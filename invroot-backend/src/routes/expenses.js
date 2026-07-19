import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* GET /api/expenses */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status, category } = req.query;
    const offset = (page - 1) * limit;
    const conditions = ['tenant_id = ?'];
    const params = [req.tenantId];

    if (search)   { conditions.push('(vendor_name LIKE ? OR reference LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (status)   { conditions.push('status = ?');   params.push(status);   }
    if (category) { conditions.push('category = ?'); params.push(category); }

    const where = conditions.join(' AND ');
    const rows = await query(
      `SELECT * FROM expenses WHERE ${where} ORDER BY expense_date DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(`SELECT COUNT(*) as total FROM expenses WHERE ${where}`, params);
    res.json({ success: true, data: rows, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* GET /api/expenses/summary */
router.get('/summary', async (req, res) => {
  try {
    const [row] = await query(
      `SELECT
        COALESCE(SUM(amount), 0) AS total,
        COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END), 0) AS paid,
        COALESCE(SUM(CASE WHEN status='unpaid' THEN amount ELSE 0 END), 0) AS unpaid,
        COALESCE(SUM(CASE WHEN status='overdue' THEN amount ELSE 0 END), 0) AS overdue,
        COUNT(*) AS count
       FROM expenses WHERE tenant_id = ?`, [req.tenantId]
    );
    res.json({ success: true, data: row });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* GET /api/expenses/categories */
router.get('/categories', async (req, res) => {
  try {
    const rows = await query(
      `SELECT category, COUNT(*) as count, SUM(amount) as total
       FROM expenses WHERE tenant_id = ? AND category IS NOT NULL
       GROUP BY category ORDER BY total DESC`,
      [req.tenantId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* POST /api/expenses */
router.post('/', async (req, res) => {
  try {
    const { reference, vendor_name, category, amount, currency, expense_date, due_date, status, payment_method, notes } = req.body;
    if (!amount) return res.status(400).json({ success: false, message: 'Amount is required' });

    const result = await execute(
      `INSERT INTO expenses (tenant_id, reference, vendor_name, category, amount, currency, expense_date, due_date, status, payment_method, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, reference || null, vendor_name || null, category || null,
       amount, currency || 'SAR', expense_date || null, due_date || null,
       status || 'unpaid', payment_method || null, notes || null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* PUT /api/expenses/:id */
router.put('/:id', async (req, res) => {
  try {
    const { reference, vendor_name, category, amount, currency, expense_date, due_date, status, payment_method, notes } = req.body;
    const result = await execute(
      `UPDATE expenses SET reference=?, vendor_name=?, category=?, amount=?, currency=?,
       expense_date=?, due_date=?, status=?, payment_method=?, notes=?
       WHERE id=? AND tenant_id=?`,
      [reference, vendor_name, category, amount, currency, expense_date, due_date,
       status, payment_method, notes, req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Expense not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* POST /api/expenses/:id/mark-paid */
router.post('/:id/mark-paid', async (req, res) => {
  try {
    await execute(
      `UPDATE expenses SET status='paid', payment_method=? WHERE id=? AND tenant_id=?`,
      [req.body.payment_method || 'cash', req.params.id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* DELETE /api/expenses/:id */
router.delete('/:id', async (req, res) => {
  try {
    await execute('DELETE FROM expenses WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
