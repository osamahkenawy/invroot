/**
 * Signup pricing and plan selection.
 *
 * The bug this guards against: the page advertised plans the product does not
 * have, and the handler threw the choice away. Someone picking "Starter —
 * forever free, 10 invoices / month" got a trial with one invoice, ever.
 */
import { query, execute } from '../src/lib/database.js';
import { config } from '../src/config.js';

const BASE = 'http://127.0.0.1:5000';
const pass = [], fail = [];
const check = (n, ok, d = '') => (ok ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);
const created = [];

const plansFor = (country, lang = 'en') =>
  fetch(`${BASE}/api/public/plans?country=${country}&lang=${lang}`).then(r => r.json());

/* ── the advertised plans must be the enforced plans ── */
{
  const { data } = await plansFor('AE');
  const ids = data.plans.map(p => p.id);
  check('only real plans are offered', ids.every(id => id in config.plans), ids.join(', '));
  check('retired tiers are not offered', !ids.some(id => config.plans[id].retired), ids.join(', '));
  check('no invented tiers', !ids.includes('pro') && !ids.includes('business'), ids.join(', '));

  const starter = data.plans.find(p => p.id === 'starter');
  check('Starter is priced, not "free forever"',
    starter.free === false && starter.monthly === config.plans.starter.monthly,
    `${starter.display} (config says ${config.plans.starter.monthly})`);
  check('Starter limits match what the server enforces',
    starter.limits.invoices === config.plans.starter.maxInvoices,
    `${starter.limits.invoices} vs ${config.plans.starter.maxInvoices}`);

  const trial = data.plans.find(p => p.id === 'trial');
  check('Trial states its real single-invoice limit',
    trial.limits.invoices === config.plans.trial.maxInvoices && trial.lifetime_limit === true,
    `${trial.limits.invoices} invoice, lifetime=${trial.lifetime_limit}`);

  const ent = data.plans.find(p => p.id === 'enterprise');
  check('Enterprise is sales-led with a contact address', ent.sales_led && !!ent.contact, ent.contact);
}

/* ── currency by country ───────────────────────────── */
{
  const cases = [['AE','AED'], ['EG','EGP'], ['SA','SAR'], ['KW','KWD'], ['GB','GBP'], ['US','USD']];
  for (const [country, cur] of cases) {
    const { data } = await plansFor(country);
    check(`${country} → ${cur}`, data.local_currency === cur, data.local_currency);
    const starter = data.plans.find(p => p.id === 'starter');
    if (cur === starter.billed_currency) {
      check(`${country}: no pointless self-conversion`, starter.local === null, JSON.stringify(starter.local));
    } else {
      check(`${country}: shows an indicative local price`,
        starter.local?.currency === cur && starter.local?.approximate === true, starter.local?.display);
      check(`${country}: still states the billed currency`, starter.billed_currency === 'AED', starter.billed_currency);
    }
  }
  const { data: unknown } = await plansFor('ZZ');
  check('unknown country invents nothing', unknown.local_currency === null &&
    unknown.plans.every(p => p.local === null));
}

/* ── Arabic ────────────────────────────────────────── */
{
  const { data } = await plansFor('EG', 'ar');
  const hasArabic = (str) => /[؀-ۿ]/.test(str);
  for (const p of data.plans) {
    check(`plan "${p.id}" name is Arabic`, hasArabic(p.name), p.name);
    check(`plan "${p.id}" features are Arabic`, p.features.every(hasArabic), p.features[0]);
  }
  const en = (await plansFor('EG', 'en')).data;
  check('English stays English', en.plans.every(p => !hasArabic(p.name)), en.plans.map(p => p.name).join(', '));
}

/* ── registration honours the choice ───────────────── */
const register = async (body) => {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
};
const tenantOf = async (email) => (await query(
  'SELECT t.id, t.plan, t.pending_plan, t.currency, t.country FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.email = ?', [email]))[0];

{
  /* Choosing a PAID plan on the signup form must not grant it.
     This assertion was previously the exact opposite — it required
     tenants.plan to become 'starter' — which is how signup came to hand out a
     paid tier to anyone who picked it: no card, no Stripe customer, no
     subscription, but full Starter limits from plan-limit.js. The choice is
     honoured as an intent (pending_plan) and the entitlement only arrives via
     applySubscription() when Stripe says the money did. */
  const email = `pricing-starter-${Date.now()}@yopmail.com`;
  const r = await register({ business_name: 'Pricing Starter Co', email, password: 'Testing12345', plan: 'starter', country: 'AE' });
  check('register accepts a valid plan', r.status === 201 || r.json.success, `status=${r.status}`);
  const t = await tenantOf(email); created.push(t?.id);
  check('a paid plan is NOT granted at signup', t?.plan === config.defaultPlan, `plan=${t?.plan}`);
  check('the paid choice is recorded as a pending checkout', t?.pending_plan === 'starter', `pending_plan=${t?.pending_plan}`);
  check('register reports the outstanding plan to the client',
    r.json?.data?.pending_plan === 'starter', `data.pending_plan=${r.json?.data?.pending_plan}`);
  check('AE workspace is created in AED', t?.currency === 'AED', `currency=${t?.currency}`);
  check('country is recorded', t?.country === 'AE', `country=${t?.country}`);
}
{
  const email = `pricing-eg-${Date.now()}@yopmail.com`;
  await register({ business_name: 'Pricing Egypt Co', email, password: 'Testing12345', plan: 'trial', country: 'EG' });
  const t = await tenantOf(email); created.push(t?.id);
  check('EG workspace is created in EGP', t?.currency === 'EGP', `currency=${t?.currency}`);
  check('trial is stored as trial', t?.plan === 'trial', `plan=${t?.plan}`);
  check('the trial owes nothing, so no checkout is pending', t?.pending_plan === null, `pending_plan=${t?.pending_plan}`);
}
{
  // A tier that doesn't exist must not grant anything.
  const email = `pricing-bogus-${Date.now()}@yopmail.com`;
  await register({ business_name: 'Pricing Bogus Co', email, password: 'Testing12345', plan: 'business', country: 'AE' });
  const t = await tenantOf(email); created.push(t?.id);
  check('an unknown plan falls back to the trial, not a paid tier',
    t?.plan === config.defaultPlan, `plan=${t?.plan}`);
}
{
  // Nobody self-serves onto the sales-led tier.
  const email = `pricing-ent-${Date.now()}@yopmail.com`;
  await register({ business_name: 'Pricing Ent Co', email, password: 'Testing12345', plan: 'enterprise', country: 'AE' });
  const t = await tenantOf(email); created.push(t?.id);
  check('enterprise cannot be self-selected at signup', t?.plan === config.defaultPlan, `plan=${t?.plan}`);
  /* Enterprise is sold by a human. Queuing a self-serve checkout for it would
     send the customer to a Stripe price that does not exist. */
  check('enterprise queues no self-serve checkout', t?.pending_plan === null, `pending_plan=${t?.pending_plan}`);
}
{
  // A retired tier must not be resurrected through the API.
  const email = `pricing-retired-${Date.now()}@yopmail.com`;
  await register({ business_name: 'Pricing Retired Co', email, password: 'Testing12345', plan: 'growth', country: 'AE' });
  const t = await tenantOf(email); created.push(t?.id);
  check('a retired tier is refused', t?.plan === config.defaultPlan, `plan=${t?.plan}`);
}
{
  const email = `pricing-nocountry-${Date.now()}@yopmail.com`;
  await register({ business_name: 'Pricing NoCountry Co', email, password: 'Testing12345', plan: 'trial' });
  const t = await tenantOf(email); created.push(t?.id);
  check('no country still yields a sane currency', !!t?.currency, `currency=${t?.currency}`);
}

/* clean up the accounts this run created */
for (const id of created.filter(Boolean)) {
  await execute('DELETE FROM users WHERE tenant_id = ?', [id]);
  await execute('DELETE FROM tenants WHERE id = ?', [id]);
}

for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
