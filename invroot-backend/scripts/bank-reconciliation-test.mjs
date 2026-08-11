/**
 * Payments ↔ banking.
 *
 * The dangerous failure here is not an error message, it is a bank balance that
 * quietly disagrees with reality. So most of these assert the invariant rather
 * than the happy path: after N operations, does the account balance still equal
 * the sum of its own transactions, and did any money get counted twice?
 *
 * Runs entirely on a throwaway tenant. Nothing here touches real data — an
 * earlier suite in this project did, and destroyed a tenant's logo repeatedly.
 */

import 'dotenv/config';
import { query, execute, transaction } from '../src/lib/database.js';
import {
  depositPayment, withdrawPayment, matchTransaction, unmatchTransaction, unreconciled,
} from '../src/lib/bank-reconciliation.js';

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ''}`); };
const eq  = (a, b, m) => (Number(a) === Number(b) ? ok(m) : bad(m, `expected ${b}, got ${a}`));

/* ---- fixtures ------------------------------------------------------------ */
const stamp = Math.floor(Number(process.hrtime.bigint() % 100000n));
const tenantId = (await execute(
  `INSERT INTO tenants (company_name, slug, email, currency, status, plan)
   VALUES (?, ?, ?, 'AED', 'active', 'starter')`,
  [`Bank Fixture ${stamp}`, `bank-fx-${stamp}`, `bank-${stamp}@fixture.invalid`])).insertId;

const clientId = (await execute(
  `INSERT INTO clients (tenant_id, name, email, currency) VALUES (?, 'Bank Fixture Client', ?, 'AED')`,
  [tenantId, `c-${stamp}@fixture.invalid`])).insertId;

const accountId = (await execute(
  `INSERT INTO bank_accounts (tenant_id, name, bank_name, currency, balance, account_type, is_active)
   VALUES (?, 'Fixture Current', 'Fixture Bank', 'AED', 0, 'checking', 1)`,
  [tenantId])).insertId;

const mkInvoice = async (total) => (await execute(
  `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, currency, issue_date, due_date,
                         line_items, subtotal, tax_amount, total_amount, paid_amount)
   VALUES (?, ?, ?, 'sent', 'AED', CURDATE(), CURDATE(), ?, ?, 0, ?, 0)`,
  [tenantId, clientId, `FX/${stamp}/${Math.floor(Number(process.hrtime.bigint() % 10000n))}`,
   JSON.stringify([{ description: 'Work', quantity: 1, unit_price: total, tax_rate: 0, total }]),
   total, total])).insertId;

const mkPayment = async (invoiceId, amount, date = null) => (await execute(
  `INSERT INTO payments (tenant_id, invoice_id, client_id, amount, method, payment_date)
   VALUES (?, ?, ?, ?, 'bank_transfer', ?)`,
  [tenantId, invoiceId, clientId, amount, date || new Date().toISOString().slice(0, 10)])).insertId;

const balance = async () =>
  Number((await query('SELECT balance FROM bank_accounts WHERE id = ?', [accountId]))[0].balance);

/** The invariant that matters: balance must equal the sum of its own lines. */
const ledgerSum = async () => Number((await query(
  `SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END), 0) s
     FROM bank_transactions WHERE account_id = ?`, [accountId]))[0].s);

/* ---- deposit ------------------------------------------------------------- */
console.log('recording a payment into an account');
{
  const inv = await mkInvoice(1000);
  const pay = await mkPayment(inv, 1000);
  await transaction(conn => depositPayment(conn, {
    tenantId, paymentId: pay, accountId, amount: 1000, date: '2026-08-01', description: 'Test',
  }));
  eq(await balance(), 1000, 'balance moved by the payment amount');
  eq(await ledgerSum(), 1000, 'balance equals the sum of transactions');

  const [p] = await query('SELECT bank_account_id FROM payments WHERE id = ?', [pay]);
  eq(p.bank_account_id, accountId, 'payment records which account it landed in');

  const [tx] = await query('SELECT payment_id FROM bank_transactions WHERE payment_id = ?', [pay]);
  tx ? ok('bank line points back at the payment') : bad('bank line missing');
}

/* ---- the double-count guard --------------------------------------------- */
console.log('\nthe same payment cannot be banked twice');
{
  const inv = await mkInvoice(500);
  const pay = await mkPayment(inv, 500);
  await transaction(conn => depositPayment(conn, { tenantId, paymentId: pay, accountId, amount: 500, date: '2026-08-01' }));
  const after1 = await balance();

  let threw = null;
  try {
    await transaction(conn => depositPayment(conn, { tenantId, paymentId: pay, accountId, amount: 500, date: '2026-08-01' }));
  } catch (e) { threw = e; }

  threw ? ok(`second deposit refused (${threw.code || threw.message})`) : bad('second deposit was ALLOWED');
  eq(await balance(), after1, 'balance unchanged by the refused attempt');
  eq(await ledgerSum(), await balance(), 'ledger still agrees with balance');
}

console.log('\nconcurrent deposits of one payment — exactly one wins');
{
  const inv = await mkInvoice(700);
  const pay = await mkPayment(inv, 700);
  const before = await balance();

  const attempts = await Promise.allSettled(Array.from({ length: 5 }, () =>
    transaction(conn => depositPayment(conn, { tenantId, paymentId: pay, accountId, amount: 700, date: '2026-08-01' }))));
  const won = attempts.filter(a => a.status === 'fulfilled').length;

  eq(won, 1, 'exactly one of five concurrent deposits succeeded');
  eq(await balance(), before + 700, 'the money was counted exactly once');
  eq(await ledgerSum(), await balance(), 'ledger agrees after the race');
}

/* ---- withdrawal ---------------------------------------------------------- */
console.log('\ndeleting a payment takes the money back out');
{
  const inv = await mkInvoice(250);
  const pay = await mkPayment(inv, 250);
  await transaction(conn => depositPayment(conn, { tenantId, paymentId: pay, accountId, amount: 250, date: '2026-08-01' }));
  const withMoney = await balance();

  await transaction(conn => withdrawPayment(conn, { tenantId, paymentId: pay }));
  eq(await balance(), withMoney - 250, 'balance reduced by exactly the payment');
  eq(await ledgerSum(), await balance(), 'ledger agrees after withdrawal');
  eq((await query('SELECT id FROM bank_transactions WHERE payment_id = ?', [pay])).length, 0,
     'the bank line is gone, not orphaned');
}

/* ---- matching an imported statement line -------------------------------- */
console.log('\nmatching an existing statement line to an existing payment');
{
  const inv = await mkInvoice(1234.56);
  const pay = await mkPayment(inv, 1234.56, '2026-08-03');
  // A line that arrived from the bank, already counted in the balance.
  const txId = (await execute(
    `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, transaction_date)
     VALUES (?, ?, 'credit', 1234.56, 'FT2608 INWARD', '2026-08-04')`, [tenantId, accountId])).insertId;
  await execute('UPDATE bank_accounts SET balance = balance + 1234.56 WHERE id = ?', [accountId]);

  const before = await balance();
  await transaction(conn => matchTransaction(conn, { tenantId, transactionId: txId, paymentId: pay }));

  eq(await balance(), before, 'matching does NOT move the balance (it was already counted)');
  const [t] = await query('SELECT payment_id FROM bank_transactions WHERE id = ?', [txId]);
  eq(t.payment_id, pay, 'the line now names the payment');

  let threw = null;
  try { await transaction(conn => matchTransaction(conn, { tenantId, transactionId: txId, paymentId: pay })); }
  catch (e) { threw = e; }
  threw?.code === 'ALREADY_MATCHED' ? ok('a second match is refused') : bad('re-match allowed', threw?.code);

  await transaction(conn => unmatchTransaction(conn, { tenantId, transactionId: txId }));
  eq(await balance(), before, 'unmatching does not move the balance either');
  eq((await query('SELECT bank_account_id FROM payments WHERE id = ?', [pay]))[0].bank_account_id, null,
     'the payment is unreconciled again');
}

console.log('\nmismatched amounts are refused');
{
  const inv = await mkInvoice(900);
  const pay = await mkPayment(inv, 900);
  const txId = (await execute(
    `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, transaction_date)
     VALUES (?, ?, 'credit', 5000, '2026-08-04')`, [tenantId, accountId])).insertId;
  await execute('UPDATE bank_accounts SET balance = balance + 5000 WHERE id = ?', [accountId]);

  let threw = null;
  try { await transaction(conn => matchTransaction(conn, { tenantId, transactionId: txId, paymentId: pay })); }
  catch (e) { threw = e; }
  threw?.code === 'AMOUNT_MISMATCH' ? ok('a 5000 line cannot be matched to a 900 payment') : bad('mismatch allowed', threw?.code);

  // A debit is money going out; it is never a customer payment.
  const debitId = (await execute(
    `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, transaction_date)
     VALUES (?, ?, 'debit', 900, '2026-08-04')`, [tenantId, accountId])).insertId;
  await execute('UPDATE bank_accounts SET balance = balance - 900 WHERE id = ?', [accountId]);
  let threw2 = null;
  try { await transaction(conn => matchTransaction(conn, { tenantId, transactionId: debitId, paymentId: pay })); }
  catch (e) { threw2 = e; }
  threw2?.code === 'NOT_A_CREDIT' ? ok('a debit cannot be a customer payment') : bad('debit match allowed', threw2?.code);
}

/* ---- cross-tenant -------------------------------------------------------- */
console.log('\ntenant isolation');
{
  const otherTenant = (await execute(
    `INSERT INTO tenants (company_name, slug, email, currency, status, plan)
     VALUES (?, ?, ?, 'AED', 'active', 'starter')`,
    [`Other ${stamp}`, `other-${stamp}`, `other-${stamp}@fixture.invalid`])).insertId;

  const inv = await mkInvoice(100);
  const pay = await mkPayment(inv, 100);
  let threw = null;
  try {
    await transaction(conn => depositPayment(conn, {
      tenantId: otherTenant, paymentId: pay, accountId, amount: 100, date: '2026-08-01' }));
  } catch (e) { threw = e; }
  threw ? ok('another tenant cannot deposit into our account') : bad('CROSS-TENANT DEPOSIT ALLOWED');

  await execute('DELETE FROM tenants WHERE id = ?', [otherTenant]);
}

/* ---- the reconciliation view -------------------------------------------- */
console.log('\nthe unreconciled view');
{
  const data = await unreconciled({ tenantId });
  const is = (cond, m) => (cond ? ok(m) : bad(m));
  is(Array.isArray(data.payments) && Array.isArray(data.transactions), 'returns both sides');
  is(data.payments.every(p => p.id), 'lists payments with no bank account');
  is(data.payments.every(p => p.invoice_number !== undefined),
     'each unreconciled payment carries its invoice number');
  is(typeof data.unreconciled_total === 'number', 'totals the money not yet in a bank');
  is(Array.isArray(data.suggestions), 'offers suggestions without applying them');

  const banked = await query(
    'SELECT COUNT(*) c FROM payments WHERE tenant_id = ? AND bank_account_id IS NOT NULL', [tenantId]);
  const listed = data.payments.length;
  const total  = (await query('SELECT COUNT(*) c FROM payments WHERE tenant_id = ?', [tenantId]))[0].c;
  eq(listed, total - banked[0].c, 'lists exactly the payments that are not banked');
}

/* ---- final invariant ----------------------------------------------------- */
console.log('\nafter everything');
eq(await balance(), await ledgerSum(), 'balance still equals the sum of its transactions');

/* ---- teardown ------------------------------------------------------------ */
await execute('DELETE FROM bank_transactions WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM bank_accounts    WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM payments         WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM invoices         WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM clients          WHERE tenant_id = ?', [tenantId]);
await execute('DELETE FROM tenants          WHERE id = ?',        [tenantId]);
console.log(`\nfixtures removed (tenant ${tenantId})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
