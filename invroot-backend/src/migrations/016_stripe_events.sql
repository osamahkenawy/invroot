-- Webhook idempotency and an audit trail for billing.
--
-- Stripe retries a delivery until it gets a 2xx, and may deliver the same event
-- more than once even after success. Recording the event id lets the handler
-- recognise a replay and skip it rather than applying a plan change twice.
--
-- `app_owned` records whether the event carried our namespace. Events belonging
-- to the other product sharing this Stripe account are logged and ignored, which
-- also makes cross-wiring visible instead of silent.

CREATE TABLE IF NOT EXISTS stripe_events (
  id           VARCHAR(80)  NOT NULL PRIMARY KEY,   -- Stripe event id (evt_…)
  type         VARCHAR(80)  NOT NULL,
  app_owned    TINYINT(1)   NOT NULL DEFAULT 0,
  tenant_id    INT UNSIGNED NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'processed',  -- processed | ignored | failed
  error        VARCHAR(500) NULL,
  payload_type VARCHAR(80)  NULL,
  received_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stripe_events_tenant (tenant_id, received_at),
  INDEX idx_stripe_events_type (type, received_at)
);
