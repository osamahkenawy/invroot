/**
 * Format a number as currency.
 * @param {number|string|null} amount
 * @param {string} currency - ISO 4217 currency code, e.g. 'SAR'
 * @param {string} locale   - BCP 47 locale, defaults to document lang
 */
export function fmtCurrency(amount, currency = 'SAR', locale) {
  const num = parseFloat(amount);
  if (isNaN(num)) return '—';
  const lang = locale || (typeof document !== 'undefined' ? document.documentElement.lang : 'en');

  /* A default parameter only applies to `undefined`, so an explicit null — which
     is what a client row carries when it inherits the tenant's currency — sailed
     through to Intl and threw "Invalid currency code". A formatting helper must
     never be able to take a page down: every caller passes it a value straight
     from the database, and one null anywhere crashed the whole render. */
  const code = String(currency || '').trim().toUpperCase();
  const safe = /^[A-Z]{3}$/.test(code) ? code : 'SAR';

  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US', {
      style: 'currency',
      currency: safe,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    // A code that is well-formed but unknown to this runtime still formats.
    return `${safe} ${num.toFixed(2)}`;
  }
}
