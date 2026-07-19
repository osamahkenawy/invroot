import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { nextDocNumber } from '../lib/numbering.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/credit-notes ──────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const rows = await query(
      `SELECT cn.*, c.name as client_name, i.invoice_number
       FROM credit_notes cn
       LEFT JOIN clients c ON cn.client_id = c.id
       LEFT JOIN invoices i ON cn.invoice_id = i.id
       WHERE cn.tenant_id = ? ORDER BY cn.created_at DESC`,
      [req.tenantId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── POST /api/credit-notes ─────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { invoice_id, amount, reason, reason_code } = req.body;
    if (!invoice_id || !amount) return res.status(400).json({ success: false, message: 'invoice_id and amount required' });

    const [invoice] = await query('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [invoice_id, req.tenantId]);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (amount > invoice.total_amount) return res.status(400).json({ success: false, message: 'Credit cannot exceed invoice total' });

    const cnNumber = await nextDocNumber(req.tenantId, 'credit_note');

    const result = await execute(
      `INSERT INTO credit_notes (tenant_id, invoice_id, client_id, cn_number, amount, reason, reason_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'issued')`,
      [req.tenantId, invoice_id, invoice.client_id, cnNumber, amount, reason, reason_code]
    );

    // Adjust client balance
    await execute('UPDATE clients SET credit_balance = credit_balance + ? WHERE id = ?', [amount, invoice.client_id]);

    res.status(201).json({ success: true, id: result.insertId, cn_number: cnNumber });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── PUT /api/credit-notes/:id/void ─────────────────── */
router.put('/:id/void', async (req, res) => {
  try {
    const [cn] = await query('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!cn) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (cn.status === 'voided') return res.status(400).json({ success: false, message: 'Already voided' });
    await execute("UPDATE credit_notes SET status = 'voided' WHERE id = ?", [cn.id]);
    // Reverse client balance
    await execute('UPDATE clients SET credit_balance = credit_balance - ? WHERE id = ?', [cn.amount, cn.client_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── PUT /api/credit-notes/:id/apply ────────────────── */
router.put('/:id/apply', async (req, res) => {
  try {
    const [cn] = await query('SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!cn) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (!['issued'].includes(cn.status)) return res.status(400).json({ success: false, message: 'Can only apply issued credit notes' });
    await execute("UPDATE credit_notes SET status = 'applied' WHERE id = ?", [cn.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── GET /api/credit-notes/summary ──────────────────── */
router.get('/summary', async (req, res) => {
  try {
    const [row] = await query(
      `SELECT
         COALESCE(SUM(amount),0) AS total_issued,
         COALESCE(SUM(CASE WHEN status='applied' THEN amount ELSE 0 END),0) AS total_applied,
         COALESCE(SUM(CASE WHEN status='issued'  THEN amount ELSE 0 END),0) AS total_pending,
         COUNT(*) AS count
       FROM credit_notes WHERE tenant_id = ?`,
      [req.tenantId]
    );
    const [{ currency }] = await query("SELECT COALESCE(currency,'SAR') AS currency FROM tenants WHERE id = ?", [req.tenantId]).catch(() => [{ currency: 'SAR' }]);
    res.json({ success: true, data: { ...row, currency } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
