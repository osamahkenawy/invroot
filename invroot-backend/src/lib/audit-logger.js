import { query, execute } from './database.js';

/**
 * Log an audit event.
 * @param {object} opts - { tenantId, userId, action, entity, entityId, changes, ip, userAgent }
 */
export async function logAudit({ tenantId, userId, action, entity, entityId, changes = null, ip = null, userAgent = null }) {
  try {
    await execute(
      `INSERT INTO invroot_audit_logs (tenant_id, user_id, action, entity, entity_id, changes, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, userId, action, entity, entityId, changes ? JSON.stringify(changes) : null, ip, userAgent]
    );
  } catch (err) {
    // Audit log failures should never break the main operation
    console.error('Audit log error:', err.message);
  }
}

/**
 * Get audit logs for a tenant with optional filters.
 */
export async function getAuditLogs({ tenantId, entity, entityId, userId, limit = 50, offset = 0 }) {
  let sql = `
    SELECT al.*, u.full_name as user_name, u.email as user_email
    FROM invroot_audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.tenant_id = ?
  `;
  const params = [tenantId];

  if (entity) { sql += ' AND al.entity = ?'; params.push(entity); }
  if (entityId) { sql += ' AND al.entity_id = ?'; params.push(entityId); }
  if (userId) { sql += ' AND al.user_id = ?'; params.push(userId); }

  sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return query(sql, params);
}
