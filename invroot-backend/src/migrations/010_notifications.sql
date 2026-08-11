-- In-app notification center. Rows are tenant-scoped; user_id NULL means the
-- notification is visible to everyone in the tenant (e.g. "payment received").
-- read_at marks when it was dismissed/read.
-- NOTE: prefixed `invroot_` because this DB is shared with a CRM that already
-- owns a differently-shaped `notifications` table (same reason as invroot_quotes).

CREATE TABLE IF NOT EXISTS invroot_notifications (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'info',
  title VARCHAR(200) NOT NULL,
  body VARCHAR(500) NULL,
  link VARCHAR(300) NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_feed (tenant_id, user_id, read_at, created_at)
);
