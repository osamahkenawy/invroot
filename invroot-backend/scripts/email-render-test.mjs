/**
 * Email shell rendering.
 *
 * The bug this guards: the header background was declared only as a CSS
 * gradient. Clients that don't support gradients (Outlook desktop, several
 * webmail viewers) rendered it white — and because the logo is white artwork
 * on transparency, it vanished. Only the gold mark showed.
 */
import { renderBrandedEmail } from '../src/lib/email.js';
import { writeFileSync, readFileSync } from 'fs';
import sharp from 'sharp';

const pass = [], fail = [];
/* Every message the fake transport receives, shared across the blocks below. */
const capturedForParity = [];
const check = (n, ok, d = '') => (ok ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

const html = renderBrandedEmail({
  heading: "Let's verify your email ✨",
  bodyHtml: '<p>Tap the button below to confirm your email.</p>',
});

/* the header must survive a client with no gradient support */
const headerTd = html.match(/<tr><td bgcolor="[^"]*"[^>]*>/)?.[0] || '';
check('header has a bgcolor attribute', /bgcolor="#?[0-9A-Fa-f]{3,8}"/.test(headerTd), headerTd.slice(0, 60));
check('header declares a solid background-color', /background-color:\s*#?[0-9A-Fa-f]{3,8}/.test(headerTd));
check('solid colour precedes the gradient',
  headerTd.indexOf('background-color:') < headerTd.indexOf('linear-gradient'),
  'a later shorthand would override the fallback');
check('the fallback is dark, so white artwork stays legible', (() => {
  const hex = headerTd.match(/bgcolor="(#[0-9A-Fa-f]{6})"/)?.[1];
  if (!hex) return false;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) < 100;
})(), headerTd.match(/bgcolor="(#[0-9A-Fa-f]{6})"/)?.[1]);

/* the logo itself */
check('logo is embedded by CID, not hotlinked',
  html.includes('src="cid:invrootlogo"'), 'a remote URL would be blocked by most clients');
check('logo has an explicit width attribute for Outlook',
  /<img[^>]*src="cid:invrootlogo"[^>]*width="\d+"/.test(html));
check('logo has alt text', /<img[^>]*src="cid:invrootlogo"[^>]*alt="[^"]+"/.test(html));

/* The header colour is a defence the client can take away — Yopmail strips
   bgcolor AND background-color, and the white wordmark disappeared onto white.
   So the artwork must carry its own dark plate: fully opaque, and dark enough
   that white strokes read on it no matter what the surrounding cell renders. */
const logoPng = readFileSync(new URL('../src/assets/email-logo-navy.png', import.meta.url));
const logo = await sharp(logoPng);
const meta = await logo.metadata();
const { data: corner } = await logo.clone().extract({ left: 0, top: 0, width: 8, height: 8 })
  .raw().toBuffer({ resolveWithObject: true });
check('logo artwork is opaque, not transparent',
  meta.channels < 4 || corner[3] === 255,
  `alpha at corner = ${meta.channels < 4 ? 'n/a (no alpha channel)' : corner[3]}`);
check('logo plate is dark, so the white wordmark reads on any header',
  (0.299 * corner[0] + 0.587 * corner[1] + 0.114 * corner[2]) < 100,
  `rgb(${corner[0]},${corner[1]},${corner[2]})`);

/* ── Subject lines name the business ──────────────────────
   Mail arrives from Invroot, not from the tenant, so a subject of just
   "Invoice #INV/08/2026/1" told the recipient nothing about who was billing
   them — and a client of two Invroot businesses saw two indistinguishable
   subjects. Intercept at the transport so nothing is actually sent. */
{
  const nodemailer = (await import('nodemailer')).default;
  // Shared with the URI-parity block below — email.js memoises its transport,
  // so only the fake installed here ever receives anything.
  const captured = capturedForParity;
  nodemailer.createTransport = () => ({ verify: async () => true, sendMail: async m => (captured.push(m), { messageId: 'test' }) });
  const { sendInvoiceEmail } = await import('../src/lib/email.js');

  const base = { to: 'c@example.test', clientName: 'Client', invoiceNumber: 'INV/08/2026/1',
                 dueDate: '2026-09-08', totalAmount: '3000.00', currency: 'AED' };
  await sendInvoiceEmail({ ...base, companyName: 'Trasealla Solutions', lang: 'en' });
  await sendInvoiceEmail({ ...base, companyName: 'تريسيلا', lang: 'ar' });
  await sendInvoiceEmail({ ...base, lang: 'en' });   // tenant with no name on file

  check('invoice subject names the billing business',
    captured[0]?.subject === 'Invoice #INV/08/2026/1 from Trasealla Solutions', captured[0]?.subject);
  check('Arabic subject names it too',
    captured[1]?.subject?.includes('تريسيلا'), captured[1]?.subject);
  check('a nameless tenant gets no dangling "from"',
    captured[2]?.subject === 'Invoice #INV/08/2026/1', captured[2]?.subject);
}

/* ── Every link in the HTML must also be in the plain text ─
   Namecheap's outbound filter rejects a multipart/alternative message whose
   two parts disagree about their URIs: "550 ... odd number of URIs ...
   JFE040009". Invoice and reminder mails carried the payment link in HTML
   only, so they bounced before reaching the customer — invisibly to the
   sender, and unpaid to everyone else. A text reader also got an invoice with
   no way to pay it. */
/* Reuses `captured` from the block above on purpose. email.js memoises its
   transporter on first use, so a second block installing its own fake would
   never receive anything — the messages keep arriving in the first array, and
   the checks below would silently loop over nothing and "pass". */
{
  const E = await import('../src/lib/email.js');
  const LINK = 'https://invroot.com/pay/tok';
  const before = capturedForParity.length;

  await E.sendInvoiceEmail({ to: 'x@e.com', clientName: 'C', companyName: 'Co', invoiceNumber: 'I1',
                             dueDate: 'd', totalAmount: '1', currency: 'AED', portalLink: LINK });
  await E.sendPaymentReminder({ to: 'x@e.com', clientName: 'C', invoiceNumber: 'I1', amount: '1',
                                currency: 'AED', dueDate: 'd', portalLink: LINK, daysOverdue: 3 });
  await E.sendVerificationEmail({ to: 'x@e.com', name: 'N', verifyLink: 'https://invroot.com/v?t=1' });
  await E.sendPasswordResetEmail({ to: 'x@e.com', name: 'N', resetLink: 'https://invroot.com/r?t=1' });

  const fresh = capturedForParity.slice(before);
  check('parity fixture actually captured messages', fresh.length === 4, `captured ${fresh.length}/4`);

  const uris = s => [...new Set(String(s || '').match(/https?:\/\/[^\s"'<>)]+/g) || [])];
  for (const m of fresh) {
    const missing = uris(m.html).filter(u => !uris(m.text).includes(u));
    check(`text part carries every HTML link — ${String(m.subject).slice(0, 32)}`,
      missing.length === 0, missing.join(' ') || 'all present');
  }
}

/* nothing else relies on a gradient alone */
const gradientsWithoutFallback = [...html.matchAll(/<t[dh]([^>]*)>/g)]
  .filter(m => m[1].includes('linear-gradient') && !/bgcolor=/.test(m[1]));
check('no table cell relies on a gradient alone',
  gradientsWithoutFallback.length === 0,
  gradientsWithoutFallback.map(m => m[1].slice(0, 50)).join(' | '));

// Emit a preview with gradients stripped — what a non-supporting client sees.
writeFileSync('/tmp/invroot-email-no-gradient.html',
  html.replace(/background:linear-gradient\([^)]*\);?/g, ''));
writeFileSync('/tmp/invroot-email-full.html', html);

for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed`);
console.log('previews: /tmp/invroot-email-full.html and /tmp/invroot-email-no-gradient.html\n');
process.exit(fail.length ? 1 : 0);
