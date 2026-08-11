-- File storage metadata.
--
-- Uploads previously existed only as a bare filename on the owning row, with the
-- bytes in a shared folder served by express.static and no auth. That made every
-- payment proof and expense receipt readable by anyone with the URL, and gave no
-- way to tell which tenant a file belonged to.
--
-- This table records who owns each object, what it is attached to, and which
-- driver holds it, so reads can be authorised and files can be migrated between
-- local disk and S3 without guessing.
--
-- Prefixed `invroot_` because this database is shared with a CRM that already
-- owns an `attachments` table (same reason as invroot_quotes / invroot_notifications).

CREATE TABLE IF NOT EXISTS invroot_attachments (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT UNSIGNED NOT NULL,
  -- What the file hangs off, e.g. ('client', 42) or ('expense', 7).
  -- NULL entity means a standalone upload not yet linked to a record.
  entity_type   VARCHAR(40)  NULL,
  entity_id     INT UNSIGNED NULL,
  kind          VARCHAR(20)  NOT NULL,           -- logo | stamp | signature | avatar | attachment
  storage_key   VARCHAR(500) NOT NULL,           -- tenants/<id>/<folder>/<uuid>.<ext>
  storage_driver VARCHAR(10) NOT NULL DEFAULT 'local',
  original_name VARCHAR(255) NULL,
  mime_type     VARCHAR(120) NULL,
  size_bytes    INT UNSIGNED NULL,
  uploaded_by   INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invroot_attachments_key (storage_key),
  INDEX idx_invroot_attachments_entity (tenant_id, entity_type, entity_id),
  INDEX idx_invroot_attachments_kind (tenant_id, kind)
);

-- Client profile picture. Stores the attachment id rather than a path, so the
-- access check and the driver stay in one place.
ALTER TABLE clients ADD COLUMN avatar_attachment_id BIGINT NULL AFTER name;
