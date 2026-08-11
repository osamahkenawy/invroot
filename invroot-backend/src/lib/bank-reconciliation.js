/**
 * Payments ↔ bank transactions.
 *
 * Recording a payment and seeing it in the bank were two unrelated acts. The
 * invoice said the customer had paid; the bank balance did not move; and the
 * only way to make them agree was to retype the payment into the banking screen
 * — with nothing to stop you typing it twice.
 *
 * This makes the link explicit and the double-count impossible. Every function
 * here takes the caller's `conn` so the bank line and the payment are written in
 * ONE transaction: money that exists on one side and not the other is precisely
 * the bug this module exists to prevent.
 *
 * `payments.bank_account_id IS NULL` is a legitimate state, not a defect — cash
 * in a drawer has no bank account, and 109 payments predate this feature. That
 * is what `unreconciled()` surfaces, rather than guessing an account and
 * inventing a balance nobody can trust.
 */

import { query } from './database.js';
import { AppError } from './api-error.js';

/** A customer payment is money IN. */
const CREDIT = 'credit';

/**
 * Create the bank line for a payment and move the account balance, atomically.
 *
 * The UNIQUE index on (tenant_id, payment_id) is the real guard: if a retry or
 * a second reconciler gets here first, the insert fails rather than crediting
 * the same money twice. We translate that into a clear error instead of a 500.
 */
export async function depositPayment(conn, { tenantId, paymentId, accountId, amount, date, description, reference }) {
  const [[account]] = await conn.query(
    'SELECT id, currency FROM bank_accounts WHERE id = ? AND tenant_id = ? AND (is_active IS NULL OR is_active = 1)',
    [accountId, tenantId]
  );
  if (!account) {
    throw new AppError('That bank account could not be found, or is no longer active.', 400, 'NO_SUCH_ACCOUNT');
  }

  let txId;
  try {
    const [res] = await conn.query(
      `INSERT INTO bank_transactions (tenant_id, account_id, payment_id, type, amount, description, reference, transaction_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, accountId, paymentId, CREDIT, amount, description || null, reference || null, date]
    );
    txId = res.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new AppError('That payment is already reconciled to a bank account.', 409, 'ALREADY_RECONCILED');
    }
    throw err;
  }

  /* Balance moves in the same transaction as the line that justifies it. A
     balance that does not equal the sum of its transactions is unauditable. */
  await conn.query('UPDATE bank_accounts SET balance = balance + ? WHERE id = ? AND tenant_id = ?',
    [amount, accountId, tenantId]);
  await conn.query('UPDATE payments SET bank_account_id = ? WHERE id = ? AND tenant_id = ?',
    [accountId, paymentId, tenantId]);

  return txId;
}

/**
 * Undo the above — used when a payment is deleted.
 *
 * Without this, deleting a payment would leave its money sitting in the bank
 * balance for ever, with no transaction you could point at to explain it.
 */
export async function withdrawPayment(conn, { tenantId, paymentId }) {
  const [rows] = await conn.query(
    'SELECT id, account_id, amount FROM bank_transactions WHERE tenant_id = ? AND payment_id = ?',
    [tenantId, paymentId]
  );
  for (const tx of rows) {
    await conn.query('UPDATE bank_accounts SET balance = balance - ? WHERE id = ? AND tenant_id = ?',
      [tx.amount, tx.account_id, tenantId]);
    await conn.query('DELETE FROM bank_transactions WHERE id = ? AND tenant_id = ?', [tx.id, tenantId]);
  }
  return rows.length;
}

/**
 * Link a bank line that is already on the statement to a payment already in the
 * app — the common case when statements are imported rather than generated.
 *
 * Does NOT touch the balance: the transaction is already counted in it. This is
 * a labelling operation, and treating it as a deposit would double the money.
 */
export async function matchTransaction(conn, { tenantId, transactionId, paymentId }) {
  const [[tx]] = await conn.query(
    'SELECT id, account_id, amount, type, payment_id FROM bank_transactions WHERE id = ? AND tenant_id = ?',
    [transactionId, tenantId]
  );
  if (!tx) throw new AppError('That bank transaction could not be found.', 404, 'NO_SUCH_TX');
  if (tx.payment_id) throw new AppError('That bank transaction is already matched to a payment.', 409, 'ALREADY_MATCHED');
  if (tx.type !== CREDIT) {
    throw new AppError('Only money coming in can be matched to a customer payment.', 400, 'NOT_A_CREDIT');
  }

  const [[payment]] = await conn.query(
    'SELECT id, amount, bank_account_id FROM payments WHERE id = ? AND tenant_id = ?',
    [paymentId, tenantId]
  );
  if (!payment) throw new AppError('That payment could not be found.', 404, 'NO_SUCH_PAYMENT');
  if (payment.bank_account_id) throw new AppError('That payment is already reconciled.', 409, 'ALREADY_RECONCILED');

  /* Amounts must agree. Matching a 5,000 statement line to a 500 payment would
     claim the invoice was settled by money that is not there — refuse rather
     than let a mis-click quietly corrupt the books. Compared in cents because
     these are DECIMAL columns of different scales. */
  const cents = (v) => Math.round(Number(v) * 100);
  if (cents(tx.amount) !== cents(payment.amount)) {
    throw new AppError(
      `The amounts do not match: the bank line is ${tx.amount} and the payment is ${payment.amount}.`,
      400, 'AMOUNT_MISMATCH'
    );
  }

  try {
    await conn.query('UPDATE bank_transactions SET payment_id = ? WHERE id = ? AND tenant_id = ? AND payment_id IS NULL',
      [paymentId, transactionId, tenantId]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new AppError('That payment is already matched to another bank transaction.', 409, 'ALREADY_RECONCILED');
    }
    throw err;
  }
  await conn.query('UPDATE payments SET bank_account_id = ? WHERE id = ? AND tenant_id = ?',
    [tx.account_id, paymentId, tenantId]);
}

/** Break a link without deleting either side. Balance again untouched. */
export async function unmatchTransaction(conn, { tenantId, transactionId }) {
  const [[tx]] = await conn.query(
    'SELECT id, payment_id FROM bank_transactions WHERE id = ? AND tenant_id = ?',
    [transactionId, tenantId]
  );
  if (!tx) throw new AppError('That bank transaction could not be found.', 404, 'NO_SUCH_TX');
  if (!tx.payment_id) return;

  await conn.query('UPDATE payments SET bank_account_id = NULL WHERE id = ? AND tenant_id = ?',
    [tx.payment_id, tenantId]);
  await conn.query('UPDATE bank_transactions SET payment_id = NULL WHERE id = ? AND tenant_id = ?',
    [transactionId, tenantId]);
}

/**
 * The two sides that have not been paired up.
 *
 * Returned separately and unmatched on purpose: guessing pairs by amount would
 * be wrong the moment two customers pay the same round number, and a wrong
 * automatic match is far more expensive to unpick than a manual one to make.
 */
export async function unreconciled({ tenantId, accountId = null }) {
  const payments = await query(
    `SELECT p.id, p.amount, p.method, p.payment_date, p.reference,
            i.invoice_number, c.name AS client_name
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN clients  c ON c.id = p.client_id
      WHERE p.tenant_id = ? AND p.bank_account_id IS NULL
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT 200`,
    [tenantId]
  );

  const transactions = await query(
    `SELECT bt.id, bt.account_id, bt.amount, bt.description, bt.reference,
            bt.transaction_date, ba.name AS account_name
       FROM bank_transactions bt
       JOIN bank_accounts ba ON ba.id = bt.account_id
      WHERE bt.tenant_id = ? AND bt.payment_id IS NULL AND bt.type = 'credit'
        ${accountId ? 'AND bt.account_id = ?' : ''}
      ORDER BY bt.transaction_date DESC, bt.id DESC
      LIMIT 200`,
    accountId ? [tenantId, accountId] : [tenantId]
  );

  /* A suggestion is not a match. Same amount within a week is a strong enough
     hint to put the two rows next to each other, and far too weak to act on
     without a person saying yes. */
  const cents = (v) => Math.round(Number(v) * 100);
  const dayGap = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;
  const suggestions = [];
  for (const p of payments) {
    const hit = transactions.find(tx =>
      cents(tx.amount) === cents(p.amount) &&
      p.payment_date && tx.transaction_date &&
      dayGap(p.payment_date, tx.transaction_date) <= 7 &&
      !suggestions.some(s => s.transaction_id === tx.id)
    );
    if (hit) suggestions.push({ payment_id: p.id, transaction_id: hit.id, amount: p.amount });
  }

  return {
    payments,
    transactions,
    suggestions,
    unreconciled_total: Number(payments.reduce((s, p) => s + Number(p.amount), 0).toFixed(2)),
  };
}
