/**
 * End-to-end check of the authenticated file layer.
 *
 * The point of this test is the isolation claim: uploads carry the tenant in the
 * key, and a read by a different tenant must be indistinguishable from a read of
 * something that doesn't exist. Runs on whichever driver is configured.
 */
import { generateToken } from '../src/middleware/auth.js';

const BASE = 'http://127.0.0.1:5000';
const pass = [];
const fail = [];
const check = (name, ok, detail = '') => (ok ? pass : fail).push(`${name}${detail ? ` — ${detail}` : ''}`);

// Two real users in different tenants (from the users table).
const A = { id: 1, username: 'test', role: 'admin', tenant_id: 1 };
const B = { id: 8, username: 'osamah', role: 'admin', tenant_id: 9913 };
const tokenA = generateToken(A);
const tokenB = generateToken(B);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

/* ── driver config ──────────────────────────────────── */
let cfg;
{
  const r = await fetch(`${BASE}/api/files/config`, { headers: { Authorization: `Bearer ${tokenA}` } });
  const j = await r.json();
  cfg = j.data;
  check('GET /api/files/config', r.status === 200 && !!cfg?.driver, `driver=${cfg?.driver} s3=${cfg?.s3_configured}`);
}

/* ── upload as tenant A ─────────────────────────────── */
let uploaded;
{
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'proof.png');
  fd.append('kind', 'attachment');
  fd.append('entity_type', 'payment');
  fd.append('entity_id', '1');
  const r = await fetch(`${BASE}/api/files`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: fd });
  const j = await r.json();
  uploaded = j.data;
  check('POST /api/files (tenant A)', r.status === 201 && !!uploaded?.id, `id=${uploaded?.id}`);
}

/* ── the key must be namespaced to the tenant ───────── */
{
  const { query } = await import('../src/lib/database.js');
  const [row] = await query('SELECT storage_key, tenant_id, storage_driver FROM invroot_attachments WHERE id = ?', [uploaded.id]);
  check('storage key is tenant-scoped', row?.storage_key?.startsWith(`tenants/${A.tenant_id}/`), row?.storage_key);
  check('random filename (not original)', !row?.storage_key?.includes('proof'), row?.storage_key);
}

/* ── owner can read it ──────────────────────────────── */
{
  const r = await fetch(`${BASE}/api/files/${uploaded.id}`, {
    headers: { Authorization: `Bearer ${tokenA}` }, redirect: 'manual',
  });
  const okDirect = r.status === 200;
  const okSigned = r.status >= 300 && r.status < 400 && /X-Amz-Signature/i.test(r.headers.get('location') || '');
  check('owner GET /api/files/:id', okDirect || okSigned, `status=${r.status}${okSigned ? ' (signed redirect)' : ''}`);
  if (okDirect) {
    check('Cache-Control is private', /private/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
    const body = Buffer.from(await r.arrayBuffer());
    check('bytes round-trip intact', body.equals(PNG), `${body.length}B vs ${PNG.length}B`);
  } else if (okSigned) {
    /* Don't let the round-trip go unchecked just because this driver redirects
       — follow the signed URL and compare the actual bytes. */
    const direct = await fetch(r.headers.get('location'));
    const body = Buffer.from(await direct.arrayBuffer());
    check('bytes round-trip intact (via signed URL)', body.equals(PNG), `${body.length}B vs ${PNG.length}B`);
    check('signed URL expires', /X-Amz-Expires=\d+/.test(r.headers.get('location')),
      (r.headers.get('location').match(/X-Amz-Expires=(\d+)/) || [])[0]);
  }
}

/* ── the isolation claim ────────────────────────────── */
{
  const r = await fetch(`${BASE}/api/files/${uploaded.id}`, {
    headers: { Authorization: `Bearer ${tokenB}` }, redirect: 'manual',
  });
  check('cross-tenant read is refused', r.status === 404, `status=${r.status}`);
  check('cross-tenant refusal is 404 not 403', r.status !== 403, 'a 403 would confirm the id exists');
}

/* ── unauthenticated read ───────────────────────────── */
{
  const r = await fetch(`${BASE}/api/files/${uploaded.id}`, { redirect: 'manual' });
  check('anonymous read is refused', r.status === 401, `status=${r.status}`);
}

/* ── the old static hole is closed ──────────────────── */
{
  const { query } = await import('../src/lib/database.js');
  const [row] = await query('SELECT storage_key FROM invroot_attachments WHERE id = ?', [uploaded.id]);
  const r = await fetch(`${BASE}/uploads/${row.storage_key}`, { redirect: 'manual' });
  check('/uploads/<key> no longer serves documents', r.status === 404, `status=${r.status}`);
  const r2 = await fetch(`${BASE}/uploads/documents/anything.pdf`, { redirect: 'manual' });
  check('/uploads/documents/* not mounted', r2.status === 404, `status=${r2.status}`);
}

/* ── cross-tenant delete ────────────────────────────── */
{
  const r = await fetch(`${BASE}/api/files/${uploaded.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${tokenB}` },
  });
  check('cross-tenant DELETE is refused', r.status === 404, `status=${r.status}`);
}

/* ── bad kind is rejected ───────────────────────────── */
{
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'x.png');
  fd.append('kind', '../../etc/passwd');
  const r = await fetch(`${BASE}/api/files`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: fd });
  check('unknown kind rejected (no path traversal)', r.status === 400, `status=${r.status}`);
}

/* ── client avatar: upload, expose, replace ─────────── */
{
  const { query } = await import('../src/lib/database.js');
  const [client] = await query('SELECT id FROM clients WHERE tenant_id = ? LIMIT 1', [A.tenant_id]);
  if (!client) {
    check('client avatar flow', false, 'no client in tenant 1 to test against');
  } else {
    const up = async () => {
      const fd = new FormData();
      fd.append('file', new Blob([PNG], { type: 'image/png' }), 'face.png');
      const r = await fetch(`${BASE}/api/clients/${client.id}/avatar`, {
        method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: fd,
      });
      return { status: r.status, json: await r.json() };
    };
    const first = await up();
    check('POST client avatar', first.status === 201 && !!first.json?.data?.attachment_id, `status=${first.status}`);

    const lr = await fetch(`${BASE}/api/clients?limit=100`, { headers: { Authorization: `Bearer ${tokenA}` } });
    const list = (await lr.json()).data || [];
    const me = list.find(c => c.id === client.id);
    /* Stable and site-relative on BOTH drivers. Not a presigned URL: those
       expire, and an avatar lives on screen far longer than any sane TTL — it
       would 404 mid-session and fall back to initials, looking like "no picture
       set". Relative so the browser resolves it against the app's own origin
       and sends the auth cookie; an <img> cannot send a Bearer header. */
    const av = me?.avatar_url || '';
    check('avatar_url is stable and site-relative',
      av === `/api/files/${first.json.data.attachment_id}`, av);
    check('avatar_url does not expire', !/X-Amz-Expires/.test(av),
      'a presigned avatar dies while the page is still open');

    // Re-uploading must replace, not accumulate — otherwise every change leaves
    // an orphaned object in the bucket that nobody will ever delete.
    const second = await up();
    const rows = await query(
      "SELECT id FROM invroot_attachments WHERE tenant_id = ? AND entity_type = 'client' AND entity_id = ? AND kind = 'avatar'",
      [A.tenant_id, client.id]
    );
    check('re-upload replaces old avatar (no orphans)', rows.length === 1, `${rows.length} avatar rows`);

    const del = await fetch(`${BASE}/api/clients/${client.id}/avatar`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` },
    });
    const [after] = await query('SELECT avatar_attachment_id FROM clients WHERE id = ?', [client.id]);
    check('DELETE client avatar clears reference', del.status === 200 && after.avatar_attachment_id === null,
      `status=${del.status} ref=${after?.avatar_attachment_id}`);

    // Non-image must be refused: an SVG avatar is a stored-XSS vector.
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'x.pdf');
    const r = await fetch(`${BASE}/api/clients/${client.id}/avatar`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: fd,
    });
    check('non-image avatar rejected', r.status === 400, `status=${r.status}`);
  }
}

/* ── stored-XSS: an SVG must never render inline ────── */
{
  const XSS_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>');
  const { query } = await import('../src/lib/database.js');
  const [client] = await query('SELECT id FROM clients WHERE tenant_id = ? LIMIT 1', [A.tenant_id]);

  // As an avatar it must be refused outright — it would be rendered in the UI.
  const fd = new FormData();
  fd.append('file', new Blob([XSS_SVG], { type: 'image/svg+xml' }), 'x.svg');
  const r = await fetch(`${BASE}/api/clients/${client.id}/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: fd,
  });
  check('SVG avatar rejected (stored XSS)', r.status === 400, `status=${r.status}`);

  /* The upload allowlist has no SVG entry, so one can't be stored through the
     API at all — which means the disposition hardening in files.js only ever
     sees a row that predates the allowlist (or was written by another path).
     Simulate exactly that: put the row and the bytes in place directly. */
  const { execute } = await import('../src/lib/database.js');
  const { putObject } = await import('../src/lib/storage.js');
  const { key, driver: drv } = await putObject({
    tenantId: A.tenant_id, kind: 'attachment', buffer: XSS_SVG,
    originalName: 'legacy.svg', contentType: 'image/svg+xml',
  });
  const ins = await execute(
    `INSERT INTO invroot_attachments
       (tenant_id, kind, storage_key, storage_driver, original_name, mime_type, size_bytes, uploaded_by)
     VALUES (?, 'attachment', ?, ?, 'legacy.svg', 'image/svg+xml', ?, ?)`,
    [A.tenant_id, key, drv, XSS_SVG.length, A.id]
  );
  const get = await fetch(`${BASE}/api/files/${ins.insertId}`, {
    headers: { Authorization: `Bearer ${tokenA}` }, redirect: 'manual',
  });
  check('nosniff set', get.headers.get('x-content-type-options') === 'nosniff', get.headers.get('x-content-type-options'));

  /* The two drivers answer differently, so the check has to differ too.
     local  — we stream, so the header is ours to set.
     s3     — we redirect, and the browser then talks to the bucket directly.
              Nothing we set here reaches it; the instruction must be inside
              the signed URL, or the SVG renders inline off the bucket domain. */
  if (get.status >= 300 && get.status < 400) {
    const loc = get.headers.get('location') || '';
    const q = new URL(loc).searchParams;
    check('signed URL forces download for executable type',
      /attachment/i.test(q.get('response-content-disposition') || ''),
      q.get('response-content-disposition') || '(none)');
    check('signed URL neutralises the content type',
      q.get('response-content-type') === 'application/octet-stream',
      q.get('response-content-type') || '(none)');

    // And prove S3 actually honours it, rather than trusting the parameter.
    const direct = await fetch(loc);
    const cd = direct.headers.get('content-disposition') || '';
    check('S3 honours the forced download', /attachment/.test(cd), `content-disposition=${cd || '(none)'}`);
    check('object is NOT public without a signature',
      (await fetch(loc.split('?')[0])).status === 403,
      'unsigned fetch must be denied');
  } else {
    const cd = get.headers.get('content-disposition') || '';
    check('legacy SVG row served as download, not inline', /attachment/.test(cd), `content-disposition=${cd || '(none)'}`);
    check('legacy SVG row gets sandbox CSP', /sandbox/.test(get.headers.get('content-security-policy') || ''),
      get.headers.get('content-security-policy') || '(none)');
  }
  await fetch(`${BASE}/api/files/${ins.insertId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` } });
}

/* ── owner delete cleans up ─────────────────────────── */
{
  const r = await fetch(`${BASE}/api/files/${uploaded.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${tokenA}` },
  });
  check('owner DELETE succeeds', r.status === 200, `status=${r.status}`);
  const r2 = await fetch(`${BASE}/api/files/${uploaded.id}`, {
    headers: { Authorization: `Bearer ${tokenA}` }, redirect: 'manual',
  });
  check('deleted file is gone', r2.status === 404, `status=${r2.status}`);
}

console.log(`\nDriver: ${cfg?.driver}  |  S3 configured: ${cfg?.s3_configured}\n`);
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
