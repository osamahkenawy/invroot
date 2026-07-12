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
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}
