-- Subscription coupon codes.
--
-- The discount itself lives in STRIPE, not here. Stripe is what charges the
-- card, so it has to be the thing that decides the amount — a local discount
-- table would let the UI promise "AED 34.50" while Stripe took AED 69, which is
-- exactly the kind of mismatch that already bit this codebase once with plans.
--
-- What lives here is everything Stripe has no opinion about:
--   * which of OUR plans a code may be used on
--   * a listing for the admin portal that doesn't need a Stripe round trip
--   * who redeemed what, and when, for support and reporting
--
-- `stripe_promotion_code_id` is the join back to the real thing. If a code is
-- archived in Stripe it stops working immediately regardless of this table,
-- because validation always asks Stripe before saying yes.

CREATE TABLE IF NOT EXISTS invroot_coupons (
  id                        INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  -- What the customer types. Stored uppercase; lookups uppercase too, so
  -- "welcome50" and "WELCOME50" are the same code.
  code                      VARCHAR(60)  NOT NULL,
  stripe_coupon_id          VARCHAR(120) NOT NULL,
  stripe_promotion_code_id  VARCHAR(120) NOT NULL,

  -- Mirrored for display. Stripe stays authoritative; these are a cache so the
  -- admin list doesn't need an API call per row.
  discount_type             ENUM('percent','amount') NOT NULL,
  percent_off               DECIMAL(5,2) NULL,
  amount_off                DECIMAL(12,2) NULL,
  currency                  VARCHAR(10)  NULL,
  duration                  ENUM('once','repeating','forever') NOT NULL DEFAULT 'once',
  duration_in_months        INT NULL,

  -- Scoping Stripe cannot express, because it doesn't know our plan names.
  -- NULL means "any purchasable plan".
  applies_to_plans          VARCHAR(255) NULL,

  max_redemptions           INT NULL,
  times_redeemed            INT NOT NULL DEFAULT 0,
  expires_at                DATETIME NULL,
  active                    TINYINT(1) NOT NULL DEFAULT 1,

  note                      VARCHAR(255) NULL,
  created_by                INT UNSIGNED NULL,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at               DATETIME NULL,

  UNIQUE KEY uq_invroot_coupons_code (code),
  UNIQUE KEY uq_invroot_coupons_promo (stripe_promotion_code_id),
  INDEX idx_invroot_coupons_active (active, expires_at)
);

-- One row per successful redemption, written from the Stripe webhook rather
-- than at checkout — a session that is created but never paid must not count.
CREATE TABLE IF NOT EXISTS invroot_coupon_redemptions (
  id                     BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  coupon_id              INT NOT NULL,
  code                   VARCHAR(60) NOT NULL,
  tenant_id              INT UNSIGNED NOT NULL,
  stripe_subscription_id VARCHAR(120) NULL,
  stripe_session_id      VARCHAR(120) NULL,
  plan                   VARCHAR(40)  NULL,
  -- What the discount was actually worth, as Stripe reported it.
  discount_amount        DECIMAL(12,2) NULL,
  currency               VARCHAR(10)  NULL,
  redeemed_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  /* Stripe retries webhooks, and a tenant may resubscribe later. This makes a
     replayed event a no-op instead of double-counting a redemption. */
  UNIQUE KEY uq_redemption_once (coupon_id, tenant_id, stripe_subscription_id),
  INDEX idx_redemption_tenant (tenant_id),
  INDEX idx_redemption_coupon (coupon_id)
);
