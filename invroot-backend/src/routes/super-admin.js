import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
router.use(authMiddleware);

/* ── Guard: platform super admins only ─────────────── */
const superOnly = (req, res, next) => {
  if (!req.user?.is_super_admin) return res.status(403).json({ success: false, message: 'Super admin access required' });
  next();
};
router.use(superOnly);

/* ════════════════════════════════════════════
   PLATFORM OVERVIEW
════════════════════════════════════════════ */

/* GET /api/super-admin/overview ─────────────────────── */
router.get('/overview', async (req, res) => {
  try {
    const [[tenants], [users], [invoices], [payments], [revenue],
           [active_tenants], [new_tenants_30d], [overdue_invoices]] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM tenants'),
      query('SELECT COUNT(*) AS total FROM users WHERE is_super_admin = 0 OR is_super_admin IS NULL'),
      query('SELECT COUNT(*) AS total FROM invoices'),
      query('SELECT COUNT(*) AS total FROM payments'),
      query('SELECT COALESCE(SUM(amount),0) AS total FROM payments'),
      query("SELECT COUNT(*) AS total FROM tenants WHERE status = 'active'"),
      query("SELECT COUNT(*) AS total FROM tenants WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"),
      query("SELECT COUNT(*) AS total FROM invoices WHERE status = 'overdue'"),
    ]);

    // Monthly trend (last 6 months)
    const trend = await query(`
      SELECT DATE_FORMAT(payment_date,'%Y-%m') AS month,
             COALESCE(SUM(amount),0) AS revenue,
             COUNT(*) AS count
      FROM payments
      WHERE payment_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY month ORDER BY month ASC`);

    // Top 5 tenants by revenue
    const topTenants = await query(`
      SELECT t.id, t.company_name, t.status, t.plan,
             COUNT(DISTINCT i.id) AS invoice_count,
             COALESCE(SUM(p.amount),0) AS total_revenue
      FROM tenants t
      LEFT JOIN invoices i ON i.tenant_id = t.id
      LEFT JOIN payments p ON p.tenant_id = t.id
      GROUP BY t.id ORDER BY total_revenue DESC LIMIT 5`);

    // Invoice status distribution
    const invoiceStatus = await query(`
      SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS amount
      FROM invoices GROUP BY status`);

    res.json({
      success: true,
      data: {
        kpis: {
          total_tenants:    tenants.total,
          active_tenants:   active_tenants.total,
          new_tenants_30d:  new_tenants_30d.total,
          total_users:      users.total,
          total_invoices:   invoices.total,
          total_payments:   payments.total,
          total_revenue:    revenue.total,
          overdue_invoices: overdue_invoices.total,
        },
        revenue_trend: trend,
        top_tenants: topTenants,
        invoice_status: invoiceStatus,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ════════════════════════════════════════════
   TENANTS
════════════════════════════════════════════ */

/* GET /api/super-admin/tenants ──────────────────────── */
router.get('/tenants', async (req, res) => {
  try {
    const { search, status, plan, page = 1, limit = 20 } = req.query;
    const conds = ['1=1'];
    const params = [];
    if (search) { conds.push('(t.company_name LIKE ? OR t.email LIKE ?)'); const s = `%${search}%`; params.push(s, s); }
    if (status) { conds.push('t.status = ?'); params.push(status); }
    if (plan)   { conds.push('t.plan = ?');   params.push(plan); }
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = conds.join(' AND ');

    const rows = await query(`
      SELECT t.*,
             COUNT(DISTINCT u.id) AS user_count,
             COUNT(DISTINCT i.id) AS invoice_count,
             COALESCE(SUM(p.amount),0) AS total_revenue
      FROM tenants t
      LEFT JOIN users u ON u.tenant_id = t.id AND (u.is_super_admin = 0 OR u.is_super_admin IS NULL)
      LEFT JOIN invoices i ON i.tenant_id = t.id
      LEFT JOIN payments p ON p.tenant_id = t.id
      WHERE ${where}
      GROUP BY t.id ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM tenants t WHERE ${where}`, params);
    res.json({ success: true, data: rows, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* GET /api/super-admin/tenants/:id ──────────────────── */
router.get('/tenants/:id', async (req, res) => {
  try {
    const tid = req.params.id;
    const [tenant] = await query('SELECT * FROM tenants WHERE id = ?', [tid]);
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

    const [users, invoices, payments, recentInvoices, recentPayments] = await Promise.all([
      query('SELECT id, full_name, email, role, is_active, last_login_at, created_at FROM users WHERE tenant_id = ?', [tid]),
      query(`SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS amount FROM invoices WHERE tenant_id = ? GROUP BY status`, [tid]),
      query(`SELECT method, COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount FROM payments WHERE tenant_id = ? GROUP BY method`, [tid]),
      query(`SELECT i.*, c.name AS client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.tenant_id = ? ORDER BY i.created_at DESC LIMIT 10`, [tid]),
      query(`SELECT p.*, i.invoice_number, c.name AS client_name FROM payments p LEFT JOIN invoices i ON p.invoice_id = i.id LEFT JOIN clients c ON p.client_id = c.id WHERE p.tenant_id = ? ORDER BY p.payment_date DESC LIMIT 10`, [tid]),
    ]);

    const [{ total_invoiced }] = await query('SELECT COALESCE(SUM(total_amount),0) AS total_invoiced FROM invoices WHERE tenant_id = ?', [tid]);
    const [{ total_collected }] = await query('SELECT COALESCE(SUM(amount),0) AS total_collected FROM payments WHERE tenant_id = ?', [tid]);

    res.json({
      success: true,
      data: {
        tenant,
        users,
        invoice_summary: invoices,
        payment_summary: payments,
        recent_invoices: recentInvoices,
        recent_payments: recentPayments,
        total_invoiced,
        total_collected,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* PUT /api/super-admin/tenants/:id/status ───────────── */
router.put('/tenants/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['active', 'suspended', 'trial', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    await execute('UPDATE tenants SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* PUT /api/super-admin/tenants/:id/plan ─────────────── */
router.put('/tenants/:id/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    await execute('UPDATE tenants SET plan = ? WHERE id = ?', [plan, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* PUT /api/super-admin/tenants/:id/impersonate ──────── */
/* Returns a short-lived token scoped to that tenant    */
router.post('/tenants/:id/impersonate', async (req, res) => {
  try {
    const [owner] = await query(
      'SELECT * FROM users WHERE tenant_id = ? AND is_owner = 1 AND is_active = 1 LIMIT 1',
      [req.params.id]
    );
    if (!owner) return res.status(404).json({ success: false, message: 'No active owner found for tenant' });
    // Generate a token that expires in 1 hour
    const jwt = await import('jsonwebtoken');
    const { config } = await import('../config.js');
    const token = jwt.default.sign(
      { id: owner.id, username: owner.username, role: owner.role, tenant_id: owner.tenant_id, impersonated_by: req.user.id },
      config.jwt.secret,
      { expiresIn: '1h' }
    );
    res.json({ success: true, token, tenant_id: owner.tenant_id, email: owner.email });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ════════════════════════════════════════════
   CROSS-TENANT INVOICES
════════════════════════════════════════════ */

router.get('/invoices', async (req, res) => {
  try {
    const { tenant_id, status, search, date_from, date_to, page = 1, limit = 25 } = req.query;
    const conds = ['1=1'];
    const params = [];
    if (tenant_id) { conds.push('i.tenant_id = ?'); params.push(tenant_id); }
    if (status)    { conds.push('i.status = ?');    params.push(status); }
    if (date_from) { conds.push('DATE(i.issue_date) >= ?'); params.push(date_from); }
    if (date_to)   { conds.push('DATE(i.issue_date) <= ?'); params.push(date_to); }
    if (search)    { conds.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR t.company_name LIKE ?)'); const s = `%${search}%`; params.push(s,s,s); }
    const offset = (parseInt(page)-1)*parseInt(limit);
    const where = conds.join(' AND ');
    const rows = await query(`
      SELECT i.*, t.company_name AS tenant_name, c.name AS client_name
      FROM invoices i
      LEFT JOIN tenants t ON i.tenant_id = t.id
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM invoices i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN clients c ON i.client_id = c.id WHERE ${where}`, params);
    const [{ total_amount }] = await query(`SELECT COALESCE(SUM(i.total_amount),0) AS total_amount FROM invoices i LEFT JOIN tenants t ON i.tenant_id = t.id LEFT JOIN clients c ON i.client_id = c.id WHERE ${where}`, params);
    res.json({ success: true, data: rows, total, total_amount });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ════════════════════════════════════════════
   CROSS-TENANT PAYMENTS
════════════════════════════════════════════ */

router.get('/payments', async (req, res) => {
  try {
    const { tenant_id, method, date_from, date_to, page = 1, limit = 25 } = req.query;
    const conds = ['1=1'];
    const params = [];
    if (tenant_id) { conds.push('p.tenant_id = ?'); params.push(tenant_id); }
    if (method)    { conds.push('p.method = ?');    params.push(method); }
    if (date_from) { conds.push('DATE(p.payment_date) >= ?'); params.push(date_from); }
    if (date_to)   { conds.push('DATE(p.payment_date) <= ?'); params.push(date_to); }
    const offset = (parseInt(page)-1)*parseInt(limit);
    const where = conds.join(' AND ');
    const rows = await query(`
      SELECT p.*, t.company_name AS tenant_name, i.invoice_number, c.name AS client_name
      FROM payments p
      LEFT JOIN tenants t ON p.tenant_id = t.id
      LEFT JOIN invoices i ON p.invoice_id = i.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE ${where} ORDER BY p.payment_date DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM payments p WHERE ${conds.join(' AND ')}`, params);
    const [{ total_amount }] = await query(`SELECT COALESCE(SUM(amount),0) AS total_amount FROM payments p WHERE ${conds.join(' AND ')}`, params);
    res.json({ success: true, data: rows, total, total_amount });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ════════════════════════════════════════════
   USERS (ALL TENANTS)
════════════════════════════════════════════ */

router.get('/users', async (req, res) => {
  try {
    const { tenant_id, search, is_active, page = 1, limit = 25 } = req.query;
    const conds = ['(u.is_super_admin = 0 OR u.is_super_admin IS NULL)'];
    const params = [];
    if (tenant_id) { conds.push('u.tenant_id = ?'); params.push(tenant_id); }
    if (is_active !== undefined) { conds.push('u.is_active = ?'); params.push(is_active === '1' ? 1 : 0); }
    if (search)    { conds.push('(u.full_name LIKE ? OR u.email LIKE ?)'); const s = `%${search}%`; params.push(s,s); }
    const offset = (parseInt(page)-1)*parseInt(limit);
    const where = conds.join(' AND ');
    const rows = await query(`
      SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.is_owner, u.last_login_at, u.created_at,
             t.company_name AS tenant_name, t.id AS tenant_id
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      WHERE ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`, params);
    res.json({ success: true, data: rows, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/users/:id/toggle', async (req, res) => {
  try {
    const [user] = await query('SELECT id, is_active, is_super_admin FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    if (user.is_super_admin) return res.status(403).json({ success: false, message: 'Cannot modify super admin' });
    await execute('UPDATE users SET is_active = ? WHERE id = ?', [user.is_active ? 0 : 1, user.id]);
    res.json({ success: true, is_active: !user.is_active });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ════════════════════════════════════════════
   PLATFORM ANALYTICS
════════════════════════════════════════════ */

router.get('/analytics', async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period);

    const [signups, revenueByDay, topClients, invoiceAgeing] = await Promise.all([
      // New tenants per day
      query(`
        SELECT DATE(created_at) AS day, COUNT(*) AS count
        FROM tenants WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY day ORDER BY day`, [days]),

      // Revenue per day
      query(`
        SELECT DATE(payment_date) AS day, COALESCE(SUM(amount),0) AS revenue
        FROM payments WHERE payment_date >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY day ORDER BY day`, [days]),

      // Top clients across platform
      query(`
        SELECT c.name AS client_name, t.company_name AS tenant_name,
               COUNT(i.id) AS invoice_count, COALESCE(SUM(i.total_amount),0) AS total_value
        FROM clients c
        JOIN invoices i ON i.client_id = c.id
        JOIN tenants t ON c.tenant_id = t.id
        GROUP BY c.id ORDER BY total_value DESC LIMIT 10`),

      // Invoice ageing
      query(`
        SELECT
          SUM(CASE WHEN DATEDIFF(NOW(),due_date) BETWEEN 1  AND 30 THEN total_amount-paid_amount ELSE 0 END) AS d1_30,
          SUM(CASE WHEN DATEDIFF(NOW(),due_date) BETWEEN 31 AND 60 THEN total_amount-paid_amount ELSE 0 END) AS d31_60,
          SUM(CASE WHEN DATEDIFF(NOW(),due_date) BETWEEN 61 AND 90 THEN total_amount-paid_amount ELSE 0 END) AS d61_90,
          SUM(CASE WHEN DATEDIFF(NOW(),due_date) > 90              THEN total_amount-paid_amount ELSE 0 END) AS d90plus
        FROM invoices WHERE status IN ('sent','overdue','partial')`),
    ]);

    res.json({
      success: true,
      data: { signups, revenue_by_day: revenueByDay, top_clients: topClients, invoice_ageing: invoiceAgeing[0] },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ════════════════════════════════════════════
   SUPER ADMIN AUTH CHECK
════════════════════════════════════════════ */

router.get('/me', (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.user.id,
      email: req.user.email,
      full_name: req.user.full_name,
      is_super_admin: true,
    },
  });
});

export default router;
