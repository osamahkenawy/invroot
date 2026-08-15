/**
 * schema.org payloads for the marketing pages.
 *
 * Kept as plain data builders, with no React and no imports beyond the route
 * table, so the prerender script can bake the same JSON-LD into the static
 * HTML that the running app injects. Search engines and the app must agree —
 * two different descriptions of the same page is the one thing structured data
 * must never do.
 */
import { SITE_URL, absUrl } from './pages.js';

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#software`;

function organization() {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'Invroot',
    url: SITE_URL,
    logo: `${SITE_URL}/logos/invroot-colored-logo-2000-2000-px.png`,
    email: 'support@invroot.com',
    parentOrganization: { '@type': 'Organization', name: 'Trasealla Solutions', url: 'https://trasealla.com' },
    // No areaServed: it previously named the UAE and the GCC, which told search
    // engines the company serves those two places and nowhere else. Omitting it
    // asserts no restriction, which is the accurate thing to say.
  };
}

function website(lang) {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID,
    url: SITE_URL,
    name: 'Invroot',
    inLanguage: lang,
    publisher: { '@id': ORG_ID },
  };
}

/**
 * `price` comes from the same /public/plans response the pricing page renders,
 * so the rich result cannot advertise a number the product does not charge.
 * When it hasn't loaded, the offer is omitted entirely rather than guessed —
 * a wrong price in a rich result is a support ticket, not a typo.
 */
function software(lang, price, currency) {
  const node = {
    '@type': 'SoftwareApplication',
    '@id': APP_ID,
    name: 'Invroot',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, iOS, Android',
    inLanguage: ['en', 'ar'],
    url: SITE_URL,
    publisher: { '@id': ORG_ID },
  };
  if (price != null && currency) {
    node.offers = [
      { '@type': 'Offer', name: 'Free trial', price: '0', priceCurrency: currency },
      { '@type': 'Offer', name: 'Starter', price: String(price), priceCurrency: currency,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: String(price), priceCurrency: currency,
          billingIncrement: 1, unitCode: 'MON',
        } },
    ];
  }
  return node;
}

function breadcrumb(lang, page, label, homeLabel) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: homeLabel, item: absUrl(lang, '') },
      { '@type': 'ListItem', position: 2, name: label, item: absUrl(lang, page.path) },
    ],
  };
}

function faqPage(items) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/**
 * @param {object} o
 * @param {string} o.key   page key from PAGES
 * @param {string} o.lang
 * @param {object} o.page  the PAGES entry
 * @param {string} o.title breadcrumb label for this page
 * @param {string} o.homeLabel
 * @param {Array}  [o.faqs]
 * @param {number} [o.price]
 * @param {string} [o.currency]
 */
export function jsonLdFor({ key, lang, page, title, homeLabel, faqs, price, currency }) {
  const graph = [organization()];

  if (key === 'home') {
    graph.push(website(lang), software(lang, price, currency));
  } else {
    graph.push(breadcrumb(lang, page, title, homeLabel));
  }
  if (key === 'pricing') graph.push(software(lang, price, currency));
  if ((key === 'faq' || key === 'invoicing-uae') && faqs?.length) graph.push(faqPage(faqs));

  return { '@context': 'https://schema.org', '@graph': graph };
}
