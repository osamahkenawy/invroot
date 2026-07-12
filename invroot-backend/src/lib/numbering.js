/**
 * Document numbering helper
 *
 * Supports two formats (stored in invoice_numbering.number_format):
 *   "classic"  →  PREFIX-00001       (e.g. INV-00040)
 *   "date"     →  PREFIX/MM/YYYY/SEQ (e.g. TS/06/2026/40)
 *
 * The sequential counter is always derived from the highest existing number
 * for that tenant, falling back to invoice_start when no documents exist.
 */

import { query } from './database.js';

/**
 * @param {number} tenantId
 * @param {'invoice'|'quote'|'credit_note'|'receipt'} type
 * @returns {Promise<string>} the next formatted document number
 */
export async function nextDocNumber(tenantId, type) {
  const [settings] = await query(
    'SELECT * FROM invoice_numbering WHERE tenant_id = ?',
    [tenantId]
  );

  const format   = settings?.number_format || 'date';   // default to date format
  const startAt  = settings?.[`${type}_start`] || 1;

  /* ── Resolve prefix per type ── */
  let prefix;
  switch (type) {
    case 'invoice':     prefix = settings?.invoice_prefix     || 'INV'; break;
    case 'quote':       prefix = settings?.quote_prefix       || 'QUO'; break;
    case 'credit_note': prefix = settings?.credit_note_prefix || 'CN';  break;
    case 'receipt':     prefix = settings?.receipt_prefix     || 'RCP'; break;
    default:            prefix = 'DOC';
  }

  // Strip trailing dashes/slashes the user may have added in the UI
  prefix = prefix.replace(/[-/]+$/, '');

  /* ── Resolve the table + column for this type ── */
  const tableMap = {
    invoice:     { table: 'invoices',     col: 'invoice_number'  },
    quote:       { table: 'quotes',       col: 'quote_number'    },
    credit_note: { table: 'credit_notes', col: 'cn_number'       },
    receipt:     { table: 'receipts',     col: 'receipt_number'  },
  };
  const { table, col } = tableMap[type];

  /* ── Find the current highest sequence number ── */
  let nextSeq;
  if (format === 'date') {
    // Numbers look like  PREFIX/MM/YYYY/SEQ  — extract last segment
    const [row] = await query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(${col}, '/', -1) AS UNSIGNED)), 0) AS maxSeq
       FROM ${table} WHERE tenant_id = ?`,
      [tenantId]
    );
    nextSeq = Math.max(row?.maxSeq || 0, startAt - 1) + 1;

    const now = new Date();
    const mm  = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${prefix}/${mm}/${yyyy}/${nextSeq}`;
  } else {
    // Classic:  PREFIXnnnnn  — extract numeric suffix after prefix
    const [row] = await query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(${col}, ?) AS UNSIGNED)), 0) AS maxSeq
       FROM ${table} WHERE tenant_id = ?`,
      [prefix.length + 2, tenantId]   // +2 to skip the separator char (- or /)
    );
    nextSeq = Math.max(row?.maxSeq || 0, startAt - 1) + 1;
    return `${prefix}-${String(nextSeq).padStart(5, '0')}`;
  }
}
