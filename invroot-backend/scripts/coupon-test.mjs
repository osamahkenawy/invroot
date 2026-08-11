/**
 * Coupons — adversarial pass.
 *
 * Coupons decide what a card is charged, so the questions worth asking are not
 * "does the happy path work" but: can someone get a discount they weren't
 * given, use one twice, apply it to the wrong plan, guess codes, or make the
 * quoted price differ from the charged one?
 */
import { generateToken } from '../src/middleware/auth.js';
import { query, execute } from '../src/lib/database.js';
import { config } from '../src/config.js';
import { applyDiscount, normaliseCode } from '../src/lib/coupons.js';
import { isStripeConfigured, stripe } from '../src/lib/stripe-client.js';

const BASE = 'http://127.0.0.1:5000';
const pass = [], fail = [], skip = [];
const check = (n, ok, d = '') => (ok ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

/* ── pure arithmetic first — no network, no excuses ── */
{
  const p = (m, o) => applyDiscount(m, o);
  check('50% off 69 = 34.50', p(69, { discount_type: 'percent', percent_off: 50 }).total === 34.5);
  check('100% off is free, not negative', p(69, { discount_type: 'percent', percent_off: 100 }).total === 0);
  check('fixed 20 off 69 = 49', p(69, { discount_type: 'amount', amount_off: 20 }).total === 49);
  check('a fixed amount larger than the price floors at zero',
    p(69, { discount_type: 'amount', amount_off: 500 }).total === 0,
    'a negative total would be a refund we never agreed to');
  check('discount never exceeds the price',
    p(69, { discount_type: 'amount', amount_off: 500 }).discount === 69);
  check('percentages round to the minor unit',
    p(69, { discount_type: 'percent', percent_off: 33.333 }).total === 46.0,
    String(p(69, { discount_type: 'percent', percent_off: 33.333 }).total));
  check('0% off changes nothing', p(69, { discount_type: 'percent', percent_off: 0 }).total === 69);
  check('codes normalise case and whitespace',
    normaliseCode('  welcome50 ') === 'WELCOME50', normaliseCode('  welcome50 '));
}

/* ── actors ─────────────────────────────────────────── */
const [ownerA] = await query(
  'SELECT id, username, role, tenant_id, is_owner FROM users WHERE tenant_id = 1 AND is_owner = 1 LIMIT 1');
const [otherTenantOwner] = await query(
  'SELECT id, username, role, tenant_id, is_owner FROM users WHERE tenant_id <> 1 AND is_active = 1 LIMIT 1');
const [staff] = await query(
  "SELECT id, username, role, tenant_id FROM users WHERE tenant_id = 1 AND (is_owner = 0 OR is_owner IS NULL) AND is_active = 1 LIMIT 1");
const [superAdmin] = await query('SELECT id, username, role, tenant_id, is_super_admin FROM users WHERE is_super_admin = 1 LIMIT 1');

const tokOwner = generateToken(ownerA);
const tokOther = generateToken(otherTenantOwner);
const tokStaff = staff ? generateToken(staff) : null;
const tokSuper = superAdmin ? generateToken({ ...superAdmin, is_super_admin: 1 }) : null;

const call = async (path, { method = 'GET', body, token } = {}) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body && JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
};

/* ── authorisation on the admin surface ─────────────── */
{
  const asTenant = await call('/api/super-admin/coupons', { token: tokOwner });
  check('a tenant owner cannot list coupons', asTenant.status === 401 || asTenant.status === 403, `status=${asTenant.status}`);

  const create = await call('/api/super-admin/coupons', {
    method: 'POST', token: tokOwner,
    body: { code: 'HACKED', discount_type: 'percent', percent_off: 100 },
  });
  check('a tenant owner cannot mint a 100% coupon',
    create.status === 401 || create.status === 403, `status=${create.status}`);

  const anon = await call('/api/super-admin/coupons', { method: 'POST', body: { code: 'ANON', percent_off: 100 } });
  check('anonymous cannot mint coupons', anon.status === 401, `status=${anon.status}`);
}

/* ── validation surface ─────────────────────────────── */
{
  const anon = await call('/api/billing/validate-coupon', { method: 'POST', body: { code: 'X', plan: 'starter' } });
  check('validation requires a session', anon.status === 401, `status=${anon.status}`);

  if (tokStaff) {
    const asStaff = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokStaff, body: { code: 'X', plan: 'starter' } });
    check('a non-owner cannot probe codes', asStaff.status === 403, `status=${asStaff.status}`);
  } else skip.push('non-owner probe (no non-owner user in tenant 1)');

  const noCode = await call('/api/billing/validate-coupon', { method: 'POST', token: tokOwner, body: { plan: 'starter' } });
  check('an empty code is refused', noCode.status === 400, `status=${noCode.status}`);

  // A code can never be applied to a plan that isn't for sale.
  for (const plan of ['enterprise', 'trial', 'growth', 'not-a-plan']) {
    const r = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokOwner, body: { code: 'ANY', plan } });
    check(`plan "${plan}" cannot take a coupon`, r.status === 400, `status=${r.status}`);
  }
}

/* ── enumeration: every miss must look identical ────── */
{
  const probes = ['NOPE1', 'ADMIN', 'FREE100', "' OR 1=1 --", 'A'.repeat(200), '../../etc', '🎉🎉'];
  const seen = new Set();
  let status5xx = 0;
  for (const code of probes) {
    const r = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokOwner, body: { code, plan: 'starter' } });
    if (r.status >= 500) status5xx++;
    seen.add(`${r.status}|${r.json?.message}`);
  }
  check('hostile input never 500s', status5xx === 0, `${status5xx} server errors`);
  check('every unknown code gives the same answer', seen.size === 1,
    [...seen].join(' / ') + ' — differing replies would let codes be enumerated');
}

/* ── the rest needs Stripe ──────────────────────────── */
if (!isStripeConfigured() || !tokSuper) {
  skip.push('Stripe-backed checks (no key configured or no super admin)');
} else {
  const CODE = `TEST${Date.now().toString().slice(-8)}`;
  let couponId = null;

  /* create */
  {
    const r = await call('/api/super-admin/coupons', {
      method: 'POST', token: tokSuper,
      body: { code: CODE.toLowerCase(), discount_type: 'percent', percent_off: 50,
              duration: 'once', applies_to_plans: 'starter', note: 'automated test' },
    });
    couponId = r.json?.id ?? r.json?.data?.id;
    check('super admin can create a coupon', r.status === 201 && !!couponId, `status=${r.status} ${r.json?.message || ''}`);

    const [row] = await query('SELECT * FROM invroot_coupons WHERE id = ?', [couponId]);
    check('the code is stored uppercase', row?.code === CODE, row?.code);
    check('it is linked to a real Stripe promotion code', !!row?.stripe_promotion_code_id);

    // And it really exists in Stripe, stamped as ours.
    const promo = await stripe().promotionCodes.retrieve(row.stripe_promotion_code_id);
    check('Stripe holds the promotion code', promo.code === CODE, promo.code);
    check('it is stamped as belonging to this app',
      promo.metadata?.app === config.stripe.appNamespace,
      'the Stripe account is shared with another product');
  }

  /* duplicates */
  {
    const dup = await call('/api/super-admin/coupons', {
      method: 'POST', token: tokSuper,
      body: { code: CODE, discount_type: 'percent', percent_off: 10 } });
    check('a duplicate code is refused', dup.status >= 400, `status=${dup.status}`);
  }

  /* nonsense values */
  {
    const cases = [
      ['percent 0',    { discount_type: 'percent', percent_off: 0 }],
      ['percent 101',  { discount_type: 'percent', percent_off: 101 }],
      ['percent -5',   { discount_type: 'percent', percent_off: -5 }],
      ['amount -10',   { discount_type: 'amount',  amount_off: -10 }],
      ['no discount',  { discount_type: 'percent' }],
      ['empty code',   { code: '', discount_type: 'percent', percent_off: 10 }],
    ];
    let refused = 0;
    for (const [, body] of cases) {
      const r = await call('/api/super-admin/coupons', {
        method: 'POST', token: tokSuper,
        body: { code: `BAD${Math.random().toString(36).slice(2, 8)}`, ...body } });
      if (r.status >= 400) refused++;
    }
    check('nonsense discounts are all refused', refused === cases.length, `${refused}/${cases.length}`);
  }

  /* the quoted price must be the charged price */
  {
    const r = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokOwner, body: { code: CODE.toLowerCase(), plan: 'starter' } });
    check('a valid code validates, case-insensitively', r.json?.valid === true, JSON.stringify(r.json?.message || ''));
    const p = r.json?.data;
    check('the quote matches the plan price', p?.original === config.plans.starter.monthly, String(p?.original));
    check('50% of AED 69 is quoted as 34.50', p?.total === 34.5, String(p?.total));
    check('the quote states the billed currency', p?.currency === 'AED', p?.currency);
    check('the quote says how long it lasts', !!p?.duration_label, p?.duration_label);
  }

  /* scoping */
  {
    const r = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokOwner, body: { code: CODE, plan: 'enterprise' } });
    check('a starter-only code is refused on enterprise', r.status === 400 || r.json?.valid === false);
  }

  /* deactivating stops it immediately */
  {
    await call(`/api/super-admin/coupons/${couponId}`, { method: 'PATCH', token: tokSuper, body: { active: false } });
    const r = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokOwner, body: { code: CODE, plan: 'starter' } });
    check('deactivating kills the code at once', r.json?.valid === false, r.json?.reason);
    await call(`/api/super-admin/coupons/${couponId}`, { method: 'PATCH', token: tokSuper, body: { active: true } });
  }

  /* expiry is enforced server-side */
  {
    await execute('UPDATE invroot_coupons SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?', [couponId]);
    const r = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokOwner, body: { code: CODE, plan: 'starter' } });
    check('an expired code is refused', r.json?.valid === false && r.json?.reason === 'expired', r.json?.reason);
    await execute('UPDATE invroot_coupons SET expires_at = NULL WHERE id = ?', [couponId]);
  }

  /* one redemption per tenant */
  {
    await execute(
      `INSERT INTO invroot_coupon_redemptions (coupon_id, code, tenant_id, stripe_subscription_id, plan)
       VALUES (?, ?, 1, 'sub_test_redemption', 'starter')`, [couponId, CODE]);

    const mine = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokOwner, body: { code: CODE, plan: 'starter' } });
    check('a tenant cannot reuse a code they already redeemed',
      mine.json?.valid === false && mine.json?.reason === 'already_used', mine.json?.reason);

    const theirs = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokOther, body: { code: CODE, plan: 'starter' } });
    check("another tenant's redemption doesn't block this one",
      theirs.json?.valid === true, JSON.stringify(theirs.json?.reason || 'ok'));

    // A replayed webhook must not double count.
    await execute(
      `INSERT IGNORE INTO invroot_coupon_redemptions (coupon_id, code, tenant_id, stripe_subscription_id, plan)
       VALUES (?, ?, 1, 'sub_test_redemption', 'starter')`, [couponId, CODE]);
    const [{ n }] = await query(
      'SELECT COUNT(*) AS n FROM invroot_coupon_redemptions WHERE coupon_id = ? AND tenant_id = 1', [couponId]);
    check('a duplicate redemption is ignored, not double counted', n === 1, `${n} rows`);

    await execute('DELETE FROM invroot_coupon_redemptions WHERE coupon_id = ?', [couponId]);
  }

  /* checkout re-validates rather than trusting the client */
  {
    const bogus = await call('/api/stripe/create-checkout', {
      method: 'POST', token: tokOwner, body: { plan: 'starter', coupon: 'NEVER-VALIDATED' } });
    check('checkout refuses a code the client never validated',
      bogus.status === 400, `status=${bogus.status} ${bogus.json?.message || ''}`);

    const wrongPlan = await call('/api/stripe/create-checkout', {
      method: 'POST', token: tokOwner, body: { plan: 'enterprise', coupon: CODE } });
    check('checkout refuses an unpurchasable plan', wrongPlan.status === 400, `status=${wrongPlan.status}`);
  }

  /* the webhook path that records a redemption
     This is where a wrong column name hid: the query only runs when a
     DISCOUNTED invoice is paid, so nothing else in the suite touched it. */
  {
    const { recordCouponRedemptionForTest } = await import('../src/routes/stripe.js')
      .then(m => ({ recordCouponRedemptionForTest: m.recordCouponRedemptionForTest }))
      .catch(() => ({}));

    const [row] = await query('SELECT * FROM invroot_coupons WHERE id = ?', [couponId]);
    await execute("UPDATE tenants SET stripe_customer_id = 'cus_coupon_test' WHERE id = 1");

    if (recordCouponRedemptionForTest) {
      await recordCouponRedemptionForTest({
        subscription: 'sub_coupon_test',
        customer: 'cus_coupon_test',
        currency: 'aed',
        total_discount_amounts: [{ amount: 3450, discount: { coupon: { id: row.stripe_coupon_id } } }],
        lines: { data: [] },
      });
      const [red] = await query(
        'SELECT * FROM invroot_coupon_redemptions WHERE coupon_id = ? AND tenant_id = 1', [couponId]);
      check('a paid discounted invoice records a redemption', !!red, red ? `AED ${red.discount_amount}` : 'none');
      check('the discount amount is converted from minor units',
        red && Number(red.discount_amount) === 34.5, String(red?.discount_amount));

      // Replay it — Stripe retries, and a retry must not double count.
      await recordCouponRedemptionForTest({
        subscription: 'sub_coupon_test', customer: 'cus_coupon_test', currency: 'aed',
        total_discount_amounts: [{ amount: 3450, discount: { coupon: { id: row.stripe_coupon_id } } }],
        lines: { data: [] },
      });
      const [{ n }] = await query(
        'SELECT COUNT(*) AS n FROM invroot_coupon_redemptions WHERE coupon_id = ?', [couponId]);
      check('a replayed webhook does not double count', n === 1, `${n} rows`);

      const [after] = await query('SELECT times_redeemed FROM invroot_coupons WHERE id = ?', [couponId]);
      check('the mirrored counter is derived, not incremented', after.times_redeemed === 1, String(after.times_redeemed));
    } else {
      skip.push('webhook redemption (handler not exported for testing)');
    }

    await execute("UPDATE tenants SET stripe_customer_id = NULL WHERE id = 1 AND stripe_customer_id = 'cus_coupon_test'");
    await execute('DELETE FROM invroot_coupon_redemptions WHERE coupon_id = ?', [couponId]);
  }

  /* clean up Stripe + local */
  {
    const [row] = await query('SELECT * FROM invroot_coupons WHERE id = ?', [couponId]);
    await call(`/api/super-admin/coupons/${couponId}`, { method: 'DELETE', token: tokSuper });
    const gone = await call('/api/billing/validate-coupon', {
      method: 'POST', token: tokOwner, body: { code: CODE, plan: 'starter' } });
    check('a deleted coupon stops working', gone.json?.valid === false, gone.json?.reason);

    try { await stripe().promotionCodes.update(row.stripe_promotion_code_id, { active: false }); } catch {}
    try { await stripe().coupons.del(row.stripe_coupon_id); } catch {}
    await execute('DELETE FROM invroot_coupon_redemptions WHERE coupon_id = ?', [couponId]);
    await execute('DELETE FROM invroot_coupons WHERE id = ?', [couponId]);
  }
}

for (const p of pass) console.log(`  PASS  ${p}`);
for (const s of skip) console.log(`  SKIP  ${s}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed, ${skip.length} skipped\n`);
process.exit(fail.length ? 1 : 0);
