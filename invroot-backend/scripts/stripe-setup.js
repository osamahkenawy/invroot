/**
 * Provision Invroot's plans in Stripe.
 *
 *   npm run stripe:setup            # show what would be created
 *   npm run stripe:setup -- --apply # create it
 *
 * This Stripe account is shared with another product, so the script:
 *   • only ever looks at objects carrying metadata.app = <namespace>
 *   • never lists, edits or deletes anything outside that namespace
 *   • is idempotent — re-running reuses what it already created
 *
 * It prints the price ids to copy into .env. It does not write .env itself.
 */

import { config } from '../src/config.js';
import { stripe, isStripeConfigured, ownedMetadata } from '../src/lib/stripe-client.js';

const APPLY = process.argv.includes('--apply');
const NS = config.stripe.appNamespace;

/* Paid tiers. Amounts are in the currency's smallest unit (fils for AED).
   Adjust to your real pricing before running with --apply. */
const PLANS = [
  { plan: 'starter', name: 'Invroot Starter', amount: 6900, currency: 'aed', interval: 'month' },
];
// Enterprise is deliberately absent: it is custom-priced and sales-led, so it
// has no Stripe price. See POST /api/billing/enterprise-enquiry.

if (!isStripeConfigured()) {
  console.error('❌ STRIPE_SECRET_KEY is not set in .env — add it first, then re-run.');
  process.exit(1);
}

const sdk = stripe();

/* Confirm which account/mode we're pointed at before creating anything. */
let acct;
try {
  acct = await sdk.accounts.retrieve();
} catch (err) {
  console.error('❌ Could not reach Stripe:', err.message);
  process.exit(1);
}
const live = !config.stripe.secretKey.includes('_test_');
console.log(`Stripe account : ${acct.id}${acct.settings?.dashboard?.display_name ? ` (${acct.settings.dashboard.display_name})` : ''}`);
console.log(`Mode           : ${live ? '🔴 LIVE' : '🧪 test / sandbox'}`);
console.log(`Namespace      : ${NS}`);
console.log(`Action         : ${APPLY ? 'CREATE' : 'dry run (pass --apply to create)'}\n`);

if (live && APPLY) {
  console.error('❌ Refusing to create live-mode objects from a script. Do this in the Stripe dashboard.');
  process.exit(1);
}

/**
 * Find a product we previously created for this plan.
 *
 * Uses list + client-side metadata filter rather than products.search: the
 * search index is eventually consistent (a product created seconds ago returns
 * no hits), so relying on it made a second --apply create a duplicate. list is
 * strongly consistent. Other products are read past and never modified.
 */
async function findOurProduct(plan) {
  for await (const product of sdk.products.list({ limit: 100 })) {
    if (product.metadata?.app === NS && product.metadata?.plan === plan) return product;
  }
  return null;
}

async function findOurPrice(productId) {
  const res = await sdk.prices.list({ product: productId, active: true, limit: 1 });
  return res.data[0] || null;
}

const envLines = [];

for (const p of PLANS) {
  const existing = await findOurProduct(p.plan);

  if (existing) {
    const price = await findOurPrice(existing.id);
    console.log(`• ${p.plan.padEnd(11)} already exists → product ${existing.id}${price ? `, price ${price.id}` : ' (no active price)'}`);
    if (price) envLines.push([p.plan, price.id]);
    continue;
  }

  if (!APPLY) {
    console.log(`• ${p.plan.padEnd(11)} would create "${p.name}" at ${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}/${p.interval}`);
    continue;
  }

  const product = await sdk.products.create({
    name: p.name,
    description: `Invroot ${p.plan} plan`,
    metadata: ownedMetadata({ plan: p.plan }),
  });
  const price = await sdk.prices.create({
    product: product.id,
    unit_amount: p.amount,
    currency: p.currency,
    recurring: { interval: p.interval },
    metadata: ownedMetadata({ plan: p.plan }),
  });
  console.log(`✅ ${p.plan.padEnd(11)} created → product ${product.id}, price ${price.id}`);
  envLines.push([p.plan, price.id]);
}

if (envLines.length) {
  console.log('\n─────────────────────────────────────────────');
  console.log('Copy these into invroot-backend/.env:\n');
  for (const [plan, priceId] of envLines) {
    console.log(`STRIPE_PRICE_${plan.toUpperCase()}=${priceId}`);
  }
  console.log('─────────────────────────────────────────────');
}

if (!APPLY) console.log('\nNothing was created. Re-run with --apply when the pricing above looks right.');
process.exit(0);
