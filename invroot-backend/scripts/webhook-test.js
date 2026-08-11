/**
 * Send genuinely-signed Stripe webhook events at the local endpoint.
 *
 *   npm run webhook:test              # run every scenario
 *   npm run webhook:test -- upgrade   # run one
 *
 * The Stripe CLI needs Xcode Command Line Tools to install via Homebrew. This
 * does the same job with the stripe SDK already in node_modules: it signs the
 * payload with STRIPE_WEBHOOK_SECRET exactly as Stripe does, so the endpoint's
 * signature verification is genuinely exercised rather than bypassed.
 *
 * Scenarios cover the paths that actually matter:
 *   upgrade   — a subscription activates the tenant's plan
 *   cancel    — a deletion suspends it
 *   foreign   — an event from the OTHER product on this shared account is ignored
 *   replay    — a redelivered event is not applied twice
 *   badsig    — a tampered payload is rejected
 */

import Stripe from 'stripe';
import { config } from '../src/config.js';
import { query, execute } from '../src/lib/database.js';

const ENDPOINT = process.env.WEBHOOK_URL || 'http://127.0.0.1:5000/api/stripe/webhook';
const SECRET = config.stripe.webhookSecret;
const NS = config.stripe.appNamespace;
const only = process.argv[2];

if (!SECRET) {
  console.error('❌ STRIPE_WEBHOOK_SECRET is empty — set it in .env first.');
  process.exit(1);
}

const sdk = new Stripe(config.stripe.secretKey || 'sk_test_placeholder');

/** POST a payload with a valid Stripe-Signature header. */
async function send(event, { tamper = false } = {}) {
  const payload = JSON.stringify(event);
  const header = sdk.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
    // Tampering after signing is what an attacker would do — the signature
    // must no longer match.
    body: tamper ? payload.replace('"tenant_id":"1"', '"tenant_id":"9999"') : payload,
  });
  return { status: res.status, body: await res.text() };
}

function subscriptionEvent(type, { tenantId = '1', app = NS, priceId, status = 'active', id } = {}) {
  return {
    id: id || `evt_test_${Math.random().toString(36).slice(2, 12)}`,
    object: 'event',
    type,
    data: {
      object: {
        id: `sub_test_${Math.random().toString(36).slice(2, 10)}`,
        object: 'subscription',
        status,
        metadata: app ? { app, tenant_id: tenantId, plan: 'starter' } : { tenant_id: tenantId },
        items: { data: [{ price: { id: priceId || config.stripe.priceIds.starter } }] },
      },
    },
  };
}

async function tenantRow(id = 1) {
  const [t] = await query('SELECT plan, status, subscription_id FROM tenants WHERE id = ?', [id]);
  return t;
}

const scenarios = {
  async upgrade() {
    const before = await tenantRow();
    const ev = subscriptionEvent('customer.subscription.created');
    const res = await send(ev);
    const after = await tenantRow();
    console.log(`  HTTP ${res.status} ${res.body}`);
    console.log(`  tenant: plan ${before.plan} → ${after.plan}, status ${before.status} → ${after.status}`);
    console.log(`  subscription_id: ${after.subscription_id}`);
    return after.plan === 'starter' && after.status === 'active';
  },

  async foreign() {
    // Same shape, but namespaced to the other product on this Stripe account.
    const before = await tenantRow();
    const ev = subscriptionEvent('customer.subscription.updated', { app: 'other-product', status: 'canceled' });
    const res = await send(ev);
    const after = await tenantRow();
    console.log(`  HTTP ${res.status} ${res.body}`);
    console.log(`  tenant untouched: plan ${after.plan}, status ${after.status}`);
    const [logged] = await query(
      "SELECT status FROM stripe_events WHERE id = ?", [ev.id]
    );
    console.log(`  logged as: ${logged?.status || '(not logged)'}`);
    return after.plan === before.plan && after.status === before.status && logged?.status === 'ignored';
  },

  async replay() {
    const ev = subscriptionEvent('customer.subscription.created', { id: `evt_replay_${Date.now()}` });
    const first = await send(ev);
    const second = await send(ev);   // Stripe redelivering the same event
    console.log(`  first  → HTTP ${first.status} ${first.body}`);
    console.log(`  second → HTTP ${second.status} ${second.body}`);
    return second.body.includes('duplicate');
  },

  async badsig() {
    const ev = subscriptionEvent('customer.subscription.created');
    const res = await send(ev, { tamper: true });
    console.log(`  HTTP ${res.status} — ${res.body}`);
    return res.status === 400;
  },

  async cancel() {
    const ev = subscriptionEvent('customer.subscription.deleted');
    const res = await send(ev);
    const after = await tenantRow();
    console.log(`  HTTP ${res.status} ${res.body}`);
    console.log(`  tenant status → ${after.status}`);
    return after.status === 'cancelled';
  },
};

const order = ['upgrade', 'foreign', 'replay', 'badsig', 'cancel'];
const toRun = only ? [only] : order;

console.log(`endpoint : ${ENDPOINT}`);
console.log(`namespace: ${NS}`);
console.log(`secret   : ${SECRET.slice(0, 18)}…\n`);

let pass = 0, fail = 0;
for (const name of toRun) {
  if (!scenarios[name]) { console.log(`unknown scenario: ${name}`); continue; }
  console.log(`▸ ${name}`);
  try {
    const ok = await scenarios[name]();
    console.log(ok ? '  ✅ pass\n' : '  ❌ FAIL\n');
    ok ? pass++ : fail++;
  } catch (err) {
    console.log(`  ❌ ERROR: ${err.message}\n`);
    fail++;
  }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
