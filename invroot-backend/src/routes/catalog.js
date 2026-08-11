import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { logAudit } from '../lib/audit-logger.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/catalog ───────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { search, category, page = 1, limit = 20, include_archived } = req.query;
    const offset = (page - 1) * limit;
    const conditions = ['ci.tenant_id = ?'];
    const params = [req.tenantId];
    // DELETE archives (is_active = 0) rather than removing the row. Nothing
    // filtered on it, so "deleted" items kept appearing in the list and in the
    // invoice/quote pickers. Hidden by default; ?include_archived=1 to see them.
    if (!include_archived) conditions.push('ci.is_active = 1');
    if (search) { conditions.push('(ci.name LIKE ? OR ci.sku LIKE ? OR ci.description LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
    if (category) { conditions.push('ci.category = ?'); params.push(category); }
    const where = conditions.join(' AND ');

    // Resolve the linked tax rate to an actual percentage. The column stores
    // tax_rate_id, but the invoice and quote line pickers read `tax_rate` — so
    // without this join they silently applied 0% to every catalog line.
    const items = await query(
      `SELECT ci.*, tr.rate AS tax_rate, tr.name AS tax_rate_name
       FROM catalog_items ci
       LEFT JOIN tax_rates tr ON tr.id = ci.tax_rate_id AND tr.tenant_id = ci.tenant_id
       WHERE ${where} ORDER BY ci.name ASC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]);
    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM catalog_items ci WHERE ${where}`, params);
    res.json({ success: true, data: items, total });
  } catch (err) {
    failure(res, err, { context: 'catalog' });
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
    failure(res, err, { context: 'catalog' });
  }
});

/* ── GET /api/catalog/:id ───────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [item] = await query(
      `SELECT ci.*, tr.rate AS tax_rate, tr.name AS tax_rate_name
       FROM catalog_items ci
       LEFT JOIN tax_rates tr ON tr.id = ci.tax_rate_id AND tr.tenant_id = ci.tenant_id
       WHERE ci.id = ? AND ci.tenant_id = ?`, [req.params.id, req.tenantId]);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json({ success: true, data: item });
  } catch (err) {
    failure(res, err, { context: 'catalog' });
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
    failure(res, err, { context: 'catalog' });
  }
});

/* ── DELETE /api/catalog/:id ────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    await execute('UPDATE catalog_items SET is_active = 0 WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ success: true, message: 'Item archived' });
  } catch (err) {
    failure(res, err, { context: 'catalog' });
  }
});

/* ── GET /api/catalog/categories ───────────────────── */
router.get('/meta/categories', async (req, res) => {
  try {
    const rows = await query(
      'SELECT DISTINCT category FROM catalog_items WHERE tenant_id = ? AND category IS NOT NULL AND is_active = 1',
      [req.tenantId]);
    res.json({ success: true, data: rows.map(r => r.category) });
  } catch (err) {
    failure(res, err, { context: 'catalog' });
  }
});

export default router;
