/**
 * Adversarial pass over the profile + avatar surface.
 *
 * The happy path is covered elsewhere. This file only asks: what happens when
 * someone sends something the UI would never send?
 */
import { generateToken } from '../src/middleware/auth.js';
import { query, execute } from '../src/lib/database.js';
import { config } from '../src/config.js';

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

const post = async (token, bytes, type, name) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const r = await fetch(`${BASE}/api/settings/profile/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
};

/* ── content-type lies ─────────────────────────────────
   The declared type is attacker-controlled. Claiming image/png over SVG bytes
   is the obvious bypass attempt. */
{
  const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const r = await post(tokenA, svgBytes, 'image/png', 'lying.png');
  if (r.status === 201) {
    // Stored. The defence that still has to hold: it must never be served in a
    // way a browser will execute.
    const id = r.json.data.attachment_id;
    const [row] = await query('SELECT storage_key, mime_type FROM invroot_attachments WHERE id = ?', [id]);
    const get = await fetch(`${BASE}/api/files/${id}`, { headers: { Authorization: `Bearer ${tokenA}` }, redirect: 'manual' });
    const served = get.status >= 300 && get.status < 400
      ? new URL(get.headers.get('location')).searchParams.get('response-content-type') || row.mime_type
      : get.headers.get('content-type');
    check('mislabelled SVG is not served as image/svg+xml', !/svg/i.test(String(served)), `served as ${served}`);
    check('nosniff prevents the browser re-deriving the type',
      get.headers.get('x-content-type-options') === 'nosniff', get.headers.get('x-content-type-options'));
    await fetch(`${BASE}/api/settings/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
  } else {
    check('mislabelled SVG rejected outright', r.status === 400, `status=${r.status}`);
  }
}

/* ── oversized upload ───────────────────────────────── */
{
  const big = Buffer.alloc(config.app.maxFileSize + 1024, 0x41);
  const r = await post(tokenA, big, 'image/png', 'huge.png');
  check('oversized upload rejected with 400, not 500', r.status === 400, `status=${r.status} ${r.json?.message || ''}`);
  check('oversized error is readable', /large/i.test(r.json?.message || ''), r.json?.message);
}

/* ── empty / missing file ───────────────────────────── */
{
  const r = await fetch(`${BASE}/api/settings/profile/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: new FormData(),
  });
  check('missing file rejected with 400', r.status === 400, `status=${r.status}`);

  const empty = await post(tokenA, Buffer.alloc(0), 'image/png', 'empty.png');
  check('zero-byte upload does not 500', empty.status < 500, `status=${empty.status}`);
}

/* ── a filename that tries to escape ────────────────── */
{
  const r = await post(tokenA, PNG, 'image/png', '../../../../etc/passwd.png');
  if (r.status === 201) {
    const [row] = await query('SELECT storage_key FROM invroot_attachments WHERE id = ?', [r.json.data.attachment_id]);
    check('traversal in the filename cannot escape the tenant prefix',
      row.storage_key.startsWith(`tenants/${a.tenant_id}/avatars/`) && !row.storage_key.includes('..'),
      row.storage_key);
    await fetch(`${BASE}/api/settings/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
  } else check('traversal filename handled', r.status === 400, `status=${r.status}`);
}

/* ── the profile update itself ──────────────────────── */
{
  const put = (body, token = tokenA) => fetch(`${BASE}/api/settings/profile`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, json: await r.json() }));

  const blank = await put({ full_name: '   ' });
  check('blank name refused', blank.status === 400, `status=${blank.status}`);

  const badLang = await put({ lang_preference: 'fr' });
  check('unsupported language refused', badLang.status === 400, `status=${badLang.status}`);

  /* Mass assignment: the body must not be able to set fields the endpoint
     never advertised. Escalating your own role would be the prize. */
  const before = (await query('SELECT role, is_owner, tenant_id, email FROM users WHERE id = ?', [a.id]))[0];
  await put({ full_name: before.email ? 'Acme Admin' : 'Acme Admin', role: 'super_admin', is_owner: 1, tenant_id: 9999, email: 'attacker@evil.test' });
  const after = (await query('SELECT role, is_owner, tenant_id, email FROM users WHERE id = ?', [a.id]))[0];
  check('role cannot be set through the profile form', after.role === before.role, `${before.role} → ${after.role}`);
  check('tenant cannot be changed through the profile form', after.tenant_id === before.tenant_id, `${before.tenant_id} → ${after.tenant_id}`);
  check('email cannot be changed through the profile form', after.email === before.email, `${before.email} → ${after.email}`);

  const partial = await put({ phone: '+971500000000' });
  const nameKept = (await query('SELECT full_name FROM users WHERE id = ?', [a.id]))[0].full_name;
  check('partial update leaves other fields alone', partial.status === 200 && !!nameKept, `name=${nameKept}`);
}

/* ── one tenant's profile read cannot see another's ─── */
{
  const mine  = await fetch(`${BASE}/api/settings/profile`, { headers: { Authorization: `Bearer ${tokenA}` } }).then(r => r.json());
  const yours = await fetch(`${BASE}/api/settings/profile`, { headers: { Authorization: `Bearer ${tokenB}` } }).then(r => r.json());
  check('profile is scoped to the caller', mine.data.id === a.id && yours.data.id === b.id,
    `${mine.data.id} vs ${yours.data.id}`);
  check('no password field leaks', !('password' in mine.data), Object.keys(mine.data).join(','));
  check('no reset token leaks', !('password_reset_token' in mine.data));
}

/* ── deleting twice is harmless ─────────────────────── */
{
  await post(tokenA, PNG, 'image/png', 'x.png');
  const d1 = await fetch(`${BASE}/api/settings/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
  const d2 = await fetch(`${BASE}/api/settings/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
  check('double delete is idempotent', d1.status === 200 && d2.status === 200, `${d1.status}, ${d2.status}`);
}

/* ── rapid re-uploads leave exactly one row ─────────────
   A double-click, or a client retrying a slow upload, sends the swap twice.
   Done as read-old → insert-new → delete-old without a lock, both requests read
   the same old id and both delete it, orphaning one object per extra request.
   Assert on a clean slate — counting leftovers from a previous run measured
   nothing and hid the real result once already. */
{
  await fetch(`${BASE}/api/settings/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
  await execute(
    "DELETE FROM invroot_attachments WHERE entity_type = 'user' AND entity_id = ? AND kind = 'avatar'", [a.id]);

  /* Snapshot the bucket first — anything already here belongs to someone else. */
  let preExisting = new Set();
  if (config.storage.driver === 's3' && config.storage.bucket) {
    const { S3Client: S3, ListObjectsV2Command: L } = await import('@aws-sdk/client-s3');
    const probe = new S3({
      region: config.storage.region,
      ...(config.storage.accessKeyId ? { credentials: { accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey } } : {}),
    });
    const before = await probe.send(new L({ Bucket: config.storage.bucket, Prefix: `tenants/${a.tenant_id}/avatars/` }));
    preExisting = new Set((before.Contents || []).map(o => o.Key));
  }

  const N = 6;
  await Promise.all(Array.from({ length: N }, () => post(tokenA, PNG, 'image/png', 'race.png')));

  const rows = await query(
    "SELECT id, storage_key FROM invroot_attachments WHERE entity_type = 'user' AND entity_id = ? AND kind = 'avatar'", [a.id]);
  check(`${N} concurrent uploads settle on one avatar row`, rows.length === 1, `${rows.length} rows`);

  const [u] = await query('SELECT avatar_attachment_id FROM users WHERE id = ?', [a.id]);
  check('the surviving row is the one the user points at',
    rows.length === 1 && u.avatar_attachment_id === rows[0].id, `points at ${u.avatar_attachment_id}`);

  // And nothing was left paying rent in the bucket.
  if (config.storage.driver === 's3' && config.storage.bucket) {
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const c = new S3Client({
      region: config.storage.region,
      ...(config.storage.accessKeyId ? { credentials: { accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey } } : {}),
    });
    /* Compare only against objects that were in the bucket BEFORE this block.
       The fixture shares a tenant with real users, so everything under the
       tenant's avatar prefix is emphatically not "ours to judge" — an earlier
       version of this check reported a live user's avatar as an orphan. */
    const r = await c.send(new ListObjectsV2Command({ Bucket: config.storage.bucket, Prefix: `tenants/${a.tenant_id}/avatars/` }));
    const stored = new Set((r.Contents || []).map(o => o.Key));
    const referenced = new Set(rows.map(x => x.storage_key));
    // Objects this run created = present now, minus what existed beforehand.
    const ourOrphans = [...stored].filter(k => !preExisting.has(k) && !referenced.has(k));
    check('no orphan objects left in the bucket', ourOrphans.length === 0, `${ourOrphans.length} orphan(s)`);
  }

  await fetch(`${BASE}/api/settings/profile/avatar`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
}

/* Remove the fixture and everything it created. */
await execute("DELETE FROM invroot_attachments WHERE entity_type = 'user' AND entity_id = ?", [a.id]);
await execute('DELETE FROM user_sessions WHERE user_id = ?', [a.id]);
await execute('DELETE FROM users WHERE id = ?', [a.id]);

for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
