/**
 * Unbilled work → invoice.
 *
 * The question that matters is not "does it make an invoice" but "can the same
 * work ever be charged twice, or be lost". Everything below is about those two.
 */
import { generateToken } from '../src/middleware/auth.js';
import { query, execute } from '../src/lib/database.js';

const BASE = 'http://127.0.0.1:5000';
const pass = [], fail = [];
const check = (n, ok, d = '') => (ok ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

const [owner] = await query('SELECT id, username, role, tenant_id FROM users WHERE tenant_id = 1 AND is_owner = 1 LIMIT 1');
const [other] = await query('SELECT id, username, role, tenant_id FROM users WHERE tenant_id <> 1 AND is_active = 1 LIMIT 1');
const tok = generateToken(owner), tokOther = generateToken(other);

const call = async (path, { method = 'GET', body, token = tok } = {}) => {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body && JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
};

/* A client and some work that belongs only to this test. */
const cIns = await execute(
  `INSERT INTO clients (tenant_id, name, email, currency, payment_terms, status)
   VALUES (1, '__billable fixture', 'fixture@invroot.test', 'AED', 30, 'active')`);
const CLIENT = cIns.insertId;
const created = { time: [], expenses: [], invoices: [] };

const addTime = async (hours, rate) => {
  const r = await execute(
    `INSERT INTO time_entries (tenant_id, client_id, project, description, hours, hourly_rate, entry_date, status)
     VALUES (1, ?, 'Fixture', 'Work', ?, ?, CURDATE(), 'unbilled')`, [CLIENT, hours, rate]);
  created.time.push(r.insertId); return r.insertId;
};
const addExpense = async (amount, { billable = 1, currency = 'AED', client = CLIENT } = {}) => {
  const r = await execute(
    `INSERT INTO expenses (tenant_id, client_id, billable, vendor_name, category, amount, currency, expense_date, status)
     VALUES (1, ?, ?, 'Fixture Vendor', 'Travel', ?, ?, CURDATE(), 'unpaid')`,
    [client, billable, amount, currency]);
  created.expenses.push(r.insertId); return r.insertId;
};

/* ── what is waiting to be billed ────────────────────── */
const t1 = await addTime(10, 100);      // 1,000
const t2 = await addTime(2.5, 200);     //   500
const e1 = await addExpense(300);       //   300
await addExpense(999, { billable: 0 }); // absorbed — must not appear
{
  const r = await call(`/api/invoices/unbilled/${CLIENT}`);
  const d = r.json?.data;
  check('unbilled work is listed', r.status === 200 && !!d, `status=${r.status}`);
  check('hours are totalled', d?.totals.hours === 12.5, String(d?.totals.hours));
  check('time value is computed from hours x rate', d?.totals.time_amount === 1500, String(d?.totals.time_amount));
  check('billable expenses are included', d?.totals.expense_amount === 300, String(d?.totals.expense_amount));
  check('non-billable costs are excluded', d?.totals.expense_count === 1,
    'an absorbed cost must never be offered for billing');
}

/* ── another tenant cannot see or bill it ────────────── */
{
  const r = await call(`/api/invoices/unbilled/${CLIENT}`, { token: tokOther });
  check('another tenant cannot see this work', r.status === 404, `status=${r.status}`);
  const b = await call('/api/invoices/from-unbilled', {
    method: 'POST', token: tokOther,
    body: { client_id: CLIENT, time_entry_ids: [t1] } });
  check('another tenant cannot bill it', b.status === 404 || b.status === 403, `status=${b.status}`);
}

/* ── creating the invoice ────────────────────────────── */
let invoiceId;
{
  const r = await call('/api/invoices/from-unbilled', {
    method: 'POST', body: { client_id: CLIENT, time_entry_ids: [t1, t2], expense_ids: [e1] } });
  invoiceId = r.json?.id;
  created.invoices.push(invoiceId);
  check('invoice is created from work', r.status === 201 && !!invoiceId, `status=${r.status} ${r.json?.message || ''}`);

  const [inv] = await query('SELECT total_amount, line_items, status, currency FROM invoices WHERE id = ?', [invoiceId]);
  check('total equals the work billed', Number(inv.total_amount) === 1800, String(inv.total_amount));
  check('it lands as a draft, not sent', inv.status === 'draft', inv.status);
  check('it uses the client currency', inv.currency === 'AED', inv.currency);
  const items = typeof inv.line_items === 'string' ? JSON.parse(inv.line_items) : inv.line_items;
  check('every piece of work became a line', items.length === 3, `${items.length} lines`);
}

/* ── the work is now claimed ─────────────────────────── */
{
  const rows = await query('SELECT id, invoice_id, status FROM time_entries WHERE id IN (?, ?)', [t1, t2]);
  check('time is marked billed against the invoice',
    rows.every(r => r.invoice_id === invoiceId && r.status === 'billed'),
    JSON.stringify(rows.map(r => r.status)));
  const [exp] = await query('SELECT invoice_id FROM expenses WHERE id = ?', [e1]);
  check('the expense is marked billed', exp.invoice_id === invoiceId, String(exp.invoice_id));

  const r = await call(`/api/invoices/unbilled/${CLIENT}`);
  check('billed work disappears from the unbilled list',
    r.json?.data?.totals.time_count === 0 && r.json?.data?.totals.expense_count === 0,
    JSON.stringify(r.json?.data?.totals));
}

/* ── it cannot be billed a second time ───────────────── */
{
  const r = await call('/api/invoices/from-unbilled', {
    method: 'POST', body: { client_id: CLIENT, time_entry_ids: [t1] } });
  check('already-billed time is refused', r.status === 409, `status=${r.status}`);
  check('the refusal explains why', /already been invoiced/i.test(r.json?.message || ''), r.json?.message);
}

/* ── the race: two people billing the same work at once ── */
{
  const a = await addTime(5, 100);
  const b = await addTime(5, 100);
  const results = await Promise.all([1, 2, 3, 4].map(() =>
    call('/api/invoices/from-unbilled', {
      method: 'POST', body: { client_id: CLIENT, time_entry_ids: [a, b] } })));

  const created201 = results.filter(r => r.status === 201);
  created201.forEach(r => created.invoices.push(r.json.id));
  check('exactly one of four concurrent attempts succeeds', created201.length === 1,
    `${created201.length} succeeded — more than one means a customer billed twice`);

  const rows = await query('SELECT invoice_id FROM time_entries WHERE id IN (?, ?)', [a, b]);
  const distinct = new Set(rows.map(r => r.invoice_id));
  check('the work is attached to exactly one invoice', distinct.size === 1, `${distinct.size} invoices`);

  /* The losers must not have created an invoice at all. A rolled-back claim
     that still leaves an invoice behind is a phantom charge. */
  const phantom = await query(
    "SELECT COUNT(*) n FROM invoices WHERE client_id = ? AND status = 'draft' AND total_amount = 1000", [CLIENT]);
  check('losing attempts leave no phantom invoice', phantom[0].n === 1, `${phantom[0].n} invoices for that work`);
}

/* ── voiding gives the work back ─────────────────────── */
{
  const v = await call(`/api/invoices/${invoiceId}/void`, { method: 'POST' });
  check('the invoice voids', v.status === 200, `status=${v.status}`);

  const rows = await query('SELECT invoice_id, status FROM time_entries WHERE id IN (?, ?)', [t1, t2]);
  check('voiding releases the time',
    rows.every(r => r.invoice_id === null && r.status === 'unbilled'),
    'otherwise the hours are stranded against a document that charges nothing');

  const [exp] = await query('SELECT invoice_id FROM expenses WHERE id = ?', [e1]);
  check('voiding releases the expense', exp.invoice_id === null, String(exp.invoice_id));

  const r = await call(`/api/invoices/unbilled/${CLIENT}`);
  check('released work is billable again', r.json?.data?.totals.time_count === 2,
    `${r.json?.data?.totals.time_count} entries back`);
}

/* ── things that must be refused ─────────────────────── */
{
  const none = await call('/api/invoices/from-unbilled', { method: 'POST', body: { client_id: CLIENT } });
  check('billing nothing is refused', none.status === 400, `status=${none.status}`);

  const noRate = await execute(
    `INSERT INTO time_entries (tenant_id, client_id, project, hours, hourly_rate, entry_date, status)
     VALUES (1, ?, 'No rate', 3, NULL, CURDATE(), 'unbilled')`, [CLIENT]);
  created.time.push(noRate.insertId);
  const r = await call('/api/invoices/from-unbilled', {
    method: 'POST', body: { client_id: CLIENT, time_entry_ids: [noRate.insertId] } });
  check('time with no rate is refused, not billed at zero', r.status === 400, `status=${r.status}`);

  const usd = await addExpense(50, { currency: 'USD' });
  const cur = await call('/api/invoices/from-unbilled', {
    method: 'POST', body: { client_id: CLIENT, expense_ids: [usd] } });
  check('a foreign-currency expense is refused, not billed at face value',
    cur.status === 400 && /convert/i.test(cur.json?.message || ''), cur.json?.message);

  const foreign = await addExpense(70, { client: null });
  const wrong = await call('/api/invoices/from-unbilled', {
    method: 'POST', body: { client_id: CLIENT, expense_ids: [foreign] } });
  check("another client's expense cannot be attached", wrong.status === 400, `status=${wrong.status}`);
}

/* ── the roll-up ─────────────────────────────────────── */
{
  const r = await call('/api/invoices/unbilled');
  const mine = r.json?.data?.clients?.find(c => c.client_id === CLIENT);
  check('the cross-client roll-up finds this client', !!mine, `${r.json?.data?.client_count} clients with work`);
  check('the roll-up carries a value', Number(mine?.time_amount) > 0, String(mine?.time_amount));
}

/* cleanup */
for (const id of created.invoices.filter(Boolean)) await execute('DELETE FROM invoices WHERE id = ?', [id]);
await execute('DELETE FROM time_entries WHERE client_id = ?', [CLIENT]);
await execute('DELETE FROM expenses WHERE client_id = ? OR id IN (?)', [CLIENT, created.expenses.at(-1) || 0]);
await execute('DELETE FROM clients WHERE id = ?', [CLIENT]);

for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
