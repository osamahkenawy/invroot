/**
 * Importing historical invoices.
 *
 * The failure modes here are quiet, not loud. An import that renumbers a
 * customer's invoice, restates its total at today's tax rate, or emails two
 * years of customers about payments they already made all "succeed". So these
 * assert the properties that make an import trustworthy:
 *
 *   the original invoice number survives
 *   the original total survives, even when it disagrees with the line items
 *   a settled invoice arrives settled, not as a draft
 *   nothing is sent to anybody
 *   re-running is safe
 *   a dry run predicts the real thing and writes nothing
 *
 * Runs over HTTP against a throwaway tenant, so it exercises the real route
 * with real middleware rather than the library in isolation.
 */

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { query, execute } from '../src/lib/database.js';

const API = process.env.TEST_API || 'http://127.0.0.1:5000/api';
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ''}`); };
const is  = (c, m, d) => (c ? ok(m) : bad(m, d));
const eq  = (a, b, m) => (String(a) === String(b) ? ok(m) : bad(m, `expected ${b}, got ${a}`));

/* ---- fixtures ------------------------------------------------------------ */
const stamp = Math.floor(Number(process.hrtime.bigint() % 100000n));
const tenantId = (await execute(
  `INSERT INTO tenants (company_name, slug, email, currency, status, plan)
   VALUES (?, ?, ?, 'AED', 'active', 'starter')`,
  [`Import Fixture ${stamp}`, `imp-${stamp}`, `imp-${stamp}@fixture.invalid`])).insertId;

const userId = (await execute(
  `INSERT INTO users (tenant_id, email, password, full_name, role, is_active, email_verified, is_owner)
   VALUES (?, ?, '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Import Owner', 'admin', 1, 1, 1)`,
  [tenantId, `imp-${stamp}@fixture.invalid`])).insertId;

const knownClientId = (await execute(
  `INSERT INTO clients (tenant_id, name, email, currency, status)
   VALUES (?, 'Existing Customer LLC', ?, 'AED', 'active')`,
  [tenantId, `known-${stamp}@fixture.invalid`])).insertId;

const token = jwt.sign(
  { id: userId, username: `imp-${stamp}@fixture.invalid`, role: 'admin', tenant_id: tenantId, is_super_admin: false },
  process.env.JWT_SECRET, { expiresIn: '15m' });

const post = async (body) => {
  const r = await fetch(`${API}/invoices/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

/* Messages are { code, params, msg } so the browser can translate them; these
   assertions read the English fallback that travels with each one. */
const txt = (list) => (list || []).map(e => (typeof e === 'string' ? e : e.msg)).join(' | ');

const countInvoices = async () =>
  Number((await query('SELECT COUNT(*) c FROM invoices WHERE tenant_id = ?', [tenantId]))[0].c);

/* A realistic file: an old paid invoice with its own number and an odd tax
   rate, a partly-paid one, and one still outstanding. */
const FILE = [
  {
    invoice_number: '2024-001',
    client_id: knownClientId,
    issue_date: '2024-03-11', due_date: '2024-04-10',
    currency: 'AED',
    line_items: [{ description: 'Retainer — March', quantity: 1, unit_price: 10000, tax_rate: 5 }],
    total_amount: 10500,
    status: 'paid',
    payments: [{ amount: 10500, method: 'bank_transfer', payment_date: '2024-04-02', reference: 'FT24040201' }],
  },
  {
    invoice_number: '2024-002',
    client_name: 'Brand New Customer FZE',
    client_email: `new-${stamp}@fixture.invalid`,
    issue_date: '2024-05-01', due_date: '2024-05-31',
    currency: 'AED',
    line_items: [{ description: 'Consulting', quantity: 20, unit_price: 500, tax_rate: 0 }],
    status: 'partial',
    payments: [{ amount: 4000, method: 'cash', payment_date: '2024-06-15' }],
  },
  {
    invoice_number: '2024-003',
    client_id: knownClientId,
    issue_date: '2024-09-09', due_date: '2024-10-09',
    total_amount: 2750.5,
    status: 'sent',
    description: 'Website maintenance 2024',
  },
];

/* ---- dry run ------------------------------------------------------------- */
console.log('dry run');
{
  const before = await countInvoices();
  const { status, body } = await post({ invoices: FILE, create_missing_clients: true });

  eq(status, 200, 'dry run accepted');
  is(body.dry_run === true, 'reported as a dry run');
  eq(body.summary.importable, 3, 'all three rows are importable');
  eq(body.summary.clients_to_create, 1, 'one client would be created');
  eq(body.summary.value, 10500 + 10000 + 2750.5, 'totals the money it would bring in');
  eq(await countInvoices(), before, 'NOTHING was written');
  is((await query('SELECT COUNT(*) c FROM clients WHERE tenant_id = ?', [tenantId]))[0].c === 1,
     'no client was created either');

  const row3 = body.rows.find(r => r.invoice_number === '2024-003');
  is(/No line items/i.test((row3.warnings||[]).map(w=>w.msg||w).join(' ')), 'warns that a summary line will be created');
}

/* ---- the real thing ------------------------------------------------------ */
console.log('\nimport');
let importedIds = {};
{
  const { status, body } = await post({ invoices: FILE, create_missing_clients: true, dry_run: false });
  eq(status, 200, 'import accepted');
  eq(body.summary.imported, 3, 'three invoices imported');
  eq(body.summary.clients_created, 1, 'the unknown customer was created once');

  const rows = await query(
    'SELECT id, invoice_number, status, issue_date, total_amount, paid_amount, sent_at FROM invoices WHERE tenant_id = ? ORDER BY invoice_number',
    [tenantId]);
  rows.forEach(r => { importedIds[r.invoice_number] = r.id; });

  eq(rows.length, 3, 'three rows on record');
  eq(rows.map(r => r.invoice_number).join(','), '2024-001,2024-002,2024-003',
     'ORIGINAL invoice numbers preserved — not renumbered');
}

console.log('\nthe money survived the trip');
{
  const [a] = await query("SELECT * FROM invoices WHERE tenant_id = ? AND invoice_number = '2024-001'", [tenantId]);
  eq(Number(a.total_amount), 10500, 'total kept exactly as issued (5% VAT of its day)');
  eq(Number(a.paid_amount), 10500, 'recorded as fully paid');
  eq(a.status, 'paid', 'arrives PAID, not as a draft');
  eq(String(a.issue_date).slice(0, 10), '2024-03-11', 'original issue date kept');
  is(a.sent_at !== null, 'a non-draft import is marked as having been issued');

  const [b] = await query("SELECT * FROM invoices WHERE tenant_id = ? AND invoice_number = '2024-002'", [tenantId]);
  eq(Number(b.total_amount), 10000, 'total computed from line items when not supplied');
  eq(Number(b.paid_amount), 4000, 'partial payment recorded');
  eq(b.status, 'partial', 'status matches the money');

  const pays = await query('SELECT amount, method, payment_date FROM payments WHERE tenant_id = ? ORDER BY id', [tenantId]);
  eq(pays.length, 2, 'both historical payments written');
  eq(String(pays[0].payment_date).slice(0, 10), '2024-04-02', 'payment keeps its ORIGINAL date');
  eq(pays[1].method, 'cash', 'payment method preserved');
}

/* The whole reason payments are written directly rather than through the
   payments route. */
console.log('\nnothing was sent to anybody');
{
  const receipts = await query('SELECT COUNT(*) c FROM receipts WHERE tenant_id = ?', [tenantId]).catch(() => [{ c: 0 }]);
  eq(receipts[0].c, 0, 'no receipts auto-generated for two-year-old payments');

  const notes = await query('SELECT COUNT(*) c FROM invroot_notifications WHERE tenant_id = ?', [tenantId]).catch(() => [{ c: 0 }]);
  eq(notes[0].c, 0, 'no in-app notifications raised');

  const audit = await query("SELECT action FROM invroot_audit_logs WHERE tenant_id = ? AND action = 'import'", [tenantId]);
  is(audit.length === 1, 'the import itself IS audited (one entry, not one per row)');
}

/* ---- idempotency --------------------------------------------------------- */
console.log('\nre-running the same file');
{
  const before = await countInvoices();
  const { status, body } = await post({ invoices: FILE, create_missing_clients: true, dry_run: false });
  eq(status, 400, 'refused — there is nothing new to do');
  eq(body.summary.skipped, 3, 'all three recognised as already imported');
  eq(await countInvoices(), before, 'no duplicates created');
}

console.log('\na corrected file re-run imports only the new rows');
{
  const fixed = [...FILE, {
    invoice_number: '2024-004', client_id: knownClientId,
    issue_date: '2024-11-02', due_date: '2024-12-02',
    total_amount: 500, status: 'sent',
  }];
  const { body } = await post({ invoices: fixed, create_missing_clients: true, dry_run: false });
  eq(body.summary.imported, 1, 'only the one new invoice imported');
  eq(body.summary.skipped, 3, 'the three already-imported rows skipped');
  eq(await countInvoices(), 4, 'four invoices total');
}

/* ---- validation ---------------------------------------------------------- */
console.log('\nbad data is refused, with the reason');
{
  const { body } = await post({ invoices: [
    { client_id: knownClientId, issue_date: '2025-01-01', total_amount: 100 },                    // no number
    { invoice_number: 'X-1', client_id: knownClientId, total_amount: 100 },                       // no issue date
    { invoice_number: 'X-2', client_id: knownClientId, issue_date: '01/02/2024', total_amount: 5 }, // ambiguous date
    { invoice_number: 'X-3', client_id: knownClientId, issue_date: '2025-01-01', total_amount: 100,
      status: 'paid', payments: [{ amount: 40, method: 'cash', payment_date: '2025-01-02' }] },   // paid but underpaid
    { invoice_number: 'X-4', client_id: 999999, issue_date: '2025-01-01', total_amount: 100 },    // foreign client
    { invoice_number: 'X-5', client_id: knownClientId, issue_date: '2025-01-01', total_amount: 100,
      payments: [{ amount: 500, method: 'cash', payment_date: '2025-01-02' }] },                  // overpaid
  ]});

  const err = (n) => txt(body.rows.find(r => r.invoice_number === n)?.errors);
  is(/invoice_number is required/.test(txt(body.rows[0].errors)), 'missing number rejected');
  is(/issue_date is required/.test(err('X-1')), 'missing issue date rejected');
  is(/YYYY-MM-DD/.test(err('X-2')), 'ambiguous 01/02/2024 rejected rather than guessed');
  is(/only cover/.test(err('X-3')), "'paid' with insufficient payments rejected");
  is(/does not belong/.test(err('X-4')), "another tenant's client rejected");
  is(/exceeds the invoice total/.test(err('X-5')), 'overpayment rejected');
  eq(body.summary.importable, 0, 'nothing importable in a bad file');
}

console.log('\nevery message carries a translatable code');
{
  const { body } = await post({ invoices: [
    { invoice_number: '', client_id: knownClientId, total_amount: 0 },
  ]});
  const all = body.rows.flatMap(r => [...(r.errors||[]), ...(r.warnings||[])]);
  is(all.length > 0, 'the bad row produced messages');
  is(all.every(e => e && typeof e === 'object' && e.code && e.msg),
     'each carries { code, msg } so it can be translated, with English as the fallback');
}

console.log('\nduplicate numbers inside one file');
{
  const { body } = await post({ invoices: [
    { invoice_number: 'D-1', client_id: knownClientId, issue_date: '2025-02-01', total_amount: 10 },
    { invoice_number: 'D-1', client_id: knownClientId, issue_date: '2025-02-02', total_amount: 20 },
  ]});
  is(/more than once/.test(txt(body.rows[1].errors)), 'the second D-1 is refused');
  eq(body.summary.importable, 1, 'only the first is importable');
}

console.log('\nunknown clients without permission to create them');
{
  const { body } = await post({ invoices: [
    { invoice_number: 'U-1', client_name: 'Never Seen Before Co', issue_date: '2025-03-01', total_amount: 10 },
  ]});
  is(/create missing clients/i.test(txt(body.rows[0].errors)),
     'refuses to invent a customer unless asked');
}

/* The same customer, spelled the same, but with an email on only one row —
   the normal state of a real export. */
console.log('\none customer across rows with patchy details');
{
  const { body } = await post({ create_missing_clients: true, invoices: [
    { invoice_number: 'DUP-1', client_name: 'Gulf Marine Services',
      client_email: `gulf-${stamp}@fixture.invalid`,
      issue_date: '2024-01-05', total_amount: 100, status: 'sent' },
    { invoice_number: 'DUP-2', client_name: 'Gulf Marine Services',
      issue_date: '2024-02-05', total_amount: 200, status: 'sent' },
    { invoice_number: 'DUP-3', client_email: `gulf-${stamp}@fixture.invalid`,
      issue_date: '2024-03-05', total_amount: 300, status: 'sent' },
  ]});
  eq(body.summary.clients_to_create, 1,
     'one customer, not one per spelling — an email on some rows and not others is normal');

  const done = await post({ create_missing_clients: true, dry_run: false, invoices: [
    { invoice_number: 'DUP-1', client_name: 'Gulf Marine Services',
      client_email: `gulf-${stamp}@fixture.invalid`,
      issue_date: '2024-01-05', total_amount: 100, status: 'sent' },
    { invoice_number: 'DUP-2', client_name: 'Gulf Marine Services',
      issue_date: '2024-02-05', total_amount: 200, status: 'sent' },
  ]});
  eq(done.body.summary.clients_created, 1, 'and only one is actually created');

  const gulf = await query(
    "SELECT id, email FROM clients WHERE tenant_id = ? AND name = 'Gulf Marine Services'", [tenantId]);
  eq(gulf.length, 1, 'exactly one Gulf Marine Services on record');
  is(gulf[0].email !== null, 'the email from the row that had one was kept');

  const theirs = await query(
    'SELECT COUNT(*) c FROM invoices WHERE tenant_id = ? AND client_id = ?', [tenantId, gulf[0].id]);
  eq(theirs[0].c, 2, 'both invoices went to the SAME customer, not split across duplicates');
}

/* ---- totals disagreement -------------------------------------------------- */
console.log('\nwhen the stated total disagrees with the line items');
{
  const { body } = await post({ invoices: [{
    invoice_number: 'T-1', client_id: knownClientId,
    issue_date: '2025-04-01', total_amount: 1000,
    line_items: [{ description: 'Thing', quantity: 1, unit_price: 900, tax_rate: 0 }],
    status: 'sent',
  }] });
  const row = body.rows[0];
  is(row.errors.length === 0, 'not an error — old tax rules are real');
  is(/does not equal the line items/.test((row.warnings||[]).map(w=>w.msg||w).join(' ')), 'but it IS reported');
  eq(row.total, 1000, 'the stated total wins — the customer holds that invoice');
}

/* ---- numbering after import ---------------------------------------------- */
console.log('\nthe live numbering sequence after an import');
{
  const r = await fetch(`${API}/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      client_id: knownClientId, issue_date: '2026-08-02', due_date: '2026-09-01', currency: 'AED',
      line_items: [{ description: 'New work', quantity: 1, unit_price: 100, tax_rate: 0 }],
    }),
  });
  const b = await r.json();
  is(b.success, `a new invoice can still be created (${b.invoice_number || b.message})`);
  const clash = await query(
    'SELECT COUNT(*) c FROM invoices WHERE tenant_id = ? AND invoice_number = ?',
    [tenantId, b.invoice_number]);
  eq(clash[0].c, 1, 'its number does not collide with any imported number');

  /* The quiet damage this guards against: SUBSTRING_INDEX('2024-001','/',-1)
     is the whole string, which casts to 2024. Before the pattern filter, the
     five imported legacy numbers dragged the live counter to 2024 and the next
     real invoice came out as .../2025 — and an import numbered 9999-001 would
     have pushed every future invoice past 10000. */
  const seq = Number(String(b.invoice_number).split('/').pop());
  is(seq < 100, `the live sequence is unpolluted by legacy numbers (seq ${seq}, not ~2024)`);

  const [counter] = await query(
    "SELECT next_seq FROM doc_counters WHERE tenant_id = ? AND doc_type = 'invoice'", [tenantId]);
  is(Number(counter?.next_seq || 0) < 100,
     `the stored counter is unpolluted too (next_seq ${counter?.next_seq})`);

  // A deliberately outrageous legacy number must not move the counter at all.
  await execute(
    `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, currency, issue_date, due_date,
                           line_items, subtotal, tax_amount, total_amount, paid_amount)
     VALUES (?, ?, '9999-001', 'paid', 'AED', '2019-01-01', '2019-02-01', '[]', 1, 0, 1, 1)`,
    [tenantId, knownClientId]);
  const r2 = await fetch(`${API}/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      client_id: knownClientId, issue_date: '2026-08-02', due_date: '2026-09-01', currency: 'AED',
      line_items: [{ description: 'After 9999', quantity: 1, unit_price: 10, tax_rate: 0 }],
    }),
  });
  const b2 = await r2.json();
  const seq2 = Number(String(b2.invoice_number).split('/').pop());
  is(seq2 < 100, `a 9999-001 legacy number does not push the sequence past 10000 (got ${seq2})`);
}

/* ---- tenant isolation ----------------------------------------------------- */
console.log('\ntenant isolation');
{
  const otherTenant = (await execute(
    `INSERT INTO tenants (company_name, slug, email, currency, status, plan)
     VALUES (?, ?, ?, 'AED', 'active', 'starter')`,
    [`Other Imp ${stamp}`, `oimp-${stamp}`, `oimp-${stamp}@fixture.invalid`])).insertId;
  const otherClient = (await execute(
    `INSERT INTO clients (tenant_id, name, email, currency, status) VALUES (?, 'Their Client', ?, 'AED', 'active')`,
    [otherTenant, `oc-${stamp}@fixture.invalid`])).insertId;

  const { body } = await post({ invoices: [
    { invoice_number: 'ISO-1', client_id: otherClient, issue_date: '2025-01-01', total_amount: 100 },
  ]});
  is(/does not belong/.test(txt(body.rows[0].errors)), "cannot import against another tenant's client");

  // Their invoice numbers must not block ours, nor ours theirs.
  await execute(
    `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, currency, issue_date, due_date,
                           line_items, subtotal, tax_amount, total_amount, paid_amount)
     VALUES (?, ?, '2024-001', 'sent', 'AED', '2024-03-11', '2024-04-10', '[]', 100, 0, 100, 0)`,
    [otherTenant, otherClient]);
  const mine = await query("SELECT COUNT(*) c FROM invoices WHERE tenant_id = ? AND invoice_number = '2024-001'", [tenantId]);
  eq(mine[0].c, 1, 'the same number can exist for two different tenants');

  await execute('DELETE FROM invoices WHERE tenant_id = ?', [otherTenant]);
  await execute('DELETE FROM clients  WHERE tenant_id = ?', [otherTenant]);
  await execute('DELETE FROM tenants  WHERE id = ?',        [otherTenant]);
}

/* ---- batch size ----------------------------------------------------------- */
console.log('\nguards');
{
  const huge = Array.from({ length: 1001 }, (_, i) => ({
    invoice_number: `H-${i}`, client_id: knownClientId, issue_date: '2025-01-01', total_amount: 1,
  }));
  const { status, body } = await post({ invoices: huge });
  eq(status, 400, 'a file over 1000 rows is refused');
  is(/1000 at a time/.test(body.message), 'and says why');

  const empty = await post({ invoices: [] });
  eq(empty.status, 400, 'an empty file is refused');
}

/* ---- teardown ------------------------------------------------------------- */
await execute('DELETE FROM payments WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM invoices WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM clients  WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM users    WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM invroot_audit_logs WHERE tenant_id = ?', [tenantId]).catch(() => {});
await execute('DELETE FROM invoice_numbering  WHERE tenant_id = ?', [tenantId]).catch(() => {});
await execute('DELETE FROM tenants WHERE id = ?', [tenantId]);
console.log(`\nfixtures removed (tenant ${tenantId})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
