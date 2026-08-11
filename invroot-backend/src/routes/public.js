import express from 'express';
import { query, execute } from '../lib/database.js';
import { generateInvoicePdf } from '../lib/pdf.js';
import { failure } from '../lib/api-error.js';
import { withAssetUrls } from '../lib/storage.js';
import { config } from '../config.js';
import { convert, ratesFetchedAt } from '../lib/fx.js';
import { currencyForCountry, tidyAmount, formatMoney, countryFromRequest } from '../lib/currency.js';

const router = express.Router();

// NOTE: no auth middleware — these endpoints are reachable by anyone holding
// the invoice's random public_token (the shareable payment link).

/* ══════════════════════════════════════════════════════════════════════
   Public pricing

   The signup page used to carry its own hardcoded plan list. It had drifted
   badly: it advertised "Starter — forever free, up to 10 invoices / month"
   while config.plans.starter is AED 69/month, and offered "Pro" and "Business"
   tiers that do not exist at all. Whatever the customer picked was discarded,
   so everyone silently landed on the trial with its single lifetime invoice.

   Serving the plans from the same config that ENFORCES the limits is what
   stops that happening again — the page can no longer promise something the
   product doesn't do.
   ══════════════════════════════════════════════════════════════════════ */

/* Customer-facing copy. Limits come from config so the numbers can't disagree
   with what the plan-limit middleware actually allows. */
const PLAN_COPY = {
  trial: {
    en: { name: 'Free trial',  tagline: 'Try it, no card needed',
          features: ['{invoices} to try the full flow', '{clients}',
                     'PDF invoices with your logo', 'Email support'] },
    ar: { name: 'تجربة مجانية', tagline: 'جرّبه بدون بطاقة',
          features: ['{invoices} لتجربة النظام كاملاً', '{clients}',
                     'فواتير PDF بشعارك', 'دعم عبر البريد'] },
  },
  starter: {
    en: { name: 'Starter', tagline: 'For growing businesses',
          features: ['{invoices} a year', 'Up to {clients}', 'Up to {users}',
                     'Custom branding, stamp & signature', 'Payments, receipts & reminders', 'Priority support'] },
    ar: { name: 'الأساسية', tagline: 'للشركات النامية',
          features: ['{invoices} سنوياً', 'حتى {clients}', 'حتى {users}',
                     'هويتك التجارية والختم والتوقيع', 'المدفوعات والإيصالات والتذكيرات', 'دعم ذو أولوية'] },
  },
  enterprise: {
    en: { name: 'Enterprise', tagline: 'Custom pricing',
          features: ['Unlimited invoices, clients & users', 'Onboarding and data migration',
                     'Custom integrations', 'Annual contract', 'Dedicated support'] },
    ar: { name: 'المؤسسات', tagline: 'تسعير مخصص',
          features: ['فواتير وعملاء ومستخدمون بلا حدود', 'المساعدة في الإعداد ونقل البيانات',
                     'تكاملات مخصصة', 'عقد سنوي', 'دعم مخصص'] },
  },
};

/* Order shown to a visitor. Retired tiers are deliberately absent — they exist
   in config only so old rows still resolve to sane limits. */
const PUBLIC_PLAN_IDS = ['trial', 'starter', 'enterprise'];

/* Each token expands to a COUNT AND ITS NOUN, not a bare number.
   The templates used to read "Up to {clients} clients", which was fine while
   the trial allowed five and broke the moment it allowed one — "Up to 1
   clients". Keeping the noun here means the copy still comes from the same
   config the middleware enforces, and stays grammatical at any allowance.

   Arabic counts its nouns differently from English: one takes an explicit
   واحد, three to ten take the plural, and eleven upwards return to the
   singular. Getting that wrong is the kind of thing a customer notices
   immediately. */
const COUNTED = {
  en: {
    invoices: n => `${n} ${n === 1 ? 'invoice' : 'invoices'}`,
    clients:  n => `${n} ${n === 1 ? 'client' : 'clients'}`,
    users:    n => `${n} ${n === 1 ? 'team member' : 'team members'}`,
  },
  ar: {
    invoices: n => (n === 1 ? 'فاتورة واحدة' : n >= 3 && n <= 10 ? `${n} فواتير` : `${n} فاتورة`),
    clients:  n => (n === 1 ? 'عميل واحد' : n >= 3 && n <= 10 ? `${n} عملاء` : `${n} عميل`),
    users:    n => (n === 1 ? 'عضو فريق واحد' : n >= 3 && n <= 10 ? `${n} أعضاء فريق` : `${n} عضو فريق`),
  },
};

const UNLIMITED = {
  en: {invoices: 'Unlimited invoices', clients: 'Unlimited clients', users: 'Unlimited team members'},
  ar: {invoices: 'فواتير بلا حدود', clients: 'عملاء بلا حدود', users: 'أعضاء فريق بلا حدود'},
};

const fillLimits = (text, limits, lang = 'en') => {
  const counted = COUNTED[lang] || COUNTED.en;
  const unlimited = UNLIMITED[lang] || UNLIMITED.en;
  const say = (key, value) =>
    (value === -1 ? unlimited[key] : counted[key](Number(value)));
  return text
    .replace('{invoices}', say('invoices', limits.maxInvoices))
    .replace('{clients}', say('clients', limits.maxClients))
    .replace('{users}', say('users', limits.maxUsers));
};

/* ── GET /api/public/plans ──────────────────────────── */
/* ?country=AE&lang=ar — country may also arrive from an edge geo header. */
router.get('/plans', async (req, res) => {
  try {
    const lang = req.query.lang === 'ar' ? 'ar' : 'en';
    const country = String(req.query.country || '').toUpperCase() || countryFromRequest(req);
    const localCurrency = currencyForCountry(country);

    const plans = [];
    for (const id of PUBLIC_PLAN_IDS) {
      const limits = config.plans[id];
      if (!limits) continue;
      const copy = PLAN_COPY[id]?.[lang] || PLAN_COPY[id]?.en || { name: id, tagline: '', features: [] };

      const billedCurrency = limits.currency || 'AED';
      const monthly = limits.salesLed ? null : (limits.monthly ?? 0);

      /* Indicative local price. Only ever a hint: the charge happens in
         `billed_currency`, which the UI states next to it. */
      let local = null;
      if (monthly > 0 && localCurrency && localCurrency !== billedCurrency) {
        const converted = await convert(monthly, billedCurrency, localCurrency);
        if (converted != null) {
          const amount = tidyAmount(converted, localCurrency);
          local = {
            currency: localCurrency,
            amount,
            display: formatMoney(amount, localCurrency, lang),
            approximate: true,
            rates_updated_at: ratesFetchedAt(),
          };
        }
      }

      plans.push({
        id,
        name: copy.name,
        tagline: copy.tagline,
        features: copy.features.map(f => fillLimits(f, limits, lang)),
        // Limits, straight from what the server enforces.
        limits: { invoices: limits.maxInvoices, clients: limits.maxClients, users: limits.maxUsers },
        free: monthly === 0,
        sales_led: !!limits.salesLed,
        lifetime_limit: !!limits.lifetime,
        monthly,
        billed_currency: billedCurrency,
        display: monthly === 0
          ? (lang === 'ar' ? 'مجاناً' : 'Free')
          : (limits.salesLed ? (lang === 'ar' ? 'حسب الطلب' : 'Custom') : formatMoney(monthly, billedCurrency, lang)),
        local,
        recommended: id === 'starter',
        contact: limits.salesLed ? config.sales.inboxes[0] : null,
      });
    }

    res.json({
      success: true,
      data: {
        country: country || null,
        local_currency: localCurrency || null,
        // The signup form must send one of these back; anything else is refused.
        selectable: PUBLIC_PLAN_IDS,
        plans,
      },
    });
  } catch (err) { failure(res, err, { context: 'public' }); }
});

async function loadByToken(token) {
  const [inv] = await query(
    `SELECT i.id, i.tenant_id, i.invoice_number, i.issue_date, i.due_date, i.currency,
            i.line_items, i.subtotal, i.tax_amount, i.discount_amount, i.total_amount,
            i.paid_amount, i.status, i.notes,
            /* The tenant picks a language per invoice. The payment page must
               follow THAT, not the visitor's browser — an Arabic invoice sent
               to an Arabic client should not land in English. */
            i.lang,
            c.name AS client_name, c.email AS client_email,
            t.company_name, t.logo_url, t.address, t.tax_id, t.footer_text,
            t.primary_color, t.accent_color
     FROM invoices i
     JOIN clients c ON i.client_id = c.id
     JOIN tenants t ON i.tenant_id = t.id
     WHERE i.public_token = ?`,
    [token]
  );
  // Resolve the logo before it reaches an unauthenticated page.
  return withAssetUrls(inv);
}

/* ── GET /api/public/invoices/:token ─────────────────── */
router.get('/invoices/:token', async (req, res) => {
  try {
    const inv = await loadByToken(req.params.token);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // Passive read receipt: a 'sent' invoice becomes 'viewed' once opened.
    if (inv.status === 'sent') {
      execute("UPDATE invoices SET status = 'viewed' WHERE id = ?", [inv.id]).catch(() => {});
      inv.status = 'viewed';
    }

    const balance_due = Number(inv.total_amount) - Number(inv.paid_amount);
    const { tenant_id, id, ...safe } = inv; // don't leak internal ids
    res.json({ success: true, data: { ...safe, balance_due, pdf_url: `/api/public/invoices/${req.params.token}/pdf` } });
  } catch (err) {
    failure(res, err, { context: 'public' });
  }
});

/* ── GET /api/public/invoices/:token/pdf ─────────────── */
router.get('/invoices/:token/pdf', async (req, res) => {
  try {
    const inv = await loadByToken(req.params.token);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const [tenant] = await query(
      `SELECT company_name, logo_url, address, tax_id, footer_text, invoice_terms,
              stamp_url, currency, lang, primary_color, accent_color, invoice_template
       FROM tenants WHERE id = ?`,
      [inv.tenant_id]
    );
    const pdfBuffer = await generateInvoicePdf(inv, await withAssetUrls(tenant || {}), inv.lang || 'en');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${inv.invoice_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    failure(res, err, { context: 'public' });
  }
});

export default router;
