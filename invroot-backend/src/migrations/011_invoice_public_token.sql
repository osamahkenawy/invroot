-- Shareable public payment link per invoice. A random public_token lets a
-- client open a read-only invoice page at /pay/:token with no login.

ALTER TABLE invoices ADD COLUMN public_token CHAR(40) NULL AFTER invoice_number;
CREATE UNIQUE INDEX idx_invoices_public_token ON invoices (public_token);
