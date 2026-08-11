/**
 * Does a real tenant's logo survive the full regression suite?
 *
 * It did not. brand-asset-test.mjs ran against tenant 1 — a real workspace —
 * and uploading its own test logo triggered the replace-on-upload delete of the
 * real S3 object. Every `npm run test:all` destroyed the tenant's logo and left
 * logo_url NULL, which is why the app kept reporting "no logo set" after every
 * login however many times it was uploaded.
 *
 * The suites now use throwaway fixture tenants. This proves it stays that way:
 * it plants a marker logo on tenant 1, runs every suite, and checks that both
 * the database row AND the S3 object are still there afterwards.
 *
 * The marker is removed and logo_url restored at the end, pass or fail — a
 * test that leaves its own artefact behind as someone's brand is the very bug
 * it exists to catch.
 */

import { execSync } from 'child_process';
import { query, execute } from '../src/lib/database.js';
import { putObject, deleteObject, getObjectStream } from '../src/lib/storage.js';

const TENANT = 1;
const before = (await query('SELECT logo_url FROM tenants WHERE id = ?', [TENANT]))[0]?.logo_url ?? null;
console.log('tenant logo before:', before);

/* A 1x1 PNG. Never presented as anyone's brand — it exists for the few seconds
   the suites run and is deleted below. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64');

const stored = await putObject({
  tenantId: TENANT, kind: 'logo', buffer: PNG,
  originalName: 'survival-marker.png', contentType: 'image/png',
});
const KEY = typeof stored === 'string' ? stored : stored.key;
await execute('UPDATE tenants SET logo_url = ? WHERE id = ?', [KEY, TENANT]);
console.log('marker planted:', KEY);

const SUITES = [
  'storage-test', 'brand-asset-test', 'profile-avatar-test', 'profile-edge-test',
  'signup-pricing-test', 'email-render-test', 'refresh-token-test', 'coupon-test',
  'billable-work-test',
];

let suiteFailures = 0;
for (const s of SUITES) {
  try {
    const out = execSync(`node scripts/${s}.mjs`, { encoding: 'utf8' });
    console.log(`  ${s.padEnd(22)} ${(out.match(/^\d+ passed.*$/m) || ['ran'])[0]}`);
  } catch {
    console.log(`  ${s.padEnd(22)} ERROR`);
    suiteFailures++;
  }
}
try {
  execSync('npm test', { encoding: 'utf8' });
  console.log('  npm test               ok');
} catch { console.log('  npm test               ERROR'); suiteFailures++; }

const after = (await query('SELECT logo_url FROM tenants WHERE id = ?', [TENANT]))[0]?.logo_url ?? null;
const stillInS3 = await getObjectStream(KEY).then(() => true).catch(() => false);

console.log('\ntenant logo after: ', after);
console.log('object still there:', stillInS3);

const survived = after === KEY && stillInS3;
console.log(survived
  ? '\nPASS  a real tenant logo survives the full regression'
  : `\nFAIL  the suite destroys tenant logos — row ${after === KEY ? 'kept' : 'lost'}, object ${stillInS3 ? 'kept' : 'deleted'}`);

/* Always clean up, even on failure. */
await deleteObject(KEY).catch(() => {});
await execute('UPDATE tenants SET logo_url = ? WHERE id = ?', [before, TENANT]);
console.log('marker removed; logo_url restored to', before);

process.exit(survived && !suiteFailures ? 0 : 1);
