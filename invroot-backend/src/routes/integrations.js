import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/role-gate.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/integrations ──────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM integrations WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'integrations' }); }
});

/* ── POST /api/integrations ─────────────────────────── */
router.post('/', requireOwner, async (req, res) => {
  try {
    const { provider, credentials, field_mapping, sync_frequency } = req.body;
    if (!provider) return res.status(400).json({ success: false, message: 'provider required' });
    const result = await execute(
      `INSERT INTO integrations (tenant_id, provider, credentials, field_mapping, sync_frequency, status)
       VALUES (?, ?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE credentials=VALUES(credentials), field_mapping=VALUES(field_mapping), status='active'`,
      [req.tenantId, provider, JSON.stringify(credentials || {}), JSON.stringify(field_mapping || {}), sync_frequency || 'hourly']
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { failure(res, err, { context: 'integrations' }); }
});

/* ── DELETE /api/integrations/:provider ─────────────── */
router.delete('/:provider', requireOwner, async (req, res) => {
  try {
    await execute("UPDATE integrations SET status = 'disconnected' WHERE provider = ? AND tenant_id = ?", [req.params.provider, req.tenantId]);
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'integrations' }); }
});

/* ── GET /api/integrations/api-keys ─────────────────── */
router.get('/api-keys', async (req, res) => {
  try {
    const keys = await query('SELECT id, name, scope, created_at, last_used_at FROM api_keys WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: keys });
  } catch (err) { failure(res, err, { context: 'integrations' }); }
});

/* ── POST /api/integrations/api-keys ────────────────── */
router.post('/api-keys', requireOwner, async (req, res) => {
  try {
    const { name, scope } = req.body;
    const { default: crypto } = await import('crypto');
    const key = 'invroot_' + crypto.randomBytes(32).toString('hex');
    const result = await execute(
      'INSERT INTO api_keys (tenant_id, name, key_hash, scope) VALUES (?, ?, ?, ?)',
      [req.tenantId, name, key, JSON.stringify(scope || ['read'])]
    );
    res.status(201).json({ success: true, id: result.insertId, key }); // key shown once
  } catch (err) { failure(res, err, { context: 'integrations' }); }
});

/* ── DELETE /api/integrations/api-keys/:id ──────────── */
router.delete('/api-keys/:id', requireOwner, async (req, res) => {
  try {
    await execute('DELETE FROM api_keys WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'integrations' }); }
});

/* ── GET /api/integrations/webhooks ─────────────────── */
router.get('/webhooks', async (req, res) => {
  try {
    const rows = await query('SELECT id, url, events, is_active, created_at FROM webhook_endpoints WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'integrations' }); }
});

/* ── POST /api/integrations/webhooks ────────────────── */
router.post('/webhooks', requireOwner, async (req, res) => {
  try {
    const { url, events, secret } = req.body;
    if (!url || !events?.length) return res.status(400).json({ success: false, message: 'url and events required' });
    const result = await execute(
      'INSERT INTO webhook_endpoints (tenant_id, url, events, secret, is_active) VALUES (?, ?, ?, ?, 1)',
      [req.tenantId, url, JSON.stringify(events), secret || null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { failure(res, err, { context: 'integrations' }); }
});

export default router;
