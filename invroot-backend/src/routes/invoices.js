import express from 'express';
import { query, execute, transaction } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { generateInvoicePdf } from '../lib/pdf.js';
import { sendInvoiceEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit-logger.js';
import { dispatchWebhookEvent } from '../lib/webhook-dispatcher.js';
import { nextDocNumber } from '../lib/numbering.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── Helper: build tenant object with stamp + default signatory ── */
async function getTenantWithBranding(tenantId) {
  const [tenant] = await query(
    'SELECT company_name, logo_url, address, tax_id, footer_text, invoice_terms, stamp_url, currency, lang FROM tenants WHERE id = ?',
    [tenantId]
  );
  if (!tenant) return {};
  const [sig] = await query(
    'SELECT signature_url, name AS signatory_name, title AS signatory_title FROM company_signatories WHERE tenant_id = ? AND is_default = 1 LIMIT 1',
    [tenantId]
  );
  return { ...tenant, ...(sig || {}) };
}

/* ── GET /api/invoices ──────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { status, client_id, search, date_from, date_to, page = 1, limit = 20 } = req.query;
    const conditions = ['i.tenant_id = ?'];
    const params = [req.tenantId];
    if (status)    { conditions.push('i.status = ?');        params.push(status); }
    if (client_id) { conditions.push('i.client_id = ?');     params.push(client_id); }
    if (search)    { conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ?)'); const s = `%${search}%`; params.push(s, s); }
    if (date_from) { conditions.push('i.issue_date >= ?');   params.push(date_from); }
    if (date_to)   { conditions.push('i.issue_date <= ?');   params.push(date_to); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = conditions.join(' AND ');

    const invoices = await query(
      `SELECT i.*, c.name as client_name, c.email as client_email
       FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
       WHERE ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE ${where}`, params
    );

    res.json({ success: true, data: invoices, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/invoices ─────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const {
      client_id, issue_date, due_date, currency,
      line_items, discount_type, discount_value,
      notes, memo, payment_terms, po_number, lang = 'en',
      stamp_url, signature_url, signatory_id,
    } = req.body;

    if (!client_id || !line_items?.length) {
      return res.status(400).json({ success: false, message: 'client_id and line_items required' });
    }

    // Calculate totals
    const subtotal = line_items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const taxAmount = line_items.reduce((sum, item) => {
      const lineTotal = item.quantity * item.unit_price;
      return sum + (lineTotal * (item.tax_rate || 0) / 100);
    }, 0);
    let discountAmount = 0;
    if (discount_type === 'percent') discountAmount = subtotal * (discount_value || 0) / 100;
    else if (discount_type === 'fixed') discountAmount = discount_value || 0;
    const totalAmount = subtotal + taxAmount - discountAmount;

    // Generate invoice number
    const invoiceNumber = await nextDocNumber(req.tenantId, 'invoice');

    const result = await execute(
      `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
        line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount,
        paid_amount, notes, memo, payment_terms, po_number, lang, stamp_url, signature_url, signatory_id)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, client_id, invoiceNumber, issue_date, due_date, currency,
       JSON.stringify(line_items), subtotal, discount_type, discount_value, discountAmount,
       taxAmount, totalAmount, notes, memo, payment_terms, po_number || null, lang, stamp_url, signature_url, signatory_id]
    );

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'create', entity: 'invoice', entityId: result.insertId });
    await dispatchWebhookEvent({ tenantId: req.tenantId, event: 'invoice.created', payload: { id: result.insertId, invoice_number: invoiceNumber } });

    res.status(201).json({ success: true, id: result.insertId, invoice_number: invoiceNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/invoices/:id ──────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [invoice] = await query(
      `SELECT i.*, c.name as client_name, c.email as client_email, c.billing_address as client_address,
              c.preferred_language as client_lang
       FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
       WHERE i.id = ? AND i.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const payments = await query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC', [invoice.id]);
    res.json({ success: true, data: { ...invoice, payments } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── PUT /api/invoices/:id ──────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const [inv] = await query('SELECT status FROM invoices WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (['paid', 'void'].includes(inv.status)) return res.status(400).json({ success: false, message: `Cannot edit a ${inv.status} invoice` });

    const { issue_date, due_date, currency, line_items, discount_type, discount_value, notes, memo, payment_terms, po_number, lang, stamp_url, signature_url, signatory_id } = req.body;

    const subtotal = line_items.reduce((s, i) => s + (i.quantity * i.unit_price), 0);
    const taxAmount = line_items.reduce((s, i) => s + (i.quantity * i.unit_price) * (i.tax_rate || 0) / 100, 0);
    let discountAmount = 0;
    if (discount_type === 'percent') discountAmount = subtotal * (discount_value || 0) / 100;
    else if (discount_type === 'fixed') discountAmount = discount_value || 0;
    const totalAmount = subtotal + taxAmount - discountAmount;

    await execute(
      `UPDATE invoices SET issue_date=?, due_date=?, currency=?, line_items=?, subtotal=?,
       discount_type=?, discount_value=?, discount_amount=?, tax_amount=?, total_amount=?,
       notes=?, memo=?, payment_terms=?, po_number=?, lang=?, stamp_url=?, signature_url=?, signatory_id=?
       WHERE id=? AND tenant_id=?`,
      [issue_date, due_date, currency, JSON.stringify(line_items), subtotal,
       discount_type, discount_value, discountAmount, taxAmount, totalAmount,
       notes, memo, payment_terms, po_number || null, lang, stamp_url, signature_url, signatory_id, req.params.id, req.tenantId]
    );
    res.json({ success: true, message: 'Invoice updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/invoices/:id/send ────────────────────── */
router.post('/:id/send', async (req, res) => {
  try {
    const [invoice] = await query(
      `SELECT i.*, c.email as client_email, c.name as client_name, c.preferred_language as client_lang,
              t.company_name, t.logo_url, t.address, t.tax_id, t.footer_text
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       JOIN tenants t ON i.tenant_id = t.id
       WHERE i.id = ? AND i.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const lang = req.body.lang || invoice.lang || invoice.client_lang || 'en';
    const tenantBranding = await getTenantWithBranding(req.tenantId);
    const pdfBuffer = await generateInvoicePdf(invoice, tenantBranding, lang);

    await sendInvoiceEmail({
      to: invoice.client_email,
      clientName: invoice.client_name,
      invoiceNumber: invoice.invoice_number,
      dueDate: invoice.due_date,
      totalAmount: invoice.total_amount,
      currency: invoice.currency,
      pdfBuffer,
      lang,
    });

    await execute("UPDATE invoices SET status = 'sent', sent_at = NOW() WHERE id = ?", [invoice.id]);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'send', entity: 'invoice', entityId: invoice.id });
    await dispatchWebhookEvent({ tenantId: req.tenantId, event: 'invoice.sent', payload: { id: invoice.id } });

    res.json({ success: true, message: 'Invoice sent' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/invoices/:id/pdf ──────────────────────── */
router.get('/:id/pdf', async (req, res) => {
  try {
    const [invoice] = await query(
      `SELECT i.*, c.name as client_name, c.email as client_email, c.billing_address as client_address,
              t.company_name, t.logo_url, t.address, t.tax_id, t.footer_text
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       JOIN tenants t ON i.tenant_id = t.id
       WHERE i.id = ? AND i.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const lang = req.query.lang || invoice.lang || 'en';
    const tenantBranding = await getTenantWithBranding(req.tenantId);
    const pdfBuffer = await generateInvoicePdf(invoice, tenantBranding, lang);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/invoices/:id/void ────────────────────── */
router.post('/:id/void', async (req, res) => {
  try {
    const result = await execute(
      "UPDATE invoices SET status = 'void' WHERE id = ? AND tenant_id = ? AND status NOT IN ('paid')",
      [req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(400).json({ success: false, message: 'Cannot void this invoice' });
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'void', entity: 'invoice', entityId: req.params.id });
    res.json({ success: true, message: 'Invoice voided' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/invoices/:id/duplicate ───────────────── */
router.post('/:id/duplicate', async (req, res) => {
  try {
    const [inv] = await query('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const newNumber = await nextDocNumber(req.tenantId, 'invoice');

    const result = await execute(
      `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
        line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount, paid_amount, notes, lang)
       VALUES (?, ?, ?, 'draft', CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [inv.tenant_id, inv.client_id, newNumber, inv.due_date, inv.currency,
       inv.line_items, inv.subtotal, inv.discount_type, inv.discount_value,
       inv.discount_amount, inv.tax_amount, inv.total_amount, inv.notes, inv.lang]
    );

    res.status(201).json({ success: true, id: result.insertId, invoice_number: newNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
