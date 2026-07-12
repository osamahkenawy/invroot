import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { logAudit } from '../lib/audit-logger.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

const buildWhere = (tenantId, filters) => {
  const conditions = ['c.tenant_id = ?'];
  const params = [tenantId];
  if (filters.search) {
    conditions.push('(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)');
    const s = `%${filters.search}%`;
    params.push(s, s, s);
  }
  if (filters.status) { conditions.push('c.status = ?'); params.push(filters.status); }
  if (filters.tag) { conditions.push('JSON_CONTAINS(c.tags, ?)'); params.push(JSON.stringify(filters.tag)); }
  return { where: conditions.join(' AND '), params };
};

/* ── GET /api/clients ───────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { search, status, tag, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const { where, params } = buildWhere(req.tenantId, { search, status, tag });

    const clients = await query(
      `SELECT c.*,
        (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM invoices WHERE client_id = c.id AND status NOT IN ('paid','void')) AS outstanding_balance,
        (SELECT MAX(created_at) FROM invoices WHERE client_id = c.id) AS last_invoice_date
       FROM clients c WHERE ${where}
       ORDER BY c.name ASC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [{ total }] = await query(`SELECT COUNT(*) as total FROM clients c WHERE ${where}`, params);
    res.json({ success: true, data: clients, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/clients ──────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { name, company_name, email, phone, billing_address, shipping_address, currency, payment_terms, credit_limit, preferred_language, tags, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Client name required' });

    const result = await execute(
      `INSERT INTO clients (tenant_id, name, company_name, email, phone, billing_address, shipping_address, currency, payment_terms, credit_limit, preferred_language, tags, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [req.tenantId, name, company_name || null, email, phone, billing_address, shipping_address, currency || null,
       payment_terms || 30, credit_limit || null, preferred_language || 'en',
       tags ? JSON.stringify(tags) : null, notes]
    );

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'create', entity: 'client', entityId: result.insertId });
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/clients/:id ───────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [client] = await query('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    const invoices    = await query('SELECT id, invoice_number, status, total_amount, due_date FROM invoices WHERE client_id = ? ORDER BY created_at DESC LIMIT 10', [client.id]);
    const quotes      = await query('SELECT id, quote_number, status, total_amount FROM quotes WHERE client_id = ? ORDER BY created_at DESC LIMIT 10', [client.id]);
    const payments    = await query('SELECT id, amount, method, payment_date FROM payments WHERE client_id = ? ORDER BY payment_date DESC LIMIT 10', [client.id]);
    const notes       = await query('SELECT * FROM client_notes WHERE client_id = ? ORDER BY created_at DESC', [client.id]);

    res.json({ success: true, data: { ...client, invoices, quotes, payments, notes } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── PUT /api/clients/:id ───────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const { name, company_name, email, phone, billing_address, shipping_address, currency, payment_terms, credit_limit, preferred_language, tags, notes, status } = req.body;
    const result = await execute(
      `UPDATE clients SET name=?, company_name=?, email=?, phone=?, billing_address=?, shipping_address=?,
       currency=?, payment_terms=?, credit_limit=?, preferred_language=?, tags=?, notes=?, status=?
       WHERE id=? AND tenant_id=?`,
      [name, company_name || null, email, phone, billing_address, shipping_address, currency, payment_terms, credit_limit,
       preferred_language, tags ? JSON.stringify(tags) : null, notes, status, req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Client not found' });
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'update', entity: 'client', entityId: req.params.id });
    res.json({ success: true, message: 'Client updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── DELETE /api/clients/:id ────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const [hasInvoices] = await query('SELECT id FROM invoices WHERE client_id = ? LIMIT 1', [req.params.id]);
    if (hasInvoices) {
      // Soft-delete (archive) if they have invoices
      await execute('UPDATE clients SET status = ? WHERE id = ? AND tenant_id = ?', ['archived', req.params.id, req.tenantId]);
      return res.json({ success: true, message: 'Client archived (has existing invoices)' });
    }
    await execute('DELETE FROM clients WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ success: true, message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/clients/:id/notes ────────────────────── */
router.post('/:id/notes', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ success: false, message: 'Note content required' });
    const result = await execute(
      'INSERT INTO client_notes (client_id, tenant_id, user_id, content) VALUES (?, ?, ?, ?)',
      [req.params.id, req.tenantId, req.user.id, content]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
