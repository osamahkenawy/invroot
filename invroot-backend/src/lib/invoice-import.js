/**
 * Importing invoices that already exist somewhere else.
 *
 * Every assumption the normal create path makes is wrong for historical data:
 *
 *   Numbering — POST /invoices calls nextDocNumber() and assigns the next
 *   number in sequence. An invoice that has been sent to a customer as
 *   "2024-001" must keep that number: it is on their copy, in their accounts,
 *   and quoted on the payment they made. Importing must preserve it, and must
 *   not burn numbers out of the live sequence while doing so.
 *
 *   Status — creation hardcodes 'draft'. Most imported invoices are settled
 *   history; a year of paid work arriving as drafts is worse than useless,
 *   because drafts are excluded from every revenue and aging figure.
 *
 *   Totals — creation always recomputes from line items. Tax rules change. An
 *   invoice raised under a 5% VAT regime must keep the total the customer
 *   actually paid, not be silently restated at today's rate. So a supplied
 *   total is honoured verbatim, and any disagreement with the line items is
 *   REPORTED rather than corrected.
 *
 *   Side effects — recording a payment normally emails the customer, fires a
 *   webhook, raises an in-app notification and generates a receipt. Importing
 *   two years of history would email every customer about payments they made
 *   long ago. Nothing in this file sends anything.
 *
 * The unique index on (tenant_id, invoice_number) is what makes re-running an
 * import safe: a number already present is skipped, not duplicated. That
 * matters because imports are almost never right the first time, and the
 * natural response to a half-finished run is to fix the file and run it again.
 */

import { query } from './database.js';
import { AppError } from './api-error.js';

const VALID_STATUS = ['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void'];
const VALID_METHOD = ['cash', 'bank_transfer', 'card', 'check', 'stripe', 'paypal', 'other'];

/**
 * A message with a code, so the browser can translate it.
 *
 * The English text travels alongside as `msg` and is used verbatim when no
 * translation exists — an untranslated locale then reads like English rather
 * than showing a raw key. Row-level import errors were English-only, which
 * made the one screen where careful reading matters most unusable in Arabic.
 */
const m = (code, params, msg) => ({ code, params, msg });

const money = (v) => Number(Number(v || 0).toFixed(2));
const cents = (v) => Math.round(Number(v || 0) * 100);

/** ISO date or null. Rejects nonsense rather than storing 0000-00-00. */
function parseDate(v, field, errors) {
  if (!v) return null;
  const s = String(v).trim();
  /* Deliberately strict. "01/02/2024" is 1 February in most of the world and
     2 January in the US; guessing would silently misdate a year of invoices
     and nobody would notice until an aging report looked wrong. */
  /* `match`, not `m` — `m` is the message helper in this module's scope, and
     shadowing it here would mean the error path called a null regex result as
     a function. Exactly the shadowing that crashed Toast.jsx. */
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!match) {
    errors.push(m('bad_date_format', { field, value: v },
      `${field} must be YYYY-MM-DD (got "${v}"). Ambiguous formats like 01/02/2024 are refused on purpose.`));
    return null;
  }
  const d = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    errors.push(m('not_a_date', { field, value: v }, `${field} is not a real date: "${v}"`));
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Validate one row and work out exactly what would be written.
 *
 * Pure: touches no data. This is what makes a dry run meaningful — the same
 * function decides the outcome whether or not anything is committed, so a
 * clean dry run genuinely predicts a clean import.
 */
export function planRow(row, { index, clientResolver, existingNumbers }) {
  const errors = [];
  const warnings = [];

  const number = String(row.invoice_number ?? '').trim();
  if (!number) errors.push(m('number_required', {},
    'invoice_number is required — this is the number the customer already has.'));
  if (number.length > 100) errors.push(m('number_too_long', {},
    'invoice_number is longer than 100 characters.'));

  /* Duplicates WITHIN the file are a different problem from duplicates against
     the database, and a much more likely one: two rows claiming to be 2024-001
     means the source export is wrong, and importing either would be a guess. */
  if (number && existingNumbers.inFile.has(number)) {
    errors.push(m('number_duplicated', { number },
      `invoice_number "${number}" appears more than once in this file.`));
  } else if (number) {
    existingNumbers.inFile.add(number);
  }

  const alreadyInDb = number && existingNumbers.inDb.has(number);

  const client = clientResolver(row, errors);

  const issue_date = parseDate(row.issue_date, 'issue_date', errors);
  if (!row.issue_date) errors.push(m('issue_date_required', {}, 'issue_date is required.'));
  const due_date = parseDate(row.due_date, 'due_date', errors) || issue_date;
  if (issue_date && due_date && due_date < issue_date) {
    warnings.push(m('due_before_issue', {}, 'due_date is before issue_date — imported as given.'));
  }

  const status = String(row.status ?? 'paid').trim().toLowerCase();
  if (!VALID_STATUS.includes(status)) {
    errors.push(m('bad_status', { value: row.status, allowed: VALID_STATUS.join(', ') },
      `status "${row.status}" is not one of: ${VALID_STATUS.join(', ')}`));
  }

  /* Line items are optional. Plenty of historical records are a number and a
     description on paper; refusing them would mean the invoice cannot be
     imported at all, which serves nobody. One summary line is honest. */
  const rawItems = Array.isArray(row.line_items) ? row.line_items : [];
  const items = rawItems
    .filter(i => String(i?.description ?? '').trim())
    .map(i => ({
      description: String(i.description).trim(),
      quantity:   Number(i.quantity ?? 1),
      unit_price: money(i.unit_price),
      tax_rate:   Number(i.tax_rate ?? 0),
      total:      money(Number(i.quantity ?? 1) * Number(i.unit_price ?? 0)),
    }));

  const computedSubtotal = money(items.reduce((s, i) => s + i.quantity * i.unit_price, 0));
  const computedTax      = money(items.reduce((s, i) => s + i.quantity * i.unit_price * i.tax_rate / 100, 0));

  const hasExplicitTotal = row.total_amount !== undefined && row.total_amount !== null && row.total_amount !== '';
  const total_amount = hasExplicitTotal ? money(row.total_amount) : money(computedSubtotal + computedTax);

  if (!(total_amount > 0)) errors.push(m('total_not_positive', {}, 'total_amount must be greater than zero.'));

  const subtotal   = row.subtotal   !== undefined && row.subtotal   !== '' ? money(row.subtotal)   : computedSubtotal;
  const tax_amount = row.tax_amount !== undefined && row.tax_amount !== '' ? money(row.tax_amount) : computedTax;
  const discount_amount = money(row.discount_amount);

  /* The supplied total wins — historical tax rules are not today's — but a
     disagreement is surfaced, because it is equally likely to be a broken
     export as a legitimate old rate. */
  if (hasExplicitTotal && items.length) {
    const expected = money(computedSubtotal + computedTax - discount_amount);
    if (cents(expected) !== cents(total_amount)) {
      warnings.push(m('total_mismatch', { total: total_amount, expected },
        `total_amount ${total_amount} does not equal the line items (${expected}). ` +
        `Keeping ${total_amount} — the invoice the customer holds is the source of truth.`));
    }
  }
  if (!items.length) {
    warnings.push(m('no_line_items', {},
      'No line items — a single summary line will be created so the invoice reads correctly.'));
  }

  /* Payments */
  const rawPayments = Array.isArray(row.payments) ? row.payments : [];
  const payments = [];
  rawPayments.forEach((p, i) => {
    const amt = money(p?.amount);
    if (!(amt > 0)) { errors.push(m('payment_not_positive', { index: i },
      `payments[${i}].amount must be greater than zero.`)); return; }
    const method = String(p?.method ?? 'bank_transfer').toLowerCase();
    if (!VALID_METHOD.includes(method)) {
      errors.push(m('bad_payment_method', { index: i, value: p.method, allowed: VALID_METHOD.join(', ') },
        `payments[${i}].method "${p.method}" is not one of: ${VALID_METHOD.join(', ')}`));
      return;
    }
    payments.push({
      amount: amt,
      method,
      payment_date: parseDate(p?.payment_date, `payments[${i}].payment_date`, errors) || issue_date,
      reference: p?.reference ? String(p.reference).slice(0, 200) : null,
      notes: p?.notes ? String(p.notes) : null,
    });
  });

  const paidFromPayments = money(payments.reduce((s, p) => s + p.amount, 0));

  /* Two honest ways to import a settled invoice:

       with payment rows  — full history; reconciliation and receipts work.
       status 'paid' only — the total is known, the individual payments are not.

     The second is extremely common when migrating, so it is supported rather
     than rejected. It is flagged, because the money will not appear in the
     payments module and someone will eventually wonder why. */
  let paid_amount = paidFromPayments;
  if (!payments.length && (status === 'paid' || status === 'partial')) {
    paid_amount = status === 'paid'
      ? total_amount
      : money(row.paid_amount);
    if (status === 'partial' && !(paid_amount > 0)) {
      errors.push(m('partial_without_amount', {},
        "status is 'partial' but there are no payments and no paid_amount."));
    }
    warnings.push(m('settled_without_payments', { status, amount: paid_amount },
      `Marked ${status} without payment records, so paid_amount is set to ${paid_amount}. ` +
      'It will not appear under Payments or in bank reconciliation.'));
  }

  if (payments.length && cents(paidFromPayments) > cents(total_amount)) {
    errors.push(m('overpaid', { paid: paidFromPayments, total: total_amount },
      `payments total ${paidFromPayments} exceeds the invoice total ${total_amount}.`));
  }

  /* A status that contradicts the money is the single most common import
     defect, and the most damaging: it makes revenue reports wrong in a way
     that looks plausible. */
  if (payments.length) {
    const settled = cents(paidFromPayments) >= cents(total_amount);
    if (status === 'paid' && !settled) {
      errors.push(m('paid_but_underpaid', { paid: paidFromPayments, total: total_amount },
        `status is 'paid' but payments only cover ${paidFromPayments} of ${total_amount}. Use 'partial'.`));
    }
    if (status === 'partial' && settled) {
      warnings.push(m('partial_is_actually_paid', {},
        "status is 'partial' but the payments cover the full total — importing as 'paid'."));
    }
  }

  const finalStatus = (status === 'partial' && payments.length && cents(paidFromPayments) >= cents(total_amount))
    ? 'paid' : status;

  return {
    index,
    invoice_number: number,
    skip: alreadyInDb ? 'already imported' : null,
    errors,
    warnings,
    client,
    values: {
      invoice_number: number,
      client_id: client?.id ?? null,
      status: finalStatus,
      issue_date, due_date,
      currency: String(row.currency || '').trim().toUpperCase() || null,
      line_items: items.length ? items : [{
        description: String(row.description || `Invoice ${number}`).trim(),
        quantity: 1, unit_price: total_amount, tax_rate: 0, total: total_amount,
      }],
      subtotal, tax_amount, discount_amount, total_amount, paid_amount,
      notes: row.notes ? String(row.notes) : null,
      po_number: row.po_number ? String(row.po_number).slice(0, 100) : null,
      payments,
    },
  };
}

/**
 * Resolve the customer for a row.
 *
 * Matching is by email first because it is the only field people actually keep
 * consistent; names arrive as "Acme Ltd", "Acme Limited" and "ACME" in the same
 * export. Creating a client is opt-in: silently inventing customers from typos
 * is how an address book becomes unusable.
 */
export async function buildClientResolver({ tenantId, createMissing }) {
  const clients = await query(
    'SELECT id, name, email, currency FROM clients WHERE tenant_id = ?', [tenantId]);

  const byEmail = new Map();
  const byName  = new Map();
  for (const c of clients) {
    if (c.email) byEmail.set(c.email.trim().toLowerCase(), c);
    byName.set(c.name.trim().toLowerCase(), c);
  }

  const toCreate = new Map();   // key → { name, email, currency }

  const resolve = (row, errors) => {
    if (row.client_id) {
      const hit = clients.find(c => c.id === Number(row.client_id));
      if (!hit) { errors.push(m('client_not_yours', { id: row.client_id },
        `client_id ${row.client_id} does not belong to this account.`)); return null; }
      return hit;
    }

    const email = String(row.client_email ?? '').trim().toLowerCase();
    const name  = String(row.client_name ?? '').trim();

    if (email && byEmail.has(email)) return byEmail.get(email);
    if (name  && byName.has(name.toLowerCase())) return byName.get(name.toLowerCase());

    if (!name && !email) {
      errors.push(m('client_missing', {}, 'No client — give client_id, or client_name, or client_email.'));
      return null;
    }
    if (!createMissing) {
      errors.push(m('client_unknown', { who: email || name },
        `No existing client matches ${email || name}. Turn on "create missing clients", or add them first.`));
      return null;
    }

    /* Dedupe pending creations across BOTH keys.

       Exports are rarely complete: the same customer appears on one row with
       an email and on the next without. Keying only on `email || name` made
       those two rows two different keys, so one company was created twice and
       its invoices split between the duplicates. Look up by name as well, and
       let a later row fill in an email an earlier one lacked. */
    const nameKey = name.toLowerCase();
    let key = email && toCreate.has(email) ? email
            : nameKey && [...toCreate].find(([, c]) => c.name.toLowerCase() === nameKey)?.[0];

    if (!key) {
      key = email || nameKey;
      toCreate.set(key, { name: name || email, email: email || null, currency: row.currency || null });
    } else {
      const pending = toCreate.get(key);
      if (!pending.email && email) pending.email = email;
      if (!pending.currency && row.currency) pending.currency = row.currency;
    }
    /* Marked pending: the id does not exist yet. The importer creates these
       first, in one place, so a row is never written against a client that
       failed to be created. */
    return { id: null, pending: key, name: name || email, email: email || null };
  };

  return { resolve, toCreate, existing: clients };
}
