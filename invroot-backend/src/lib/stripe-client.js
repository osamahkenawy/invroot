/**
 * Stripe client, shared-account safe.
 *
 * This Stripe account is also used by another product. Two consequences shape
 * everything here:
 *
 *   1. Every object Invroot creates carries `metadata.app = <namespace>`, so it
 *      is attributable and searchable without touching the other product's data.
 *   2. The webhook only acts on events whose object carries our namespace.
 *      A misrouted or copy-pasted endpoint therefore cannot make Invroot mutate
 *      a tenant from someone else's subscription.
 *
 * The client is created lazily: the key is often absent in development, and
 * importing this module must never be what takes the server down.
 */

import Stripe from 'stripe';
import { config } from '../config.js';

let client = null;

/** True when a secret key is present — check before offering billing. */
export function isStripeConfigured() {
  return Boolean(config.stripe.secretKey);
}

/** True when inbound webhooks can be verified. */
export function isWebhookConfigured() {
  return Boolean(config.stripe.webhookSecret);
}

/**
 * The shared Stripe client.
 * @throws if called with no secret key configured — callers should guard with
 *         isStripeConfigured() and return a friendly error instead.
 */
export function stripe() {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured (STRIPE_SECRET_KEY is empty)');
  }
  if (!client) {
    client = new Stripe(config.stripe.secretKey, {
      apiVersion: config.stripe.apiVersion,
      // Shows up in Stripe's logs, so requests from this app are identifiable
      // when two products share an account.
      appInfo: { name: `Invroot (${config.stripe.appNamespace})`, version: '1.0.0' },
    });
  }
  return client;
}

/** Stamp metadata with our namespace. Use for every object we create. */
export function ownedMetadata(extra = {}) {
  return { app: config.stripe.appNamespace, ...extra };
}

/**
 * Does this Stripe object belong to Invroot?
 *
 * Objects created before the namespace existed have no `app` key. Those are
 * treated as ours only when they carry a tenant_id, which the other product
 * does not set — otherwise legacy subscriptions would stop being processed.
 */
export function isOwnedByApp(obj) {
  const app = obj?.metadata?.app;
  if (app) return app === config.stripe.appNamespace;
  return Boolean(obj?.metadata?.tenant_id);
}

/** Map a Stripe price id back to a plan name, or null when unrecognised. */
export function planForPriceId(priceId) {
  if (!priceId) return null;
  for (const [plan, id] of Object.entries(config.stripe.priceIds)) {
    if (id && id === priceId) return plan;
  }
  return null;
}

/** The plan names we can actually bill for (a price id is configured). */
export function billablePlans() {
  return Object.entries(config.stripe.priceIds)
    .filter(([, id]) => Boolean(id))
    .map(([plan]) => plan);
}
