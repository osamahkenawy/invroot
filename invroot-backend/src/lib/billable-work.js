/**
 * Unbilled work → invoice lines.
 *
 * This is the join between three modules that previously never spoke: time
 * tracking, expenses, and invoicing. Someone logs hours and rebillable costs
 * against a client; this turns them into an invoice and marks them billed so
 * they can never be charged twice.
 *
 * The double-billing guard is the whole point. Claiming work is a transition
 * from "unbilled" to "on invoice N", and it has to be atomic against a second
 * person doing the same thing from another screen — otherwise the same forty
 * hours land on two invoices and a customer is billed twice for one job.
 */

import { query } from './database.js';
import { AppError } from './api-error.js';

/** Money the customer is charged for a time entry. */
export const timeEntryAmount = (e) =>
  Number(((Number(e.hours) || 0) * (Number(e.hourly_rate) || 0)).toFixed(2));

/** Money the customer is charged for a rebilled expense. */
export const expenseAmount = (e) =>
  Number((Number(e.billed_amount ?? e.amount) || 0).toFixed(2));

/**
 * Everything waiting to be invoiced for a client.
 *
 * Deliberately returns the entries themselves, not just totals: the person
 * billing needs to see and choose what goes on the invoice. Charging for
 * everything unbilled by default is how disputes start.
 */
export async function unbilledWorkFor({ tenantId, clientId }) {
  const time = await query(
    `SELECT id, project, description, hours, hourly_rate, entry_date
       FROM time_entries
      WHERE tenant_id = ? AND client_id = ?
        AND invoice_id IS NULL
        AND (status IS NULL OR status = 'unbilled')
      ORDER BY entry_date ASC, id ASC`,
    [tenantId, clientId]
  );

  const expenses = await query(
    `SELECT id, reference, vendor_name, category, amount, billed_amount, currency, expense_date
       FROM expenses
      WHERE tenant_id = ? AND client_id = ?
        AND billable = 1
        AND invoice_id IS NULL
      ORDER BY expense_date ASC, id ASC`,
    [tenantId, clientId]
  );

  const hours = time.reduce((s, e) => s + (Number(e.hours) || 0), 0);

  return {
    time: time.map(e => ({ ...e, amount: timeEntryAmount(e) })),
    expenses: expenses.map(e => ({ ...e, amount: expenseAmount(e) })),
    totals: {
      hours: Number(hours.toFixed(2)),
      time_amount: Number(time.reduce((s, e) => s + timeEntryAmount(e), 0).toFixed(2)),
      expense_amount: Number(expenses.reduce((s, e) => s + expenseAmount(e), 0).toFixed(2)),
      time_count: time.length,
      expense_count: expenses.length,
    },
  };
}

/**
 * Load the selected work and turn it into invoice line items.
 *
 * Validates before anything is written: wrong tenant, wrong client, already
 * billed, or a currency that doesn't match the invoice all fail here rather
 * than producing a wrong invoice.
 */
export async function buildLinesFromWork({ tenantId, clientId, timeIds = [], expenseIds = [], currency }) {
  const lines = [];

  if (timeIds.length) {
    const rows = await query(
      `SELECT id, project, description, hours, hourly_rate, entry_date, invoice_id, status
         FROM time_entries
        WHERE tenant_id = ? AND client_id = ? AND id IN (${timeIds.map(() => '?').join(',')})`,
      [tenantId, clientId, ...timeIds]
    );
    /* A count mismatch means an id belonged to another tenant, another client,
       or does not exist. Refuse the whole request rather than silently invoice
       the subset that happened to be valid. */
    if (rows.length !== timeIds.length) {
      throw new AppError('Some time entries could not be found for this client.', 400, 'BAD_TIME_ENTRIES');
    }
    for (const e of rows) {
      if (e.invoice_id || e.status === 'billed') {
        throw new AppError('Some of that time has already been invoiced.', 409, 'ALREADY_BILLED');
      }
      if (!Number(e.hourly_rate)) {
        throw new AppError(
          `Time entry ${e.id} has no hourly rate, so it cannot be billed. Set a rate first.`,
          400, 'NO_RATE'
        );
      }
      lines.push({
        description: [e.project, e.description].filter(Boolean).join(' — ')
          || `Work on ${String(e.entry_date).slice(0, 10)}`,
        quantity: Number(e.hours),
        unit_price: Number(e.hourly_rate),
        tax_rate: 0,
        source: { type: 'time_entry', id: e.id },
      });
    }
  }

  if (expenseIds.length) {
    const rows = await query(
      `SELECT id, reference, vendor_name, category, amount, billed_amount, currency,
              expense_date, billable, invoice_id
         FROM expenses
        WHERE tenant_id = ? AND client_id = ? AND id IN (${expenseIds.map(() => '?').join(',')})`,
      [tenantId, clientId, ...expenseIds]
    );
    if (rows.length !== expenseIds.length) {
      throw new AppError('Some expenses could not be found for this client.', 400, 'BAD_EXPENSES');
    }
    for (const e of rows) {
      if (!e.billable) {
        throw new AppError(`Expense ${e.id} is not marked billable.`, 400, 'NOT_BILLABLE');
      }
      if (e.invoice_id) {
        throw new AppError('Some of those expenses have already been invoiced.', 409, 'ALREADY_BILLED');
      }
      /* Rebilling a USD cost on an AED invoice at face value would overcharge
         or undercharge by the exchange rate. Refuse rather than guess — the
         person can convert it deliberately. */
      if (e.currency && currency && String(e.currency).toUpperCase() !== String(currency).toUpperCase()) {
        throw new AppError(
          `Expense ${e.id} is in ${e.currency} but the invoice is in ${currency}. Convert it first.`,
          400, 'CURRENCY_MISMATCH'
        );
      }
      lines.push({
        description: [e.vendor_name, e.category, e.reference].filter(Boolean).join(' — ')
          || `Expense ${String(e.expense_date).slice(0, 10)}`,
        quantity: 1,
        unit_price: expenseAmount(e),
        tax_rate: 0,
        source: { type: 'expense', id: e.id },
      });
    }
  }

  return lines;
}

/**
 * Mark the source records as billed, inside the caller's transaction.
 *
 * The WHERE clause re-asserts "still unbilled". If another request claimed the
 * same work between the read above and this write, affectedRows comes back
 * short and we throw — the caller's transaction rolls back and no invoice is
 * created. That is the difference between a race and a customer billed twice.
 */
export async function claimWork(conn, { tenantId, invoiceId, timeIds = [], expenseIds = [] }) {
  if (timeIds.length) {
    const [res] = await conn.query(
      `UPDATE time_entries
          SET invoice_id = ?, status = 'billed'
        WHERE tenant_id = ? AND invoice_id IS NULL
          AND (status IS NULL OR status = 'unbilled')
          AND id IN (${timeIds.map(() => '?').join(',')})`,
      [invoiceId, tenantId, ...timeIds]
    );
    if (res.affectedRows !== timeIds.length) {
      throw new AppError(
        'Some of that time was invoiced by someone else a moment ago. Nothing was charged — please review and try again.',
        409, 'WORK_ALREADY_CLAIMED'
      );
    }
  }

  if (expenseIds.length) {
    const [res] = await conn.query(
      `UPDATE expenses
          SET invoice_id = ?
        WHERE tenant_id = ? AND invoice_id IS NULL AND billable = 1
          AND id IN (${expenseIds.map(() => '?').join(',')})`,
      [invoiceId, tenantId, ...expenseIds]
    );
    if (res.affectedRows !== expenseIds.length) {
      throw new AppError(
        'Some of those expenses were invoiced by someone else a moment ago. Nothing was charged — please review and try again.',
        409, 'WORK_ALREADY_CLAIMED'
      );
    }
  }
}

/**
 * Release work back to unbilled — used when an invoice is voided or deleted.
 * Without this, voiding an invoice would strand the hours as "billed" against
 * a document that no longer charges for them, and they could never be
 * recovered.
 */
export async function releaseWork(conn, { tenantId, invoiceId }) {
  const run = conn ? conn.query.bind(conn) : null;
  const sqlTime = `UPDATE time_entries SET invoice_id = NULL, status = 'unbilled'
                    WHERE tenant_id = ? AND invoice_id = ?`;
  const sqlExp  = `UPDATE expenses SET invoice_id = NULL WHERE tenant_id = ? AND invoice_id = ?`;
  if (run) {
    await run(sqlTime, [tenantId, invoiceId]);
    await run(sqlExp,  [tenantId, invoiceId]);
  } else {
    const { execute } = await import('./database.js');
    await execute(sqlTime, [tenantId, invoiceId]);
    await execute(sqlExp,  [tenantId, invoiceId]);
  }
}
