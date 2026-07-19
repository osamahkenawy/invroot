-- ── Super Admin Migration ─────────────────────────────
-- Adds is_super_admin flag to users and creates the platform admin account

-- Add is_super_admin column
ALTER TABLE users ADD COLUMN is_super_admin TINYINT(1) DEFAULT 0 AFTER is_owner;

-- Add tenant_id nullable for super admin (already nullable, but ensure FK allows NULL)
-- (no change needed — tenant_id is already nullable in CREATE TABLE)

-- Insert default super admin user (password: SuperAdmin123!)
-- bcrypt hash for "SuperAdmin123!"
INSERT IGNORE INTO users (tenant_id, email, username, full_name, password, role, is_owner, is_super_admin, is_active, email_verified)
VALUES (
  NULL,
  'superadmin@invroot.com',
  'superadmin',
  'Platform Administrator',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaElDCVT5aVUe5tqXWpOPM8QO',
  'super_admin',
  0,
  1,
  1,
  1
);
