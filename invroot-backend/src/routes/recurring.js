import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/recurring ─────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const rows = await query(
      `SELECT rs.*, c.name as client_name FROM recurring_schedules rs LEFT JOIN clients c ON rs.client_id = c.id WHERE rs.tenant_id = ? ORDER BY rs.next_billing_date ASC`,
      [req.tenantId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── POST /api/recurring ────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { client_id, frequency, start_date, end_date, currency, line_items, notes, auto_send, payment_terms = 30 } = req.body;
    if (!client_id || !frequency || !start_date || !line_items?.length) {
      return res.status(400).json({ success: false, message: 'client_id, frequency, start_date, and line_items required' });
    }
    const subtotal = line_items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const taxAmount = line_items.reduce((s, i) => s + i.quantity * i.unit_price * (i.tax_rate || 0) / 100, 0);
    const result = await execute(
      `INSERT INTO recurring_schedules (tenant_id, client_id, frequency, start_date, end_date, next_billing_date, currency, line_items, subtotal, tax_amount, total_amount, notes, auto_send, payment_terms, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [req.tenantId, client_id, frequency, start_date, end_date || null, start_date, currency, JSON.stringify(line_items), subtotal, taxAmount, subtotal + taxAmount, notes, auto_send ? 1 : 0, payment_terms]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── PUT /api/recurring/:id/pause ───────────────────── */
router.put('/:id/pause', async (req, res) => {
  try {
    await execute("UPDATE recurring_schedules SET status = 'paused' WHERE id = ? AND tenant_id = ?", [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── PUT /api/recurring/:id/resume ─────────────────── */
router.put('/:id/resume', async (req, res) => {
  try {
    await execute("UPDATE recurring_schedules SET status = 'active' WHERE id = ? AND tenant_id = ?", [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── DELETE /api/recurring/:id ──────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    await execute("UPDATE recurring_schedules SET status = 'cancelled' WHERE id = ? AND tenant_id = ?", [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
