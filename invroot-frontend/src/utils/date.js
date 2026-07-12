/**
 * Format a date string as a locale-aware date.
 * @param {string|Date|null} value
 * @param {object} opts - Intl.DateTimeFormat options
 */
export function fmtDate(value, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return '—';
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'en';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-US', opts).format(d);
}

/**
 * Format as ISO date string (YYYY-MM-DD) for <input type="date">
 */
export function toInputDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * Return days between two dates (positive = future)
 */
export function daysDiff(a, b = new Date()) {
  const msPerDay = 86_400_000;
  return Math.round((new Date(a) - new Date(b)) / msPerDay);
}
