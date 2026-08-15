/**
 * Coupon validation and pricing preview.
 *
 * Every answer this module gives is checked against Stripe before it is
 * returned. The local table is a mirror for listing and scoping; it is never
 * trusted on its own, because a code archived or exhausted in Stripe must stop
 * working here the instant it does there — not whenever a mirror next syncs.
 *
 * The preview amount is computed from the SAME numbers Stripe will charge, so
 * the figure shown next to the code is the figure taken from the card.
 */

import { query, execute } from './database.js';
import { config } from '../config.js';
import { stripe, ownedMetadata, isOwnedByApp } from './stripe-client.js';

/** Codes are matched case-insensitively; uppercase is the canonical form. */
export const normaliseCode = (code) => String(code || '').trim().toUpperCase();

export const COUPON_RESULT = {
  OK: 'ok',
  NOT_FOUND: 'not_found',
  INACTIVE: 'inactive',
  EXPIRED: 'expired',
  EXHAUSTED: 'exhausted',
  WRONG_PLAN: 'wrong_plan',
  ALREADY_USED: 'already_used',
  NOT_OURS: 'not_ours',
};

/* Deliberately identical wording for "no such code" and "not valid for this
   plan"-style failures would be unhelpful, but every failure must avoid
   confirming whether a code exists in the OTHER product sharing this Stripe
   account. NOT_OURS therefore reads the same as NOT_FOUND to the caller. */
const MESSAGES = {
  [COUPON_RESULT.NOT_FOUND]:    "That code isn't valid.",
  [COUPON_RESULT.NOT_OURS]:     "That code isn't valid.",
  [COUPON_RESULT.INACTIVE]:     'That code is no longer active.',
  [COUPON_RESULT.EXPIRED]:      'That code has expired.',
  [COUPON_RESULT.EXHAUSTED]:    'That code has reached its redemption limit.',
  [COUPON_RESULT.WRONG_PLAN]:   "That code doesn't apply to this plan.",
  [COUPON_RESULT.ALREADY_USED]: "You've already used that code.",
};

export const messageFor = (result) => MESSAGES[result] || "That code isn't valid.";

/** Plans a coupon may be used on. NULL/empty means any purchasable plan. */
function planAllowed(row, plan) {
  if (!row.applies_to_plans) return true;
  return row.applies_to_plans.split(',').map(s => s.trim()).filter(Boolean).includes(plan);
}

/**
 * Work out what a plan costs once a discount is applied.
 * Mirrors Stripe's own arithmetic: percentages round to the minor unit, and a
 * fixed amount can never take the total below zero.
 */
export function applyDiscount(monthly, { discount_type, percent_off, amount_off }) {
  const base = Number(monthly) || 0;
  if (discount_type === 'percent') {
    const off = base * (Number(percent_off) || 0) / 100;
    return { discount: Number(off.toFixed(2)), total: Number(Math.max(0, base - off).toFixed(2)) };
  }
  const off = Math.min(base, Number(amount_off) || 0);
  return { discount: Number(off.toFixed(2)), total: Number((base - off).toFixed(2)) };
}

/**
 * Validate a code for a tenant + plan.
 *
 * Returns { result, coupon?, promotionCodeId?, preview? }. Callers map
 * `result` to a message; they must not invent their own reasons, so that the
 * responses stay uniform and unhelpful to anyone guessing codes.
 */
export async function validateCoupon({ code, plan, tenantId }) {
  const wanted = normaliseCode(code);
  if (!wanted) return { result: COUPON_RESULT.NOT_FOUND };

  const [row] = await query('SELECT * FROM invroot_coupons WHERE code = ?', [wanted]);
  if (!row) return { result: COUPON_RESULT.NOT_FOUND };
  if (!row.active || row.archived_at) return { result: COUPON_RESULT.INACTIVE };
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { result: COUPON_RESULT.EXPIRED };
  if (!planAllowed(row, plan)) return { result: COUPON_RESULT.WRONG_PLAN };

  /* One redemption per tenant. Without this a tenant could cancel and
     resubscribe repeatedly on a launch discount that was meant to be one-off. */
  const [used] = await query(
    'SELECT id FROM invroot_coupon_redemptions WHERE coupon_id = ? AND tenant_id = ? LIMIT 1',
    [row.id, tenantId]
  );
  if (used) return { result: COUPON_RESULT.ALREADY_USED };

  /* Stripe is the authority. The mirror above only filters cheaply; anything
     that decides whether money changes hands is confirmed here. */
  let promo;
  try {
    promo = await stripe().promotionCodes.retrieve(row.stripe_promotion_code_id, { expand: ['coupon'] });
  } catch {
    return { result: COUPON_RESULT.NOT_FOUND };
  }

  // The Stripe account is shared with another product — never honour its codes.
  if (!isOwnedByApp(promo) && !isOwnedByApp(promo.coupon)) {
    return { result: COUPON_RESULT.NOT_OURS };
  }
  if (!promo.active || !promo.coupon?.valid) return { result: COUPON_RESULT.INACTIVE };
  if (promo.expires_at && promo.expires_at * 1000 < Date.now()) return { result: COUPON_RESULT.EXPIRED };
  if (promo.max_redemptions != null && promo.times_redeemed >= promo.max_redemptions) {
    return { result: COUPON_RESULT.EXHAUSTED };
  }

  /* Read the discount from Stripe's object, not our mirror — if someone edited
     the coupon in the Stripe dashboard, the mirror is stale and quoting it
     would show a price we won't charge. */
  const live = {
    discount_type: promo.coupon.percent_off != null ? 'percent' : 'amount',
    percent_off: promo.coupon.percent_off,
    // Stripe holds fixed amounts in the minor unit.
    amount_off: promo.coupon.amount_off != null ? promo.coupon.amount_off / 100 : null,
    currency: (promo.coupon.currency || '').toUpperCase() || null,
    duration: promo.coupon.duration,
    duration_in_months: promo.coupon.duration_in_months,
  };

  const planCfg = config.plans[plan];
  const monthly = planCfg?.monthly ?? 0;
  const billedCurrency = planCfg?.currency || 'AED';

  /* A fixed-amount coupon in the wrong currency cannot be applied — Stripe
     would reject it at checkout, so refuse it here rather than quote a
     discount that then fails at the payment step. */
  if (live.discount_type === 'amount' && live.currency && live.currency !== billedCurrency) {
    return { result: COUPON_RESULT.WRONG_PLAN };
  }

  const { discount, total } = applyDiscount(monthly, live);

  return {
    result: COUPON_RESULT.OK,
    coupon: row,
    promotionCodeId: promo.id,
    preview: {
      code: wanted,
      ...live,
      plan,
      currency: billedCurrency,
      original: monthly,
      discount,
      total,
      /* Say plainly how long it lasts. "50% off" on a repeating coupon means
         something very different from "50% off" once. */
      duration_label: live.duration === 'forever'
        ? 'for the life of the subscription'
        : live.duration === 'repeating'
          ? `for the first ${live.duration_in_months} month${live.duration_in_months === 1 ? '' : 's'}`
          : 'on your first payment',
    },
  };
}

/** Create the coupon + promotion code in Stripe, stamped as ours. */
export async function createStripeCoupon({ code, percentOff, amountOff, currency, duration, durationInMonths, maxRedemptions, expiresAt }) {
  const s = stripe();

  const couponPayload = {
    duration: duration || 'once',
    metadata: ownedMetadata({ code: normaliseCode(code) }),
  };
  if (percentOff != null) couponPayload.percent_off = Number(percentOff);
  else {
    couponPayload.amount_off = Math.round(Number(amountOff) * 100);   // minor unit
    couponPayload.currency = String(currency || 'AED').toLowerCase();
  }
  if (couponPayload.duration === 'repeating') {
    couponPayload.duration_in_months = Number(durationInMonths) || 1;
  }

  const coupon = await s.coupons.create(couponPayload);

  const promoPayload = {
    coupon: coupon.id,
    code: normaliseCode(code),
    metadata: ownedMetadata({ code: normaliseCode(code) }),
  };
  if (maxRedemptions) promoPayload.max_redemptions = Number(maxRedemptions);
  if (expiresAt) promoPayload.expires_at = Math.floor(new Date(expiresAt).getTime() / 1000);

  const promo = await s.promotionCodes.create(promoPayload);
  return { coupon, promo };
}

/**
 * Record that a coupon was actually redeemed, once a checkout has completed.
 *
 * This function was CALLED by the webhook and never existed. Every
 * `checkout.session.completed` therefore threw ReferenceError, and since
 * Stripe reads a 500 as "retry later", the endpoint was collecting failures on
 * its most important event.
 *
 * The subscription itself was never at risk — plans are granted by
 * `customer.subscription.created/updated`, a separate event — so paying
 * customers got what they paid for. What was lost is the redemption record,
 * which is what validateCoupon() reads to enforce one-use-per-tenant and what
 * the admin page reads to show who used a code. A launch discount capped at N
 * uses would never have burned a single one.
 *
 * Recorded here rather than at checkout creation on purpose: a session that is
 * created and abandoned must not consume a code. Only a completed session
 * means money moved.
 *
 * @param {object} session Stripe checkout.session
 * @returns {Promise<{tenantId: (string|null), note: string}>}
 */
export async function recordRedemption(session) {
  const tenantId = session?.metadata?.tenant_id || session?.client_reference_id || null;
  const code = normaliseCode(session?.metadata?.coupon);

  // Most checkouts carry no code at all. That is not a failure.
  if (!code) return { tenantId, note: 'no coupon on session' };
  if (!tenantId) return { tenantId: null, note: `coupon ${code} but no tenant_id on session` };

  const [coupon] = await query('SELECT id FROM invroot_coupons WHERE code = ?', [code]);
  if (!coupon) return { tenantId, note: `coupon ${code} not in mirror` };

  /* Belt-and-braces against a Stripe retry that slips past event dedup. There
     is no unique index on the session column, so this is the guard. */
  const [seen] = await query(
    'SELECT id FROM invroot_coupon_redemptions WHERE stripe_session_id = ? LIMIT 1',
    [session.id]
  );
  if (seen) return { tenantId, note: `redemption already recorded for ${code}` };

  /* Stripe reports discounts in minor units. Storing 1000 where 10.00 belongs
     would overstate every total on the admin page a hundredfold. */
  const discount = Number(session?.total_details?.amount_discount || 0) / 100;
  const currency = String(session.currency || '').toUpperCase() || null;
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id || null;

  await execute(
    `INSERT INTO invroot_coupon_redemptions
       (coupon_id, code, tenant_id, stripe_subscription_id, stripe_session_id, plan, discount_amount, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [coupon.id, code, tenantId, subscriptionId, session.id,
     session?.metadata?.plan || null, discount, currency]
  );
  await execute(
    'UPDATE invroot_coupons SET times_redeemed = times_redeemed + 1 WHERE id = ?',
    [coupon.id]
  );

  return { tenantId, note: `redeemed ${code} (-${discount} ${currency || ''})`.trim() };
}
