-- Four columns the app writes to but no migration ever created.
--
-- Same root cause as 021a: development runs against `trasealla`, a database
-- shared with another Trasealla product, and these columns happen to exist
-- there. Nothing in this repo creates them, so on a database of its own they
-- are simply absent.
--
-- `clients.company_name` is the severe one. routes/clients.js INSERTs it on
-- every create, so on a fresh schema adding a client fails outright with
-- ER_BAD_FIELD_ERROR — the first thing anyone does after signing up, and the
-- prerequisite for issuing a single invoice. Production had this from the
-- moment it launched.
--
-- The invoices columns fail later and more quietly: po_number is written by
-- the invoice form and read by the PDF renderer, and parent_invoice_id /
-- relation_type drive the credit-note and revision links on invoice detail.
--
-- All four are additive and nullable (bar relation_type, which carries the
-- same default it has in development), so this is a no-op on any install that
-- already has them.

ALTER TABLE clients
  ADD COLUMN company_name VARCHAR(200) NULL DEFAULT NULL AFTER name;

ALTER TABLE invoices
  ADD COLUMN po_number VARCHAR(100) NULL DEFAULT NULL,
  ADD COLUMN parent_invoice_id INT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN relation_type ENUM('original','revision','correction','replacement','duplicate')
      NOT NULL DEFAULT 'original';

CREATE INDEX idx_invoices_parent ON invoices (parent_invoice_id);
