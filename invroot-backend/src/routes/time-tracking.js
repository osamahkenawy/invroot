import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* GET /api/time-tracking */
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status, client_id } = req.query;
    const offset = (page - 1) * limit;
    const conditions = ['t.tenant_id = ?'];
    const params = [req.tenantId];

    if (search)   { conditions.push('(t.project LIKE ? OR t.description LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (status)   { conditions.push('t.status = ?');    params.push(status);    }
    if (client_id){ conditions.push('t.client_id = ?'); params.push(client_id); }

    const where = conditions.join(' AND ');
    const rows = await query(
      `SELECT t.*, c.name AS client_name
       FROM time_entries t
       LEFT JOIN clients c ON c.id = t.client_id AND c.tenant_id = t.tenant_id
       WHERE ${where}
       ORDER BY t.entry_date DESC, t.id DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(`SELECT COUNT(*) as total FROM time_entries t WHERE ${where}`, params);
    res.json({ success: true, data: rows, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* GET /api/time-tracking/summary */
router.get('/summary', async (req, res) => {
  try {
    const [row] = await query(
      `SELECT
        COALESCE(SUM(hours), 0) AS total_hours,
        COALESCE(SUM(CASE WHEN status='unbilled' THEN hours ELSE 0 END), 0) AS unbilled_hours,
        COALESCE(SUM(CASE WHEN status='unbilled' THEN hours * hourly_rate ELSE 0 END), 0) AS unbilled_value,
        COUNT(*) AS total_entries
       FROM time_entries WHERE tenant_id = ?`, [req.tenantId]
    );
    res.json({ success: true, data: row });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* POST /api/time-tracking */
router.post('/', async (req, res) => {
  try {
    const { client_id, project, description, hours, hourly_rate, entry_date, status } = req.body;
    if (!hours) return res.status(400).json({ success: false, message: 'Hours are required' });
    const result = await execute(
      `INSERT INTO time_entries (tenant_id, client_id, project, description, hours, hourly_rate, entry_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, client_id || null, project || null, description || null,
       hours, hourly_rate || 0, entry_date || new Date().toISOString().slice(0,10), status || 'unbilled']
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* PUT /api/time-tracking/:id */
router.put('/:id', async (req, res) => {
  try {
    const { client_id, project, description, hours, hourly_rate, entry_date, status } = req.body;
    const result = await execute(
      `UPDATE time_entries SET client_id=?, project=?, description=?, hours=?,
       hourly_rate=?, entry_date=?, status=?
       WHERE id=? AND tenant_id=?`,
      [client_id, project, description, hours, hourly_rate, entry_date, status, req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Entry not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* POST /api/time-tracking/:id/mark-billed */
router.post('/:id/mark-billed', async (req, res) => {
  try {
    await execute(
      `UPDATE time_entries SET status='billed', invoice_id=? WHERE id=? AND tenant_id=?`,
      [req.body.invoice_id || null, req.params.id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* DELETE /api/time-tracking/:id */
router.delete('/:id', async (req, res) => {
  try {
    await execute('DELETE FROM time_entries WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
