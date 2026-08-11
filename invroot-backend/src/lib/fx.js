/**
 * Exchange rates for *displaying* prices in a visitor's local currency.
 *
 * This is presentation only. Subscriptions are charged by Stripe in the plan's
 * own currency (AED), so the local figure is an estimate shown to help someone
 * judge the cost — never the amount taken. Every response says so, and the UI
 * repeats it next to the price. Quoting a converted number as if it were the
 * charge would be a misrepresentation, and the customer's card issuer would
 * apply its own rate anyway.
 *
 * Because of that, the failure mode is deliberate: if rates can't be fetched we
 * return null and the caller shows the real AED price alone. A stale rate that
 * silently drifts is worse than no conversion at all.
 */

import { config } from '../config.js';

const TTL_MS = 12 * 60 * 60 * 1000;   // rates move slowly; twice a day is plenty
const TIMEOUT_MS = 3000;              // pricing must never hang on a third party

let cache = { base: null, rates: null, fetchedAt: 0 };
let inflight = null;

/** True when conversion is switched off entirely. */
export function isDisabled() {
  return String(process.env.FX_ENABLED || 'true').toLowerCase() === 'false';
}

async function fetchRates(base) {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`rate provider returned ${res.status}`);
    const body = await res.json();
    if (body?.result !== 'success' || !body?.rates) throw new Error('unexpected rate payload');
    return body.rates;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rates keyed by currency code, relative to `base`. Null when unavailable.
 * Concurrent callers share one request rather than each firing their own.
 */
export async function getRates(base = 'AED') {
  if (isDisabled()) return null;

  const fresh = cache.rates && cache.base === base && (Date.now() - cache.fetchedAt) < TTL_MS;
  if (fresh) return cache.rates;

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const rates = await fetchRates(base);
      cache = { base, rates, fetchedAt: Date.now() };
      return rates;
    } catch (err) {
      console.warn(`[fx] could not refresh rates (${err.message}) — prices will show in ${base} only`);
      /* Serve a stale cache rather than nothing: an hours-old rate is still a
         reasonable estimate, and it is labelled as an estimate. But never
         invent one, and never let a stale cache live forever. */
      const stale = cache.rates && cache.base === base && (Date.now() - cache.fetchedAt) < 7 * 24 * 60 * 60 * 1000;
      return stale ? cache.rates : null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Convert an amount between currencies for display.
 * Returns null when the rate isn't known — the caller must then show the
 * original price rather than a guess.
 */
export async function convert(amount, from, to) {
  if (!amount || !from || !to) return null;
  if (String(from).toUpperCase() === String(to).toUpperCase()) return Number(amount);

  const rates = await getRates(String(from).toUpperCase());
  const rate = rates?.[String(to).toUpperCase()];
  if (!rate || !Number.isFinite(rate)) return null;
  return Number(amount) * rate;
}

/** When the cached rates were last refreshed, for surfacing in the API. */
export function ratesFetchedAt() {
  return cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null;
}
