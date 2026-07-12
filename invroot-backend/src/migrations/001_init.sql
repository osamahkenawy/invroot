-- ═══════════════════════════════════════════════════════
-- INVROOT – Initial Database Migration
-- ═══════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET foreign_key_checks = 0;

-- ── Tenants (companies) ────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name       VARCHAR(200) NOT NULL,
  trading_name       VARCHAR(200),
  slug               VARCHAR(100) UNIQUE NOT NULL,
  email              VARCHAR(200),
  phone              VARCHAR(50),
  tax_id             VARCHAR(100),
  registration_id    VARCHAR(100),
  address            TEXT,
  city               VARCHAR(100),
  country            VARCHAR(100) DEFAULT 'SA',
  website            VARCHAR(300),
  industry           VARCHAR(100),
  logo_url           VARCHAR(300),
  stamp_url          VARCHAR(300),
  currency           VARCHAR(10)  DEFAULT 'SAR',
  lang               VARCHAR(10)  DEFAULT 'en',
  timezone           VARCHAR(100) DEFAULT 'Asia/Riyadh',
  date_format        VARCHAR(50)  DEFAULT 'DD/MM/YYYY',
  fiscal_year_start  VARCHAR(10)  DEFAULT '01-01',
  footer_text        TEXT,
  invoice_terms      TEXT,
  plan               VARCHAR(50)  DEFAULT 'starter',
  subscription_id    VARCHAR(200),
  status             ENUM('active','trialing','suspended','cancelled') DEFAULT 'trialing',
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ── Users ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id             INT UNSIGNED,
  email                 VARCHAR(200) NOT NULL,
  username              VARCHAR(200),
  full_name             VARCHAR(200),
  password              VARCHAR(255) NOT NULL,
  role                  VARCHAR(100) DEFAULT 'staff',
  is_owner              TINYINT(1) DEFAULT 0,
  is_active             TINYINT(1) DEFAULT 1,
  email_verified        TINYINT(1) DEFAULT 0,
  email_verify_token    VARCHAR(200),
  password_reset_token  VARCHAR(200),
  password_reset_expires DATETIME,
  avatar_url            VARCHAR(300),
  lang_preference       VARCHAR(10) DEFAULT 'en',
  last_login_at         DATETIME,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email (email),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Roles & Permissions ────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT UNSIGNED NOT NULL,
  name        VARCHAR(100) NOT NULL,
  name_ar     VARCHAR(100),
  slug        VARCHAR(100) NOT NULL,
  permissions JSON,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_slug (tenant_id, slug),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Company Signatories ────────────────────────────────
CREATE TABLE IF NOT EXISTS company_signatories (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT UNSIGNED NOT NULL,
  name          VARCHAR(200),
  title         VARCHAR(200),
  signature_url VARCHAR(300),
  is_default    TINYINT(1) DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Branches ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id  INT UNSIGNED NOT NULL,
  name       VARCHAR(200) NOT NULL,
  address    TEXT,
  phone      VARCHAR(50),
  is_active  TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Invoice Numbering ──────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_numbering (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id            INT UNSIGNED UNIQUE NOT NULL,
  invoice_prefix       VARCHAR(20) DEFAULT 'INV-',
  invoice_start        INT DEFAULT 1,
  quote_prefix         VARCHAR(20) DEFAULT 'QUO-',
  quote_start          INT DEFAULT 1,
  credit_note_prefix   VARCHAR(20) DEFAULT 'CN-',
  credit_note_start    INT DEFAULT 1,
  reset_frequency      ENUM('never','yearly','monthly') DEFAULT 'never',
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Tax Rates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_rates (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT UNSIGNED NOT NULL,
  name        VARCHAR(100) NOT NULL,
  rate        DECIMAL(8,4) NOT NULL,
  type        VARCHAR(50) DEFAULT 'VAT',
  is_compound TINYINT(1) DEFAULT 0,
  is_inclusive TINYINT(1) DEFAULT 0,
  is_default  TINYINT(1) DEFAULT 0,
  is_active   TINYINT(1) DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Clients ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id            INT UNSIGNED NOT NULL,
  name                 VARCHAR(200) NOT NULL,
  email                VARCHAR(200),
  phone                VARCHAR(50),
  billing_address      TEXT,
  shipping_address     TEXT,
  currency             VARCHAR(10),
  payment_terms        INT DEFAULT 30,
  credit_limit         DECIMAL(15,2),
  credit_balance       DECIMAL(15,2) DEFAULT 0,
  preferred_language   VARCHAR(10) DEFAULT 'en',
  tags                 JSON,
  notes                TEXT,
  status               ENUM('active','inactive','archived') DEFAULT 'active',
  portal_token         VARCHAR(200),
  portal_token_expires DATETIME,
  portal_session_token VARCHAR(200),
  portal_session_expires DATETIME,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Client Notes ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_notes (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id  INT UNSIGNED NOT NULL,
  tenant_id  INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED,
  content    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Catalog Items ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog_items (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       INT UNSIGNED NOT NULL,
  name            VARCHAR(300) NOT NULL,
  description     TEXT,
  sku             VARCHAR(100),
  unit_price      DECIMAL(15,4) NOT NULL DEFAULT 0,
  cost_price      DECIMAL(15,4),
  unit_of_measure VARCHAR(50),
  tax_rate_id     INT UNSIGNED,
  category        VARCHAR(100),
  tags            JSON,
  is_service      TINYINT(1) DEFAULT 0,
  is_active       TINYINT(1) DEFAULT 1,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (tax_rate_id) REFERENCES tax_rates(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ── Invoices ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id            INT UNSIGNED NOT NULL,
  client_id            INT UNSIGNED NOT NULL,
  quote_id             INT UNSIGNED,
  recurring_schedule_id INT UNSIGNED,
  invoice_number       VARCHAR(100) NOT NULL,
  status               ENUM('draft','sent','viewed','partial','paid','overdue','void') DEFAULT 'draft',
  issue_date           DATE,
  due_date             DATE,
  currency             VARCHAR(10) DEFAULT 'SAR',
  line_items           JSON,
  subtotal             DECIMAL(15,4) DEFAULT 0,
  discount_type        ENUM('percent','fixed'),
  discount_value       DECIMAL(10,4) DEFAULT 0,
  discount_amount      DECIMAL(15,4) DEFAULT 0,
  tax_amount           DECIMAL(15,4) DEFAULT 0,
  total_amount         DECIMAL(15,4) DEFAULT 0,
  paid_amount          DECIMAL(15,4) DEFAULT 0,
  notes                TEXT,
  memo                 TEXT,
  payment_terms        INT DEFAULT 30,
  lang                 VARCHAR(10) DEFAULT 'en',
  stamp_url            VARCHAR(300),
  signature_url        VARCHAR(300),
  signatory_id         INT UNSIGNED,
  sent_at              DATETIME,
  viewed_at            DATETIME,
  paid_at              DATETIME,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_invoice (tenant_id, invoice_number),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id)
) ENGINE=InnoDB;

-- ── Quotes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
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
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_quote (tenant_id, quote_number),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id)
) ENGINE=InnoDB;

-- ── Payments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    INT UNSIGNED NOT NULL,
  invoice_id   INT UNSIGNED NOT NULL,
  client_id    INT UNSIGNED,
  amount       DECIMAL(15,4) NOT NULL,
  method       ENUM('cash','bank_transfer','card','check','stripe','paypal','other') NOT NULL,
  payment_date DATE,
  reference    VARCHAR(200),
  notes        TEXT,
  proof_url    VARCHAR(300),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Credit Notes ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_notes (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT UNSIGNED NOT NULL,
  invoice_id  INT UNSIGNED,
  client_id   INT UNSIGNED,
  cn_number   VARCHAR(100) NOT NULL,
  amount      DECIMAL(15,4) NOT NULL,
  reason      TEXT,
  reason_code VARCHAR(100),
  status      ENUM('issued','applied','refunded') DEFAULT 'issued',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Recurring Schedules ────────────────────────────────
CREATE TABLE IF NOT EXISTS recurring_schedules (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          INT UNSIGNED NOT NULL,
  client_id          INT UNSIGNED NOT NULL,
  frequency          ENUM('weekly','monthly','quarterly','annual') NOT NULL,
  start_date         DATE,
  end_date           DATE,
  next_billing_date  DATE,
  currency           VARCHAR(10) DEFAULT 'SAR',
  line_items         JSON,
  subtotal           DECIMAL(15,4) DEFAULT 0,
  tax_amount         DECIMAL(15,4) DEFAULT 0,
  total_amount       DECIMAL(15,4) DEFAULT 0,
  notes              TEXT,
  auto_send          TINYINT(1) DEFAULT 0,
  payment_terms      INT DEFAULT 30,
  status             ENUM('active','paused','cancelled') DEFAULT 'active',
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id)
) ENGINE=InnoDB;

-- ── Reminder Rules ────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminder_rules (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT UNSIGNED NOT NULL,
  name        VARCHAR(200) NOT NULL,
  days_offset INT NOT NULL,
  channel     ENUM('email','sms','both') DEFAULT 'email',
  template_id INT UNSIGNED,
  is_active   TINYINT(1) DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Reminder Logs ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminder_logs (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  rule_id   INT UNSIGNED,
  entity_id INT UNSIGNED,
  channel   VARCHAR(20),
  status    ENUM('sent','failed') DEFAULT 'sent',
  error     TEXT,
  sent_at   DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ── Notification Templates ────────────────────────────
CREATE TABLE IF NOT EXISTS notification_templates (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id  INT UNSIGNED NOT NULL,
  name       VARCHAR(200),
  subject_en TEXT,
  body_en    TEXT,
  subject_ar TEXT,
  body_ar    TEXT,
  type       VARCHAR(50) DEFAULT 'reminder',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Audit Logs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
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

-- ── Integrations ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id      INT UNSIGNED NOT NULL,
  provider       VARCHAR(100) NOT NULL,
  credentials    JSON,
  field_mapping  JSON,
  sync_frequency VARCHAR(50) DEFAULT 'hourly',
  status         ENUM('active','disconnected') DEFAULT 'active',
  last_sync_at   DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_provider (tenant_id, provider),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── API Keys ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    INT UNSIGNED NOT NULL,
  name         VARCHAR(200),
  key_hash     VARCHAR(300) NOT NULL,
  scope        JSON,
  last_used_at DATETIME,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Webhook Endpoints ─────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id  INT UNSIGNED NOT NULL,
  url        VARCHAR(500) NOT NULL,
  events     JSON,
  secret     VARCHAR(300),
  is_active  TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Webhook Deliveries ────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       INT UNSIGNED,
  endpoint_id     INT UNSIGNED,
  event           VARCHAR(100),
  payload         JSON,
  status          ENUM('pending','delivered','failed') DEFAULT 'pending',
  attempts        INT DEFAULT 0,
  response_status INT,
  error           TEXT,
  last_attempt_at DATETIME,
  next_retry_at   DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

SET foreign_key_checks = 1;
