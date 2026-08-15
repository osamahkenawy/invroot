-- Bank details a customer can actually pay into.
--
-- Until now there was nowhere to put them, so tenants typed them into the
-- invoice Notes field as one long string:
--
--   AccountNumber: 1015977723001 Bank Name: Emirates NBD Branch Name: AL
--   MUROOR BRANCH BIC Code: EBILAEAD**** IBAN: AE730200001015977723905
--
-- which prints as a single wrapped paragraph, because to the renderer it IS a
-- single paragraph. No amount of styling fixes that; the fields have to exist
-- before they can be laid out as fields.
--
-- These go on bank_accounts rather than tenants: the tenant already registers
-- their accounts there for reconciliation, so re-entering the same account in
-- a second place would be both duplicate typing and a second thing to keep in
-- step. `show_on_invoices` marks which one customers should pay into — a
-- business may reconcile five accounts and publish exactly one, and some
-- publish none, which is why the default is 0.
--
-- Deliberately country-neutral. IBAN and SWIFT/BIC cover Europe, the Gulf and
-- most of Asia; `routing_code` is the catch-all for the systems that do not
-- use IBAN at all — a US ABA routing number, a UK sort code, an Indian IFSC,
-- an Australian BSB — labelled generically so it fits whichever one applies.
-- Every column is nullable, so a tenant fills in only what their country uses.
--
-- Additive and nullable throughout, so this is a no-op on any install that
-- already has the columns.

ALTER TABLE bank_accounts
  ADD COLUMN account_holder   VARCHAR(200) NULL DEFAULT NULL,
  ADD COLUMN iban             VARCHAR(64)  NULL DEFAULT NULL,
  ADD COLUMN swift            VARCHAR(32)  NULL DEFAULT NULL,
  ADD COLUMN branch           VARCHAR(200) NULL DEFAULT NULL,
  ADD COLUMN routing_code     VARCHAR(64)  NULL DEFAULT NULL,
  ADD COLUMN show_on_invoices TINYINT(1)   NOT NULL DEFAULT 0;

CREATE INDEX idx_bank_accounts_on_invoices ON bank_accounts (tenant_id, show_on_invoices);
