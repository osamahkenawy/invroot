/**
 * Role-based access control middleware factory.
 * Usage: requireRole(['admin', 'accountant'])
 */
export const requireRole = (allowedRoles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (req.user.permissions?.platform_owner) return next(); // super-admin bypass
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  }
  next();
};

/**
 * Permission-based gate middleware.
 * Usage: requirePermission('invoices.create')
 */
export const requirePermission = (permissionKey) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (req.user.permissions?.platform_owner) return next();
  if (req.user.is_owner) return next(); // owner has all permissions
  const [module_, action] = permissionKey.split('.');
  const perms = req.user.permissions || {};
  const modulePerms = perms[module_];
  if (!modulePerms || (action && !modulePerms[action] && modulePerms[action] !== true)) {
    return res.status(403).json({ success: false, message: `Permission denied: ${permissionKey}` });
  }
  next();
};

/**
 * Owner-only gate.
 */
export const requireOwner = (req, res, next) => {
  if (!req.user?.is_owner && !req.user?.permissions?.platform_owner) {
    return res.status(403).json({ success: false, message: 'Owner access required' });
  }
  next();
};
