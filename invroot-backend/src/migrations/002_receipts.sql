-- ── Receipts ──────────────────────────────────────────
-- A receipt is proof that a payment was received. One receipt per payment.
CREATE TABLE IF NOT EXISTS receipts (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id      INT UNSIGNED NOT NULL,
  payment_id     INT UNSIGNED NOT NULL,
  invoice_id     INT UNSIGNED NOT NULL,
  client_id      INT UNSIGNED,
  receipt_number VARCHAR(100) NOT NULL,
  amount         DECIMAL(15,4) NOT NULL,
  method         ENUM('cash','bank_transfer','card','check','stripe','paypal','other') NOT NULL,
  currency       VARCHAR(10) DEFAULT 'SAR',
  issued_date    DATE,
  notes          TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_receipt (tenant_id, receipt_number),
  KEY idx_receipt_payment (payment_id),
  KEY idx_receipt_invoice (invoice_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Receipt numbering config (reuses invoice_numbering row per tenant)
ALTER TABLE invoice_numbering ADD COLUMN receipt_prefix VARCHAR(20) DEFAULT 'RCP-';
ALTER TABLE invoice_numbering ADD COLUMN receipt_start INT DEFAULT 1;
