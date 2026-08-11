/**
 * Document numbering helper
 *
 * Supports two formats (stored in invoice_numbering.number_format):
 *   "classic"  →  PREFIX-00001       (e.g. INV-00040)
 *   "date"     →  PREFIX/MM/YYYY/SEQ (e.g. TS/06/2026/40)
 *
 * Sequence numbers come from the `doc_counters` table and are allocated
 * atomically. The previous implementation derived the next number with
 * SELECT MAX(...) and let the caller insert it, which meant two simultaneous
 * creates read the same maximum, produced the same number, and the second one
 * died against the unique index with a 500. The counter row is incremented in
 * the same statement that reads it, so that gap no longer exists.
 */

import { query, execute } from './database.js';

/* Where each document type's numbers live. Quotes sit in `invroot_quotes`
   because a CRM product sharing this database already owns `quotes`. */
const TABLE_MAP = {
  invoice:     { table: 'invoices',       col: 'invoice_number' },
  quote:       { table: 'invroot_quotes', col: 'quote_number'   },
  credit_note: { table: 'credit_notes',   col: 'cn_number'      },
  receipt:     { table: 'receipts',       col: 'receipt_number' },
};

const DEFAULT_PREFIX = {
  invoice: 'INV', quote: 'QUO', credit_note: 'CN', receipt: 'RCP',
};

/**
 * Highest sequence already present in the document table — used only to seed a
 * counter the first time a tenant allocates a number of this type, so existing
 * tenants continue their sequence instead of restarting at 1.
 */
/* MySQL REGEXP metacharacters in a tenant-supplied prefix would otherwise be
   interpreted rather than matched — a prefix of "A.B" must not match "AXB". */
const escapeRe = (s) => String(s).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

async function highestExistingSeq({ table, col }, tenantId, format, prefix) {
  /* Only numbers this tenant's own format could have produced may seed the
     counter.

     Without the pattern check, `SUBSTRING_INDEX('2024-001', '/', -1)` returns
     the whole string — there is no slash — and CAST AS UNSIGNED reads it as
     2024. So importing historical invoices numbered 2024-001 pushed the live
     counter to 2024, and the next real invoice was issued as .../2025. An
     import numbered 9999-001 would push every future invoice past 10000.

     Legacy numbers are deliberately outside the sequence: they were issued by
     whatever system came before, and that system's numbering is not ours to
     continue. */
  if (format === 'date') {
    // PREFIX/MM/YYYY/SEQ — the sequence is the final segment.
    const [row] = await query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(${col}, '/', -1) AS UNSIGNED)), 0) AS maxSeq
       FROM ${table}
       WHERE tenant_id = ? AND ${col} REGEXP ?`,
      [tenantId, `^${escapeRe(prefix)}/[0-9]{2}/[0-9]{4}/[0-9]+$`]
    );
    return Number(row?.maxSeq || 0);
  }
  // PREFIX-nnnnn — skip the prefix and its separator.
  const [row] = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${col}, ?) AS UNSIGNED)), 0) AS maxSeq
     FROM ${table}
     WHERE tenant_id = ? AND ${col} REGEXP ?`,
    [prefix.length + 2, tenantId, `^${escapeRe(prefix)}-[0-9]+$`]
  );
  return Number(row?.maxSeq || 0);
}

/**
 * Atomically reserve the next sequence number for (tenant, type).
 *
 * The INSERT ... ON DUPLICATE KEY UPDATE runs as a single statement, so two
 * concurrent callers are serialised by the row lock and always receive
 * different numbers. LAST_INSERT_ID(expr) makes the allocated value available
 * as the statement's insertId — read from the same round trip rather than a
 * follow-up SELECT, which matters because the pool would hand a second query a
 * different connection and LAST_INSERT_ID() is per-connection.
 */
async function reserveSeq(tenantId, type, seed) {
  const result = await execute(
    `INSERT INTO doc_counters (tenant_id, doc_type, next_seq)
     VALUES (?, ?, LAST_INSERT_ID(?))
     ON DUPLICATE KEY UPDATE next_seq = LAST_INSERT_ID(next_seq + 1)`,
    [tenantId, type, seed]
  );
  return Number(result.insertId);
}

/**
 * @param {number} tenantId
 * @param {'invoice'|'quote'|'credit_note'|'receipt'} type
 * @returns {Promise<string>} the next formatted document number
 */
export async function nextDocNumber(tenantId, type) {
  const mapping = TABLE_MAP[type];
  if (!mapping) throw new Error(`Unknown document type: ${type}`);

  const [settings] = await query(
    'SELECT * FROM invoice_numbering WHERE tenant_id = ?',
    [tenantId]
  );

  const format  = settings?.number_format || 'date';
  const startAt = Number(settings?.[`${type}_start`]) || 1;

  // Strip trailing dashes/slashes a user may have typed into the prefix field.
  const prefix = String(settings?.[`${type}_prefix`] || DEFAULT_PREFIX[type] || 'DOC')
    .replace(/[-/]+$/, '');

  /* Seed value used only if this tenant has no counter row yet. Taking the
     greater of "highest number already issued" and "configured start" means
     turning the feature on mid-flight never reuses a number. */
  const existing = await highestExistingSeq(mapping, tenantId, format, prefix);
  const seed = Math.max(existing, startAt - 1) + 1;

  const seq = await reserveSeq(tenantId, type, seed);

  if (format === 'date') {
    const now  = new Date();
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${prefix}/${mm}/${yyyy}/${seq}`;
  }
  return `${prefix}-${String(seq).padStart(5, '0')}`;
}

/**
 * Re-align a tenant's counter with the documents actually on record.
 *
 * Needed after a bulk import, or if rows were deleted directly in the database
 * and the counter is now ahead of (or behind) reality.
 */
export async function resyncCounter(tenantId, type, { forwardOnly = false } = {}) {
  const mapping = TABLE_MAP[type];
  if (!mapping) throw new Error(`Unknown document type: ${type}`);

  const [settings] = await query('SELECT * FROM invoice_numbering WHERE tenant_id = ?', [tenantId]);
  const format = settings?.number_format || 'date';
  const prefix = String(settings?.[`${type}_prefix`] || DEFAULT_PREFIX[type] || 'DOC').replace(/[-/]+$/, '');
  const startAt = Number(settings?.[`${type}_start`]) || 1;

  const existing = await highestExistingSeq(mapping, tenantId, format, prefix);
  const next = Math.max(existing, startAt - 1) + 1;

  /* forwardOnly is for imports. Rewinding the counter is right when rows were
     deleted from the database by hand, but wrong after an import: another
     request may have reserved a number that is not yet committed, and moving
     the counter back would hand that same number out twice. An admin repair
     asks for the rewind explicitly by leaving this off. */
  await execute(
    forwardOnly
      ? `INSERT INTO doc_counters (tenant_id, doc_type, next_seq) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE next_seq = GREATEST(next_seq, VALUES(next_seq))`
      : `INSERT INTO doc_counters (tenant_id, doc_type, next_seq) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE next_seq = VALUES(next_seq)`,
    [tenantId, type, next]
  );
  return next;
}
