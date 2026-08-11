import { execute } from './database.js';

/**
 * Create an in-app notification. Safe to fire-and-forget — failures are logged,
 * never thrown, so a notification problem can't break the business action that
 * triggered it.
 *
 * @param {object} o
 * @param {number} o.tenantId  - required tenant scope
 * @param {number|null} [o.userId] - specific user, or null = whole tenant
 * @param {string} [o.type]  - info | success | warning | payment | invoice | ...
 * @param {string} o.title
 * @param {string} [o.body]
 * @param {string} [o.link]  - in-app path the notification links to
 */
export async function notify({ tenantId, userId = null, type = 'info', title, body = null, link = null }) {
  if (!tenantId || !title) return;
  try {
    await execute(
      `INSERT INTO invroot_notifications (tenant_id, user_id, type, title, body, link)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId, userId, type, title.slice(0, 200), body ? body.slice(0, 500) : null, link ? link.slice(0, 300) : null]
    );
  } catch (err) {
    console.error('notify() failed:', err.message);
  }
}
