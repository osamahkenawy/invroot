import { query } from '../lib/database.js';

export const tenantMiddleware = async (req, res, next) => {
  try {
    if (req.user?.permissions?.platform_owner) {
      req.tenantId = req.query.tenant_id || req.body?.tenant_id || null;
      return next();
    }

    let tenantId = req.user?.tenant_id || null;

    if (!tenantId && req.headers['x-tenant-id']) {
      tenantId = parseInt(req.headers['x-tenant-id']);
    }

    if (tenantId) {
      const [tenant] = await query('SELECT * FROM tenants WHERE id = ?', [tenantId]);
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
      req.tenant = tenant;
      req.tenantId = tenant.id;
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Require tenant to be active (not suspended/cancelled).
 */
export const requireActiveTenant = (req, res, next) => {
  const status = req.tenant?.status || req.user?.tenant_status;
  if (status && status !== 'active' && status !== 'trialing') {
    return res.status(402).json({
      success: false,
      code: 'TENANT_SUSPENDED',
      message: 'Your account is suspended. Please update your billing to restore access.',
    });
  }
  next();
};
