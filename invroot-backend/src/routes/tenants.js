import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

router.get('/', async (req, res) => {
  const [tenant] = await query('SELECT * FROM tenants WHERE id = ?', [req.tenantId]);
  res.json({ success: true, data: tenant });
});

export default router;
