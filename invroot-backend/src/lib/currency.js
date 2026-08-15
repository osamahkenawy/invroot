/**
 * Country → currency, and how to present a price in it.
 *
 * Used in two places that must agree: the public pricing shown before signup,
 * and the currency a new workspace is created with. Before this, registration
 * hardcoded USD for every tenant regardless of where they were.
 */

export const COUNTRY_CURRENCY = {
  AE:'AED', SA:'SAR', EG:'EGP', KW:'KWD', QA:'QAR', BH:'BHD', OM:'OMR', JO:'JOD',
  LB:'LBP', IQ:'IQD', YE:'YER', SY:'SYP', LY:'LYD', TN:'TND', DZ:'DZD', MA:'MAD',
  SD:'SDG', PS:'ILS', TR:'TRY', IR:'IRR', PK:'PKR', IN:'INR', BD:'BDT', LK:'LKR',
  US:'USD', CA:'CAD', GB:'GBP', AU:'AUD', NZ:'NZD', CH:'CHF', SE:'SEK', NO:'NOK',
  DK:'DKK', PL:'PLN', CZ:'CZK', HU:'HUF', RO:'RON', BG:'BGN', RU:'RUB', UA:'UAH',
  ZA:'ZAR', NG:'NGN', KE:'KES', GH:'GHS', TZ:'TZS', UG:'UGX', ET:'ETB',
  CN:'CNY', JP:'JPY', KR:'KRW', SG:'SGD', MY:'MYR', ID:'IDR', TH:'THB', PH:'PHP',
  VN:'VND', HK:'HKD', TW:'TWD',
  BR:'BRL', MX:'MXN', AR:'ARS', CL:'CLP', CO:'COP', PE:'PEN',
  // The eurozone.
  AT:'EUR', BE:'EUR', CY:'EUR', EE:'EUR', FI:'EUR', FR:'EUR', DE:'EUR', GR:'EUR',
  IE:'EUR', IT:'EUR', LV:'EUR', LT:'EUR', LU:'EUR', MT:'EUR', NL:'EUR', PT:'EUR',
  SK:'EUR', SI:'EUR', ES:'EUR', HR:'EUR',
};

/* Currencies with no minor unit — showing "JPY 1,900.00" is wrong. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'RWF', 'XOF', 'XAF', 'KMF', 'DJF', 'GNF', 'PYG', 'VUV']);

/** Currency for an ISO country code, or null when we don't know it. */
export function currencyForCountry(code) {
  if (!code) return null;
  return COUNTRY_CURRENCY[String(code).trim().toUpperCase()] || null;
}

/** Decimal places a currency is normally quoted to. */
export function decimalsFor(currency) {
  return ZERO_DECIMAL.has(String(currency || '').toUpperCase()) ? 0 : 2;
}

/**
 * Round a converted price to something that reads like a price rather than a
 * calculator result. 4,278.9312 EGP is technically the answer; 4,280 is what a
 * human expects to see, and the exact figure would be false precision anyway
 * because the customer is billed in AED, not this currency.
 */
export function tidyAmount(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n >= 1000) return Math.round(n / 10) * 10;
  if (n >= 100)  return Math.round(n);
  return Number(n.toFixed(decimalsFor(currency)));
}

/** Format for display in a given locale. */
export function formatMoney(amount, currency, locale = 'en') {
  if (amount == null) return null;
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-US', {
      style: 'currency', currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: decimalsFor(currency),
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/**
 * Country of the request, from whichever geo header the edge put there.
 * Returns null behind a plain reverse proxy or in local development — callers
 * must cope with not knowing rather than guessing wrong.
 */
export function countryFromRequest(req) {
  const header = req.headers['cf-ipcountry']            // Cloudflare
    || req.headers['x-vercel-ip-country']               // Vercel
    || req.headers['x-appengine-country']               // App Engine
    || req.headers['x-country-code'];                   // generic proxies
  const code = String(header || '').trim().toUpperCase();
  // Cloudflare sends XX for anonymised/unknown, T1 for Tor.
  if (!code || code.length !== 2 || code === 'XX' || code === 'T1') return null;
  return code;
}

/**
 * Every currency Invroot accepts — the validation side of the same list the UI
 * renders from (invroot-frontend/src/data/currencies.js).
 *
 * This module used to hold only the country→currency map, and each caller
 * validated against its own inline array. routes/company.js allowed ten codes
 * while Settings offered a hundred and forty, so most tenants outside the Gulf
 * were told "Unsupported currency." for their own money.
 *
 * Two packages, so this is a copy rather than an import;
 * scripts/currency-parity-check.mjs fails if it stops matching the frontend.
 */
export const SUPPORTED_CURRENCIES = [
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AZN','BAM','BBD','BDT','BGN',
  'BHD','BIF','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CHF','CLP',
  'CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB',
  'EUR','FJD','GBP','GEL','GHS','GMD','GNF','GTQ','GYD','HNL','HTG','HUF','IDR',
  'ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KWD',
  'KYD','KZT','LAK','LBP','LKR','LRD','LYD','MAD','MDL','MGA','MKD','MMK','MNT',
  'MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD',
  'OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF',
  'SAR','SBD','SCR','SDG','SEK','SGD','SLL','SOS','SRD','SSP','STN','SYP','SZL',
  'THB','TJS','TMT','TND','TOP','TRY','TTD','TZS','UAH','UGX','USD','UYU','UZS',
  'VES','VND','VUV','WST','XAF','XCD','XOF','YER','ZAR','ZMW',
];

export function isSupportedCurrency(code) {
  return SUPPORTED_CURRENCIES.includes(String(code || '').toUpperCase());
}
