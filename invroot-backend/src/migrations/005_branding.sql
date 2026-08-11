-- Migration 005: Tenant branding for generated documents
-- The Settings → Branding screen already collects these, but there was
-- nowhere to store them, so invoice/receipt PDFs fell back to a hardcoded
-- accent colour and the settings silently did nothing.
ALTER TABLE tenants ADD COLUMN primary_color    VARCHAR(20) DEFAULT '#0D1B2A';
ALTER TABLE tenants ADD COLUMN accent_color     VARCHAR(20) DEFAULT '#8A6D1F';
ALTER TABLE tenants ADD COLUMN invoice_template VARCHAR(30) DEFAULT 'classic';
