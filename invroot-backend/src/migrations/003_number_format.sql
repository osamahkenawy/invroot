-- Migration 003: Add number_format column to invoice_numbering
-- Allows tenants to choose between "classic" (INV-00001) and "date" (PREFIX/MM/YYYY/SEQ)
ALTER TABLE invoice_numbering ADD COLUMN number_format VARCHAR(20) DEFAULT 'date';
