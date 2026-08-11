/**
 * Do uploads actually reach S3? — proved over HTTP, not by reading code.
 *
 * Every upload route mounts the memory-backed `uploadAny` and calls putObject,
 * so *in principle* the bytes go wherever STORAGE_DRIVER points. This asserts
 * it for real: it POSTs a file to each endpoint against the running server,
 * then asks S3 directly — with a raw client, not the app's storage layer —
 * whether the object is there and what it contains.
 *
 * Using the app's own storage helper to verify the app's own storage helper
 * would prove nothing: a driver that silently wrote to disk would report
 * success on both sides. HeadObject against the bucket is the independent check.
 *
 * Every object it creates is deleted afterwards, and nothing is attached to a
 * real tenant's brand — the fixtures are a throwaway tenant and client.
 */

import 'dotenv/config';
import { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import jwt from 'jsonwebtoken';
import { query, execute } from '../src/lib/database.js';
import { driver } from '../src/lib/storage.js';

const API = process.env.TEST_API || 'http://127.0.0.1:5000/api';
const BUCKET = process.env.S3_BUCKET;

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ''}`); };

console.log(`driver = ${driver().name || process.env.STORAGE_DRIVER}   bucket = ${BUCKET}\n`);

if (String(process.env.STORAGE_DRIVER).toLowerCase() !== 's3') {
  console.log('STORAGE_DRIVER is not s3 — this test only means something against S3.');
  process.exit(1);
}

/* A raw client, deliberately not the app's. */
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/* ---- throwaway fixtures -------------------------------------------------- */
const stamp = Math.floor(Number(process.hrtime.bigint() % 100000n));
const tRes = await execute(
  `INSERT INTO tenants (company_name, slug, email, currency, status, plan)
   VALUES (?, ?, ?, 'AED', 'active', 'starter')`,
  [`S3 E2E Fixture ${stamp}`, `s3-e2e-${stamp}`, `s3-e2e-${stamp}@fixture.invalid`]);
const tenantId = tRes.insertId;

const uRes = await execute(
  `INSERT INTO users (tenant_id, email, password, full_name, role, is_active, email_verified, is_owner)
   VALUES (?, ?, '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV', 'S3 Fixture Owner', 'admin', 1, 1, 1)`,
  [tenantId, `s3-e2e-${stamp}@fixture.invalid`]);
const userId = uRes.insertId;

const cRes = await execute(
  `INSERT INTO clients (tenant_id, name, email, currency) VALUES (?, 'S3 Fixture Client', ?, 'AED')`,
  [tenantId, `client-${stamp}@fixture.invalid`]);
const clientId = cRes.insertId;

const token = jwt.sign(
  { id: userId, username: `s3-e2e-${stamp}@fixture.invalid`, role: 'admin', tenant_id: tenantId, is_super_admin: false },
  process.env.JWT_SECRET, { expiresIn: '10m' });

/* A 1x1 PNG and a tiny PDF — one image path, one document path. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

const created = [];

async function upload(path, field, buf, filename, type, extra = {}) {
  const fd = new FormData();
  fd.append(field, new Blob([buf], { type }), filename);
  for (const [k, v] of Object.entries(extra)) fd.append(k, String(v));
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Ask S3 itself. Returns null when the object is not there. */
async function head(key) {
  try { return await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); }
  catch { return null; }
}

async function bodyOf(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await r.Body.transformToByteArray());
}

/**
 * One endpoint: upload, then independently confirm the bytes are in the bucket,
 * under a key scoped to this tenant, byte-identical to what was sent.
 */
async function check(label, path, field, buf, filename, type, keyFrom, extra) {
  const { status, body } = await upload(path, field, buf, filename, type, extra);
  if (![200, 201].includes(status) || body.success === false) {
    bad(`${label} — upload rejected`, `HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`);
    return;
  }
  const key = await keyFrom(body);
  if (!key) { bad(`${label} — no storage key recorded`); return; }
  created.push(key);

  const h = await head(key);
  if (!h) { bad(`${label} — NOT in S3`, `key ${key}`); return; }
  ok(`${label} → s3://${BUCKET}/${key} (${h.ContentLength} bytes)`);

  if (!key.startsWith(`tenants/${tenantId}/`)) bad(`${label} — key not tenant-scoped`, key);
  else ok(`${label} — key scoped to tenant ${tenantId}`);

  const got = await bodyOf(key);
  if (Buffer.compare(got, buf) === 0) ok(`${label} — bytes in S3 match bytes sent`);
  else bad(`${label} — stored bytes differ`, `sent ${buf.length}, stored ${got.length}`);

  if (h.ServerSideEncryption === 'AES256') ok(`${label} — encrypted at rest (AES256)`);
  else bad(`${label} — not encrypted at rest`, String(h.ServerSideEncryption));
}

console.log('company brand assets');
await check('logo', '/company/logo', 'logo', PNG, 'logo.png', 'image/png',
  async () => (await query('SELECT logo_url FROM tenants WHERE id = ?', [tenantId]))[0]?.logo_url);
await check('stamp', '/company/stamp', 'stamp', PNG, 'stamp.png', 'image/png',
  async () => (await query('SELECT stamp_url FROM tenants WHERE id = ?', [tenantId]))[0]?.stamp_url);
/* Signatures live on company_signatories, not tenants — one company can have
   several signatories, each with their own image. */
await check('signature', '/company/signature', 'signature', PNG, 'sig.png', 'image/png',
  async () => (await query(
    'SELECT signature_url FROM company_signatories WHERE tenant_id = ? ORDER BY id DESC LIMIT 1',
    [tenantId]))[0]?.signature_url);

console.log('\nprofile + client avatars');
const keyOfAttachment = async (id) =>
  (await query('SELECT storage_key FROM invroot_attachments WHERE id = ?', [id]))[0]?.storage_key;

await check('user avatar', '/settings/profile/avatar', 'file', PNG, 'me.png', 'image/png',
  (b) => keyOfAttachment(b.data?.attachment_id));
await check('client avatar', `/clients/${clientId}/avatar`, 'file', PNG, 'c.png', 'image/png',
  (b) => keyOfAttachment(b.data?.attachment_id));

console.log('\ndocument attachments');
await check('pdf attachment', '/files', 'file', PDF, 'contract.pdf', 'application/pdf',
  (b) => keyOfAttachment(b.data?.id ?? b.id),
  { entity_type: 'client', entity_id: clientId });
await check('png attachment', '/uploads/document', 'file', PDF, 'terms.pdf', 'application/pdf',
  async (b) => b.key || b.data?.key);

/* Nothing should have been written to the local disk while the driver is s3. */
console.log('\nlocal disk stayed untouched');
const fs = await import('fs');
const localRoot = 'uploads';
const before = new Set();
const walk = (d) => { try { for (const f of fs.readdirSync(d, { withFileTypes: true }))
  f.isDirectory() ? walk(`${d}/${f.name}`) : before.add(`${d}/${f.name}`); } catch {} };
walk(localRoot);
const strays = [...before].filter(p => /\/(logo|stamp|sig|me|c|contract|terms)\.(png|pdf)$/.test(p));
if (strays.length) bad('files were also written to local disk', strays.join(', '));
else ok('no upload landed on the local filesystem');

/* ---- teardown ------------------------------------------------------------ */
for (const key of created) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
}
await execute('DELETE FROM invroot_attachments WHERE tenant_id = ?', [tenantId]).catch(() => {});
await execute('DELETE FROM company_signatories WHERE tenant_id = ?', [tenantId]).catch(() => {});
await execute('DELETE FROM clients WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM users   WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM tenants WHERE id = ?', [tenantId]);
console.log(`\nfixtures removed (tenant ${tenantId}, ${created.length} S3 objects)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
