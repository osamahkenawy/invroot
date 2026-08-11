-- Atomic document-number allocation.
--
-- Numbers used to be derived with SELECT MAX(...) and formatted by the caller,
-- which left a gap between read and insert: two simultaneous invoice creations
-- both read the same maximum, both built the same number, and the second lost
-- to the uq_tenant_invoice unique index with a 500. Verified reproducible at
-- 5 concurrent creates (1 succeeded, 4 failed).
--
-- next_seq holds the NEXT number to hand out and is incremented atomically in
-- the same statement that reads it, so concurrent callers can never collide.
-- Rows are seeded lazily from each tenant's existing highest number, so no
-- sequence restarts or skips backwards for tenants already invoicing.

CREATE TABLE IF NOT EXISTS doc_counters (
  tenant_id INT UNSIGNED NOT NULL,
  doc_type  VARCHAR(20)  NOT NULL,
  next_seq  INT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, doc_type)
);
