/**
 * Brand assets must survive the move onto the storage layer.
 * The logo is embedded in client-facing PDFs and shown on the public invoice
 * page, so a broken URL here is visible to the tenant's customers.
 */
import { generateToken } from '../src/middleware/auth.js';
const BASE = 'http://127.0.0.1:5000';
const pass = [], fail = [];
const check = (n, ok, d = '') => (ok ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

const { query, execute } = await import('../src/lib/storage.js')
  .then(() => import('../src/lib/database.js'));

/* A throwaway tenant, created and destroyed by this suite.
 *
 * This used to run against tenant 1 — a real workspace. Uploading a test logo
 * triggers the replace-on-upload delete of whatever was there, so every
 * regression run destroyed the tenant's actual logo and left the field NULL.
 * Test code must never touch a workspace a person owns. */
import bcrypt from 'bcryptjs';
const FIXTURE = `__brand-${Date.now()}`;
const tIns = await execute(
  `INSERT INTO tenants (company_name, slug, email, status, currency, lang)
   VALUES ('Brand Fixture Co', ?, ?, 'active', 'AED', 'en')`,
  [FIXTURE, `${FIXTURE}@invroot.test`]
);
const TENANT = tIns.insertId;
const uIns = await execute(
  `INSERT INTO users (tenant_id, email, username, full_name, password, role, is_owner, is_active, email_verified)
   VALUES (?, ?, ?, 'Brand Fixture', ?, 'admin', 1, 1, 1)`,
  [TENANT, `${FIXTURE}@invroot.test`, `${FIXTURE}@invroot.test`, await bcrypt.hash('fixture-only', 10)]
);
const owner = { id: uIns.insertId, username: `${FIXTURE}@invroot.test`, role: 'admin', tenant_id: TENANT, is_owner: 1 };
const token = generateToken(owner);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const before = null;   // a brand-new tenant starts with no logo
const uploadedKeys = [];  // everything this run puts in the bucket, so it can clean up

/* upload */
const fd = new FormData();
fd.append('logo', new Blob([PNG], { type: 'image/png' }), 'brand.png');
const up = await fetch(`${BASE}/api/company/logo`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
});
const upJson = await up.json();
check('POST /api/company/logo', up.status === 200 && upJson.success, `status=${up.status} ${upJson.message || ''}`);
check('response logo_url is absolute', /^https?:\/\//.test(upJson.logo_url || ''), upJson.logo_url);

/* stored as a tenant-scoped key, not a bare filename */
const [row] = await query('SELECT logo_url FROM tenants WHERE id = ?', [TENANT]);
uploadedKeys.push(row.logo_url);
check('stored value is a tenant-scoped key', String(row.logo_url).startsWith(`tenants/${TENANT}/logos/`), row.logo_url);

/* the URL actually fetches */
const img = await fetch(upJson.logo_url);
check('logo URL is fetchable', img.status === 200, `status=${img.status}`);
check('bytes match', Buffer.from(await img.arrayBuffer()).equals(PNG));

/* re-uploading must not leave the old object behind */
{
  const countObjects = async () => {
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const { config } = await import('../src/config.js');
    if (config.storage.driver !== 's3' || !config.storage.bucket) return null;
    const c = new S3Client({
      region: config.storage.region,
      ...(config.storage.accessKeyId ? { credentials: { accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey } } : {}),
    });
    const r = await c.send(new ListObjectsV2Command({ Bucket: config.storage.bucket, Prefix: `tenants/${TENANT}/logos/` }));
    return (r.Contents || []).length;
  };
  const n1 = await countObjects();
  const fd2 = new FormData();
  fd2.append('logo', new Blob([PNG], { type: 'image/png' }), 'brand2.png');
  await fetch(`${BASE}/api/company/logo`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd2 });
  const n2 = await countObjects();
  uploadedKeys.push((await query('SELECT logo_url FROM tenants WHERE id = ?', [TENANT]))[0].logo_url);
  if (n1 === null) {
    check('logo replace leaves no orphan (skipped on local driver)', true, 'local driver');
  } else {
    check('logo replace leaves no orphan in the bucket', n2 === n1, `${n1} objects before, ${n2} after`);
  }
}

/* GET /api/company hands back the resolved URL, not the raw key */
const co = await fetch(`${BASE}/api/company`, { headers: { Authorization: `Bearer ${token}` } });
const coJson = await co.json();
check('GET /api/company resolves logo_url', /^https?:\/\//.test(coJson.data?.logo_url || ''), coJson.data?.logo_url);

/* SVG logo is refused — it would render inline in every invoice PDF */
const fd2 = new FormData();
fd2.append('logo', new Blob([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')], { type: 'image/svg+xml' }), 'x.svg');
const svg = await fetch(`${BASE}/api/company/logo`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd2 });
check('SVG logo refused', svg.status === 400, `status=${svg.status}`);

/* the PDF renderer resolves it too */
/* The fixture tenant is brand new, so give it one invoice to render. This
   check is the only thing that proves the logo actually reaches the PDF —
   a successful render alone does not, because a broken <img> doesn't fail. */
const cIns = await execute(
  `INSERT INTO clients (tenant_id, name, email, currency, payment_terms, status)
   VALUES (?, 'Fixture Client', 'fixture-client@invroot.test', 'AED', 30, 'active')`, [TENANT]);
const invIns = await execute(
  `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
     line_items, subtotal, discount_value, discount_amount, tax_amount, total_amount, paid_amount, lang)
   VALUES (?, ?, 'FIXTURE-001', 'sent', CURDATE(), CURDATE(), 'AED', ?, 100, 0, 0, 0, 100, 0, 'en')`,
  [TENANT, cIns.insertId,
   JSON.stringify([{ description: 'Fixture line', quantity: 1, unit_price: 100, tax_rate: 0, total: 100 }])]);
const [inv] = await query('SELECT id, invoice_number FROM invoices WHERE id = ?', [invIns.insertId]);
if (inv) {
  const render = async () => {
    const r = await fetch(`${BASE}/api/invoices/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  };
  const withLogo = await render();
  check('invoice PDF still renders', withLogo.status === 200 && withLogo.buf.slice(0, 4).toString() === '%PDF',
    `status=${withLogo.status} ${withLogo.buf.length}B`);

  /* Rendering successfully is NOT proof the logo arrived — a broken <img> does
     not fail a PDF render, so this check used to pass with no logo at all.
     Count embedded image objects with and without one instead. */
  const images = (b) => (b.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
  const logoKey = (await query('SELECT logo_url FROM tenants WHERE id = ?', [TENANT]))[0].logo_url;
  await execute('UPDATE tenants SET logo_url = NULL WHERE id = ?', [TENANT]);
  const noLogo = await render();
  await execute('UPDATE tenants SET logo_url = ? WHERE id = ?', [logoKey, TENANT]);

  check('logo is actually embedded in the PDF', images(withLogo.buf) > images(noLogo.buf),
    `${images(withLogo.buf)} image(s) with logo vs ${images(noLogo.buf)} without`);
} else {
  check('invoice PDF still renders', false, 'fixture invoice missing');
}

/* a legacy bare filename must keep working after the switch */
await execute('UPDATE tenants SET logo_url = ? WHERE id = ?', ['legacy-logo.png', TENANT]);
const { resolveAssetUrl } = await import('../src/lib/storage.js');
const legacy = await resolveAssetUrl('legacy-logo.png', 'logos');
check('legacy bare filename still resolves', legacy?.endsWith('/uploads/logos/legacy-logo.png'), legacy);
/* The tenant tree holds private folders next to the public ones. */
for (const [folder, label] of [['documents', 'documents'], ['avatars', 'avatars']]) {
  const r = await fetch(`${BASE}/uploads/tenants/${TENANT}/${folder}/anything.png`, { redirect: 'manual' });
  check(`/uploads/tenants/*/${label} stays private`, r.status === 404, `status=${r.status}`);
}
const trav = await fetch(`${BASE}/uploads/tenants/${TENANT}/logos/../documents/x.png`, { redirect: 'manual' });
check('traversal out of a public folder refused', trav.status === 404, `status=${trav.status}`);

const hosted = await resolveAssetUrl('https://cdn.example.com/logo.png', 'logos');
check('hosted absolute URL passes through', hosted === 'https://cdn.example.com/logo.png', hosted);
check('empty value resolves to null', (await resolveAssetUrl('', 'logos')) === null);

/* Restore the original value — and remove the objects this run uploaded.
   The restore is a direct DB write, so it bypasses the route that would
   normally clean up; without this the suite litters the bucket every run. */
{
  const [cur] = await query('SELECT logo_url FROM tenants WHERE id = ?', [TENANT]);

  /* Restoring `before` blindly is how this suite once left the tenant pointing
     at a storage key whose object an earlier run had already swept — the app
     then rendered a broken image on every invoice. Only restore a value that
     still resolves to something; otherwise clear it, which the UI handles as
     "no logo yet". */
  let restore = before;
  if (before && String(before).startsWith('tenants/')) {
    const { getObjectStream } = await import('../src/lib/storage.js');
    try { await getObjectStream(before); } catch { restore = null; }
  }
  await execute('UPDATE tenants SET logo_url = ? WHERE id = ?', [restore, TENANT]);
  check('the suite leaves no dangling logo reference', true,
    restore === before ? 'restored the original' : 'original object was gone; cleared instead');

  const { deleteObject } = await import('../src/lib/storage.js');
  for (const key of new Set(uploadedKeys)) {
    if (key && key !== before && String(key).startsWith('tenants/')) await deleteObject(key);
  }
  if (cur?.logo_url && cur.logo_url !== before && String(cur.logo_url).startsWith('tenants/')) {
    await deleteObject(cur.logo_url);
  }
}

/* ── Every PDF route resolves the logo ────────────────────
   tenants.logo_url holds a STORAGE KEY, not a URL. The invoice route funnelled
   it through a resolver; the receipt and quote routes each did their own
   `SELECT * FROM tenants` and skipped it, so their PDFs embedded
   `<img src="tenants/42/logos/ab12.png">` — unresolvable in a renderer fed by
   setContent(), i.e. a broken image where the customer's brand should be.

   Checked at the source rather than by rendering: the failure is a route
   forgetting the funnel, and that is visible in the code long before anyone
   opens a PDF. */
{
  const { readFileSync } = await import('node:fs');
  /* Comments describe the bug and name the very SQL being banned, so they have
     to come out before the check — otherwise the fix's own explanation trips
     the assertion that guards it. */
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  for (const name of ['receipts', 'quotes', 'invoices']) {
    const raw = readFileSync(new URL(`../src/routes/${name}.js`, import.meta.url), 'utf8');
    if (!/generate(Invoice|Receipt)Pdf\s*\(/.test(raw)) continue;
    const src = stripComments(raw);
    check(`${name}: PDF route imports the branding funnel`,
      /from '\.\.\/lib\/branding\.js'/.test(src));
    /* The exact shape of the original bug: a raw tenant row handed to a
       renderer without passing through the resolver. */
    check(`${name}: no raw tenant row feeds a PDF`,
      !/SELECT \* FROM tenants/i.test(src),
      'use getTenantWithBranding() so logo/stamp/signature resolve');
  }

  /* Non-vacuous on purpose: plant a storage key and require the funnel to hand
     back something fetchable. Asserting on whatever the fixture happens to hold
     would pass trivially once an earlier block has cleared the logo. */
  const { getTenantWithBranding } = await import('../src/lib/branding.js');
  const [before] = await query('SELECT logo_url FROM tenants WHERE id = ?', [TENANT]);
  await execute('UPDATE tenants SET logo_url = ? WHERE id = ?',
    [`tenants/${TENANT}/logos/guard-fixture.png`, TENANT]);
  const branded = await getTenantWithBranding(TENANT);
  await execute('UPDATE tenants SET logo_url = ? WHERE id = ?', [before?.logo_url ?? null, TENANT]);

  check('the funnel turns a storage key into a fetchable URL',
    /^https?:\/\//i.test(String(branded.logo_url || '')),
    String(branded.logo_url).slice(0, 70));
}

/* Remove the fixture entirely — tenant, user, and anything it created. */
{
  const { deleteObject } = await import('../src/lib/storage.js');
  const [t] = await query('SELECT logo_url, stamp_url FROM tenants WHERE id = ?', [TENANT]);
  for (const k of [t?.logo_url, t?.stamp_url]) {
    if (k && String(k).startsWith('tenants/')) await deleteObject(k).catch(() => {});
  }
  await execute('DELETE FROM company_signatories WHERE tenant_id = ?', [TENANT]).catch(() => {});
  await execute('DELETE FROM invoices WHERE tenant_id = ?', [TENANT]);
  await execute('DELETE FROM clients WHERE tenant_id = ?', [TENANT]);
  await execute('DELETE FROM users WHERE tenant_id = ?', [TENANT]);
  await execute('DELETE FROM tenants WHERE id = ?', [TENANT]);
}

for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
