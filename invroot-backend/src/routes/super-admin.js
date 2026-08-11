import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendTenantWelcomeEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit-logger.js';
import { config } from '../config.js';
import { failure, AppError } from '../lib/api-error.js';
import { createStripeCoupon, normaliseCode } from '../lib/coupons.js';
import { stripe, isStripeConfigured } from '../lib/stripe-client.js';

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
      // A trialing tenant is live and serving requests (see requireActiveTenant),
      // so counting only status='active' reported 0 active while every tenant worked.
      query("SELECT COUNT(*) AS total FROM tenants WHERE status IN ('active','trialing')"),
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
      SELECT t.id, t.company_name, t.status, t.plan, t.currency,
             (SELECT COUNT(*) FROM invoices i WHERE i.tenant_id = t.id) AS invoice_count,
             (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.tenant_id = t.id) AS total_revenue
      FROM tenants t
      ORDER BY total_revenue DESC LIMIT 5`);

    // Invoice status distribution
    const invoiceStatus = await query(`
      SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS amount
      FROM invoices GROUP BY status`);

    // Tenants grouped by lifecycle status (active / trialing / suspended / …).
    const tenantStatus = await query(
      'SELECT status, COUNT(*) AS count FROM tenants GROUP BY status'
    );

    // Revenue must be reported per currency — tenants bill in different ones,
    // so a single summed figure would be meaningless.
    const revenueByCurrency = await query(`
      SELECT COALESCE(t.currency,'—') AS currency,
             COALESCE(SUM(p.amount),0) AS total,
             COUNT(p.id) AS payments
      FROM payments p
      LEFT JOIN tenants t ON t.id = p.tenant_id
      GROUP BY COALESCE(t.currency,'—')
      ORDER BY total DESC`);

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
        tenant_status: tenantStatus,
        revenue_by_currency: revenueByCurrency,
      },
    });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
});

/* ════════════════════════════════════════════
   TENANTS
════════════════════════════════════════════ */

/* Generate a readable temporary password (no ambiguous characters). */
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I/O
  const lower = 'abcdefghijkmnopqrstuvwxyz';  // no l
  const digit = '23456789';                   // no 0/1
  const symbol = '!@#$%&*';
  const all = upper + lower + digit + symbol;
  const pick = (set) => set[crypto.randomInt(set.length)];
  // Guarantee one of each class, then fill to 12 and shuffle.
  const chars = [pick(upper), pick(lower), pick(digit), pick(symbol)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/* POST /api/super-admin/tenants ─────────────────────── */
/* Provision a new tenant company plus its owner account. The owner receives a
   temporary password by email and must change it on first sign-in. */
router.post('/tenants', async (req, res) => {
  try {
    const {
      company_name, email, owner_name, phone,
      plan = 'starter', currency = 'AED', lang = 'en',
      status = 'trialing', password, send_email = true,
    } = req.body;

    if (!company_name || !email) {
      return res.status(400).json({ success: false, message: 'Company name and email are required' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }
    if (password && password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const [existing] = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ success: false, message: 'That email is already registered' });

    // An admin-supplied password is still treated as temporary — the owner is
    // the only one who should end up knowing their password.
    const tempPassword = password || generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 12);

    const slug = company_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30)
      + '-' + crypto.randomBytes(3).toString('hex');

    const tenantResult = await execute(
      `INSERT INTO tenants (company_name, slug, email, phone, status, plan, currency, lang)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [company_name, slug, email, phone || null, status, plan, currency, lang]
    );
    const tenantId = tenantResult.insertId;

    // email_verified = 1: the platform admin vouches for this address, so the
    // owner can sign in immediately rather than waiting on a verification link.
    const userResult = await execute(
      `INSERT INTO users (tenant_id, email, username, full_name, password, must_change_password,
                          role, is_owner, is_active, email_verified, lang_preference)
       VALUES (?, ?, ?, ?, ?, 1, 'admin', 1, 1, 1, ?)`,
      [tenantId, email, email, owner_name || company_name, hashed, lang]
    );

    const loginLink = `${config.app.frontendUrl}/login`;
    let emailed = false, emailError = null;
    if (send_email) {
      try {
        await sendTenantWelcomeEmail({
          to: email,
          name: owner_name || company_name,
          companyName: company_name,
          email,
          tempPassword,
          loginLink,
          lang,
        });
        emailed = true;
      } catch (mailErr) {
        // Never roll back a created account over a mail failure — report it so
        // the admin can pass the credentials along manually.
        emailError = mailErr.message;
        console.error('Tenant welcome email failed:', mailErr);
      }
    }

    await logAudit({
      tenantId, userId: req.user.id, action: 'create', entity: 'tenant', entityId: tenantId, ip: req.ip,
    });

    res.status(201).json({
      success: true,
      message: 'Tenant created',
      data: {
        tenant_id: tenantId,
        user_id: userResult.insertId,
        email,
        // Returned once so the admin can hand it over if the email bounced.
        temp_password: tempPassword,
        emailed,
        email_error: emailError,
      },
    });
  } catch (err) {
    failure(res, err, { context: 'super-admin' });
  }
});

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

    // Correlated subqueries, not parallel LEFT JOINs: joining users, invoices
    // and payments together multiplies rows (users × invoices per payment), which
    // inflated SUM(p.amount) by the invoice count — revenue read ~288x too high.
    const rows = await query(`
      SELECT t.*,
             (SELECT COUNT(*) FROM users u
               WHERE u.tenant_id = t.id AND (u.is_super_admin = 0 OR u.is_super_admin IS NULL)) AS user_count,
             (SELECT COUNT(*) FROM invoices i WHERE i.tenant_id = t.id) AS invoice_count,
             (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.tenant_id = t.id) AS total_revenue
      FROM tenants t
      WHERE ${where}
      ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM tenants t WHERE ${where}`, params);
    res.json({ success: true, data: rows, total });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
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
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
});

/* PUT /api/super-admin/tenants/:id/status ───────────── */
router.put('/tenants/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['active', 'suspended', 'trial', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    await execute('UPDATE tenants SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
});

/* PUT /api/super-admin/tenants/:id/plan ─────────────── */
router.put('/tenants/:id/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    await execute('UPDATE tenants SET plan = ? WHERE id = ?', [plan, req.params.id]);
    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
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
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
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
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
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
      SELECT p.*, t.company_name AS tenant_name, t.currency, i.invoice_number, c.name AS client_name
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
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
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
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
});

router.put('/users/:id/toggle', async (req, res) => {
  try {
    const [user] = await query('SELECT id, is_active, is_super_admin FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ success: false, message: 'Not found' });
    if (user.is_super_admin) return res.status(403).json({ success: false, message: 'Cannot modify super admin' });
    await execute('UPDATE users SET is_active = ? WHERE id = ?', [user.is_active ? 0 : 1, user.id]);
    res.json({ success: true, is_active: !user.is_active });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
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
        SELECT c.name AS client_name, t.company_name AS tenant_name, t.currency,
               COUNT(i.id) AS invoice_count, COALESCE(SUM(i.total_amount),0) AS total_value
        FROM clients c
        JOIN invoices i ON i.client_id = c.id
        JOIN tenants t ON c.tenant_id = t.id
        GROUP BY c.id ORDER BY total_value DESC LIMIT 10`),

      // Invoice ageing, returned as one row per bucket (with counts) — the
      // portal renders a labelled bar per bucket, which a single wide row
      // of d1_30/d31_60/… columns could not populate.
      query(`
        SELECT bucket,
               COALESCE(SUM(total_amount - paid_amount),0) AS amount,
               COUNT(*) AS count
        FROM (
          SELECT total_amount, paid_amount,
                 CASE
                   WHEN DATEDIFF(NOW(), due_date) BETWEEN 1  AND 30 THEN '1-30 days'
                   WHEN DATEDIFF(NOW(), due_date) BETWEEN 31 AND 60 THEN '31-60 days'
                   WHEN DATEDIFF(NOW(), due_date) BETWEEN 61 AND 90 THEN '61-90 days'
                   WHEN DATEDIFF(NOW(), due_date) > 90              THEN '90+ days'
                   ELSE 'not due'
                 END AS bucket
          FROM invoices
          WHERE status IN ('sent','overdue','partial')
        ) b
        WHERE bucket <> 'not due'
        GROUP BY bucket
        ORDER BY FIELD(bucket,'1-30 days','31-60 days','61-90 days','90+ days')`),
    ]);

    res.json({
      success: true,
      data: {
        // `signups_trend` is the name the portal reads; `signups` kept for
        // any existing consumer.
        signups,
        signups_trend: signups,
        revenue_by_day: revenueByDay,
        top_clients: topClients,
        invoice_ageing: invoiceAgeing,
      },
    });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
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




/* ══════════════════════════════════════════════════════
   Coupons

   Created in Stripe first, then mirrored here. That order matters: if the
   Stripe call fails there is no local row promising a discount that cannot
   actually be applied. The reverse order would leave codes that validate
   locally and then fail at the payment step.
   ══════════════════════════════════════════════════════ */

/* ── GET /api/super-admin/coupons ───────────────────── */
router.get('/coupons', async (req, res) => {
  try {
    const rows = await query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM invroot_coupon_redemptions r WHERE r.coupon_id = c.id) AS redemptions
         FROM invroot_coupons c
        ORDER BY c.archived_at IS NOT NULL, c.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
});

/* ── GET /api/super-admin/coupons/:id/redemptions ───── */
router.get('/coupons/:id/redemptions', async (req, res) => {
  try {
    const rows = await query(
      `SELECT r.*, t.company_name
         FROM invroot_coupon_redemptions r
         LEFT JOIN tenants t ON t.id = r.tenant_id
        WHERE r.coupon_id = ?
        ORDER BY r.redeemed_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
});

/* ── POST /api/super-admin/coupons ──────────────────── */
router.post('/coupons', async (req, res) => {
  try {
    if (!isStripeConfigured()) {
      throw new AppError('Stripe is not configured, so coupons cannot be created.', 400, 'NO_STRIPE');
    }

    const {
      code, discount_type, percent_off, amount_off, currency = 'AED',
      duration = 'once', duration_in_months, max_redemptions, expires_at,
      applies_to_plans, note,
    } = req.body || {};

    const wanted = normaliseCode(code);
    if (!wanted || wanted.length < 3) throw new AppError('Give the code at least 3 characters.', 400, 'BAD_CODE');
    if (!/^[A-Z0-9_-]+$/.test(wanted)) {
      throw new AppError('Codes may use letters, numbers, hyphens and underscores only.', 400, 'BAD_CODE');
    }

    if (discount_type === 'percent') {
      const pct = Number(percent_off);
      if (!(pct > 0 && pct <= 100)) throw new AppError('Percentage must be between 1 and 100.', 400, 'BAD_DISCOUNT');
    } else if (discount_type === 'amount') {
      if (!(Number(amount_off) > 0)) throw new AppError('Amount must be greater than zero.', 400, 'BAD_DISCOUNT');
    } else {
      throw new AppError('Choose a percentage or a fixed amount.', 400, 'BAD_DISCOUNT');
    }

    if (duration === 'repeating' && !(Number(duration_in_months) > 0)) {
      throw new AppError('A repeating discount needs a number of months.', 400, 'BAD_DURATION');
    }

    /* Reject a duplicate before touching Stripe. Creating there first would
       leave an orphaned Stripe coupon that no local row references. */
    const [clash] = await query('SELECT id FROM invroot_coupons WHERE code = ?', [wanted]);
    if (clash) throw new AppError('That code already exists.', 409, 'DUPLICATE');

    const { coupon, promo } = await createStripeCoupon({
      code: wanted,
      percentOff: discount_type === 'percent' ? percent_off : null,
      amountOff:  discount_type === 'amount'  ? amount_off  : null,
      currency, duration, durationInMonths: duration_in_months,
      maxRedemptions: max_redemptions, expiresAt: expires_at,
    });

    const result = await execute(
      `INSERT INTO invroot_coupons
         (code, stripe_coupon_id, stripe_promotion_code_id, discount_type,
          percent_off, amount_off, currency, duration, duration_in_months,
          applies_to_plans, max_redemptions, expires_at, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        wanted, coupon.id, promo.id, discount_type,
        discount_type === 'percent' ? Number(percent_off) : null,
        discount_type === 'amount' ? Number(amount_off) : null,
        discount_type === 'amount' ? String(currency).toUpperCase() : null,
        duration, duration === 'repeating' ? Number(duration_in_months) : null,
        Array.isArray(applies_to_plans) ? applies_to_plans.join(',') : (applies_to_plans || null),
        max_redemptions ? Number(max_redemptions) : null,
        expires_at || null, note || null, req.user.id,
      ]
    );

    await logAudit({
      userId: req.user.id, action: 'create', entity: 'coupon',
      entityId: result.insertId, ip: req.ip, meta: { code: wanted },
    }).catch(() => {});

    res.status(201).json({ success: true, id: result.insertId, code: wanted });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
});

/* ── PATCH /api/super-admin/coupons/:id ─────────────── */
/* Only activation is editable. Changing a discount after issue would alter
   what existing holders were promised; issue a new code instead. */
router.patch('/coupons/:id', async (req, res) => {
  try {
    const [row] = await query('SELECT * FROM invroot_coupons WHERE id = ?', [req.params.id]);
    if (!row) throw new AppError('Coupon not found', 404, 'NOT_FOUND');

    const active = req.body?.active ? 1 : 0;

    /* Stripe first again: if it refuses, the local row must not claim a state
       Stripe doesn't agree with. */
    await stripe().promotionCodes.update(row.stripe_promotion_code_id, { active: !!active });
    await execute('UPDATE invroot_coupons SET active = ? WHERE id = ?', [active, row.id]);

    await logAudit({
      userId: req.user.id, action: 'update', entity: 'coupon',
      entityId: row.id, ip: req.ip, meta: { code: row.code, active: !!active },
    }).catch(() => {});

    res.json({ success: true, active: !!active });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
});

/* ── DELETE /api/super-admin/coupons/:id ────────────── */
/* Archive, never delete. Redemption rows reference this coupon and are the
   record of what customers were actually charged. */
router.delete('/coupons/:id', async (req, res) => {
  try {
    const [row] = await query('SELECT * FROM invroot_coupons WHERE id = ?', [req.params.id]);
    if (!row) throw new AppError('Coupon not found', 404, 'NOT_FOUND');

    // Deactivating in Stripe is what actually stops it being redeemed.
    await stripe().promotionCodes.update(row.stripe_promotion_code_id, { active: false }).catch(() => {});
    await execute('UPDATE invroot_coupons SET active = 0, archived_at = NOW() WHERE id = ?', [row.id]);

    await logAudit({
      userId: req.user.id, action: 'delete', entity: 'coupon',
      entityId: row.id, ip: req.ip, meta: { code: row.code },
    }).catch(() => {});

    res.json({ success: true, message: 'Coupon archived' });
  } catch (err) { failure(res, err, { context: 'super-admin' }); }
});

export default router;
