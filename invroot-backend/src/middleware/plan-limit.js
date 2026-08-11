/**
 * Plan allowance enforcement.
 *
 * `config.plans` has always described per-tier limits but nothing consulted
 * them, so every tenant had enterprise capacity regardless of what they paid
 * for. These guards run on the create paths that consume an allowance.
 *
 * Reads are never blocked: a tenant over their limit (after a downgrade, say)
 * keeps full access to existing records and is only stopped from adding more.
 */

import { query } from '../lib/database.js';
import { config } from '../config.js';

/** Limits for a plan name, falling back to the most restrictive tier. */
export function limitsFor(planName) {
  const key = String(planName || '').toLowerCase();
  return config.plans[key] || config.plans[config.defaultPlan];
}

const RESOURCES = {
  clients: {
    limitKey: 'maxClients',
    label: 'clients',
    singular: 'client',
    count: (tenantId) => query('SELECT COUNT(*) AS c FROM clients WHERE tenant_id = ?', [tenantId]),
  },
  invoices: {
    limitKey: 'maxInvoices',
    label: 'invoices',
    singular: 'invoice',
    /* Paid plans get a yearly volume — counting for all time would mean a
       long-lived tenant eventually could never invoice again.
       Lifetime plans (the trial) instead count every invoice number ever
       allocated, read from doc_counters. Counting live rows would let a trial
       user delete their one invoice and issue another indefinitely. */
    count: async (tenantId, { lifetime = false } = {}) => {
      if (!lifetime) {
        return query(
          'SELECT COUNT(*) AS c FROM invoices WHERE tenant_id = ? AND YEAR(created_at) = YEAR(CURDATE())',
          [tenantId]
        );
      }
      const [counter] = await query(
        "SELECT next_seq FROM doc_counters WHERE tenant_id = ? AND doc_type = 'invoice'",
        [tenantId]
      );
      if (counter) {
        // next_seq is the NEXT number to hand out, so allocations = next_seq - 1.
        return [{ c: Math.max(0, Number(counter.next_seq) - 1) }];
      }
      // No counter yet (nothing ever issued, or pre-dates the counter table).
      return query('SELECT COUNT(*) AS c FROM invoices WHERE tenant_id = ?', [tenantId]);
    },
  },
  users: {
    limitKey: 'maxUsers',
    label: 'team members',
    singular: 'team member',
    count: (tenantId) => query(
      `SELECT COUNT(*) AS c FROM users
       WHERE tenant_id = ? AND (is_super_admin = 0 OR is_super_admin IS NULL)`,
      [tenantId]
    ),
  },
};

/**
 * Current usage against allowance for one tenant — also powers the usage
 * display in settings, so a tenant can see where they stand before hitting it.
 */
export async function usageFor(tenantId, planName) {
  const limits = limitsFor(planName);
  const lifetime = Boolean(limits.lifetime);
  const out = {};
  for (const [name, def] of Object.entries(RESOURCES)) {
    const [{ c }] = await def.count(tenantId, { lifetime });
    const limit = limits[def.limitKey];
    out[name] = {
      used: Number(c),
      limit,
      lifetime,
      unlimited: limit === -1,
      remaining: limit === -1 ? null : Math.max(0, limit - Number(c)),
    };
  }
  return out;
}

/**
 * Block a create request once the tenant's allowance is spent.
 * @param {'clients'|'invoices'|'users'} resource
 */
export function enforcePlanLimit(resource) {
  const def = RESOURCES[resource];
  if (!def) throw new Error(`Unknown metered resource: ${resource}`);

  return async (req, res, next) => {
    try {
      /* A suspended workspace cannot create anything.
         `requireActiveTenant` in middleware/tenant.js was written for this and
         then applied to no route, so a tenant whose payment failed kept full
         write access. Enforcing it here rather than re-wiring every router
         puts it on the one path every metered create already goes through, so
         it cannot be forgotten on a new endpoint. Reading stays allowed: the
         customer must be able to see and export their own records. */
      const tenantStatus = req.tenant?.status;
      if (tenantStatus && !['active', 'trialing'].includes(tenantStatus)) {
        return res.status(402).json({
          success: false,
          code: 'TENANT_SUSPENDED',
          message: 'Your subscription is not active. Update your billing to continue.',
        });
      }

      const plan = req.tenant?.plan;
      const limits = limitsFor(plan);
      const limit = limits[def.limitKey];

      if (limit === -1) return next();          // unlimited tier

      const [{ c }] = await def.count(req.tenantId, { lifetime: Boolean(limits.lifetime) });
      if (Number(c) < limit) return next();

      const planName = plan || config.defaultPlan;
      const noun = limit === 1 ? def.singular : def.label;
      const scope = limits.lifetime ? '' : ' per year';
      const message = limits.lifetime && limit === 1
        ? `Your free trial includes one ${def.singular}. Subscribe to keep going.`
        : `Your ${planName} plan allows ${limit} ${noun}${scope}. Upgrade to add more.`;

      return res.status(402).json({
        success: false,
        code: 'PLAN_LIMIT',
        message,
        limit: {
          resource, used: Number(c), max: limit,
          plan: planName, lifetime: Boolean(limits.lifetime),
        },
      });
    } catch (err) {
      // A counting failure must not become an outage — log and let it through
      // rather than blocking a paying tenant on an infrastructure hiccup.
      console.error(`plan-limit check failed for ${resource}:`, err.message);
      next();
    }
  };
}
