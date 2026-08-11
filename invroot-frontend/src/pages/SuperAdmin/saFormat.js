/**
 * Shared formatters for the platform admin portal.
 *
 * Amounts are labelled with the currency they were billed in. Tenants bill in
 * different currencies, so the portal never renders a bare '$' — that made AED
 * figures read as dollars.
 */
export function fmtAmt(n, currency = '', decimals = 0) {
  const v = Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return currency ? `${currency} ${v}` : v;
}

export function fmtN(n) {
  return Number(n || 0).toLocaleString();
}

/** '2026-07' → 'Jul' */
export function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = String(ym).split('-');
  if (!m) return String(ym).slice(0, 3);
  const d = new Date(Number(y), Number(m) - 1, 1);
  return isNaN(d) ? ym : d.toLocaleDateString('en-US', { month: 'short' });
}
