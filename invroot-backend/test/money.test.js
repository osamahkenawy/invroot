/**
 * Money paths: invoice status derivation and statement balances.
 *
 * These are the calculations a customer sees on a document, so a regression here
 * is a billing error rather than a cosmetic bug.
 */

import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pool, { query, execute } from '../src/lib/database.js';
import { recalcInvoice } from '../src/lib/invoice-totals.js';
import { makeTenant, makeClient, makeInvoice, makePayment, dropTenant } from './helpers.js';

const created = [];
async function tenant() {
  const t = await makeTenant();
  created.push(t.tenantId);
  return t;
}

after(async () => {
  for (const id of created) await dropTenant(id);
  await pool.end();
});

async function statusOf(invoiceId) {
  const [row] = await query('SELECT status, paid_amount FROM invoices WHERE id = ?', [invoiceId]);
  return row;
}

describe('invoice status derivation', () => {
  test('no payment leaves a sent invoice unpaid', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const inv = await makeInvoice(tenantId, c, { total: 1000, status: 'sent' });

    await recalcInvoice(inv.id);
    const { status, paid_amount } = await statusOf(inv.id);
    assert.equal(status, 'sent');
    assert.equal(Number(paid_amount), 0);
  });

  test('an unpaid invoice past its due date derives overdue', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const inv = await makeInvoice(tenantId, c, {
      total: 1000, status: 'sent', issueDate: '2026-01-01', dueDate: '2026-02-01',
    });

    await recalcInvoice(inv.id);
    assert.equal((await statusOf(inv.id)).status, 'overdue');
  });

  test('a part payment moves it to partial', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const inv = await makeInvoice(tenantId, c, { total: 1000, status: 'sent' });
    await makePayment(tenantId, inv.id, c, { amount: 400 });

    await recalcInvoice(inv.id);
    const { status, paid_amount } = await statusOf(inv.id);
    assert.equal(status, 'partial');
    assert.equal(Number(paid_amount), 400);
  });

  test('payment in full moves it to paid', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const inv = await makeInvoice(tenantId, c, { total: 1000, status: 'sent' });
    await makePayment(tenantId, inv.id, c, { amount: 1000 });

    await recalcInvoice(inv.id);
    assert.equal((await statusOf(inv.id)).status, 'paid');
  });

  test('settling in several instalments still lands on paid', async () => {
    // Guards the float comparison in recalcInvoice: amounts that only sum to the
    // total after several additions must not stick on `partial`.
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const inv = await makeInvoice(tenantId, c, { total: 100, status: 'sent' });
    for (const amt of [33.33, 33.33, 33.34]) {
      await makePayment(tenantId, inv.id, c, { amount: amt });
    }

    await recalcInvoice(inv.id);
    const { status, paid_amount } = await statusOf(inv.id);
    assert.equal(Number(paid_amount).toFixed(2), '100.00');
    assert.equal(status, 'paid', 'three instalments totalling the invoice must read as paid');
  });

  test('overpayment still reads as paid, never beyond', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const inv = await makeInvoice(tenantId, c, { total: 500, status: 'sent' });
    await makePayment(tenantId, inv.id, c, { amount: 600 });

    await recalcInvoice(inv.id);
    assert.equal((await statusOf(inv.id)).status, 'paid');
  });

  test('draft and void are never derived from payments', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);

    for (const manual of ['draft', 'void']) {
      const inv = await makeInvoice(tenantId, c, { total: 200, status: manual });
      await makePayment(tenantId, inv.id, c, { amount: 200 });
      await recalcInvoice(inv.id);
      assert.equal((await statusOf(inv.id)).status, manual,
        `${manual} is a manual state and must survive a recalc`);
    }
  });

  test('removing the payment returns it to unpaid', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const inv = await makeInvoice(tenantId, c, { total: 300, status: 'sent' });
    const payId = await makePayment(tenantId, inv.id, c, { amount: 300 });
    await recalcInvoice(inv.id);
    assert.equal((await statusOf(inv.id)).status, 'paid');

    await execute('DELETE FROM payments WHERE id = ?', [payId]);
    await recalcInvoice(inv.id);
    const { status, paid_amount } = await statusOf(inv.id);
    assert.equal(Number(paid_amount), 0);
    assert.ok(['sent', 'overdue'].includes(status), `expected sent/overdue, got ${status}`);
  });

  test('an applied credit note settles the invoice like a payment', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const inv = await makeInvoice(tenantId, c, { total: 250, status: 'sent' });
    await execute(
      `INSERT INTO credit_notes (tenant_id, invoice_id, client_id, cn_number, amount, currency, status)
       VALUES (?, ?, ?, ?, 250, 'AED', 'applied')`,
      [tenantId, inv.id, c, `ZZCN-${inv.id}`]
    );

    await recalcInvoice(inv.id);
    assert.equal((await statusOf(inv.id)).status, 'paid');
  });

  test('a draft credit note does not settle anything', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const inv = await makeInvoice(tenantId, c, { total: 250, status: 'sent' });
    await execute(
      `INSERT INTO credit_notes (tenant_id, invoice_id, client_id, cn_number, amount, currency, status)
       VALUES (?, ?, ?, ?, 250, 'AED', 'draft')`,
      [tenantId, inv.id, c, `ZZCND-${inv.id}`]
    );

    await recalcInvoice(inv.id);
    assert.equal((await statusOf(inv.id)).status, 'sent', 'only applied credit notes count');
  });
});

describe('statement ledger integrity', () => {
  /** Mirrors the arithmetic in GET /clients/:id/statement. */
  async function ledger(tenantId, clientId, from = null, to = null) {
    const invoices = await query(
      `SELECT invoice_number AS ref, issue_date AS date, total_amount AS amount
       FROM invoices WHERE tenant_id = ? AND client_id = ? AND status NOT IN ('void','draft')`,
      [tenantId, clientId]
    );
    const payments = await query(
      'SELECT payment_date AS date, amount FROM payments WHERE tenant_id = ? AND client_id = ?',
      [tenantId, clientId]
    );
    const rows = [
      ...invoices.map(r => ({ date: String(r.date).slice(0, 10), debit: Number(r.amount), credit: 0 })),
      ...payments.map(r => ({ date: String(r.date).slice(0, 10), debit: 0, credit: Number(r.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    let opening = 0;
    const windowed = [];
    for (const r of rows) {
      if (from && r.date < from) { opening += r.debit - r.credit; continue; }
      if (to && r.date > to) continue;
      windowed.push(r);
    }
    const debit  = windowed.reduce((s, r) => s + r.debit, 0);
    const credit = windowed.reduce((s, r) => s + r.credit, 0);
    return { opening, debit, credit, closing: opening + debit - credit };
  }

  test('closing balance equals opening plus invoiced minus paid', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const i1 = await makeInvoice(tenantId, c, { total: 1000, issueDate: '2026-01-10' });
    await makePayment(tenantId, i1.id, c, { amount: 400, date: '2026-01-20' });
    const i2 = await makeInvoice(tenantId, c, { total: 500, issueDate: '2026-02-05' });
    await makePayment(tenantId, i2.id, c, { amount: 100, date: '2026-02-10' });

    const l = await ledger(tenantId, c);
    assert.equal(l.debit, 1500);
    assert.equal(l.credit, 500);
    assert.equal(l.closing, 1000);
    assert.equal(l.closing, l.opening + l.debit - l.credit);
  });

  test('a date window folds earlier activity into the opening balance', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    const i1 = await makeInvoice(tenantId, c, { total: 1000, issueDate: '2025-11-10' });
    await makePayment(tenantId, i1.id, c, { amount: 250, date: '2025-11-20' });
    const i2 = await makeInvoice(tenantId, c, { total: 400, issueDate: '2026-03-01' });

    const full    = await ledger(tenantId, c);
    const windowed = await ledger(tenantId, c, '2026-01-01', '2026-12-31');

    assert.equal(windowed.opening, 750, 'pre-window net must carry forward');
    assert.equal(windowed.closing, full.closing,
      'a windowed statement must close on the same balance as the full history');
  });

  test('void and draft invoices are excluded from the ledger', async () => {
    const { tenantId } = await tenant();
    const c = await makeClient(tenantId);
    await makeInvoice(tenantId, c, { total: 100, status: 'sent',  issueDate: '2026-01-01' });
    await makeInvoice(tenantId, c, { total: 999, status: 'void',  issueDate: '2026-01-02' });
    await makeInvoice(tenantId, c, { total: 888, status: 'draft', issueDate: '2026-01-03' });

    const l = await ledger(tenantId, c);
    assert.equal(l.debit, 100, 'only the sent invoice is owed');
  });
});

describe('tenant isolation', () => {
  test('one tenant cannot see another tenant\'s invoices', async () => {
    const a = await tenant();
    const b = await tenant();
    const ca = await makeClient(a.tenantId, { name: 'A client' });
    const cb = await makeClient(b.tenantId, { name: 'B client' });
    await makeInvoice(a.tenantId, ca, { total: 111 });
    await makeInvoice(b.tenantId, cb, { total: 222 });

    const rows = await query('SELECT total_amount FROM invoices WHERE tenant_id = ?', [a.tenantId]);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].total_amount), 111);
  });

  test('scoping by tenant AND id refuses a cross-tenant read', async () => {
    const a = await tenant();
    const b = await tenant();
    const cb = await makeClient(b.tenantId);
    const invB = await makeInvoice(b.tenantId, cb, { total: 500 });

    // The pattern every route uses: id plus tenant_id.
    const rows = await query(
      'SELECT id FROM invoices WHERE id = ? AND tenant_id = ?',
      [invB.id, a.tenantId]
    );
    assert.equal(rows.length, 0, 'tenant A must not reach tenant B\'s invoice');
  });
});
