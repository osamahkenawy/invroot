-- Tracks whether a tenant has dismissed the getting-started checklist. Stored on
-- the tenant (not localStorage) so the choice follows the account across devices
-- and teammates.

ALTER TABLE tenants ADD COLUMN onboarding_dismissed_at DATETIME NULL AFTER status;
