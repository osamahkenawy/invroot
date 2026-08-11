/**
 * A paid plan is granted only while it is being paid for.
 *
 * The bug this guards: applySubscription() wrote `plan = ?` unconditionally and
 * used the subscription status merely to choose the value of the `status`
 * column. But entitlements are read from tenants.plan (limitsFor in
 * middleware/plan-limit.js) and nothing read status — requireActiveTenant was
 * written and then wired to no route. So a declined card produced
 * plan='starter', status='suspended', and a workspace with the full paid
 * allowance for free. It reached production and was caught by a real customer
 * whose payment failed.
 *
 * applySubscription is not exported, so it is extracted from source and run
 * against stubbed database calls. That keeps the test honest about the real
 * control flow — including the early returns — without needing a live Stripe
 * subscription in every state.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/routes/stripe.js', import.meta.url), 'utf8');
const FN = SRC.match(/async function applySubscription[\s\S]*?\n}\n/)?.[0];

/** Run the real applySubscription body against captured SQL. */
async function run(status, { priceMapped = true, currentPlan = 'trial' } = {}) {
  const writes = [];
  globalThis.__entitlementWrites = writes;
  const body =
    'const writes = globalThis.__entitlementWrites;' +
    'const execute = async (sql, params) => { writes.push({ sql, params }); };' +
    `const query = async () => [{ plan: '${currentPlan}', status: 'active' }];` +
    "const config = { defaultPlan: 'trial' };" +
    `const planForPriceId = () => ${priceMapped ? "'starter'" : 'null'};` +
    FN +
    'export { applySubscription };';
  // The fragment identifier defeats the module cache between statuses.
  const mod = await import(
    'data:text/javascript,' + encodeURIComponent(body) + '#' + status + priceMapped + currentPlan
  );
  const result = await mod.applySubscription({
    id: 'sub_test',
    status,
    metadata: { tenant_id: '42' },
    items: { data: [{ price: { id: 'price_test' } }] },
  });
  return { writes, result, grantsPlan: writes.some(w => /SET plan = \?/.test(w.sql)) };
}

describe('applySubscription entitlement', () => {
  test('extracts the real function from source', () => {
    assert.ok(FN, 'applySubscription not found — did it get renamed?');
  });

  for (const status of ['active', 'trialing']) {
    test(`grants the plan when the subscription is ${status}`, async () => {
      const { grantsPlan } = await run(status);
      assert.equal(grantsPlan, true, `${status} must grant the paid tier`);
    });
  }

  /* Every state Stripe uses for "no money has settled". `incomplete` is the
     one a declined card produces at checkout, which is how this shipped. */
  for (const status of ['incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'canceled']) {
    test(`withholds the plan when the subscription is ${status}`, async () => {
      const { grantsPlan } = await run(status);
      assert.equal(grantsPlan, false, `${status} must NOT grant a paid tier`);
    });

    /* Suspension revokes something, so it applies to a lapsed PAID tier only.
       Suspending a trial user over a card that never succeeded would take away
       a trial they are entitled to — punishing them for trying to buy. */
    test(`${status}: suspends a lapsed paid tenant`, async () => {
      const { writes } = await run(status, { currentPlan: 'starter' });
      assert.ok(
        writes.some(w => /status = 'suspended'/.test(w.sql)),
        'a paying tenant whose subscription lapsed must be suspended'
      );
    });

    test(`${status}: does NOT suspend a tenant still on the free tier`, async () => {
      const { writes } = await run(status, { currentPlan: 'trial' });
      assert.ok(
        !writes.some(w => /status = 'suspended'/.test(w.sql)),
        'a failed first payment must not lock a trial user out of their trial'
      );
    });
  }

  test('leaves pending_plan intact when payment fails, so checkout can be retried', async () => {
    const { writes } = await run('incomplete');
    assert.ok(
      !writes.some(w => /pending_plan = NULL/.test(w.sql)),
      'clearing the intent would strand the customer with no way back to checkout'
    );
  });

  test('an unmapped price never grants a plan, whatever the status', async () => {
    const { grantsPlan } = await run('active', { priceMapped: false });
    assert.equal(grantsPlan, false, 'an unrecognised price must not fall back to a paid tier');
  });
});
