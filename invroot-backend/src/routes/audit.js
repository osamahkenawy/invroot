import express from 'express';
import { query } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { getAuditLogs } from '../lib/audit-logger.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/audit ─────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { entity, entity_id, user_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const logs = await getAuditLogs({ tenantId: req.tenantId, entity, entityId: entity_id, userId: user_id, limit: parseInt(limit), offset });
    res.json({ success: true, data: logs });
  } catch (err) { failure(res, err, { context: 'audit' }); }
});

export default router;
