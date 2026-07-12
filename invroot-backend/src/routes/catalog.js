import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { logAudit } from '../lib/audit-logger.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/catalog ───────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { search, category, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const conditions = ['tenant_id = ?'];
    const params = [req.tenantId];
    if (search) { conditions.push('(name LIKE ? OR sku LIKE ? OR description LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
    if (category) { conditions.push('category = ?'); params.push(category); }
    const where = conditions.join(' AND ');

    const items = await query(`SELECT * FROM catalog_items WHERE ${where} ORDER BY name ASC LIMIT ? OFFSET ?`, [...params, parseInt(limit), parseInt(offset)]);
    const [{ total }] = await query(`SELECT COUNT(*) as total FROM catalog_items WHERE ${where}`, params);
    res.json({ success: true, data: items, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/catalog ──────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { name, description, sku, unit_price, cost_price, unit_of_measure, tax_rate_id, category, tags, is_service } = req.body;
    if (!name || unit_price === undefined) return res.status(400).json({ success: false, message: 'name and unit_price required' });
    const result = await execute(
      `INSERT INTO catalog_items (tenant_id, name, description, sku, unit_price, cost_price, unit_of_measure, tax_rate_id, category, tags, is_service)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, name, description, sku, unit_price, cost_price, unit_of_measure, tax_rate_id, category, tags ? JSON.stringify(tags) : null, is_service ? 1 : 0]
    );
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'create', entity: 'catalog_item', entityId: result.insertId });
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/catalog/:id ───────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [item] = await query('SELECT * FROM catalog_items WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── PUT /api/catalog/:id ───────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const { name, description, sku, unit_price, cost_price, unit_of_measure, tax_rate_id, category, tags, is_service, is_active } = req.body;
    const result = await execute(
      `UPDATE catalog_items SET name=?, description=?, sku=?, unit_price=?, cost_price=?,
       unit_of_measure=?, tax_rate_id=?, category=?, tags=?, is_service=?, is_active=?
       WHERE id=? AND tenant_id=?`,
      [name, description, sku, unit_price, cost_price, unit_of_measure, tax_rate_id, category,
       tags ? JSON.stringify(tags) : null, is_service ? 1 : 0, is_active !== false ? 1 : 0,
       req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json({ success: true, message: 'Item updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── DELETE /api/catalog/:id ────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    await execute('UPDATE catalog_items SET is_active = 0 WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ success: true, message: 'Item archived' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/catalog/categories ───────────────────── */
router.get('/meta/categories', async (req, res) => {
  try {
    const rows = await query('SELECT DISTINCT category FROM catalog_items WHERE tenant_id = ? AND category IS NOT NULL', [req.tenantId]);
    res.json({ success: true, data: rows.map(r => r.category) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
