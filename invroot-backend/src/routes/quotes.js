import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { logAudit } from '../lib/audit-logger.js';
import { nextDocNumber } from '../lib/numbering.js';
import { generateInvoicePdf } from '../lib/pdf.js'; // reuse invoice template for quotes
import { getTenantWithBranding } from '../lib/branding.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* NOTE: the table is `invroot_quotes`, not `quotes` — this database is shared
   with another Trasealla product that already owns a `quotes` table. See
   migration 006 for the full explanation. */

const EDITABLE_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'];

/** Recompute money from line items so the client can never post bad totals. */
function computeTotals(lineItems, discountType, discountValue) {
  const subtotal = lineItems.reduce(
    (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const taxAmount = lineItems.reduce(
    (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0) * (Number(i.tax_rate) || 0) / 100, 0);
  const discountAmount = discountType === 'percent'
    ? subtotal * (Number(discountValue) || 0) / 100
    : Math.min(Number(discountValue) || 0, subtotal);
  return {
    subtotal,
    taxAmount,
    discountAmount,
    totalAmount: Math.max(0, subtotal + taxAmount - discountAmount),
  };
}

/** Mark quotes past their valid_until as expired, so the list is truthful. */
async function autoMarkExpired(tenantId) {
  await execute(
    `UPDATE invroot_quotes SET status = 'expired'
     WHERE tenant_id = ? AND status IN ('sent','viewed')
       AND valid_until IS NOT NULL AND valid_until < CURDATE()`,
    [tenantId]
  ).catch(() => {});
}

/* ── GET /api/quotes ────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    await autoMarkExpired(req.tenantId);

    const { status, client_id, search, page = 1, limit = 20 } = req.query;
    const conditions = ['q.tenant_id = ?'];
    const params = [req.tenantId];
    if (status)    { conditions.push('q.status = ?');    params.push(status); }
    if (client_id) { conditions.push('q.client_id = ?'); params.push(client_id); }
    if (search) {
      conditions.push('(q.quote_number LIKE ? OR c.name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const lim = Math.min(parseInt(limit) || 20, 100);
    const offset = ((parseInt(page) || 1) - 1) * lim;

    const rows = await query(
      `SELECT q.*, c.name AS client_name, c.email AS client_email
       FROM invroot_quotes q LEFT JOIN clients c ON q.client_id = c.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY q.created_at DESC LIMIT ${lim} OFFSET ${offset}`,
      params
    );
    // The count must join clients too — `search` filters on c.name.
    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM invroot_quotes q
       LEFT JOIN clients c ON q.client_id = c.id
       WHERE ${conditions.join(' AND ')}`,
      params
    );
    res.json({ success: true, data: rows, total, page: parseInt(page) || 1, limit: lim });
  } catch (err) { failure(res, err, { context: 'quotes' }); }
});

/* ── GET /api/quotes/summary ────────────────────────── */
router.get('/summary', async (req, res) => {
  try {
    await autoMarkExpired(req.tenantId);
    const rows = await query(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS amount
       FROM invroot_quotes WHERE tenant_id = ? GROUP BY status`,
      [req.tenantId]
    );
    const [{ currency }] = await query(
      "SELECT COALESCE(currency,'SAR') AS currency FROM tenants WHERE id = ?", [req.tenantId]
    ).catch(() => [{ currency: 'SAR' }]);

    const by_status = {};
    let grand_total = 0, open_total = 0;
    for (const r of rows) {
      by_status[r.status] = { count: Number(r.count), amount: Number(r.amount) };
      grand_total += Number(r.amount);
      if (['draft', 'sent', 'viewed'].includes(r.status)) open_total += Number(r.amount);
    }
    const accepted = by_status.accepted?.count || 0;
    const decided  = accepted + (by_status.rejected?.count || 0);

    res.json({ success: true, data: {
      currency, by_status, grand_total, open_total,
      acceptance_rate: decided > 0 ? Math.round((accepted / decided) * 100) : 0,
    } });
  } catch (err) { failure(res, err, { context: 'quotes' }); }
});

/* ── POST /api/quotes ───────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const {
      client_id, valid_until, currency, line_items,
      discount_type, discount_value, notes, deposit_required, lang = 'en',
    } = req.body;

    if (!client_id) return res.status(400).json({ success: false, message: 'Please choose a client.' });
    if (!Array.isArray(line_items) || !line_items.length) {
      return res.status(400).json({ success: false, message: 'Add at least one line item.' });
    }
    // Never trust a client_id from the browser — confirm it's this tenant's.
    const [client] = await query(
      'SELECT id, currency FROM clients WHERE id = ? AND tenant_id = ?', [client_id, req.tenantId]);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });

    const clean = line_items
      .filter(i => String(i.description || '').trim() && Number(i.quantity) > 0)
      .map(i => ({
        description: String(i.description).trim(),
        quantity:   Number(i.quantity),
        unit_price: Number(i.unit_price) || 0,
        tax_rate:   Number(i.tax_rate) || 0,
        total:      Number(i.quantity) * (Number(i.unit_price) || 0),
      }));
    if (!clean.length) {
      return res.status(400).json({ success: false, message: 'Every line item needs a description and a quantity above zero.' });
    }

    const { subtotal, taxAmount, discountAmount, totalAmount } =
      computeTotals(clean, discount_type, discount_value);

    const [tenantRow] = await query("SELECT COALESCE(currency,'SAR') AS currency FROM tenants WHERE id = ?", [req.tenantId]);
    const cur = currency || client.currency || tenantRow?.currency || 'SAR';

    const quoteNumber = await nextDocNumber(req.tenantId, 'quote');

    const result = await execute(
      `INSERT INTO invroot_quotes
        (tenant_id, client_id, quote_number, status, valid_until, currency, line_items,
         subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount,
         notes, deposit_required, lang)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, client_id, quoteNumber, valid_until || null, cur, JSON.stringify(clean),
       subtotal, discount_type || null, Number(discount_value) || 0, discountAmount, taxAmount, totalAmount,
       notes || null, deposit_required || null, lang]
    );

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'create',
      entity: 'quote', entityId: result.insertId, ip: req.ip });

    res.status(201).json({ success: true, id: result.insertId, quote_number: quoteNumber });
  } catch (err) { failure(res, err, { context: 'quotes' }); }
});

/* ── GET /api/quotes/:id ────────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [quote] = await query(
      `SELECT q.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
              c.billing_address AS client_address
       FROM invroot_quotes q LEFT JOIN clients c ON q.client_id = c.id
       WHERE q.id = ? AND q.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    res.json({ success: true, data: quote });
  } catch (err) { failure(res, err, { context: 'quotes' }); }
});

/* ── POST /api/quotes/:id/convert ───────────────────── */
router.post('/:id/convert', async (req, res) => {
  try {
    const [quote] = await query(
      'SELECT * FROM invroot_quotes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (quote.status === 'converted') {
      return res.status(400).json({ success: false, message: 'This quote has already been converted to an invoice.' });
    }
    if (!['accepted', 'sent', 'viewed'].includes(quote.status)) {
      return res.status(400).json({ success: false, message: 'Only a sent or accepted quote can become an invoice.' });
    }

    const invoiceNumber = await nextDocNumber(req.tenantId, 'invoice');
    const terms = Number(req.body.payment_terms) || 30;

    // MySQL returns JSON columns already parsed — re-serialise before writing.
    const lineItems = typeof quote.line_items === 'string'
      ? quote.line_items
      : JSON.stringify(quote.line_items || []);

    const result = await execute(
      `INSERT INTO invoices
        (tenant_id, client_id, quote_id, invoice_number, status, issue_date, due_date, currency,
         line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount,
         total_amount, paid_amount, notes, payment_terms, lang)
       VALUES (?, ?, ?, ?, 'draft', CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [req.tenantId, quote.client_id, quote.id, invoiceNumber, terms, quote.currency,
       lineItems, quote.subtotal, quote.discount_type, quote.discount_value,
       quote.discount_amount, quote.tax_amount, quote.total_amount, quote.notes, terms, quote.lang]
    );

    await execute(
      "UPDATE invroot_quotes SET status = 'converted', converted_invoice_id = ? WHERE id = ? AND tenant_id = ?",
      [result.insertId, quote.id, req.tenantId]);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'convert',
      entity: 'quote', entityId: quote.id, ip: req.ip });

    res.status(201).json({ success: true, invoice_id: result.insertId, invoice_number: invoiceNumber });
  } catch (err) { failure(res, err, { context: 'quotes' }); }
});

/* ── PUT /api/quotes/:id ─────────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const [existing] = await query(
      'SELECT * FROM invroot_quotes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!existing) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (existing.status === 'converted') {
      return res.status(400).json({ success: false, message: 'A converted quote can no longer be edited.' });
    }

    const {
      status, valid_until, notes, currency, line_items,
      discount_type, discount_value, deposit_required, lang,
    } = req.body;

    const fields = [];
    const params = [];
    const push = (sql, val) => { fields.push(sql); params.push(val); };

    if (status !== undefined) {
      if (!EDITABLE_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
      }
      push('status = ?', status);
      if (status === 'sent') fields.push('sent_at = NOW()'); // no bound param
    }
    if (valid_until !== undefined)      push('valid_until = ?', valid_until || null);
    if (notes !== undefined)            push('notes = ?', notes);
    if (currency !== undefined)         push('currency = ?', currency);        // was silently ignored
    if (deposit_required !== undefined) push('deposit_required = ?', deposit_required || null);
    if (lang !== undefined)             push('lang = ?', lang);

    // If the money changed, recompute totals server-side rather than trusting input.
    if (line_items !== undefined || discount_type !== undefined || discount_value !== undefined) {
      const items = line_items !== undefined
        ? line_items
        : (typeof existing.line_items === 'string' ? JSON.parse(existing.line_items || '[]') : existing.line_items || []);
      const clean = (items || [])
        .filter(i => String(i.description || '').trim() && Number(i.quantity) > 0)
        .map(i => ({
          description: String(i.description).trim(),
          quantity:   Number(i.quantity),
          unit_price: Number(i.unit_price) || 0,
          tax_rate:   Number(i.tax_rate) || 0,
          total:      Number(i.quantity) * (Number(i.unit_price) || 0),
        }));
      if (!clean.length) {
        return res.status(400).json({ success: false, message: 'Add at least one line item.' });
      }
      const dType = discount_type  !== undefined ? discount_type  : existing.discount_type;
      const dVal  = discount_value !== undefined ? discount_value : existing.discount_value;
      const t = computeTotals(clean, dType, dVal);

      push('line_items = ?', JSON.stringify(clean));
      push('discount_type = ?', dType || null);
      push('discount_value = ?', Number(dVal) || 0);   // was silently ignored
      push('discount_amount = ?', t.discountAmount);
      push('subtotal = ?', t.subtotal);
      push('tax_amount = ?', t.taxAmount);
      push('total_amount = ?', t.totalAmount);
    }

    if (!fields.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

    params.push(req.params.id, req.tenantId);
    await execute(
      `UPDATE invroot_quotes SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'update',
      entity: 'quote', entityId: Number(req.params.id), ip: req.ip });

    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'quotes' }); }
});

/* ── PUT /api/quotes/:id/status ─────────────────────── */
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!EDITABLE_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const [existing] = await query(
      'SELECT status FROM invroot_quotes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!existing) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (existing.status === 'converted') {
      return res.status(400).json({ success: false, message: 'A converted quote can no longer change status.' });
    }

    const extra = status === 'sent' ? ', sent_at = NOW()' : '';
    await execute(
      `UPDATE invroot_quotes SET status = ?${extra} WHERE id = ? AND tenant_id = ?`,
      [status, req.params.id, req.tenantId]);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: `status:${status}`,
      entity: 'quote', entityId: Number(req.params.id), ip: req.ip });

    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'quotes' }); }
});

/* ── DELETE /api/quotes/:id ─────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const [q] = await query(
      'SELECT id, status FROM invroot_quotes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!q) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (q.status === 'converted') {
      return res.status(400).json({ success: false, message: 'Cannot delete a quote that became an invoice.' });
    }
    await execute('DELETE FROM invroot_quotes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'delete',
      entity: 'quote', entityId: Number(req.params.id), ip: req.ip });

    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'quotes' }); }
});

/* ── GET /api/quotes/:id/pdf ────────────────────────── */
router.get('/:id/pdf', async (req, res) => {
  try {
    const [quote] = await query(
      `SELECT q.*, c.name AS client_name, c.email AS client_email, c.billing_address AS client_address
       FROM invroot_quotes q LEFT JOIN clients c ON q.client_id = c.id
       WHERE q.id = ? AND q.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });

    // Same funnel as invoices and receipts — see lib/branding.js for why a raw
    // tenant row here produced a quote PDF with a broken logo.
    const tenantBranding = await getTenantWithBranding(req.tenantId);

    const lang = req.query.lang || quote.lang || tenantBranding?.lang || 'en';
    const lineItems = typeof quote.line_items === 'string'
      ? JSON.parse(quote.line_items || '[]')
      : (quote.line_items || []);

    // created_at is a Date — toISOString() gives a real YYYY-MM-DD.
    // The old code called .toString() first, which produced "Sat Jul 26 2026…"
    // and split('T') then yielded garbage.
    // created_at arrives as a Date or as "YYYY-MM-DD HH:MM:SS" depending on the
    // driver's date handling — split on either separator so the PDF never shows
    // a time component.
    const issued = quote.created_at instanceof Date
      ? quote.created_at.toISOString().split('T')[0]
      : String(quote.created_at || '').split(/[T ]/)[0];

    const pdfData = {
      ...quote,
      line_items: lineItems,
      invoice_number: quote.quote_number, // the shared template reads this key
      issue_date: issued,
      due_date: quote.valid_until || '',
      _isQuote: true,
    };

    const pdfBuffer = await generateInvoicePdf(pdfData, tenantBranding, lang, 'quote');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quote-${quote.quote_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) { failure(res, err, { context: 'quotes' }); }
});

export default router;
