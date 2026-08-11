/**
 * Profile avatar — the account picture for the signed-in user.
 *
 * The property that matters: the target is taken from the token, never from
 * the URL, so no request can aim this at somebody else's account.
 */
import { generateToken } from '../src/middleware/auth.js';
import { query, execute } from '../src/lib/database.js';

const BASE = 'http://127.0.0.1:5000';
const pass = [], fail = [];
const check = (n, ok, d = '') => (ok ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

/* A throwaway account, created and destroyed by this suite.
 *
 * These tests used to run against the real tenant owner and delete their
 * avatar as cleanup — so every regression run silently wiped a live user's
 * profile picture. Test code must never mutate data a person owns. */
import bcrypt from 'bcryptjs';
const FIXTURE_EMAIL = `__test-avatar-${Date.now()}@invroot.test`;
const [fixtureTenant] = await query('SELECT id FROM tenants ORDER BY id LIMIT 1');
const fixtureIns = await execute(
  `INSERT INTO users (tenant_id, email, username, full_name, password, role, is_owner, is_active, email_verified)
   VALUES (?, ?, ?, 'Avatar Fixture', ?, 'admin', 1, 1, 1)`,
  [fixtureTenant.id, FIXTURE_EMAIL, FIXTURE_EMAIL, await bcrypt.hash('fixture-only-never-used', 10)]
);
const a = {
  id: fixtureIns.insertId, username: FIXTURE_EMAIL, role: 'admin',
  tenant_id: fixtureTenant.id, is_owner: 1,
};

const [b] = await query('SELECT id, username, role, tenant_id FROM users WHERE tenant_id <> 1 AND is_active = 1 LIMIT 1');
const tokenA = generateToken(a), tokenB = generateToken(b);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const upload = async (token, bytes = PNG, type = 'image/png', name = 'me.png') => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const r = await fetch(`${BASE}/api/settings/profile/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  return { status: r.status, json: await r.json() };
};

/* profile payload */
{
  const r = await fetch(`${BASE}/api/settings/profile`, { headers: { Authorization: `Bearer ${tokenA}` } });
  const j = await r.json();
  check('GET /api/settings/profile', r.status === 200 && !!j.data?.email, `status=${r.status}`);
  // The rich header needs these; authMiddleware's user object doesn't carry them.
  for (const f of ['created_at', 'last_login_at', 'email_verified', 'company_name', 'is_owner'])
    check(`profile exposes ${f}`, f in (j.data || {}), String(j.data?.[f]));
}

/* upload */
let first;
{
  first = await upload(tokenA);
  check('POST profile avatar', first.status === 201 && !!first.json?.data?.attachment_id, `status=${first.status}`);
  check('returns a stable, non-expiring url',
    /^\/api\/files\/\d+$/.test(first.json?.data?.avatar_url || ''),
    first.json?.data?.avatar_url);
}

/* it is attached to the right user, and scoped to the tenant */
{
  const [row] = await query('SELECT tenant_id, entity_type, entity_id, kind, storage_key FROM invroot_attachments WHERE id = ?',
    [first.json.data.attachment_id]);
  check('attachment points at this user', row.entity_type === 'user' && row.entity_id === a.id, `${row.entity_type}:${row.entity_id}`);
  check('key is tenant-scoped', row.storage_key.startsWith(`tenants/${a.tenant_id}/avatars/`), row.storage_key);
}

/* it flows through the auth endpoints the app actually reads */
{
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenA}` } }).then(r => r.json());
  check('GET /api/auth/me carries the avatar', !!me.user?.avatar_url, me.user?.avatar_url || '(none)');
}

/* another user's avatar is untouched — the id comes from the token */
{
  const before = (await query('SELECT avatar_attachment_id FROM users WHERE id = ?', [b.id]))[0].avatar_attachment_id;
  await upload(tokenB);
  const mine  = (await query('SELECT avatar_attachment_id FROM users WHERE id = ?', [a.id]))[0].avatar_attachment_id;
  const other = (await query('SELECT avatar_attachment_id FROM users WHERE id = ?', [b.id]))[0].avatar_attachment_id;
  check('another user uploading does not touch mine', mine === first.json.data.attachment_id, `mine=${mine}`);
  check('their own avatar did change', other !== before, `${before} → ${other}`);
  await fetch(`${BASE}/api/settings/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenB}` } });
}

/* re-upload replaces rather than accumulates */
{
  await upload(tokenA);
  const rows = await query(
    "SELECT id FROM invroot_attachments WHERE entity_type = 'user' AND entity_id = ? AND kind = 'avatar'", [a.id]);
  check('re-upload replaces (no orphan rows)', rows.length === 1, `${rows.length} rows`);
}

/* an SVG avatar is stored XSS — refuse it */
{
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const r = await upload(tokenA, svg, 'image/svg+xml', 'x.svg');
  check('SVG avatar rejected', r.status === 400, `status=${r.status}`);
  const pdf = await upload(tokenA, Buffer.from('%PDF-1.4'), 'application/pdf', 'x.pdf');
  check('non-image rejected', pdf.status === 400, `status=${pdf.status}`);
}

/* anonymous cannot set anyone's picture */
{
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const r = await fetch(`${BASE}/api/settings/profile/avatar`, { method: 'POST', body: fd });
  check('anonymous upload refused', r.status === 401, `status=${r.status}`);
}

/* remove clears the reference */
{
  const r = await fetch(`${BASE}/api/settings/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
  const [u] = await query('SELECT avatar_attachment_id FROM users WHERE id = ?', [a.id]);
  check('DELETE clears the avatar', r.status === 200 && u.avatar_attachment_id === null, `ref=${u.avatar_attachment_id}`);
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenA}` } }).then(x => x.json());
  check('avatar_url is null after removal', me.user?.avatar_url === null, String(me.user?.avatar_url));
}

/* Remove the fixture and everything it created. */
await execute("DELETE FROM invroot_attachments WHERE entity_type = 'user' AND entity_id = ?", [a.id]);
await execute('DELETE FROM user_sessions WHERE user_id = ?', [a.id]);
await execute('DELETE FROM users WHERE id = ?', [a.id]);

for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
