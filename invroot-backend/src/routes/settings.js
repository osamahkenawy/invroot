import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/role-gate.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/settings/team ─────────────────────────── */
router.get('/team', async (req, res) => {
  try {
    const members = await query(
      'SELECT id, full_name, email, role, is_active, is_owner, last_login_at, created_at FROM users WHERE tenant_id = ? ORDER BY full_name',
      [req.tenantId]
    );
    res.json({ success: true, data: members });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── POST /api/settings/team/invite ─────────────────── */
router.post('/team/invite', requireOwner, async (req, res) => {
  try {
    const { email, full_name, role } = req.body;
    if (!email || !role) return res.status(400).json({ success: false, message: 'email and role required' });
    const [existing] = await query('SELECT id FROM users WHERE email = ? AND tenant_id = ?', [email, req.tenantId]);
    if (existing) return res.status(409).json({ success: false, message: 'User already exists' });

    const { default: crypto } = await import('crypto');
    const { default: bcrypt } = await import('bcryptjs');
    const tempPass = crypto.randomBytes(8).toString('hex');
    const hashed = await bcrypt.hash(tempPass, 12);

    const result = await execute(
      `INSERT INTO users (tenant_id, email, username, full_name, password, role, is_active, email_verified, is_owner) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0)`,
      [req.tenantId, email, email, full_name || email, hashed, role]
    );
    // In production: send invite email with temp password / set-password link
    res.status(201).json({ success: true, id: result.insertId, temp_password: tempPass });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── PUT /api/settings/team/:id ─────────────────────── */
router.put('/team/:id', requireOwner, async (req, res) => {
  try {
    const { full_name, role, is_active } = req.body;
    await execute('UPDATE users SET full_name=?, role=?, is_active=? WHERE id=? AND tenant_id=? AND is_owner=0',
      [full_name, role, is_active ? 1 : 0, req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── GET /api/settings/roles ────────────────────────── */
router.get('/roles', async (req, res) => {
  try {
    const roles = await query('SELECT * FROM roles WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: roles });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── POST /api/settings/roles ───────────────────────── */
router.post('/roles', requireOwner, async (req, res) => {
  try {
    const { name, name_ar, slug, permissions } = req.body;
    if (!name || !slug) return res.status(400).json({ success: false, message: 'name and slug required' });
    const result = await execute(
      'INSERT INTO roles (tenant_id, name, name_ar, slug, permissions) VALUES (?, ?, ?, ?, ?)',
      [req.tenantId, name, name_ar, slug, JSON.stringify(permissions || {})]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── PUT /api/settings/profile ──────────────────────── */
router.put('/profile', async (req, res) => {
  try {
    const { full_name, phone, lang_preference } = req.body;
    await execute('UPDATE users SET full_name=?, phone=?, lang_preference=? WHERE id=?', [full_name, phone || null, lang_preference, req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
