/**
 * Plans and Enterprise enquiries.
 *
 * Starter is self-service: the tenant subscribes through Stripe Checkout
 * (see routes/stripe.js). Enterprise is custom-priced and contract-based, so
 * its button raises an enquiry to the sales inboxes instead of taking a card.
 */

import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/role-gate.js';
import { usageFor } from '../middleware/plan-limit.js';
import { sendEnterpriseEnquiryEmail } from '../lib/email.js';
import { notify } from '../lib/notifications.js';
import { logAudit } from '../lib/audit-logger.js';
import { config } from '../config.js';
import { failure, AppError } from '../lib/api-error.js';
import { validateCoupon, messageFor, COUPON_RESULT } from '../lib/coupons.js';
import { isStripeConfigured } from '../lib/stripe-client.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* Feature copy shown on the pricing cards. Kept here rather than in the
   frontend so the API is the single source of truth for what is sold. */
const FEATURES = {
  trial: [
    'Try every feature — no card required',
    'One real invoice, yours to send',
    'Up to 5 clients',
    'Subscribe when you\'re ready to send more',
  ],
  starter: [
    'Unlimited invoices, quotes and receipts within your allowance',
    'Up to 200 clients and 5 team members',
    'Branded PDFs with your logo, stamp and signature',
    'Client portal and shareable payment links',
    'VAT handling and financial reports',
    'Email support',
  ],
  enterprise: [
    'Everything in Starter, without limits',
    'Annual contract with custom pricing',
    'Onboarding and data migration support',
    'Priority technical support',
    'Custom integrations and bespoke features',
    'Dedicated account manager',
  ],
};

/* ── GET /api/billing/plans ─────────────────────────── */
/* The public pricing table plus where this tenant currently stands. */
router.get('/plans', async (req, res) => {
  try {
    const currentPlan = req.tenant?.plan || config.defaultPlan;
    /* A tenant can sit on a plan without ever having paid — seeded data, or a
       plan set by an admin. Only an actual Stripe subscription gives them
       anything to manage, so the UI must be able to tell the two apart. */
    const hasSubscription = Boolean(req.tenant?.subscription_id);

    const plans = ['trial', 'starter', 'enterprise'].map(name => {
      const p = config.plans[name];
      return {
        name,
        label: p.label,
        monthly: p.monthly ?? null,
        currency: p.currency || 'AED',
        sales_led: Boolean(p.salesLed),
        // Starter can only be bought if a Stripe price is wired up.
        purchasable: name === 'starter' ? Boolean(config.stripe.priceIds.starter && isStripeConfigured()) : false,
        current: name === currentPlan,
        // Manage-billing only makes sense against a live subscription.
        manageable: name === currentPlan && hasSubscription,
        limits: { clients: p.maxClients, invoices: p.maxInvoices, users: p.maxUsers },
        features: FEATURES[name] || [],
      };
    });

    res.json({
      success: true,
      data: {
        current_plan: currentPlan,
        has_subscription: hasSubscription,
        // A retired plan still resolves, but isn't shown as one of the cards.
        current_is_retired: Boolean(config.plans[currentPlan]?.retired),
        usage: await usageFor(req.tenantId, currentPlan),
        plans,
        sales_email: config.sales.inboxes[0] || null,
      },
    });
  } catch (err) {
    failure(res, err, { context: 'billing' });
  }
});

/* ── POST /api/billing/validate-coupon ─────────────── */
/* Preview what a code does before checkout. Advisory only — the real decision
   is made again when the checkout session is created, because nothing stops a
   client skipping this call. */
router.post('/validate-coupon', requireOwner, async (req, res) => {
  try {
    const { code, plan } = req.body || {};
    if (!code) throw new AppError('Enter a code.', 400, 'NO_CODE');

    const planCfg = config.plans[plan];
    if (!planCfg || planCfg.salesLed || planCfg.retired || !(planCfg.monthly > 0)) {
      throw new AppError('That plan cannot be purchased.', 400, 'INVALID_PLAN');
    }

    const check = await validateCoupon({ code, plan, tenantId: req.tenantId });

    if (check.result !== COUPON_RESULT.OK) {
      /* 200, not 4xx: a wrong code is an ordinary form outcome, not a failed
         request, and the UI shows the reason inline. */
      return res.json({ success: false, valid: false, reason: check.result, message: messageFor(check.result) });
    }

    res.json({ success: true, valid: true, data: check.preview });
  } catch (err) { failure(res, err, { context: 'billing' }); }
});

/* ── POST /api/billing/enterprise-enquiry ───────────── */
/* Raises an Enterprise enquiry with the sales team. */
router.post('/enterprise-enquiry', requireOwner, async (req, res) => {
  try {
    const { contact_name, contact_email, phone, team_size, message } = req.body;

    const name  = String(contact_name  || req.user.full_name || '').trim();
    const email = String(contact_email || req.user.email     || '').trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new AppError('A valid contact email is required.', 400, 'INVALID_EMAIL');
    }
    if (message && String(message).length > 2000) {
      throw new AppError('Please keep the requirements under 2000 characters.', 400, 'TOO_LONG');
    }

    /* Rate limit: one enquiry per tenant per hour. Without this the button is a
       free way to send mail to our own inboxes repeatedly. */
    const [recent] = await query(
      `SELECT created_at FROM invroot_audit_logs
       WHERE tenant_id = ? AND action = 'enterprise_enquiry'
         AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
       ORDER BY created_at DESC LIMIT 1`,
      [req.tenantId]
    ).catch(() => [null]);
    if (recent) {
      throw new AppError(
        'We already have your enquiry — our team will be in touch shortly.',
        429, 'ENQUIRY_ALREADY_SENT'
      );
    }

    const usage = await usageFor(req.tenantId, req.tenant?.plan);

    await sendEnterpriseEnquiryEmail({
      to: config.sales.inboxes,
      companyName: req.tenant?.company_name || `Tenant #${req.tenantId}`,
      contactName: name || email,
      contactEmail: email,
      phone: phone || req.tenant?.phone || null,
      teamSize: team_size || null,
      message: message || null,
      tenantId: req.tenantId,
      currentPlan: req.tenant?.plan || config.defaultPlan,
      usage,
    });

    await logAudit({
      tenantId: req.tenantId, userId: req.user.id,
      action: 'enterprise_enquiry', entity: 'tenant', entityId: req.tenantId, ip: req.ip,
    });
    await notify({
      tenantId: req.tenantId,
      type: 'info',
      title: 'Enterprise enquiry sent',
      body: 'Our team will contact you about Enterprise pricing shortly.',
      link: '/settings/billing',
    });

    res.json({
      success: true,
      message: 'Thanks — our team will be in touch shortly.',
    });
  } catch (err) {
    failure(res, err, { context: 'billing' });
  }
});

export default router;
