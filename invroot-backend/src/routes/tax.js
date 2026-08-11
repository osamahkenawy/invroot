import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/role-gate.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/tax ───────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM tax_rates WHERE tenant_id = ? ORDER BY name', [req.tenantId]);
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'tax' }); }
});

/* ── POST /api/tax ──────────────────────────────────── */
router.post('/', requireOwner, async (req, res) => {
  try {
    const { name, rate, type, is_compound, is_inclusive, is_default } = req.body;
    if (!name || rate === undefined) return res.status(400).json({ success: false, message: 'name and rate required' });
    const result = await execute(
      `INSERT INTO tax_rates (tenant_id, name, rate, type, is_compound, is_inclusive, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [req.tenantId, name, rate, type || 'VAT', is_compound ? 1 : 0, is_inclusive ? 1 : 0, is_default ? 1 : 0]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { failure(res, err, { context: 'tax' }); }
});

/* ── PUT /api/tax/:id ───────────────────────────────── */
router.put('/:id', requireOwner, async (req, res) => {
  try {
    const { name, rate, type, is_compound, is_inclusive, is_default, is_active } = req.body;
    await execute(
      `UPDATE tax_rates SET name=?, rate=?, type=?, is_compound=?, is_inclusive=?, is_default=?, is_active=? WHERE id=? AND tenant_id=?`,
      [name, rate, type, is_compound ? 1 : 0, is_inclusive ? 1 : 0, is_default ? 1 : 0, is_active ? 1 : 0, req.params.id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'tax' }); }
});

/* ── DELETE /api/tax/:id ────────────────────────────── */
router.delete('/:id', requireOwner, async (req, res) => {
  try {
    await execute('UPDATE tax_rates SET is_active = 0 WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'tax' }); }
});

/* ── GET /api/tax/report ────────────────────────────── */
router.get('/report', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    if (!date_from || !date_to) return res.status(400).json({ success: false, message: 'date_from and date_to required' });
    const rows = await query(
      `SELECT currency,
        SUM(subtotal) as gross_sales,
        SUM(discount_amount) as total_discounts,
        SUM(tax_amount) as total_tax,
        SUM(total_amount) as net_sales,
        COUNT(*) as invoice_count
       FROM invoices
       WHERE tenant_id = ? AND status NOT IN ('void','draft')
         AND issue_date BETWEEN ? AND ?
       GROUP BY currency`,
      [req.tenantId, date_from, date_to]
    );
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'tax' }); }
});

export default router;
