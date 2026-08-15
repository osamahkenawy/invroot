/**
 * Two invoice-layout guarantees, checked against the rendered HTML.
 *
 * 1. The footer sentence appears ONCE. It used to render twice — as a notes
 *    block above the signature area AND in the page footer — because
 *    invoice.footer_text is copied from the tenant default at creation, so
 *    both slots held the same words.
 *
 * 2. Bank details render as labelled fields, not a sentence. Tenants had been
 *    typing them into Notes, which prints as one wrapped paragraph with the
 *    IBAN buried mid-line.
 *
 * Asserts on the HTML rather than the PDF bytes: this is a layout contract, and
 * the whole point is that the *structure* is fields rather than prose.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'lib', 'pdf.js'), 'utf8');

/* Render the template without Puppeteer: swap htmlToPdf for a capture. The
   alternative is booting Chromium to produce a PDF and then parsing text back
   out of it, which tests the renderer rather than the template. */
const stubbed = src
  .replace(/export async function htmlToPdf[\s\S]*?\n}\n/, 'async function htmlToPdf(html) { return html; }\n')
  .replace(/^import .*$/gm, '');

const mod = await import('data:text/javascript;base64,' + Buffer.from(stubbed).toString('base64'));

const TENANT = {
  company_name: 'Meridian Interiors LLC',
  address: 'Office 1204, Boulevard Plaza Tower 1, Downtown Dubai',
  tax_id: '100412536700003',
  footer_text: 'Thank you for your business. Payment within 30 days.',
  currency: 'AED',
  bank: {
    bank_account_label: 'Main operating account',
    account_holder: 'Meridian Interiors LLC',
    bank_name: 'Emirates NBD',
    branch: 'Al Muroor Branch',
    account_number: '1015977723001',
    iban: 'AE730200001015977723905',
    swift: 'EBILAEAD',
    routing_code: null,
    bank_currency: 'AED',
  },
};

const INVOICE = {
  invoice_number: 'INV/08/2026/17',
  issue_date: '2026-07-31',
  due_date: '2026-08-30',
  currency: 'AED',
  subtotal: 137100, tax_amount: 6855, total_amount: 143955, discount_amount: 0,
  client_name: 'Majid Al Futtaim Ventures',
  notes: 'Works executed per approved drawings and BOQ.',
  // Copied from the tenant default at creation — the exact condition that
  // produced the duplicate.
  footer_text: 'Thank you for your business. Payment within 30 days.',
  items: [{ description: 'Porcelain floor tiling — 320 sqm', quantity: 320, unit_price: 210, tax_rate: 5, total: 67200 }],
};

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) failures++;
};

/* Count what the customer sees, not what the source says. Comments in the
   template are not rendered, and an earlier version of this test failed
   because a comment explaining the duplicate quoted the sentence it explains. */
const rendered = h => h.replace(/<!--[\s\S]*?-->/g, '');

const html = rendered(await mod.generateInvoicePdf(INVOICE, TENANT, 'en'));

console.log('Invoice footer');
const thanks = (html.match(/Thank you for your business\. Payment within 30 days\./g) || []).length;
check('the footer sentence appears exactly once', thanks === 1, `found ${thanks}`);
check('it sits in the page footer, not above the signature',
  /<div class="footer">[^<]*Thank you for your business/.test(html));

/* The invoice's own footer must still win over the tenant default — the fix
   removed a duplicate, it did not remove the per-invoice override. */
const overridden = rendered(await mod.generateInvoicePdf(
  { ...INVOICE, footer_text: 'Late payment attracts 2% monthly interest.' }, TENANT, 'en'));
check('a per-invoice footer overrides the tenant default',
  overridden.includes('Late payment attracts 2% monthly interest.')
  && !overridden.includes('Thank you for your business'));

const noFooter = rendered(await mod.generateInvoicePdf({ ...INVOICE, footer_text: null }, TENANT, 'en'));
check('falls back to the tenant footer when the invoice has none',
  (noFooter.match(/Thank you for your business/g) || []).length === 1);

console.log('\nPayment details');
check('renders a payment block', html.includes('class="pay"') && html.includes('Payment Details'));
for (const [label, value] of [
  ['Account Name', 'Meridian Interiors LLC'],
  ['Bank', 'Emirates NBD'],
  ['Branch', 'Al Muroor Branch'],
  ['Account Number', '1015977723001'],
  ['IBAN', 'AE730200001015977723905'],
  ['SWIFT / BIC', 'EBILAEAD'],
]) {
  check(`${label} is its own labelled field`,
    new RegExp(`pay-k">${label.replace(/[/]/g, '\\/')}</div>\\s*<div class="pay-v[^"]*">${value}<`).test(html));
}
check('an unset field is omitted rather than left blank',
  !html.includes('Routing / Sort Code'));
check('account currency is hidden when it matches the invoice',
  !html.includes('Account Currency'));

const fx = rendered(await mod.generateInvoicePdf(INVOICE, { ...TENANT, bank: { ...TENANT.bank, bank_currency: 'USD' } }, 'en'));
check('account currency is shown when it differs', fx.includes('Account Currency') && fx.includes('USD'));

const noBank = rendered(await mod.generateInvoicePdf(INVOICE, { ...TENANT, bank: null }, 'en'));
check('no payment block when no account is published', !noBank.includes('class="pay"'));

const empty = rendered(await mod.generateInvoicePdf(INVOICE, { ...TENANT, bank: { bank_currency: 'AED' } }, 'en'));
check('no empty block when the account has no publishable fields', !empty.includes('class="pay"'));

console.log('\nEscaping and Arabic');
const nasty = rendered(await mod.generateInvoicePdf(INVOICE,
  { ...TENANT, bank: { ...TENANT.bank, account_holder: 'A & B <script>x</script>' } }, 'en'));
check('tenant-entered values are HTML-escaped',
  nasty.includes('A &amp; B &lt;script&gt;') && !nasty.includes('<script>x</script>'));

const ar = rendered(await mod.generateInvoicePdf(INVOICE, TENANT, 'ar'));
check('Arabic labels are used', ar.includes('تفاصيل الدفع') && ar.includes('الآيبان'));
check('the IBAN stays left-to-right inside an RTL document',
  /\.pay-v\s*{[^}]*direction:\s*ltr/.test(ar));

console.log(failures ? `\nFAIL  ${failures} check(s)` : '\nPASS  all checks');
process.exit(failures ? 1 : 0);
