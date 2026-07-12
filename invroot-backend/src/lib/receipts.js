import { query, execute } from './database.js';

/**
 * Generate the next receipt number for a tenant.
 * Uses invoice_numbering.receipt_prefix / receipt_start when available.
 */
export async function nextReceiptNumber(tenantId) {
  const [numSettings] = await query('SELECT receipt_prefix, receipt_start FROM invoice_numbering WHERE tenant_id = ?', [tenantId]);
  const prefix = numSettings?.receipt_prefix || 'RCP-';
  const start = numSettings?.receipt_start || 1;
  const [{ maxNum }] = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number, ?) AS UNSIGNED)), ?) AS maxNum
     FROM receipts WHERE tenant_id = ?`,
    [prefix.length + 1, start - 1, tenantId]
  );
  const next = (parseInt(maxNum) || (start - 1)) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

/**
 * Create a receipt row for a recorded payment.
 * Returns { id, receipt_number }.
 */
export async function createReceiptForPayment({ tenantId, payment, invoice }) {
  const receiptNumber = await nextReceiptNumber(tenantId);
  const result = await execute(
    `INSERT INTO receipts (tenant_id, payment_id, invoice_id, client_id, receipt_number, amount, method, currency, issued_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      payment.id,
      payment.invoice_id,
      payment.client_id || invoice?.client_id || null,
      receiptNumber,
      payment.amount,
      payment.method,
      invoice?.currency || 'SAR',
      payment.payment_date || new Date(),
      payment.notes || null,
    ]
  );
  return { id: result.insertId, receipt_number: receiptNumber };
}
