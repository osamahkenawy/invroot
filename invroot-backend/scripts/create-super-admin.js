// Create or reset the platform super-admin account from environment config.
//
// Migration 004 seeded superadmin@invroot.com with a placeholder bcrypt hash
// that matches no password, leaving the account unusable. This script is the
// supported way to (re)provision it — run it any time credentials need resetting:
//
//   npm run create-super-admin
//   SUPER_ADMIN_PASSWORD='...' npm run create-super-admin
//
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { query, execute } from '../src/lib/database.js';

const { email, password, name } = config.superAdmin;

if (!password) {
  console.error('❌ SUPER_ADMIN_PASSWORD is not set (env or .env). Aborting.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('❌ SUPER_ADMIN_PASSWORD must be at least 8 characters. Aborting.');
  process.exit(1);
}

const hashed = await bcrypt.hash(password, 12);
const [existing] = await query('SELECT id FROM users WHERE email = ?', [email]);

if (existing) {
  await execute(
    `UPDATE users
        SET password = ?, full_name = ?, role = 'super_admin',
            is_super_admin = 1, is_active = 1, email_verified = 1,
            email_verify_token = NULL
      WHERE id = ?`,
    [hashed, name, existing.id]
  );
  console.log(`✅ Super admin updated: ${email} (id ${existing.id})`);
} else {
  const result = await execute(
    `INSERT INTO users (tenant_id, email, username, full_name, password, role,
                        is_owner, is_super_admin, is_active, email_verified)
     VALUES (NULL, ?, ?, ?, ?, 'super_admin', 0, 1, 1, 1)`,
    [email, email.split('@')[0], name, hashed]
  );
  console.log(`✅ Super admin created: ${email} (id ${result.insertId})`);
}

// Clean up the unusable account seeded by migration 004, if it's a leftover.
if (email !== 'superadmin@invroot.com') {
  const [stale] = await query(
    "SELECT id FROM users WHERE email = 'superadmin@invroot.com' AND is_super_admin = 1"
  );
  if (stale) {
    console.log(`ℹ️  Note: legacy seeded account superadmin@invroot.com (id ${stale.id}) still exists and cannot be logged into.`);
    console.log('   Re-run with SUPER_ADMIN_EMAIL=superadmin@invroot.com to repair it, or delete it manually.');
  }
}

console.log(`   Sign in at /admin/login`);
process.exit(0);
