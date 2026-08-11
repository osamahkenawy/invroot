import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, execute } from '../lib/database.js';

export function generateToken(user, sessionId) {
  const payload = { id: user.id, username: user.username, role: user.role, tenant_id: user.tenant_id, is_super_admin: !!user.is_super_admin };
  if (sessionId) payload.sid = sessionId;
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
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
              u.is_owner, u.is_super_admin, u.avatar_url, u.lang_preference,
              u.must_change_password,
              t.status as tenant_status, t.slug as tenant_slug,
              /* Survives a page reload: /auth/me rebuilds the client's user
                 object from here, so the pending-checkout prompt must be
                 visible on this query too, not only on login. */
              t.plan as tenant_plan, t.pending_plan
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    // Session validation. Tokens issued after the security update carry a
    // `sid`; a revoked/expired session row invalidates the token (this is what
    // makes "log out everywhere" work). Legacy tokens without a sid still pass.
    if (decoded.sid) {
      const [session] = await query(
        'SELECT id, revoked_at, expires_at FROM user_sessions WHERE id = ? AND user_id = ?',
        [decoded.sid, user.id]
      );
      const expired = session?.expires_at && new Date(session.expires_at) < new Date();
      if (!session || session.revoked_at || expired) {
        return res.status(401).json({ success: false, code: 'SESSION_REVOKED', message: 'Session ended. Please sign in again.' });
      }
      req.sessionId = decoded.sid;
      // Touch last-seen without blocking the request.
      execute('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = ?', [decoded.sid]).catch(() => {});
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
