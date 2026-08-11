import express from 'express';
import { query, execute, transaction } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/role-gate.js';
import { failure, AppError } from '../lib/api-error.js';
import { uploadAny } from '../middleware/upload.js';
import { putObject, deleteObject, isDisplaySafeImage, resolveAttachmentUrl } from '../lib/storage.js';
import { enforcePlanLimit } from '../middleware/plan-limit.js';


/* ── Atomic avatar swap ───────────────────────────────────────────────
   Uploading a picture is read-old → insert-new → point-at-new → delete-old.
   Done without a lock that sequence races: two requests (a double-click, or a
   client retry) both read the same old id, both insert, and both delete that
   same old row — leaving the loser's object in the bucket forever, billed and
   referenced by nothing.

   SELECT … FOR UPDATE serialises the swap on the owning row, so each request
   sees whatever the previous one committed and deletes exactly that. Last
   upload wins, which is what someone clicking twice expects, and no object is
   left behind.

   Returns the storage key that was superseded, or null. The caller deletes the
   bytes AFTER the transaction commits — an S3 round trip inside a held row
   lock would make the lock as slow as the network. */
async function swapAvatar({ table, ownerId, tenantId, kind, entityType, file, uploaderId }) {
  const { key, driver: driverName } = await putObject({
    tenantId, kind, buffer: file.buffer,
    originalName: file.originalname, contentType: file.mimetype,
  });

  try {
    return await transaction(async (conn) => {
      const [[owner]] = await conn.query(
        `SELECT avatar_attachment_id FROM ${table} WHERE id = ? FOR UPDATE`, [ownerId]);
      if (!owner) throw new AppError('Not found', 404, 'NOT_FOUND');

      const [ins] = await conn.query(
        `INSERT INTO invroot_attachments
           (tenant_id, entity_type, entity_id, kind, storage_key, storage_driver,
            original_name, mime_type, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tenantId, entityType, ownerId, kind, key, driverName,
         file.originalname?.slice(0, 255) || null, file.mimetype, file.size, uploaderId]);

      await conn.query(`UPDATE ${table} SET avatar_attachment_id = ? WHERE id = ?`, [ins.insertId, ownerId]);

      let supersededKey = null;
      if (owner.avatar_attachment_id) {
        const [[old]] = await conn.query(
          'SELECT storage_key FROM invroot_attachments WHERE id = ?', [owner.avatar_attachment_id]);
        supersededKey = old?.storage_key || null;
        await conn.query('DELETE FROM invroot_attachments WHERE id = ?', [owner.avatar_attachment_id]);
      }
      return { attachmentId: ins.insertId, key, supersededKey };
    });
  } catch (err) {
    // The object is already in the bucket but no row will reference it.
    await deleteObject(key).catch(() => {});
    throw err;
  }
}

const router = express.Router();

/* Roles an owner may hand out. `owner` is deliberately absent — ownership
   transfers are not an invite-form action. */
const ASSIGNABLE_ROLES = ['admin', 'accountant', 'sales', 'viewer'];
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/settings/team ─────────────────────────── */
router.get('/team', async (req, res) => {
  try {
    const members = await query(
      'SELECT id, full_name, email, role, is_active, is_owner, last_login_at, created_at FROM users WHERE tenant_id = ? ORDER BY full_name',
      [req.tenantId]
    );
    res.json({ success: true, data: members });
  } catch (err) { failure(res, err, { context: 'settings' }); }
});

/* ── POST /api/settings/team/invite ─────────────────── */
router.post('/team/invite', requireOwner, enforcePlanLimit('users'), async (req, res) => {
  try {
    const { email, full_name, role } = req.body;
    if (!email || !role) return res.status(400).json({ success: false, message: 'email and role required' });

    // Without these, an invite could create a user with an unusable address or
    // a role the permission system does not recognise.
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Unknown role.' });
    }
    const [existing] = await query('SELECT id FROM users WHERE email = ? AND tenant_id = ?', [cleanEmail, req.tenantId]);
    if (existing) return res.status(409).json({ success: false, message: 'User already exists' });

    const { default: crypto } = await import('crypto');
    const { default: bcrypt } = await import('bcryptjs');
    const tempPass = crypto.randomBytes(8).toString('hex');
    const hashed = await bcrypt.hash(tempPass, 12);

    const result = await execute(
      `INSERT INTO users (tenant_id, email, username, full_name, password, role, is_active, email_verified, is_owner) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0)`,
      [req.tenantId, cleanEmail, cleanEmail, full_name || cleanEmail, hashed, role]
    );
    // In production: send invite email with temp password / set-password link
    res.status(201).json({ success: true, id: result.insertId, temp_password: tempPass });
  } catch (err) { failure(res, err, { context: 'settings' }); }
});

/* ── PUT /api/settings/team/:id ─────────────────────── */
router.put('/team/:id', requireOwner, async (req, res) => {
  try {
    const { full_name, role, is_active } = req.body;
    if (role !== undefined && !ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Unknown role.' });
    }
    await execute('UPDATE users SET full_name=?, role=?, is_active=? WHERE id=? AND tenant_id=? AND is_owner=0',
      [full_name, role, is_active ? 1 : 0, req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'settings' }); }
});

/* ── GET /api/settings/roles ────────────────────────── */
router.get('/roles', async (req, res) => {
  try {
    const roles = await query('SELECT * FROM roles WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: roles });
  } catch (err) { failure(res, err, { context: 'settings' }); }
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
  } catch (err) { failure(res, err, { context: 'settings' }); }
});

/* ── GET /api/settings/profile ──────────────────────── */
/* Everything the profile screen shows. authMiddleware's user object is built
   for authorisation, not display, so it lacks created_at / last_login_at. */
router.get('/profile', async (req, res) => {
  try {
    const [user] = await query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.is_owner, u.email_verified,
              u.lang_preference, u.last_login_at, u.created_at, u.avatar_attachment_id,
              a.storage_key AS avatar_key,
              t.company_name, t.slug AS tenant_slug
       FROM users u
       LEFT JOIN invroot_attachments a
              ON a.id = u.avatar_attachment_id AND a.tenant_id = u.tenant_id
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = ?`,
      [req.user.id]
    );
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    user.avatar_url = await resolveAttachmentUrl(user.avatar_key, user.avatar_attachment_id);
    delete user.avatar_key;

    res.json({ success: true, data: user });
  } catch (err) { failure(res, err, { context: 'settings' }); }
});

/* ── POST /api/settings/profile/avatar ──────────────── */
/* Your own picture only — the id comes from the token, never the URL, so this
   cannot be aimed at another user's account. */
router.post('/profile/avatar', uploadAny.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new AppError('No image was uploaded.', 400, 'NO_FILE');
    // An SVG passes a naive "is it an image" test and can carry a script.
    if (!isDisplaySafeImage(req.file.mimetype)) {
      throw new AppError('Your picture must be a PNG, JPEG or WebP image.', 400, 'NOT_AN_IMAGE');
    }

    const { attachmentId, key, supersededKey } = await swapAvatar({
      table: 'users', ownerId: req.user.id, tenantId: req.tenantId,
      kind: 'avatar', entityType: 'user', file: req.file, uploaderId: req.user.id,
    });
    if (supersededKey) await deleteObject(supersededKey);

    res.status(201).json({
      success: true,
      data: { attachment_id: attachmentId, avatar_url: await resolveAttachmentUrl(key, attachmentId) },
    });
  } catch (err) { failure(res, err, { context: 'settings' }); }
});

/* ── DELETE /api/settings/profile/avatar ────────────── */
router.delete('/profile/avatar', async (req, res) => {
  try {
    const [me] = await query('SELECT avatar_attachment_id FROM users WHERE id = ?', [req.user.id]);
    if (!me?.avatar_attachment_id) return res.json({ success: true, message: 'No picture to remove' });

    const [att] = await query(
      'SELECT storage_key FROM invroot_attachments WHERE id = ? AND tenant_id = ?',
      [me.avatar_attachment_id, req.tenantId]
    );
    await execute('UPDATE users SET avatar_attachment_id = NULL WHERE id = ?', [req.user.id]);
    if (att) {
      await deleteObject(att.storage_key);
      await execute('DELETE FROM invroot_attachments WHERE id = ?', [me.avatar_attachment_id]);
    }
    res.json({ success: true, message: 'Profile picture removed' });
  } catch (err) { failure(res, err, { context: 'settings' }); }
});

/* ── PUT /api/settings/profile ──────────────────────── */
router.put('/profile', async (req, res) => {
  try {
    const { full_name, phone, lang_preference } = req.body;

    // Partial update: the screen may submit only the fields it changed, and a
    // blanket overwrite would blank whatever it left out.
    const fields = [];
    const params = [];

    if (full_name !== undefined) {
      const name = String(full_name).trim();
      if (!name) {
        return res.status(400).json({ success: false, message: 'Your name cannot be empty.' });
      }
      fields.push('full_name = ?'); params.push(name);
    }
    if (phone !== undefined) {
      fields.push('phone = ?'); params.push(String(phone).trim() || null);
    }
    if (lang_preference !== undefined) {
      if (!['en', 'ar'].includes(lang_preference)) {
        return res.status(400).json({ success: false, message: 'Unsupported language.' });
      }
      fields.push('lang_preference = ?'); params.push(lang_preference);
    }

    if (!fields.length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    params.push(req.user.id);
    await execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);

    const [user] = await query(
      `SELECT u.id, u.full_name, u.phone, u.email, u.role, u.lang_preference,
              u.avatar_attachment_id, a.storage_key AS avatar_key
       FROM users u
       LEFT JOIN invroot_attachments a
              ON a.id = u.avatar_attachment_id AND a.tenant_id = u.tenant_id
       WHERE u.id = ?`,
      [req.user.id]);
    user.avatar_url = await resolveAttachmentUrl(user.avatar_key, user.avatar_attachment_id);
    delete user.avatar_key;
    res.json({ success: true, data: user });
  } catch (err) { failure(res, err, { context: 'settings' }); }
});

export default router;
