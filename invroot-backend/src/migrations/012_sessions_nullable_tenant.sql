-- Super-admin users have tenant_id = NULL (they belong to no tenant), so the
-- NOT NULL constraint added in 009 rejected their session row and broke their
-- login entirely. Sessions must allow a null tenant.

ALTER TABLE user_sessions MODIFY COLUMN tenant_id INT UNSIGNED NULL;
