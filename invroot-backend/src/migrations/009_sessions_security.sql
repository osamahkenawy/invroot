-- Account-security features: session tracking + login history.
-- Sessions let a user see where they're signed in and revoke devices
-- ("log out everywhere"); login_history records each sign-in attempt.
-- JWTs carry the session id (sid) so a revoked row invalidates the token.

CREATE TABLE IF NOT EXISTS user_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(400) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_sessions_user (user_id, revoked_at)
);

CREATE TABLE IF NOT EXISTS login_history (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  email VARCHAR(255) NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(400) NULL,
  success TINYINT(1) NOT NULL DEFAULT 0,
  reason VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_history_user (user_id, created_at)
);
