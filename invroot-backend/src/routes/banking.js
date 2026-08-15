import express from 'express';
import { query, execute, transaction } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { failure } from '../lib/api-error.js';
import { logAudit } from '../lib/audit-logger.js';
import { unreconciled, matchTransaction, unmatchTransaction } from '../lib/bank-reconciliation.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* GET /api/banking/accounts */
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await query(
      `SELECT a.*,
        (SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) FROM bank_transactions WHERE account_id=a.id) AS computed_balance
       FROM bank_accounts a WHERE a.tenant_id=? ORDER BY a.name`,
      [req.tenantId]
    );
    const totalBalance = accounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
    res.json({ success: true, data: accounts, totalBalance });
  } catch (err) { failure(res, err, { context: 'banking' }); }
});

/**
 * Exactly one account can be the one printed on invoices.
 *
 * Two accounts both claiming it would put two sets of bank details in front of
 * a customer with nothing to say which to pay into — the kind of ambiguity
 * that ends in a payment to a closed account. Clearing the others first makes
 * the flag a choice rather than a checkbox anyone can tick twice.
 */
async function clearOtherInvoiceAccounts(tenantId, exceptId = null) {
  await execute(
    `UPDATE bank_accounts SET show_on_invoices = 0
      WHERE tenant_id = ? AND show_on_invoices = 1 ${exceptId ? 'AND id <> ?' : ''}`,
    exceptId ? [tenantId, exceptId] : [tenantId]
  );
}

/* POST /api/banking/accounts */
router.post('/accounts', async (req, res) => {
  try {
    const { name, account_number, bank_name, currency, balance, account_type, notes,
            account_holder, iban, swift, branch, routing_code, show_on_invoices } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Account name required' });

    const onInvoices = show_on_invoices ? 1 : 0;
    if (onInvoices) await clearOtherInvoiceAccounts(req.tenantId);

    const result = await execute(
      `INSERT INTO bank_accounts (tenant_id, name, account_number, bank_name, currency, balance,
                                  account_type, notes, account_holder, iban, swift, branch,
                                  routing_code, show_on_invoices)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, name, account_number || null, bank_name || null,
       currency || 'SAR', balance || 0, account_type || 'checking', notes || null,
       account_holder || null, iban || null, swift || null, branch || null,
       routing_code || null, onInvoices]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { failure(res, err, { context: 'banking' }); }
});

/* PUT /api/banking/accounts/:id */
router.put('/accounts/:id', async (req, res) => {
  try {
    const { name, account_number, bank_name, currency, balance, account_type, is_active, notes,
            account_holder, iban, swift, branch, routing_code, show_on_invoices } = req.body;

    const onInvoices = show_on_invoices ? 1 : 0;
    if (onInvoices) await clearOtherInvoiceAccounts(req.tenantId, req.params.id);

    await execute(
      `UPDATE bank_accounts SET name=?, account_number=?, bank_name=?, currency=?,
       balance=?, account_type=?, is_active=?, notes=?, account_holder=?, iban=?,
       swift=?, branch=?, routing_code=?, show_on_invoices=?
       WHERE id=? AND tenant_id=?`,
      [name, account_number, bank_name, currency, balance, account_type, is_active ?? 1, notes,
       account_holder || null, iban || null, swift || null, branch || null,
       routing_code || null, onInvoices, req.params.id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'banking' }); }
});

/* DELETE /api/banking/accounts/:id */
router.delete('/accounts/:id', async (req, res) => {
  try {
    await execute('DELETE FROM bank_accounts WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'banking' }); }
});

/* GET /api/banking/accounts/:id/transactions */
router.get('/accounts/:id/transactions', async (req, res) => {
  try {
    /* Joined through to the invoice so a statement line can say WHAT it was —
       "INV/08/2026/12, Blue Wave Marine" rather than an unattributed credit. */
    const rows = await query(
      `SELECT bt.*, p.id AS matched_payment_id, i.invoice_number, i.id AS invoice_id, c.name AS client_name
         FROM bank_transactions bt
         LEFT JOIN payments p ON p.id = bt.payment_id
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN clients  c ON c.id = p.client_id
        WHERE bt.account_id = ? AND bt.tenant_id = ?
        ORDER BY bt.transaction_date DESC, bt.id DESC LIMIT 50`,
      [req.params.id, req.tenantId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'banking' }); }
});

/* POST /api/banking/accounts/:id/transactions */
router.post('/accounts/:id/transactions', async (req, res) => {
  try {
    const { type, amount, description, reference, transaction_date } = req.body;
    if (!['credit', 'debit'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be credit or debit.' });
    }
    if (!(Number(amount) > 0)) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
    }

    /* The account has to be confirmed as ours BEFORE anything is written. The
       balance update below used to say `WHERE id=?` with no tenant_id, so a
       request naming another tenant's account id moved THEIR balance. */
    const [account] = await query(
      'SELECT id FROM bank_accounts WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!account) return res.status(404).json({ success: false, message: 'Bank account not found' });

    await transaction(async (conn) => {
      await conn.query(
        `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, reference, transaction_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.tenantId, account.id, type, amount, description, reference, transaction_date || new Date().toISOString().slice(0, 10)]
      );
      const delta = type === 'credit' ? amount : -amount;
      await conn.query('UPDATE bank_accounts SET balance = balance + ? WHERE id = ? AND tenant_id = ?',
        [delta, account.id, req.tenantId]);
    });
    res.status(201).json({ success: true });
  } catch (err) { failure(res, err, { context: 'banking' }); }
});

/* ── GET /api/banking/reconciliation ──────────────────
   The two sides that have not been paired: money the app knows about but the
   bank does not, and vice versa. Until this existed the banking module could
   not see the 109 recorded payments at all. */
router.get('/reconciliation', async (req, res) => {
  try {
    const data = await unreconciled({
      tenantId: req.tenantId,
      accountId: req.query.account_id ? Number(req.query.account_id) : null,
    });
    res.json({ success: true, data });
  } catch (err) { failure(res, err, { context: 'banking' }); }
});

/* ── POST /api/banking/transactions/:id/match ─────────
   Label an existing statement line as an existing payment. Does not move the
   balance — the line is already counted in it. */
router.post('/transactions/:id/match', async (req, res) => {
  try {
    const { payment_id } = req.body;
    if (!payment_id) return res.status(400).json({ success: false, message: 'payment_id is required' });

    await transaction(conn => matchTransaction(conn, {
      tenantId: req.tenantId,
      transactionId: Number(req.params.id),
      paymentId: Number(payment_id),
    }));
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'reconcile', entity: 'payment', entityId: Number(payment_id) });
    res.json({ success: true, message: 'Matched.' });
  } catch (err) { failure(res, err, { context: 'banking' }); }
});

/* ── POST /api/banking/transactions/:id/unmatch ─────── */
router.post('/transactions/:id/unmatch', async (req, res) => {
  try {
    await transaction(conn => unmatchTransaction(conn, {
      tenantId: req.tenantId,
      transactionId: Number(req.params.id),
    }));
    res.json({ success: true, message: 'Unmatched.' });
  } catch (err) { failure(res, err, { context: 'banking' }); }
});

export default router;
