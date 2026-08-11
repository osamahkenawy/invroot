import express from 'express';
import { query, execute } from '../lib/database.js';
import { optionalAuth } from '../middleware/auth.js';
import crypto from 'crypto';
import { failure } from '../lib/api-error.js';
import { withAssetUrls } from '../lib/storage.js';

const router = express.Router();

/**
 * Client portal uses short-lived access tokens, not full user accounts.
 * Clients log in with email + portal-specific PIN or magic link.
 */

/* ── POST /api/client-portal/login ─────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { email, token } = req.body;
    if (!email || !token) return res.status(400).json({ success: false, message: 'email and token required' });

    const [client] = await query(
      `SELECT c.*, t.company_name, t.logo_url, t.currency as tenant_currency
       FROM clients c JOIN tenants t ON c.tenant_id = t.id
       WHERE c.email = ? AND c.portal_token = ? AND c.portal_token_expires > NOW()`,
      [email, token]
    );
    if (!client) return res.status(401).json({ success: false, message: 'Invalid or expired access token' });

    const sessionToken = crypto.randomBytes(32).toString('hex');
    await execute('UPDATE clients SET portal_session_token = ?, portal_session_expires = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE id = ?', [sessionToken, client.id]);

    const { portal_token: _t, portal_session_token: _s, ...safeClient } = client;
    res.json({ success: true, token: sessionToken, client: await withAssetUrls(safeClient) });
  } catch (err) { failure(res, err, { context: 'client-portal' }); }
});

/* ── Middleware to auth client portal sessions ───────── */
const portalAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const [client] = await query('SELECT * FROM clients WHERE portal_session_token = ? AND portal_session_expires > NOW()', [token]);
  if (!client) return res.status(401).json({ success: false, message: 'Session expired' });
  req.portalClient = client;
  next();
};

/* ── GET /api/client-portal/dashboard ──────────────── */
router.get('/dashboard', portalAuth, async (req, res) => {
  try {
    const clientId = req.portalClient.id;
    const [summary] = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN status IN ('sent','partial','overdue') THEN total_amount - paid_amount END), 0) as open_balance,
        COUNT(CASE WHEN status = 'overdue' THEN 1 END) as overdue_count,
        COUNT(*) as total_invoices
       FROM invoices WHERE client_id = ?`,
      [clientId]
    );
    const recent = await query('SELECT id, invoice_number, status, total_amount, due_date FROM invoices WHERE client_id = ? ORDER BY created_at DESC LIMIT 5', [clientId]);
    res.json({ success: true, data: { ...summary, recent } });
  } catch (err) { failure(res, err, { context: 'client-portal' }); }
});

/* ── GET /api/client-portal/invoices ───────────────── */
router.get('/invoices', portalAuth, async (req, res) => {
  try {
    const invoices = await query('SELECT id, invoice_number, status, total_amount, paid_amount, currency, due_date, issue_date FROM invoices WHERE client_id = ? ORDER BY created_at DESC', [req.portalClient.id]);
    res.json({ success: true, data: invoices });
  } catch (err) { failure(res, err, { context: 'client-portal' }); }
});

/* ── GET /api/client-portal/invoices/:id ───────────── */
router.get('/invoices/:id', portalAuth, async (req, res) => {
  try {
    const [invoice] = await query('SELECT * FROM invoices WHERE id = ? AND client_id = ?', [req.params.id, req.portalClient.id]);
    if (!invoice) return res.status(404).json({ success: false, message: 'Not found' });
    if (invoice.status === 'sent') await execute("UPDATE invoices SET status = 'viewed', viewed_at = NOW() WHERE id = ?", [invoice.id]);
    res.json({ success: true, data: invoice });
  } catch (err) { failure(res, err, { context: 'client-portal' }); }
});

/* ── GET /api/client-portal/payments ───────────────── */
router.get('/payments', portalAuth, async (req, res) => {
  try {
    const payments = await query('SELECT p.*, i.invoice_number, i.currency FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE p.client_id = ? ORDER BY p.payment_date DESC', [req.portalClient.id]);
    res.json({ success: true, data: payments });
  } catch (err) { failure(res, err, { context: 'client-portal' }); }
});

/* ── POST /api/client-portal/quotes/:id/respond ─────── */
router.post('/quotes/:id/respond', portalAuth, async (req, res) => {
  try {
    const { response, comment } = req.body; // 'accepted' | 'rejected'
    if (!['accepted', 'rejected'].includes(response)) return res.status(400).json({ success: false, message: 'response must be accepted or rejected' });
    const result = await execute('UPDATE invroot_quotes SET status = ?, client_comment = ? WHERE id = ? AND client_id = ?', [response, comment, req.params.id, req.portalClient.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Quote not found' });
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'client-portal' }); }
});

export default router;
