/**
 * Adversarial sweep — what a hostile or careless caller can do over HTTP.
 *
 * The suites next to this one prove features work. This one assumes the caller
 * is not cooperating: wrong tenant, tampered ids, negative money, missing auth,
 * a forged token. Those are the failures that cost money rather than time.
 *
 * Two throwaway tenants, so "can A touch B's data?" can actually be asked.
 */

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { query, execute } from '../src/lib/database.js';

const API = process.env.TEST_API || 'http://127.0.0.1:5000/api';
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ''}`); };
const is  = (c, m, d) => (c ? ok(m) : bad(m, d));

const stamp = Math.floor(Number(process.hrtime.bigint() % 100000n));

async function makeTenant(tag) {
  const tenantId = (await execute(
    `INSERT INTO tenants (company_name, slug, email, currency, status, plan)
     VALUES (?, ?, ?, 'AED', 'active', 'starter')`,
    [`Adv ${tag} ${stamp}`, `adv-${tag}-${stamp}`, `adv-${tag}-${stamp}@fixture.invalid`])).insertId;
  const userId = (await execute(
    `INSERT INTO users (tenant_id, email, password, full_name, role, is_active, email_verified, is_owner)
     VALUES (?, ?, '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Adv Owner', 'admin', 1, 1, 1)`,
    [tenantId, `adv-${tag}-${stamp}@fixture.invalid`])).insertId;
  const clientId = (await execute(
    `INSERT INTO clients (tenant_id, name, email, currency, status) VALUES (?, ?, ?, 'AED', 'active')`,
    [tenantId, `Adv ${tag} Client`, `advc-${tag}-${stamp}@fixture.invalid`])).insertId;
  const invoiceId = (await execute(
    `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, currency, issue_date, due_date,
                           line_items, subtotal, tax_amount, total_amount, paid_amount)
     VALUES (?, ?, ?, 'sent', 'AED', CURDATE(), CURDATE(), ?, 1000, 0, 1000, 0)`,
    [tenantId, clientId, `ADV/${tag}/${stamp}`,
     JSON.stringify([{ description: 'Work', quantity: 1, unit_price: 1000, tax_rate: 0, total: 1000 }])])).insertId;
  const token = jwt.sign(
    { id: userId, username: `adv-${tag}-${stamp}@fixture.invalid`, role: 'admin', tenant_id: tenantId, is_super_admin: false },
    process.env.JWT_SECRET, { expiresIn: '15m' });
  return { tenantId, userId, clientId, invoiceId, token };
}

const A = await makeTenant('a');
const B = await makeTenant('b');

const call = async (method, path, body, token) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

/* ---- authentication ------------------------------------------------------ */
console.log('authentication');
{
  const noAuth = await call('GET', '/invoices');
  is(noAuth.status === 401, `no token is refused (${noAuth.status})`);

  const garbage = await call('GET', '/invoices', undefined, 'not.a.token');
  is(garbage.status === 401, `a malformed token is refused (${garbage.status})`);

  /* A token signed with the wrong key is the interesting case: it is
     structurally perfect and claims to be an admin. */
  const forged = jwt.sign(
    { id: A.userId, username: 'x', role: 'admin', tenant_id: A.tenantId, is_super_admin: true },
    'not-the-real-secret', { expiresIn: '15m' });
  const f = await call('GET', '/invoices', undefined, forged);
  is(f.status === 401, `a token signed with the wrong secret is refused (${f.status})`);

  const expired = jwt.sign(
    { id: A.userId, username: 'x', role: 'admin', tenant_id: A.tenantId },
    process.env.JWT_SECRET, { expiresIn: '-1h' });
  const e = await call('GET', '/invoices', undefined, expired);
  is(e.status === 401, `an expired token is refused (${e.status})`);
}

/* ---- tenant isolation ---------------------------------------------------- */
console.log('\ncan tenant A reach tenant B?');
{
  const read = await call('GET', `/invoices/${B.invoiceId}`, undefined, A.token);
  is(read.status === 404 || read.status === 403, `read B's invoice → ${read.status}`);

  const edit = await call('PUT', `/invoices/${B.invoiceId}`, {
    issue_date: '2026-01-01', due_date: '2026-02-01', currency: 'AED',
    line_items: [{ description: 'HACKED', quantity: 1, unit_price: 1, tax_rate: 0 }],
  }, A.token);
  const [afterEdit] = await query('SELECT total_amount, line_items FROM invoices WHERE id = ?', [B.invoiceId]);
  is(Number(afterEdit.total_amount) === 1000, `B's invoice total untouched by A's edit (${edit.status})`);
  is(!JSON.stringify(afterEdit.line_items).includes('HACKED'), "B's line items untouched");

  const del = await call('DELETE', `/invoices/${B.invoiceId}`, undefined, A.token);
  const stillThere = await query('SELECT id FROM invoices WHERE id = ?', [B.invoiceId]);
  is(stillThere.length === 1, `B's invoice not deleted by A (${del.status})`);

  const pay = await call('POST', '/payments', {
    invoice_id: B.invoiceId, amount: 1000, method: 'cash',
  }, A.token);
  const bPays = await query('SELECT COUNT(*) c FROM payments WHERE invoice_id = ?', [B.invoiceId]);
  is(Number(bPays[0].c) === 0, `A cannot record a payment against B's invoice (${pay.status})`);

  const cli = await call('GET', `/clients/${B.clientId}`, undefined, A.token);
  is(cli.status === 404 || cli.status === 403, `read B's client → ${cli.status}`);

  const voidIt = await call('POST', `/invoices/${B.invoiceId}/void`, {}, A.token);
  const [st] = await query('SELECT status FROM invoices WHERE id = ?', [B.invoiceId]);
  is(st.status !== 'void', `A cannot void B's invoice (${voidIt.status})`);

  const markSent = await call('POST', `/invoices/${B.invoiceId}/mark-sent`, {}, A.token);
  is(markSent.status === 404, `A cannot mark B's invoice as sent (${markSent.status})`);
}

/* ---- money validation ---------------------------------------------------- */
console.log('\nmoney that should be refused');
{
  const neg = await call('POST', '/payments', { invoice_id: A.invoiceId, amount: -500, method: 'cash' }, A.token);
  const [inv1] = await query('SELECT paid_amount FROM invoices WHERE id = ?', [A.invoiceId]);
  is(neg.status === 400, `a negative payment is refused (${neg.status})`);
  is(Number(inv1.paid_amount) >= 0, `paid_amount was not driven negative (paid=${inv1.paid_amount})`);
  is(Number((await query('SELECT COUNT(*) c FROM payments WHERE invoice_id = ?', [A.invoiceId]))[0].c) === 0,
     'and no payment row was written');

  const zero = await call('POST', '/payments', { invoice_id: A.invoiceId, amount: 0, method: 'cash' }, A.token);
  is(zero.status >= 400, `a zero payment is refused (${zero.status})`);

  const nan = await call('POST', '/payments', { invoice_id: A.invoiceId, amount: 'abc', method: 'cash' }, A.token);
  is(nan.status === 400, `a non-numeric amount is refused as a bad request, not a 500 (${nan.status})`);

  /* Prices are recomputed server-side; a client-supplied total must not win. */
  const rigged = await call('POST', '/invoices', {
    client_id: A.clientId, issue_date: '2026-08-02', due_date: '2026-09-01', currency: 'AED',
    line_items: [{ description: 'Item', quantity: 2, unit_price: 100, tax_rate: 0, total: 999999 }],
    total_amount: 1,
  }, A.token);
  if (rigged.body?.id) {
    const [made] = await query('SELECT total_amount FROM invoices WHERE id = ?', [rigged.body.id]);
    is(Number(made.total_amount) === 200,
       `the server computes the total (200), ignoring the client's 1 and the rigged line total (got ${made.total_amount})`);
    await execute('DELETE FROM invoices WHERE id = ?', [rigged.body.id]);
  } else bad('could not create the rigged invoice to test with', JSON.stringify(rigged.body).slice(0, 120));

  const negLine = await call('POST', '/invoices', {
    client_id: A.clientId, issue_date: '2026-08-02', due_date: '2026-09-01', currency: 'AED',
    line_items: [{ description: 'Refund-ish', quantity: -5, unit_price: 100, tax_rate: 0 }],
  }, A.token);
  is(negLine.status >= 400, `a negative quantity is refused (${negLine.status})`);
}

/* ---- injection ----------------------------------------------------------- */
console.log('\ninjection attempts');
{
  const inj = await call('GET', `/invoices?search=${encodeURIComponent("' OR 1=1 -- ")}`, undefined, A.token);
  is(inj.status === 200, 'a quote-heavy search does not error the server');
  is(!(inj.body.data || []).some(i => i.tenant_id && i.tenant_id !== A.tenantId),
     'and returns nothing from another tenant');

  const drop = await call('POST', '/clients', { name: "Robert'); DROP TABLE invoices;--", email: `sqli-${stamp}@fixture.invalid` }, A.token);
  const stillThere = await query("SHOW TABLES LIKE 'invoices'");
  is(stillThere.length === 1, 'the invoices table still exists after a classic injection payload');
  if (drop.body?.id) await execute('DELETE FROM clients WHERE id = ?', [drop.body.id]);

  /* Stored XSS. React escapes on render, so storing markup would not be fatal
     — but the global sanitizeBody middleware strips tags before the route ever
     sees them, which is the stronger position. A name that is ONLY markup is
     therefore empty by the time it is validated, and rejected. */
  const xss = await call('POST', '/clients', {
    name: '<img src=x onerror=alert(1)>', email: `xss-${stamp}@fixture.invalid`,
  }, A.token);
  is(xss.status === 400, `a name made entirely of markup is rejected outright (${xss.status})`);

  const mixed = await call('POST', '/clients', {
    name: 'Acme <script>alert(1)</script> Ltd', email: `xss2-${stamp}@fixture.invalid`,
  }, A.token);
  if (mixed.body?.id) {
    const [row] = await query('SELECT name FROM clients WHERE id = ?', [mixed.body.id]);
    is(!/<script|onerror=/i.test(row.name),
       `markup is stripped before storage (stored as "${row.name}")`);
    await execute('DELETE FROM clients WHERE id = ?', [mixed.body.id]);
  } else bad('could not create the mixed-content client', JSON.stringify(mixed.body).slice(0, 120));
}

/* ---- error hygiene ------------------------------------------------------- */
console.log('\nwhat errors leak');
{
  const notFound = await call('GET', '/invoices/99999999', undefined, A.token);
  const text = JSON.stringify(notFound.body);
  is(!/sql|syntax|mysql|ER_|at Object\.|\/src\//i.test(text),
     `a 404 leaks no SQL, stack or path (${text.slice(0, 90)})`);

  const badBody = await call('POST', '/invoices', { client_id: 'not-a-number' }, A.token);
  const t2 = JSON.stringify(badBody.body);
  is(!/sql|ER_|stack|\/Users\//i.test(t2), `a bad body leaks nothing internal (${t2.slice(0, 90)})`);

  const me = await call('GET', '/auth/me', undefined, A.token);
  const leaked = ['password', 'password_reset_token', 'email_verify_token', 'avatar_key']
    .filter(f => JSON.stringify(me.body).includes(`"${f}"`));
  is(leaked.length === 0, `/auth/me exposes no secret fields${leaked.length ? ' — LEAKED ' + leaked.join(', ') : ''}`);
}

/* ---- import abuse -------------------------------------------------------- */
console.log('\nimport abuse');
{
  const cross = await call('POST', '/invoices/import', {
    dry_run: false, invoices: [
      { invoice_number: `X-${stamp}`, client_id: B.clientId, issue_date: '2024-01-01', total_amount: 100 },
    ],
  }, A.token);
  const made = await query('SELECT COUNT(*) c FROM invoices WHERE tenant_id = ? AND client_id = ?', [A.tenantId, B.clientId]);
  is(Number(made[0].c) === 0, `import cannot attach A's invoice to B's client (${cross.status})`);

  const dupe = await call('POST', '/invoices/import', {
    dry_run: false, invoices: [
      { invoice_number: `ADV/a/${stamp}`, client_id: A.clientId, issue_date: '2024-01-01', total_amount: 5 },
    ],
  }, A.token);
  const same = await query('SELECT COUNT(*) c FROM invoices WHERE tenant_id = ? AND invoice_number = ?',
    [A.tenantId, `ADV/a/${stamp}`]);
  is(Number(same[0].c) === 1, `import cannot duplicate an existing invoice number (${dupe.status})`);
}

/* ---- teardown ------------------------------------------------------------ */
for (const T of [A, B]) {
  for (const [tbl, col] of [['payments','tenant_id'],['bank_transactions','tenant_id'],['bank_accounts','tenant_id'],
                            ['invoices','tenant_id'],['clients','tenant_id'],['users','tenant_id'],
                            ['invroot_audit_logs','tenant_id'],['doc_counters','tenant_id'],
                            ['invoice_numbering','tenant_id'],['tenants','id']]) {
    await execute(`DELETE FROM ${tbl} WHERE ${col} = ?`, [T.tenantId]).catch(() => {});
  }
}
console.log(`\nfixtures removed (tenants ${A.tenantId}, ${B.tenantId})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
