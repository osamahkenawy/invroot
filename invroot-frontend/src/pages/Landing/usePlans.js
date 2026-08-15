import { useState, useEffect } from 'react';
import api from '../../lib/api.js';

/**
 * Prices come from the same endpoint that feeds signup, which is fed by the
 * config that ENFORCES the limits. A marketing page quoting a hardcoded number
 * is how a site ends up advertising a price the product does not charge.
 *
 * Keyed on `id`, not `name` — `name` is the display label ("Starter"), and an
 * earlier version matched on it, silently found nothing, and rendered the
 * fallback price instead of the real one. That is exactly the drift this fetch
 * exists to prevent.
 */
export default function usePlans(lang) {
  const [plans, setPlans] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/public/plans?lang=${lang}`)
      .then(r => { if (alive && r.success) setPlans(r.data.plans || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [lang]);

  const starter = plans?.find(p => p.id === 'starter');
  return {
    plans,
    starter,
    price: starter?.monthly ?? null,
    currency: starter?.billed_currency ?? null,
    limits: starter?.limits ?? null,
  };
}
