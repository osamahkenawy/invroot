import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

// A notification is visible to the current user if it targets them
// specifically OR is tenant-wide (user_id IS NULL).
const VISIBLE = '(user_id = ? OR user_id IS NULL)';

/* ── GET /api/notifications ──────────────────────────── */
/* Recent notifications for the current user. ?unread=1 → only unread. */
router.get('/', async (req, res) => {
  try {
    const onlyUnread = req.query.unread === '1';
    const rows = await query(
      `SELECT id, type, title, body, link, read_at, created_at
       FROM invroot_notifications
       WHERE tenant_id = ? AND ${VISIBLE} ${onlyUnread ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.tenantId, req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    failure(res, err, { context: 'notifications' });
  }
});

/* ── GET /api/notifications/unread-count ─────────────── */
router.get('/unread-count', async (req, res) => {
  try {
    const [row] = await query(
      `SELECT COUNT(*) AS count FROM invroot_notifications
       WHERE tenant_id = ? AND ${VISIBLE} AND read_at IS NULL`,
      [req.tenantId, req.user.id]
    );
    res.json({ success: true, count: row?.count || 0 });
  } catch (err) {
    failure(res, err, { context: 'notifications' });
  }
});

/* ── POST /api/notifications/:id/read ────────────────── */
router.post('/:id/read', async (req, res) => {
  try {
    await execute(
      `UPDATE invroot_notifications SET read_at = NOW()
       WHERE id = ? AND tenant_id = ? AND ${VISIBLE} AND read_at IS NULL`,
      [req.params.id, req.tenantId, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    failure(res, err, { context: 'notifications' });
  }
});

/* ── POST /api/notifications/read-all ────────────────── */
router.post('/read-all', async (req, res) => {
  try {
    const result = await execute(
      `UPDATE invroot_notifications SET read_at = NOW()
       WHERE tenant_id = ? AND ${VISIBLE} AND read_at IS NULL`,
      [req.tenantId, req.user.id]
    );
    res.json({ success: true, updated: result.affectedRows });
  } catch (err) {
    failure(res, err, { context: 'notifications' });
  }
});

export default router;
