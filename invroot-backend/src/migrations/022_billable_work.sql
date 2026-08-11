-- Connect tracked work to invoices.
--
-- Two modules were dead ends:
--
--   time_entries.invoice_id existed, but nothing could create an invoice FROM
--   time. The only way to fill it was to already have an invoice and mark
--   entries against it by hand — so a consultant tracked forty hours and then
--   retyped them into an invoice line by line.
--
--   expenses had no client and no billable concept at all. A rebillable cost
--   (travel, materials, a subcontractor) could be recorded but never passed on
--   to the client who incurred it. For a services business that is money
--   quietly left on the table.
--
-- These columns are what let both become invoice lines, and — just as
-- importantly — what stops them becoming invoice lines twice.

ALTER TABLE expenses
  -- Who the cost was incurred for. NULL = an internal cost, never rebillable.
  ADD COLUMN client_id  INT NULL AFTER tenant_id,
  -- Explicit rather than inferred from client_id: a cost can belong to a
  -- client for reporting yet still be absorbed rather than passed on.
  ADD COLUMN billable   TINYINT(1) NOT NULL DEFAULT 0 AFTER client_id,
  -- Set once the expense has been put on an invoice. The uniqueness of this
  -- transition is what prevents double-billing; see the conditional UPDATE in
  -- routes/invoices.js.
  ADD COLUMN invoice_id INT NULL AFTER billable,
  -- What was charged on, which may differ from `amount` once a markup is
  -- applied. Kept so the invoice can be reconciled against the original cost.
  ADD COLUMN billed_amount DECIMAL(15,2) NULL AFTER invoice_id;

-- The "what is waiting to be billed for this client" query runs on every
-- client view, so it gets an index rather than a scan.
CREATE INDEX idx_expenses_billable ON expenses (tenant_id, client_id, billable, invoice_id);
CREATE INDEX idx_time_entries_unbilled ON time_entries (tenant_id, client_id, status, invoice_id);
