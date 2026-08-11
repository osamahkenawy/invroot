-- ── Credit notes: repair the status ENUM and add missing audit columns ──
--
-- The void route has always written status = 'voided', but the column was
-- declared ENUM('issued','applied','refunded'). Under STRICT_TRANS_TABLES that
-- write raises a data-truncation error, so voiding a credit note has never
-- worked. Add the missing member (and 'draft' so notes can be prepared before
-- they are issued).
ALTER TABLE credit_notes
  MODIFY COLUMN status ENUM('draft','issued','applied','voided','refunded')
  NOT NULL DEFAULT 'issued';

-- A credit note is settled in the invoice's currency; store it so the document
-- and the list never have to guess from the tenant default.
ALTER TABLE credit_notes ADD COLUMN currency VARCHAR(10) NULL AFTER amount;

-- When the note was applied to / voided from the invoice, for the audit trail.
ALTER TABLE credit_notes ADD COLUMN applied_at DATETIME NULL;
ALTER TABLE credit_notes ADD COLUMN voided_at  DATETIME NULL;
ALTER TABLE credit_notes
  ADD COLUMN updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Backfill currency from the linked invoice for existing rows.
UPDATE credit_notes cn
  JOIN invoices i ON i.id = cn.invoice_id
  SET cn.currency = i.currency
  WHERE cn.currency IS NULL;

-- The list and summary always filter by tenant, and lookups by invoice are hot
-- (every recalc sums a specific invoice's applied notes).
CREATE INDEX idx_cn_tenant_status ON credit_notes (tenant_id, status);
CREATE INDEX idx_cn_invoice       ON credit_notes (invoice_id);
