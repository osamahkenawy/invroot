-- One Stripe customer per tenant, reused across checkouts.
--
-- Without this the checkout flow created a fresh customer every time an owner
-- started an upgrade, leaving unreconcilable duplicates — especially confusing
-- on an account shared with another product.

ALTER TABLE tenants ADD COLUMN stripe_customer_id VARCHAR(80) NULL AFTER subscription_id;
CREATE INDEX idx_tenants_stripe_customer ON tenants (stripe_customer_id);
