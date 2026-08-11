-- Migration 006: Give INVROOT its own quotes + audit_logs tables.
--
-- WHY: this MySQL database is shared with another Trasealla product (a CRM),
-- which already owned tables named `quotes`, `quote_items` and `audit_logs`.
-- INVROOT's 001_init.sql used CREATE TABLE IF NOT EXISTS, so those creates
-- silently no-op'd and INVROOT's code has been querying the CRM's tables ever
-- since — tables with no tenant_id, no client_id and no line_items column.
-- Result: the entire Quotes module failed with
--   "Unknown column 'tenant_id' in 'where clause'"
-- and every logAudit() write across the whole app failed silently.
--
-- These are NEW, additive tables. Nothing belonging to the CRM is modified,
-- renamed or dropped.

CREATE TABLE IF NOT EXISTS invroot_quotes (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id             INT UNSIGNED NOT NULL,
  client_id             INT UNSIGNED NOT NULL,
  quote_number          VARCHAR(100) NOT NULL,
  status                ENUM('draft','sent','viewed','accepted','rejected','expired','converted') DEFAULT 'draft',
  valid_until           DATE,
  currency              VARCHAR(10) DEFAULT 'SAR',
  line_items            JSON,
  subtotal              DECIMAL(15,4) DEFAULT 0,
  discount_type         ENUM('percent','fixed'),
  discount_value        DECIMAL(10,4) DEFAULT 0,
  discount_amount       DECIMAL(15,4) DEFAULT 0,
  tax_amount            DECIMAL(15,4) DEFAULT 0,
  total_amount          DECIMAL(15,4) DEFAULT 0,
  notes                 TEXT,
  deposit_required      DECIMAL(15,4),
  lang                  VARCHAR(10) DEFAULT 'en',
  client_comment        TEXT,
  converted_invoice_id  INT UNSIGNED,
  sent_at               DATETIME,
  viewed_at             DATETIME,
  responded_at          DATETIME,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_quote (tenant_id, quote_number),
  INDEX idx_tenant_status (tenant_id, status),
  INDEX idx_client (client_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invroot_audit_logs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT UNSIGNED,
  user_id     INT UNSIGNED,
  action      VARCHAR(100) NOT NULL,
  entity      VARCHAR(100),
  entity_id   INT UNSIGNED,
  changes     JSON,
  ip_address  VARCHAR(50),
  user_agent  TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_entity (entity, entity_id)
) ENGINE=InnoDB;
