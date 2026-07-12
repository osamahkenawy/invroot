import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../lib/database.js';

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

export function verifyToken(token) {
  try { return jwt.verify(token, config.jwt.secret); }
  catch { return null; }
}

export async function authMiddleware(req, res, next) {
  try {
    const token = req.cookies?.auth_token || req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ success: false, message: 'Invalid or expired token' });

    const [user] = await query(
      `SELECT u.id, u.tenant_id, u.username, u.email, u.full_name, u.role, u.is_active,
              u.is_owner, u.avatar_url, u.lang_preference,
              t.status as tenant_status, t.slug as tenant_slug
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    // Load role permissions
    if (user.role) {
      const [roleRow] = await query(
        'SELECT permissions FROM roles WHERE tenant_id = ? AND slug = ?',
        [user.tenant_id, user.role]
      );
      if (roleRow) {
        user.permissions = typeof roleRow.permissions === 'string'
          ? JSON.parse(roleRow.permissions || '{}')
          : roleRow.permissions || {};
      }
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth — does not reject, just sets req.user if token is valid.
 */
export async function optionalAuth(req, res, next) {
  const token = req.cookies?.auth_token || req.headers.authorization?.split(' ')[1];
  if (!token) return next();
  const decoded = verifyToken(token);
  if (!decoded) return next();
  try {
    const [user] = await query('SELECT id, tenant_id, username, email, role, is_active FROM users WHERE id = ?', [decoded.id]);
    if (user?.is_active) req.user = user;
  } catch { /* swallow */ }
  next();
}
