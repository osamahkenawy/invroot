-- Remember which plan someone chose at signup WITHOUT granting it.
--
-- The signup form collects a plan and POSTs it to /auth/register, which wrote
-- it straight onto the tenant row. plan-limit.js then reads tenants.plan and
-- hands out that tier's limits. So choosing "Starter" on the signup page — a
-- paid plan — created a workspace with full Starter entitlements and no card,
-- no Stripe customer, and no subscription. The paid tier was free to anyone
-- who picked it from a dropdown.
--
-- The only code that may grant a paid plan is applySubscription() in
-- routes/stripe.js, which runs off a Stripe subscription event. Everything
-- else must go through it. But the customer's choice still matters — it is
-- what we owe them after they verify and sign in — so it is recorded here
-- instead, as an INTENT that entitles them to nothing.
--
-- Cleared when the intent is fulfilled (the webhook grants the plan) or
-- abandoned (they dismiss the prompt), so a stale value can never re-trigger
-- a checkout months later.

ALTER TABLE tenants
  ADD COLUMN pending_plan VARCHAR(50) NULL DEFAULT NULL AFTER plan;
