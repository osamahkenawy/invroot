/**
 * Guard: the frontend's currency list and the backend's must be identical.
 *
 * They are separate packages, so the list is a copy rather than an import, and
 * a copy drifts. The last time these disagreed it was not cosmetic: the UI
 * offered 140 codes and the API validated against 10, so 130 of the options a
 * tenant could pick came back as "Unsupported currency." — including INR, JPY,
 * CAD, AUD, CHF, CNY, SGD and ZAR, i.e. every major currency outside the Gulf
 * bar USD, EUR and GBP.
 *
 * Also checks that no page has quietly reintroduced its own inline list, which
 * is how the six of them accumulated in the first place.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const codesIn = (src, marker) => {
  const m = src.match(new RegExp(`${marker}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!m) return null;
  return (m[1].match(/'[A-Z]{3}'/g) || []).map(s => s.replace(/'/g, ''));
};

let failed = 0;
const fail = (msg) => { console.log(`FAIL  ${msg}`); failed++; };

const front = codesIn(readFileSync(join(root, 'src/data/currencies.js'), 'utf8'), 'CURRENCIES');
const back = codesIn(
  readFileSync(join(root, '../invroot-backend/src/lib/currency.js'), 'utf8'), 'SUPPORTED_CURRENCIES');

if (!front) fail('frontend list not found');
if (!back) fail('backend list not found');

if (front && back) {
  const onlyFront = front.filter(c => !back.includes(c));
  const onlyBack = back.filter(c => !front.includes(c));
  if (onlyFront.length) fail(`offered by the UI but rejected by the API: ${onlyFront.join(', ')}`);
  if (onlyBack.length) fail(`accepted by the API but not offered: ${onlyBack.join(', ')}`);

  const sorted = [...front].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(front)) fail('frontend list is not sorted');
}

/* Any *other* inline array of currency codes is a sixth list waiting to happen. */
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'data') continue;
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(p) && files.push(p);
  }
})(join(root, 'src'));

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // Three or more quoted 3-letter codes in one array literal.
  const inline = src.match(/\[\s*'[A-Z]{3}'\s*,\s*'[A-Z]{3}'\s*,\s*'[A-Z]{3}'[^\]]*\]/g);
  if (inline) fail(`${f.replace(root + '/', '')} has its own currency list: ${inline[0].slice(0, 60)}…`);
}

if (failed) process.exit(1);
console.log(`PASS  one currency list, ${front.length} codes, frontend and backend agree`);
