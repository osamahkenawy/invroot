-- The four tables the app has always used but never created.
--
-- Development runs against `trasealla`, a database shared with another
-- Trasealla product that happens to own tables of these names. So Invroot read
-- and wrote expenses, bank accounts, bank transactions and time entries for
-- its whole life without ever declaring them — and nobody noticed, because the
-- tables were simply always there.
--
-- On a database of its own the omission is fatal, not cosmetic: migration 022
-- runs `ALTER TABLE expenses`, which aborts the whole boot with
-- ER_NO_SUCH_TABLE. The server never listens. That is exactly what happened on
-- the first deploy to a fresh `invroot` schema.
--
-- Numbered 021a so it lands after 021 and before 022: these are the base
-- shapes as they were BEFORE 022 and 023 amended them, so those two continue
-- to apply their columns and indexes unchanged, in the order they always did.
-- Every statement is IF NOT EXISTS, so existing installs (including the shared
-- development database) are a no-op.

CREATE TABLE IF NOT EXISTS expenses (
  id              INT NOT NULL AUTO_INCREMENT,
  tenant_id       INT NOT NULL,
  reference       VARCHAR(100) DEFAULT NULL,
  vendor_name     VARCHAR(200) DEFAULT NULL,
  category        VARCHAR(100) DEFAULT NULL,
  amount          DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  currency        VARCHAR(10) DEFAULT 'SAR',
  expense_date    DATE DEFAULT NULL,
  due_date        DATE DEFAULT NULL,
  status          ENUM('draft','unpaid','paid','overdue') DEFAULT 'unpaid',
  payment_method  VARCHAR(50) DEFAULT NULL,
  notes           TEXT,
  attachment_url  VARCHAR(500) DEFAULT NULL,
  created_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_expenses_tenant (tenant_id),
  KEY idx_expenses_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bank_accounts (
  id              INT NOT NULL AUTO_INCREMENT,
  tenant_id       INT NOT NULL,
  name            VARCHAR(200) NOT NULL,
  account_number  VARCHAR(100) DEFAULT NULL,
  bank_name       VARCHAR(200) DEFAULT NULL,
  currency        VARCHAR(10) DEFAULT 'SAR',
  balance         DECIMAL(15,2) DEFAULT 0.00,
  account_type    ENUM('checking','savings','credit','cash') DEFAULT 'checking',
  is_active       TINYINT(1) DEFAULT 1,
  notes           TEXT,
  created_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bank_accounts_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `payment_id` and its unique index are deliberately absent: migration 023
-- adds them, and that is what ties a statement line to a recorded payment.
CREATE TABLE IF NOT EXISTS bank_transactions (
  id                INT NOT NULL AUTO_INCREMENT,
  tenant_id         INT NOT NULL,
  account_id        INT NOT NULL,
  type              ENUM('credit','debit') NOT NULL,
  amount            DECIMAL(15,2) NOT NULL,
  description       VARCHAR(500) DEFAULT NULL,
  reference         VARCHAR(100) DEFAULT NULL,
  transaction_date  DATE DEFAULT NULL,
  created_at        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bank_tx_account (account_id),
  KEY idx_bank_tx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status/invoice_id must exist here, not in 022: that migration only builds an
-- INDEX over them, so creating them later would fail.
CREATE TABLE IF NOT EXISTS time_entries (
  id           INT NOT NULL AUTO_INCREMENT,
  tenant_id    INT NOT NULL,
  client_id    INT DEFAULT NULL,
  project      VARCHAR(200) DEFAULT NULL,
  description  TEXT,
  hours        DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  hourly_rate  DECIMAL(10,2) DEFAULT 0.00,
  entry_date   DATE DEFAULT NULL,
  status       ENUM('unbilled','billed','void') DEFAULT 'unbilled',
  invoice_id   INT DEFAULT NULL,
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_time_entries_tenant (tenant_id),
  KEY idx_time_entries_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
