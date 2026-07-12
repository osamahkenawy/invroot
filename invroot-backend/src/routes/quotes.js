import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { logAudit } from '../lib/audit-logger.js';
import { nextDocNumber } from '../lib/numbering.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/quotes ────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { status, client_id, page = 1, limit = 20 } = req.query;
    const conditions = ['q.tenant_id = ?'];
    const params = [req.tenantId];
    if (status) { conditions.push('q.status = ?'); params.push(status); }
    if (client_id) { conditions.push('q.client_id = ?'); params.push(client_id); }
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const rows = await query(
      `SELECT q.*, c.name as client_name FROM quotes q LEFT JOIN clients c ON q.client_id = c.id
       WHERE ${conditions.join(' AND ')} ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(`SELECT COUNT(*) as total FROM quotes q WHERE ${conditions.join(' AND ')}`, params);
    res.json({ success: true, data: rows, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── POST /api/quotes ───────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { client_id, valid_until, currency, line_items, discount_type, discount_value, notes, deposit_required, lang = 'en' } = req.body;
    if (!client_id || !line_items?.length) return res.status(400).json({ success: false, message: 'client_id and line_items required' });

    const subtotal = line_items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const taxAmount = line_items.reduce((s, i) => s + i.quantity * i.unit_price * (i.tax_rate || 0) / 100, 0);
    let discountAmount = discount_type === 'percent' ? subtotal * (discount_value || 0) / 100 : discount_value || 0;
    const totalAmount = subtotal + taxAmount - discountAmount;

    const quoteNumber = await nextDocNumber(req.tenantId, 'quote');

    const result = await execute(
      `INSERT INTO quotes (tenant_id, client_id, quote_number, status, valid_until, currency, line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount, notes, deposit_required, lang)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, client_id, quoteNumber, valid_until, currency, JSON.stringify(line_items), subtotal, discount_type, discount_value, discountAmount, taxAmount, totalAmount, notes, deposit_required, lang]
    );
    res.status(201).json({ success: true, id: result.insertId, quote_number: quoteNumber });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── GET /api/quotes/:id ────────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [quote] = await query(`SELECT q.*, c.name as client_name, c.email as client_email FROM quotes q LEFT JOIN clients c ON q.client_id = c.id WHERE q.id = ? AND q.tenant_id = ?`, [req.params.id, req.tenantId]);
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    res.json({ success: true, data: quote });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── POST /api/quotes/:id/convert ───────────────────── */
router.post('/:id/convert', async (req, res) => {
  try {
    const [quote] = await query('SELECT * FROM quotes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    if (!['accepted', 'sent'].includes(quote.status)) return res.status(400).json({ success: false, message: 'Only accepted/sent quotes can be converted' });

    const invoiceNumber = await nextDocNumber(quote.tenant_id, 'invoice');
    const dueDate = req.body.due_date || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

    const result = await execute(
      `INSERT INTO invoices (tenant_id, client_id, quote_id, invoice_number, status, issue_date, due_date, currency, line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount, paid_amount, notes, lang)
       VALUES (?, ?, ?, ?, 'draft', CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [quote.tenant_id, quote.client_id, quote.id, invoiceNumber, dueDate, quote.currency, quote.line_items, quote.subtotal, quote.discount_type, quote.discount_value, quote.discount_amount, quote.tax_amount, quote.total_amount, quote.notes, quote.lang]
    );
    await execute("UPDATE quotes SET status = 'converted', converted_invoice_id = ? WHERE id = ?", [result.insertId, quote.id]);
    res.status(201).json({ success: true, invoice_id: result.insertId, invoice_number: invoiceNumber });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── PUT /api/quotes/:id ─────────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const { status, valid_until, notes, currency, discount_value } = req.body;
    const allowed = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
    const fields = [];
    const params = [];
    if (status && allowed.includes(status)) { fields.push('status = ?'); params.push(status); }
    if (valid_until) { fields.push('valid_until = ?'); params.push(valid_until); }
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }
    if (!fields.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    params.push(req.params.id, req.tenantId);
    await execute(`UPDATE quotes SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── PUT /api/quotes/:id/status ─────────────────────── */
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    await execute('UPDATE quotes SET status = ? WHERE id = ? AND tenant_id = ?', [status, req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
