import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
router.use(authMiddleware);

// Platform super-admin only
const requirePlatformOwner = (req, res, next) => {
  if (!req.user?.permissions?.platform_owner) return res.status(403).json({ success: false, message: 'Forbidden' });
  next();
};
router.use(requirePlatformOwner);

router.get('/tenants', async (req, res) => {
  const { search, status, page = 1, limit = 20 } = req.query;
  const conds = ['1=1'];
  const params = [];
  if (search) { conds.push('(company_name LIKE ? OR email LIKE ?)'); const s = `%${search}%`; params.push(s, s); }
  if (status) { conds.push('status = ?'); params.push(status); }
  const offset = (page - 1) * limit;
  const rows = await query(`SELECT * FROM tenants WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), parseInt(offset)]);
  const [{ total }] = await query(`SELECT COUNT(*) as total FROM tenants WHERE ${conds.join(' AND ')}`, params);
  res.json({ success: true, data: rows, total });
});

router.put('/tenants/:id/status', async (req, res) => {
  await execute('UPDATE tenants SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  res.json({ success: true });
});

export default router;
