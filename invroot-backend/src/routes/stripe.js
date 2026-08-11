import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/role-gate.js';
import { config } from '../config.js';
import { failure, AppError } from '../lib/api-error.js';
import { validateCoupon, messageFor, COUPON_RESULT, normaliseCode } from '../lib/coupons.js';
import {
  stripe, isStripeConfigured, isWebhookConfigured,
  ownedMetadata, isOwnedByApp, planForPriceId, billablePlans,
} from '../lib/stripe-client.js';

const router = express.Router();

/** Refuse cleanly when billing hasn't been set up, rather than throwing. */
function requireStripe(req, res, next) {
  if (!isStripeConfigured()) {
    return res.status(503).json({
      success: false,
      code: 'BILLING_NOT_CONFIGURED',
      message: 'Online billing is not enabled on this deployment.',
    });
  }
  next();
}

/* ── GET /api/stripe/plans ──────────────────────────── */
/* What can actually be purchased — driven by which price ids are configured,
   so the UI never offers a plan that would fail at checkout. */
router.get('/plans', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const plans = billablePlans().map(name => ({
      name,
      limits: config.plans[name] || null,
    }));
    res.json({
      success: true,
      data: {
        configured: isStripeConfigured(),
        current_plan: req.tenant?.plan || 'free',
        plans,
      },
    });
  } catch (err) {
    failure(res, err, { context: 'stripe' });
  }
});

/* ── POST /api/stripe/create-checkout ──────────────── */
router.post('/create-checkout', authMiddleware, tenantMiddleware, requireOwner, requireStripe, async (req, res) => {
  try {
    const { plan, coupon } = req.body;
    const priceId = config.stripe.priceIds[plan];
    if (!priceId) {
      throw new AppError(
        `Plan "${plan}" is not available for purchase.`, 400, 'INVALID_PLAN'
      );
    }

    const tenantId = String(req.tenantId);

    /* Reuse one Stripe customer per tenant. Without this, every checkout
       creates another customer and the account fills with duplicates that are
       impossible to reconcile — worse here, where a second product shares it. */
    let customerId = req.tenant?.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe().customers.create({
        email: req.tenant?.email || req.user?.email,
        name: req.tenant?.company_name,
        metadata: ownedMetadata({ tenant_id: tenantId }),
      });
      customerId = customer.id;
      await execute('UPDATE tenants SET stripe_customer_id = ? WHERE id = ?', [customerId, req.tenantId]);
    }

    /* Re-validate the code here even though the UI already checked it. The
       preview call is advisory; this is the one that decides what is charged,
       and nothing stops a client posting a code it never validated. */
    let promotionCodeId = null;
    if (coupon) {
      const check = await validateCoupon({ code: coupon, plan, tenantId: req.tenantId });
      if (check.result !== COUPON_RESULT.OK) {
        throw new AppError(messageFor(check.result), 400, 'INVALID_COUPON');
      }
      promotionCodeId = check.promotionCodeId;
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      /* `discounts` and `allow_promotion_codes` are mutually exclusive in
         Stripe Checkout — sending both is an error. So: if the customer has
         already supplied a code, apply it; otherwise let them enter one on
         Stripe's own page rather than offering no route at all. */
      ...(promotionCodeId
        ? { discounts: [{ promotion_code: promotionCodeId }] }
        : { allow_promotion_codes: true }),
      success_url: `${config.app.frontendUrl}/settings/billing?success=1`,
      cancel_url:  `${config.app.frontendUrl}/settings/billing?cancelled=1`,
      client_reference_id: tenantId,
      metadata: ownedMetadata({ tenant_id: tenantId, plan, coupon: promotionCodeId ? normaliseCode(coupon) : '' }),
      /* The important part: metadata set at the top level lands on the Checkout
         Session only. Stripe does not copy it onto the Subscription it creates,
         so the previous version's webhook read sub.metadata.tenant_id and always
         found undefined — no tenant was ever updated. subscription_data puts it
         where the subscription events can actually see it. */
      subscription_data: {
        metadata: ownedMetadata({ tenant_id: tenantId, plan, coupon: promotionCodeId ? normaliseCode(coupon) : '' }),
      },
    });

    res.json({ success: true, url: session.url, session_id: session.id });
  } catch (err) {
    failure(res, err, { context: 'stripe' });
  }
});

/* ── POST /api/stripe/dismiss-pending ──────────────── */
/* Abandon the plan chosen at signup.
 *
 * Without this the prompt is unkillable: pending_plan is only cleared when a
 * subscription is granted, so someone who decided against paying would be sent
 * to checkout on every single sign-in forever. Note it clears an INTENT and
 * nothing else — there is no entitlement attached to it to take away. */
router.post('/dismiss-pending', authMiddleware, tenantMiddleware, requireOwner, async (req, res) => {
  try {
    await execute('UPDATE tenants SET pending_plan = NULL WHERE id = ?', [req.tenantId]);
    res.json({ success: true });
  } catch (err) {
    failure(res, err, { context: 'stripe' });
  }
});

/* ── POST /api/stripe/billing-portal ───────────────── */
/* Let an owner manage their own card and cancellation in Stripe's portal. */
router.post('/billing-portal', authMiddleware, tenantMiddleware, requireOwner, requireStripe, async (req, res) => {
  try {
    const customerId = req.tenant?.stripe_customer_id;
    if (!customerId) throw new AppError('This account has no billing history yet.', 400, 'NO_CUSTOMER');

    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${config.app.frontendUrl}/settings/billing`,
    });
    res.json({ success: true, url: session.url });
  } catch (err) {
    failure(res, err, { context: 'stripe' });
  }
});

/* ══════════════════════════════════════════════════════
   WEBHOOK
   Mounted with express.raw in server.js — the signature is
   computed over the exact bytes, so a parsed body cannot verify.
   ══════════════════════════════════════════════════════ */

/** Record the event and report whether it is a replay we should skip. */
async function alreadySeen(event, { appOwned, tenantId = null, status = 'processed', error = null }) {
  try {
    const result = await execute(
      `INSERT INTO stripe_events (id, type, app_owned, tenant_id, status, error, payload_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [event.id, event.type, appOwned ? 1 : 0, tenantId, status,
       error ? String(error).slice(0, 500) : null, event.data?.object?.object || null]
    );
    return { seen: false, insertId: result.insertId };
  } catch (err) {
    // Primary-key collision means Stripe is retrying an event we already handled.
    if (err.code === 'ER_DUP_ENTRY') return { seen: true };
    throw err;
  }
}

async function applySubscription(sub) {
  const tenantId = sub.metadata?.tenant_id;
  if (!tenantId) return { tenantId: null, note: 'no tenant_id in subscription metadata' };

  const priceId = sub.items?.data?.[0]?.price?.id;
  const plan = planForPriceId(priceId);

  /* An unrecognised price previously fell back to 'starter', silently granting
     a paid tier. Leave the plan untouched instead and make the gap visible. */
  if (!plan) {
    console.error(`[stripe] unmapped price ${priceId} on subscription ${sub.id} — plan left unchanged`);
    await execute('UPDATE tenants SET subscription_id = ? WHERE id = ?', [sub.id, tenantId]);
    return { tenantId, note: `unmapped price ${priceId}` };
  }

  // Stripe's own lifecycle decides whether the workspace stays usable.
  const usable = ['active', 'trialing'].includes(sub.status);
  /* This is the ONE place a paid plan is granted — signup records the customer's
     choice as tenants.pending_plan and grants nothing. Clearing it here is what
     closes the loop: the intent has now been fulfilled, so the app must stop
     prompting for a checkout the customer has already completed. */
  await execute(
    'UPDATE tenants SET plan = ?, subscription_id = ?, status = ?, pending_plan = NULL WHERE id = ?',
    [plan, sub.id, usable ? (sub.status === 'trialing' ? 'trialing' : 'active') : 'suspended', tenantId]
  );
  return { tenantId, note: `plan=${plan} status=${sub.status}` };
}


/* Record a coupon redemption from a paid invoice.
 *
 * Deliberately driven by `invoice.paid` rather than checkout completion: a
 * session can be created, a discount attached, and the payment then fail or be
 * abandoned. Counting that as a redemption would burn a single-use code the
 * customer never actually got the benefit of.
 *
 * The unique key on (coupon, tenant, subscription) makes Stripe's retries and
 * any duplicate delivery a no-op instead of a double count. */
export { recordCouponRedemption as recordCouponRedemptionForTest };

async function recordCouponRedemption(invoice) {
  const discounts = invoice?.total_discount_amounts || [];
  if (!discounts.length) return;

  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subId) return;

  const [tenant] = await query(
    // The column is `subscription_id`; `stripe_customer_id` is the fallback for
    // an invoice whose subscription we haven't recorded yet.
    'SELECT id FROM tenants WHERE subscription_id = ? OR stripe_customer_id = ? LIMIT 1',
    [subId, invoice.customer]
  );
  if (!tenant) return;

  for (const d of discounts) {
    /* `discount` on the line is the id of the applied discount; resolve it to
       the coupon so a code renamed in Stripe still matches our row. */
    const couponId = typeof d.discount === 'string'
      ? null
      : d.discount?.coupon?.id;
    if (!couponId && !invoice.discount?.coupon?.id) continue;

    const stripeCouponId = couponId || invoice.discount?.coupon?.id;
    const [row] = await query('SELECT id, code FROM invroot_coupons WHERE stripe_coupon_id = ?', [stripeCouponId]);
    if (!row) continue;   // a coupon from the other product on this shared account

    await execute(
      `INSERT IGNORE INTO invroot_coupon_redemptions
         (coupon_id, code, tenant_id, stripe_subscription_id, stripe_session_id,
          plan, discount_amount, currency)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      [row.id, row.code, tenant.id, subId,
       invoice.lines?.data?.[0]?.price?.id ? planForPriceId(invoice.lines.data[0].price.id) : null,
       (d.amount || 0) / 100, (invoice.currency || '').toUpperCase()]
    );

    /* Mirror the running total so the admin list doesn't need a Stripe call.
       Derived from the redemption rows, never incremented blindly, so a
       replayed webhook cannot inflate it. */
    await execute(
      `UPDATE invroot_coupons
          SET times_redeemed = (SELECT COUNT(*) FROM invroot_coupon_redemptions WHERE coupon_id = ?)
        WHERE id = ?`,
      [row.id, row.id]
    );
  }
}

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!isWebhookConfigured()) {
    console.error('[stripe] webhook received but STRIPE_WEBHOOK_SECRET is not set');
    return res.status(503).send('Webhook not configured');
  }

  let event;
  try {
    event = stripe().webhooks.constructEvent(
      req.body, req.headers['stripe-signature'], config.stripe.webhookSecret
    );
  } catch (err) {
    // Never echo the verification detail back to the caller.
    console.error('[stripe] signature verification failed:', err.message);
    return res.status(400).send('Invalid signature');
  }

  const obj = event.data?.object || {};

  /* Shared-account guard. Anything without our namespace belongs to the other
     product (or is cross-wired) and must not touch Invroot data. It is still
     acknowledged — a non-2xx would make Stripe retry someone else's event
     against us indefinitely. */
  if (!isOwnedByApp(obj)) {
    await alreadySeen(event, { appOwned: false, status: 'ignored' }).catch(() => {});
    console.warn(`[stripe] ignoring foreign event ${event.type} (${event.id}) — not namespaced to ${config.stripe.appNamespace}`);
    return res.json({ received: true, ignored: true });
  }

  const dedup = await alreadySeen(event, { appOwned: true }).catch(err => {
    console.error('[stripe] event log write failed:', err.message);
    return { seen: false };
  });
  if (dedup.seen) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    let outcome = { tenantId: null, note: 'unhandled' };

    switch (event.type) {
      case 'checkout.session.completed':
        /* Redemptions are recorded HERE, not at checkout creation. A session
           that is created and abandoned must not burn a single-use code, and
           only a completed session means money actually moved. */
        outcome = await recordRedemption(obj);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        outcome = await applySubscription(obj);
        break;

      case 'customer.subscription.deleted':
        if (obj.metadata?.tenant_id) {
          await execute("UPDATE tenants SET status = 'cancelled' WHERE id = ?", [obj.metadata.tenant_id]);
          outcome = { tenantId: obj.metadata.tenant_id, note: 'subscription cancelled' };
        }
        break;

      case 'invoice.payment_failed':
        /* Don't suspend on the first failure — Stripe retries on its dunning
           schedule and the subscription status change will arrive separately. */
        if (obj.subscription_details?.metadata?.tenant_id || obj.metadata?.tenant_id) {
          const tid = obj.subscription_details?.metadata?.tenant_id || obj.metadata?.tenant_id;
          console.warn(`[stripe] payment failed for tenant ${tid}, invoice ${obj.id}`);
          outcome = { tenantId: tid, note: 'payment failed (awaiting dunning outcome)' };
        }
        break;

      case 'invoice.paid':
        // Attribute any discount before the generic handling below.
        await recordCouponRedemption(obj).catch(err =>
          console.error('[stripe] could not record coupon redemption:', err.message));
        outcome = { tenantId: obj.metadata?.tenant_id || null, note: 'invoice paid' };
        break;

      default:
        outcome = { tenantId: null, note: `unhandled type ${event.type}` };
    }

    await execute(
      'UPDATE stripe_events SET tenant_id = ?, error = ? WHERE id = ?',
      [outcome.tenantId || null, outcome.note?.slice(0, 500) || null, event.id]
    ).catch(() => {});

    res.json({ received: true });
  } catch (err) {
    console.error(`[stripe] handler failed for ${event.type} (${event.id}):`, err);
    /* Returning 500 asks Stripe to retry — but the dedup row inserted above
       would make that retry look like a duplicate and be skipped forever. Drop
       the row so the redelivery gets a genuine second attempt, keeping a copy
       under a failed- prefix for diagnosis. */
    await execute(
      `INSERT INTO stripe_events (id, type, app_owned, status, error, payload_type)
       VALUES (?, ?, 1, 'failed', ?, ?)
       ON DUPLICATE KEY UPDATE error = VALUES(error)`,
      [`failed-${event.id}`.slice(0, 80), event.type, String(err.message).slice(0, 500), obj.object || null]
    ).catch(() => {});
    await execute('DELETE FROM stripe_events WHERE id = ?', [event.id]).catch(() => {});
    res.status(500).send('Handler error');
  }
});

export default router;
