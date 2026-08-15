/**
 * Guard: every handler the Stripe webhook dispatches to must actually exist.
 *
 * `recordRedemption` was called from the `checkout.session.completed` branch
 * and was never defined anywhere. Nothing caught it, because the failure only
 * appears when a real customer completes a real checkout — at which point
 * Stripe gets a 500 and starts retrying. It sat in production undetected until
 * someone read the error log.
 *
 * Two checks, both cheap:
 *   1. Static — every identifier called inside the event switch resolves to a
 *      local function or an import. This is the one that would have caught it.
 *   2. Behavioural — recordRedemption does the right thing with a real-shaped
 *      session, including the cases that decide whether money is over-counted.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'routes', 'stripe.js'), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failures++;
};

console.log('Webhook dispatch');

/* Everything the switch calls, e.g. `outcome = await recordRedemption(obj)`. */
const switchBlock = src.slice(src.indexOf('switch (event.type)'));
const called = [...new Set(
  [...switchBlock.matchAll(/await\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1])
)].filter(n => !['query', 'execute', 'stripe', 'Promise'].includes(n));

const defined = new Set([
  ...[...src.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
  ...[...src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)].map(m => m[1]),
  ...[...src.matchAll(/import\s*\{([^}]+)\}/g)]
      .flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop())),
  ...[...src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)].map(m => m[1]),
]);

const missing = called.filter(n => !defined.has(n));
check(`every handler called by the switch is defined (${called.length} checked)`,
  missing.length === 0, missing.length ? `undefined: ${missing.join(', ')}` : '');

console.log('\nrecordRedemption');

/* Stub the database so this stays a unit test — the point is the logic, and a
   test that needs a live MySQL is a test nobody runs. */
const calls = [];
let couponRow = { id: 7 };
let existingRedemption = null;

const dbStub = `
export const query = async (sql, params) => {
  globalThis.__calls.push({ sql, params });
  if (/FROM invroot_coupons WHERE code/.test(sql)) return globalThis.__couponRow ? [globalThis.__couponRow] : [];
  if (/FROM invroot_coupon_redemptions WHERE stripe_session_id/.test(sql)) {
    return globalThis.__existing ? [globalThis.__existing] : [];
  }
  return [];
};
export const execute = async (sql, params) => { globalThis.__calls.push({ sql, params }); return {}; };
`;

const couponsSrc = readFileSync(join(here, '..', 'src', 'lib', 'coupons.js'), 'utf8')
  .replace(/^import \{ query, execute \} from '\.\/database\.js';$/m,
    `const { query, execute } = await import('data:text/javascript;base64,${Buffer.from(dbStub).toString('base64')}');`)
  .replace(/^import .*stripe-client\.js';$/m, 'const stripe = () => { throw new Error("not used"); };\nconst ownedMetadata = x => x;\nconst isOwnedByApp = () => true;')
  .replace(/^import .*config\.js';$/m, 'const config = { stripe: { appNamespace: "invroot" } };');

globalThis.__calls = calls;
globalThis.__couponRow = couponRow;
globalThis.__existing = existingRedemption;

const { recordRedemption } = await import(
  'data:text/javascript;base64,' + Buffer.from(couponsSrc).toString('base64'));

const session = (over = {}) => ({
  id: 'cs_test_1',
  currency: 'aed',
  subscription: 'sub_123',
  client_reference_id: '42',
  metadata: { tenant_id: '42', plan: 'starter', coupon: 'ALAYAY' },
  total_details: { amount_discount: 6900 },   // minor units: AED 69.00
  ...over,
});

const reset = () => { calls.length = 0; globalThis.__couponRow = { id: 7 }; globalThis.__existing = null; };

reset();
let r = await recordRedemption(session());
const insert = calls.find(c => /INSERT INTO invroot_coupon_redemptions/.test(c.sql));
check('inserts a redemption row', !!insert);
check('converts minor units to major (6900 → 69)', insert?.params[6] === 69,
  `got ${insert?.params[6]}`);
check('stores the currency upper-cased', insert?.params[7] === 'AED', `got ${insert?.params[7]}`);
check('stores tenant, code, session and subscription',
  insert?.params[2] === '42' && insert?.params[1] === 'ALAYAY'
  && insert?.params[4] === 'cs_test_1' && insert?.params[3] === 'sub_123');
check('increments times_redeemed',
  calls.some(c => /UPDATE invroot_coupons SET times_redeemed = times_redeemed \+ 1/.test(c.sql)));
check('returns the tenant in its outcome', r.tenantId === '42', JSON.stringify(r));

reset();
r = await recordRedemption(session({ metadata: { tenant_id: '42', plan: 'starter' } }));
check('a checkout with no coupon is not an error',
  r.note === 'no coupon on session'
  && !calls.some(c => /INSERT/.test(c.sql)), JSON.stringify(r));

reset();
globalThis.__existing = { id: 1 };
r = await recordRedemption(session());
check('a Stripe retry does not double-count',
  /already recorded/.test(r.note) && !calls.some(c => /INSERT/.test(c.sql)), JSON.stringify(r));

reset();
globalThis.__couponRow = null;
r = await recordRedemption(session());
check('a code missing from the mirror is reported, not thrown',
  /not in mirror/.test(r.note) && !calls.some(c => /INSERT/.test(c.sql)), JSON.stringify(r));

reset();
r = await recordRedemption(session({ metadata: { coupon: 'ALAYAY' }, client_reference_id: null }));
check('a coupon with no tenant is reported, not thrown',
  /no tenant_id/.test(r.note) && !calls.some(c => /INSERT/.test(c.sql)), JSON.stringify(r));

reset();
r = await recordRedemption(session({ subscription: { id: 'sub_obj' } }));
check('accepts an expanded subscription object as well as an id',
  calls.find(c => /INSERT/.test(c.sql))?.params[3] === 'sub_obj');

console.log(failures ? `\nFAIL  ${failures} check(s)` : '\nPASS  all checks');
process.exit(failures ? 1 : 0);
