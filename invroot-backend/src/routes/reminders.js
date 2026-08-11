import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/role-gate.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/reminders/rules ───────────────────────── */
router.get('/rules', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM reminder_rules WHERE tenant_id = ? ORDER BY days_offset', [req.tenantId]);
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'reminders' }); }
});

/* ── POST /api/reminders/rules ──────────────────────── */
router.post('/rules', requireOwner, async (req, res) => {
  try {
    const { name, days_offset, channel, template_id, is_active } = req.body;
    if (!name || days_offset === undefined || !channel) return res.status(400).json({ success: false, message: 'name, days_offset, and channel required' });
    const result = await execute(
      `INSERT INTO reminder_rules (tenant_id, name, days_offset, channel, template_id, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
      [req.tenantId, name, days_offset, channel, template_id || null, is_active ? 1 : 1]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { failure(res, err, { context: 'reminders' }); }
});

/* ── PUT /api/reminders/rules/:id ───────────────────── */
router.put('/rules/:id', requireOwner, async (req, res) => {
  try {
    const { name, days_offset, channel, template_id, is_active } = req.body;
    await execute('UPDATE reminder_rules SET name=?, days_offset=?, channel=?, template_id=?, is_active=? WHERE id=? AND tenant_id=?',
      [name, days_offset, channel, template_id, is_active ? 1 : 0, req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'reminders' }); }
});

/* ── GET /api/reminders/templates ───────────────────── */
router.get('/templates', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM notification_templates WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'reminders' }); }
});

/* ── POST /api/reminders/templates ──────────────────── */
router.post('/templates', requireOwner, async (req, res) => {
  try {
    const { name, subject_en, body_en, subject_ar, body_ar, type } = req.body;
    const result = await execute(
      `INSERT INTO notification_templates (tenant_id, name, subject_en, body_en, subject_ar, body_ar, type) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, name, subject_en, body_en, subject_ar, body_ar, type || 'reminder']
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { failure(res, err, { context: 'reminders' }); }
});

/* ── PUT /api/reminders/templates/:id ───────────────── */
router.put('/templates/:id', requireOwner, async (req, res) => {
  try {
    const { name, subject_en, body_en, subject_ar, body_ar, type } = req.body;
    await execute(
      'UPDATE notification_templates SET name=?,subject_en=?,body_en=?,subject_ar=?,body_ar=?,type=? WHERE id=? AND tenant_id=?',
      [name, subject_en, body_en, subject_ar, body_ar, type, req.params.id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'reminders' }); }
});

/* ── DELETE /api/reminders/rules/:id ────────────────── */
router.delete('/rules/:id', requireOwner, async (req, res) => {
  try {
    await execute('DELETE FROM reminder_rules WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'reminders' }); }
});

/* ── GET /api/reminders/log ─────────────────────────── */
router.get('/log', async (req, res) => {
  try {
    const rows = await query(
      `SELECT rl.*, rr.name as rule_name, i.invoice_number
       FROM reminder_logs rl
       LEFT JOIN reminder_rules rr ON rl.rule_id = rr.id
       LEFT JOIN invoices i ON rl.entity_id = i.id
       WHERE rl.tenant_id = ? ORDER BY rl.sent_at DESC LIMIT 100`,
      [req.tenantId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'reminders' }); }
});

export default router;
