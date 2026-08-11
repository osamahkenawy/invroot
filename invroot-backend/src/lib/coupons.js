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

import { query } from './database.js';
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
