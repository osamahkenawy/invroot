import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';

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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* POST /api/banking/accounts */
router.post('/accounts', async (req, res) => {
  try {
    const { name, account_number, bank_name, currency, balance, account_type, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Account name required' });
    const result = await execute(
      `INSERT INTO bank_accounts (tenant_id, name, account_number, bank_name, currency, balance, account_type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, name, account_number || null, bank_name || null,
       currency || 'SAR', balance || 0, account_type || 'checking', notes || null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* PUT /api/banking/accounts/:id */
router.put('/accounts/:id', async (req, res) => {
  try {
    const { name, account_number, bank_name, currency, balance, account_type, is_active, notes } = req.body;
    await execute(
      `UPDATE bank_accounts SET name=?, account_number=?, bank_name=?, currency=?,
       balance=?, account_type=?, is_active=?, notes=? WHERE id=? AND tenant_id=?`,
      [name, account_number, bank_name, currency, balance, account_type, is_active ?? 1, notes, req.params.id, req.tenantId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* DELETE /api/banking/accounts/:id */
router.delete('/accounts/:id', async (req, res) => {
  try {
    await execute('DELETE FROM bank_accounts WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* GET /api/banking/accounts/:id/transactions */
router.get('/accounts/:id/transactions', async (req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM bank_transactions WHERE account_id=? AND tenant_id=? ORDER BY transaction_date DESC, id DESC LIMIT 50`,
      [req.params.id, req.tenantId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* POST /api/banking/accounts/:id/transactions */
router.post('/accounts/:id/transactions', async (req, res) => {
  try {
    const { type, amount, description, reference, transaction_date } = req.body;
    await execute(
      `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, reference, transaction_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, req.params.id, type, amount, description, reference, transaction_date || new Date().toISOString().slice(0,10)]
    );
    // Update account balance
    const delta = type === 'credit' ? amount : -amount;
    await execute('UPDATE bank_accounts SET balance = balance + ? WHERE id=?', [delta, req.params.id]);
    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
