import { query, execute } from './database.js';

/**
 * Recompute an invoice's paid amount and status from its payments and any
 * APPLIED credit notes, then persist the result.
 *
 * Shared by the invoices and credit-notes routes so a credit note applied or
 * voided moves the invoice exactly the way a payment does.
 *
 * @returns {{previousStatus:string,status:string,effectivePaid:number,total:number}}
 */
export async function recalcInvoice(invoiceId) {
  const [{ total_paid }] = await query(
    'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE invoice_id = ?',
    [invoiceId]
  );
  const [{ cn_applied }] = await query(
    `SELECT COALESCE(SUM(amount), 0) AS cn_applied
     FROM credit_notes WHERE invoice_id = ? AND status = 'applied'`,
    [invoiceId]
  );
  const effectivePaid = parseFloat(total_paid) + parseFloat(cn_applied);

  const [inv] = await query('SELECT total_amount, status FROM invoices WHERE id = ?', [invoiceId]);
  if (!inv) return;

  const total = parseFloat(inv.total_amount);
  const previousStatus = inv.status;
  let newStatus = previousStatus;

  // draft and void are manual states — never derive them from payments.
  if (!['draft', 'void'].includes(previousStatus)) {
    if (effectivePaid <= 0) {
      // Nothing paid any more (payment deleted, or the total grew after an
      // edit). Anything previously settled must fall back to unpaid.
      const [{ is_overdue }] = await query(
        'SELECT (due_date < CURDATE()) AS is_overdue FROM invoices WHERE id = ?', [invoiceId]
      );
      newStatus = is_overdue ? 'overdue' : 'sent';
    } else if (effectivePaid >= total) {
      newStatus = 'paid';
    } else {
      newStatus = 'partial';
    }
  }

  await execute(
    'UPDATE invoices SET paid_amount = ?, status = ?, paid_at = ? WHERE id = ?',
    [
      effectivePaid,
      newStatus,
      newStatus === 'paid' ? new Date() : null,
      invoiceId,
    ]
  );

  return { previousStatus, status: newStatus, effectivePaid, total };
}
