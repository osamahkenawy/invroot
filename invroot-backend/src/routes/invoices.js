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

/* ── Helper: auto-mark overdue invoices at query time ─────────── */
async function autoMarkOverdue(tenantId) {
  await execute(
    `UPDATE invoices
     SET status = 'overdue'
     WHERE tenant_id = ? AND status IN ('sent','viewed','partial')
       AND due_date < CURDATE()`,
    [tenantId]
  );
}

/* ── Helper: recalculate paid_amount + status after payment change */
async function recalcInvoice(invoiceId) {
  const [{ total_paid }] = await query(
    'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE invoice_id = ?',
    [invoiceId]
  );
  const [{ cn_applied }] = await query(
    `SELECT COALESCE(SUM(amount), 0) AS cn_applied
     FROM credit_notes WHERE invoice_id = ? AND status = 'applied'`,
    [invoiceId]
  );
  const effectivePaid = parseFloat(total_paid) + parseFloat(cn_applied);

  const [inv] = await query('SELECT total_amount, status FROM invoices WHERE id = ?', [invoiceId]);
  if (!inv) return;

  const total = parseFloat(inv.total_amount);
  let newStatus = inv.status;

  if (effectivePaid <= 0) {
    // No payment — revert to sent/overdue depending on due date
    const [{ is_overdue }] = await query(
      'SELECT (due_date < CURDATE()) AS is_overdue FROM invoices WHERE id = ?', [invoiceId]
    );
    newStatus = is_overdue ? 'overdue' : (inv.status === 'partial' ? 'sent' : inv.status);
  } else if (effectivePaid >= total) {
    newStatus = 'paid';
  } else {
    newStatus = 'partial';
  }

  await execute(
    'UPDATE invoices SET paid_amount = ?, status = ?, paid_at = ? WHERE id = ?',
    [
      effectivePaid,
      newStatus,
      newStatus === 'paid' ? new Date() : null,
      invoiceId,
    ]
  );
}

/* ══════════════════════════════════════════════════════════════
   GET /api/invoices/summary
   Financial overview: totals, status breakdown, age analysis
   ══════════════════════════════════════════════════════════════ */
router.get('/summary', async (req, res) => {
  try {
    await autoMarkOverdue(req.tenantId);

    // ── Status buckets ─────────────────────────────────────────
    const rows = await query(
      `SELECT
         status,
         COUNT(*)                                    AS count,
         COALESCE(SUM(total_amount), 0)              AS total,
         COALESCE(SUM(paid_amount), 0)               AS paid,
         COALESCE(SUM(total_amount - paid_amount), 0) AS outstanding
       FROM invoices
       WHERE tenant_id = ? AND status != 'void'
       GROUP BY status`,
      [req.tenantId]
    );

    const byStatus = {};
    let grand_total = 0, grand_paid = 0, grand_outstanding = 0, grand_overdue = 0;

    for (const r of rows) {
      byStatus[r.status] = { count: r.count, total: +r.total, paid: +r.paid, outstanding: +r.outstanding };
      if (r.status !== 'draft') {
        grand_total       += +r.total;
        grand_paid        += +r.paid;
        grand_outstanding += +r.outstanding;
      }
      if (r.status === 'overdue') grand_overdue += +r.outstanding;
    }

    // ── Age analysis (unpaid/partial/overdue only) ─────────────
    const ageBuckets = await query(
      `SELECT
         CASE
           WHEN due_date >= CURDATE()                        THEN 'current'
           WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 1  AND 30  THEN '1_30'
           WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND 60  THEN '31_60'
           WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND 90  THEN '61_90'
           ELSE '90plus'
         END AS bucket,
         COUNT(*)                                            AS count,
         COALESCE(SUM(total_amount - paid_amount), 0)       AS amount
       FROM invoices
       WHERE tenant_id = ? AND status IN ('sent','viewed','partial','overdue')
       GROUP BY bucket`,
      [req.tenantId]
    );

    const ageMap = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90plus': 0 };
    const ageCount = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90plus': 0 };
    for (const b of ageBuckets) { ageMap[b.bucket] = +b.amount; ageCount[b.bucket] = +b.count; }

    const age_analysis = [
      { bucket: 'current', label: 'Not yet due',   amount: ageMap.current,  count: ageCount.current  },
      { bucket: '1_30',    label: '1–30 days',     amount: ageMap['1_30'],  count: ageCount['1_30']  },
      { bucket: '31_60',   label: '31–60 days',    amount: ageMap['31_60'], count: ageCount['31_60'] },
      { bucket: '61_90',   label: '61–90 days',    amount: ageMap['61_90'], count: ageCount['61_90'] },
      { bucket: '90plus',  label: '90+ days',      amount: ageMap['90plus'],count: ageCount['90plus']},
    ];

    // ── Credit notes applied globally ─────────────────────────
    const [{ cn_applied }] = await query(
      `SELECT COALESCE(SUM(amount), 0) AS cn_applied
       FROM credit_notes WHERE tenant_id = ? AND status = 'applied'`,
      [req.tenantId]
    );

    // ── Tenant default currency ────────────────────────────────
    const [{ currency }] = await query(
      'SELECT COALESCE(currency, \'SAR\') AS currency FROM tenants WHERE id = ?', [req.tenantId]
    ).catch(() => [{ currency: 'SAR' }]);

    res.json({
      success: true,
      data: {
        currency,
        grand_total,
        grand_paid,
        grand_outstanding,
        grand_overdue,
        cn_applied: +cn_applied,
        by_status: byStatus,
        age_analysis,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/invoices/:id/relations
   Returns all documents related to this invoice
   ══════════════════════════════════════════════════════════════ */
router.get('/:id/relations', async (req, res) => {
  try {
    const [inv] = await query(
      'SELECT id, quote_id, recurring_schedule_id, parent_invoice_id, relation_type FROM invoices WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const [quote, recurring, payments, creditNotes, parent, children, siblings] = await Promise.all([
      // Linked quote
      inv.quote_id
        ? query('SELECT id, quote_number, status, total_amount, currency FROM quotes WHERE id = ?', [inv.quote_id])
        : Promise.resolve([]),

      // Recurring schedule
      inv.recurring_schedule_id
        ? query('SELECT id, name, frequency, status FROM recurring_invoices WHERE id = ?', [inv.recurring_schedule_id])
        : Promise.resolve([]),

      // Payment history
      query(
        'SELECT id, amount, method, payment_date, reference, notes FROM payments WHERE invoice_id = ? ORDER BY payment_date ASC',
        [inv.id]
      ),

      // Credit notes applied
      query(
        'SELECT id, cn_number, amount, reason, status, created_at FROM credit_notes WHERE invoice_id = ? ORDER BY created_at DESC',
        [inv.id]
      ),

      // Parent invoice (this is a revision)
      inv.parent_invoice_id
        ? query('SELECT id, invoice_number, status, total_amount, currency, relation_type FROM invoices WHERE id = ?', [inv.parent_invoice_id])
        : Promise.resolve([]),

      // Child revisions of this invoice
      query(
        'SELECT id, invoice_number, status, total_amount, currency, relation_type FROM invoices WHERE parent_invoice_id = ? AND tenant_id = ?',
        [inv.id, req.tenantId]
      ),

      // Recurring siblings (other invoices in same schedule, excluding self)
      inv.recurring_schedule_id
        ? query(
            `SELECT id, invoice_number, status, total_amount, currency, issue_date
             FROM invoices WHERE recurring_schedule_id = ? AND tenant_id = ? AND id != ?
             ORDER BY issue_date DESC LIMIT 10`,
            [inv.recurring_schedule_id, req.tenantId, inv.id]
          )
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: {
        quote:              quote[0] || null,
        recurring_schedule: recurring[0] || null,
        recurring_siblings: siblings,
        payments,
        credit_notes:       creditNotes,
        parent_invoice:     parent[0] || null,
        child_revisions:    children,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/invoices
   List with balance_due + days_overdue computed columns
   ══════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    await autoMarkOverdue(req.tenantId);

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
      `SELECT i.*,
              c.name  AS client_name,
              c.email AS client_email,
              -- Derived fields
              ROUND(i.total_amount - i.paid_amount, 4)  AS balance_due,
              GREATEST(0, DATEDIFF(CURDATE(), i.due_date)) AS days_overdue,
              -- Has relations flags
              (i.quote_id IS NOT NULL)               AS has_quote,
              (i.recurring_schedule_id IS NOT NULL)  AS has_recurring,
              (i.parent_invoice_id IS NOT NULL)      AS has_parent,
              (SELECT COUNT(*) FROM credit_notes cn WHERE cn.invoice_id = i.id) AS cn_count,
              (SELECT COUNT(*) FROM payments p     WHERE p.invoice_id  = i.id) AS payment_count
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
      parent_invoice_id = null, relation_type = 'original',
    } = req.body;

    if (!client_id || !line_items?.length) {
      return res.status(400).json({ success: false, message: 'client_id and line_items required' });
    }

    const subtotal = line_items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const taxAmount = line_items.reduce((sum, item) => {
      const lineTotal = item.quantity * item.unit_price;
      return sum + (lineTotal * (item.tax_rate || 0) / 100);
    }, 0);
    let discountAmount = 0;
    if (discount_type === 'percent') discountAmount = subtotal * (discount_value || 0) / 100;
    else if (discount_type === 'fixed') discountAmount = discount_value || 0;
    const totalAmount = subtotal + taxAmount - discountAmount;

    const invoiceNumber = await nextDocNumber(req.tenantId, 'invoice');

    const result = await execute(
      `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
        line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount,
        paid_amount, notes, memo, payment_terms, po_number, lang, stamp_url, signature_url, signatory_id,
        parent_invoice_id, relation_type)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, client_id, invoiceNumber, issue_date, due_date, currency,
       JSON.stringify(line_items), subtotal, discount_type, discount_value, discountAmount,
       taxAmount, totalAmount, notes, memo, payment_terms, po_number || null, lang,
       stamp_url, signature_url, signatory_id, parent_invoice_id, relation_type]
    );

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'create', entity: 'invoice', entityId: result.insertId });
    await dispatchWebhookEvent({ tenantId: req.tenantId, event: 'invoice.created', payload: { id: result.insertId, invoice_number: invoiceNumber } });

    res.status(201).json({ success: true, id: result.insertId, invoice_number: invoiceNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/invoices/:id/payments ────────────────── */
router.post('/:id/payments', async (req, res) => {
  try {
    const [inv] = await query(
      'SELECT id, total_amount, paid_amount, status FROM invoices WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (inv.status === 'void') return res.status(400).json({ success: false, message: 'Cannot record payment on a voided invoice' });
    if (inv.status === 'paid') return res.status(400).json({ success: false, message: 'Invoice is already fully paid. Use a credit note for overpayment.' });

    const { amount, method, payment_date, reference, notes } = req.body;
    if (!amount || !method) return res.status(400).json({ success: false, message: 'amount and method are required' });

    const balance = parseFloat(inv.total_amount) - parseFloat(inv.paid_amount);
    const overpayment = parseFloat(amount) > balance;

    await execute(
      `INSERT INTO payments (tenant_id, invoice_id, client_id, amount, method, payment_date, reference, notes)
       SELECT ?, ?, client_id, ?, ?, ?, ?, ? FROM invoices WHERE id = ?`,
      [req.tenantId, inv.id, amount, method, payment_date || new Date().toISOString().slice(0,10), reference || null, notes || null, inv.id]
    );

    await recalcInvoice(inv.id);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'payment', entity: 'invoice', entityId: inv.id });

    res.status(201).json({ success: true, overpayment, message: overpayment ? 'Payment recorded (overpayment — consider issuing a credit note for the difference)' : 'Payment recorded' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── DELETE /api/invoices/:id/payments/:paymentId ────── */
router.delete('/:id/payments/:paymentId', async (req, res) => {
  try {
    const [pmt] = await query('SELECT id, invoice_id FROM payments WHERE id = ? AND invoice_id = ?', [req.params.paymentId, req.params.id]);
    if (!pmt) return res.status(404).json({ success: false, message: 'Payment not found' });

    await execute('DELETE FROM payments WHERE id = ?', [pmt.id]);
    await recalcInvoice(pmt.invoice_id);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'delete_payment', entity: 'invoice', entityId: pmt.invoice_id });

    res.json({ success: true, message: 'Payment deleted and invoice recalculated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── GET /api/invoices/:id ──────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [invoice] = await query(
      `SELECT i.*,
              c.name AS client_name, c.email AS client_email,
              c.billing_address AS client_address, c.preferred_language AS client_lang,
              ROUND(i.total_amount - i.paid_amount, 4) AS balance_due,
              GREATEST(0, DATEDIFF(CURDATE(), i.due_date)) AS days_overdue
       FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
       WHERE i.id = ? AND i.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const payments = await query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date ASC', [invoice.id]);
    const creditNotes = await query('SELECT * FROM credit_notes WHERE invoice_id = ? ORDER BY created_at DESC', [invoice.id]);

    res.json({ success: true, data: { ...invoice, payments, credit_notes: creditNotes } });
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
    const relationType = req.body.relation_type || 'duplicate';

    const result = await execute(
      `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
        line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount,
        paid_amount, notes, lang, parent_invoice_id, relation_type)
       VALUES (?, ?, ?, 'draft', CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [inv.tenant_id, inv.client_id, newNumber, inv.due_date, inv.currency,
       inv.line_items, inv.subtotal, inv.discount_type, inv.discount_value,
       inv.discount_amount, inv.tax_amount, inv.total_amount, inv.notes, inv.lang,
       inv.id, relationType]
    );

    res.status(201).json({ success: true, id: result.insertId, invoice_number: newNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
