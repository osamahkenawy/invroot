import express from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import { query, execute, transaction } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { generateInvoicePdf } from '../lib/pdf.js';
import { sendInvoiceEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit-logger.js';
import { dispatchWebhookEvent } from '../lib/webhook-dispatcher.js';
import { nextDocNumber, resyncCounter } from '../lib/numbering.js';
import { planRow, buildClientResolver } from '../lib/invoice-import.js';
import { limitsFor } from '../middleware/plan-limit.js';
import { recalcInvoice } from '../lib/invoice-totals.js';
import { failure, AppError } from '../lib/api-error.js';
import { getTenantWithBranding } from '../lib/branding.js';
import { unbilledWorkFor, buildLinesFromWork, claimWork, releaseWork } from '../lib/billable-work.js';
import { enforcePlanLimit } from '../middleware/plan-limit.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* getTenantWithBranding used to live here, privately, describing itself as
   "the one funnel every PDF goes through" — which was only true of invoices.
   Receipts and quotes each built their own tenant object and skipped the asset
   resolution, so their PDFs shipped a broken logo. It now lives in
   lib/branding.js and all three share it. */

/* ── Helper: auto-mark overdue invoices at query time ─────────── */
async function autoMarkOverdue(tenantId) {
  await execute(
    `UPDATE invoices
     SET status = 'overdue'
     WHERE tenant_id = ? AND status IN ('sent','viewed','partial')
       AND due_date < CURDATE()`,
    [tenantId]
  );
}

/* ── Helper: normalise incoming line items ─────────────────────
   The browser filters these, but the API must not trust that — a
   blank description or a negative quantity would otherwise be
   written straight to the invoice. Used by both create and edit. */
function sanitizeLineItems(lineItems) {
  if (!Array.isArray(lineItems)) return [];
  return lineItems
    .filter(i => String(i?.description ?? '').trim() && Number(i?.quantity) > 0)
    .map(i => {
      const quantity  = Number(i.quantity);
      const unitPrice = Math.max(0, Number(i.unit_price) || 0);
      return {
        description: String(i.description).trim(),
        quantity,
        unit_price:  unitPrice,
        tax_rate:    Math.min(100, Math.max(0, Number(i.tax_rate) || 0)),
        total:       quantity * unitPrice,
      };
    });
}

/* ── Helper: money is always computed server-side ───────────── */
function computeTotals(items, discountType, discountValue) {
  const subtotal  = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const taxAmount = items.reduce((s, i) => s + i.quantity * i.unit_price * i.tax_rate / 100, 0);
  const discountAmount = discountType === 'percent'
    ? subtotal * Math.min(100, Math.max(0, Number(discountValue) || 0)) / 100
    : Math.min(Math.max(0, Number(discountValue) || 0), subtotal);
  return {
    subtotal,
    taxAmount,
    discountAmount,
    totalAmount: Math.max(0, subtotal + taxAmount - discountAmount),
  };
}

/* ── Helper: recalculate paid_amount + status after payment change */

/* ══════════════════════════════════════════════════════════════
   GET /api/invoices/summary
   Financial overview: totals, status breakdown, age analysis
   ══════════════════════════════════════════════════════════════ */
router.get('/summary', async (req, res) => {
  try {
    await autoMarkOverdue(req.tenantId);

    // ── Status buckets ─────────────────────────────────────────
    const rows = await query(
      `SELECT
         status,
         COUNT(*)                                    AS count,
         COALESCE(SUM(total_amount), 0)              AS total,
         COALESCE(SUM(paid_amount), 0)               AS paid,
         COALESCE(SUM(total_amount - paid_amount), 0) AS outstanding
       FROM invoices
       WHERE tenant_id = ? AND status != 'void'
       GROUP BY status`,
      [req.tenantId]
    );

    const byStatus = {};
    let grand_total = 0, grand_paid = 0, grand_outstanding = 0, grand_overdue = 0;

    for (const r of rows) {
      byStatus[r.status] = { count: r.count, total: +r.total, paid: +r.paid, outstanding: +r.outstanding };
      if (r.status !== 'draft') {
        grand_total       += +r.total;
        grand_paid        += +r.paid;
        grand_outstanding += +r.outstanding;
      }
      if (r.status === 'overdue') grand_overdue += +r.outstanding;
    }

    // ── Age analysis (unpaid/partial/overdue only) ─────────────
    const ageBuckets = await query(
      `SELECT
         CASE
           WHEN due_date >= CURDATE()                        THEN 'current'
           WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 1  AND 30  THEN '1_30'
           WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND 60  THEN '31_60'
           WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND 90  THEN '61_90'
           ELSE '90plus'
         END AS bucket,
         COUNT(*)                                            AS count,
         COALESCE(SUM(total_amount - paid_amount), 0)       AS amount
       FROM invoices
       WHERE tenant_id = ? AND status IN ('sent','viewed','partial','overdue')
       GROUP BY bucket`,
      [req.tenantId]
    );

    const ageMap = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90plus': 0 };
    const ageCount = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90plus': 0 };
    for (const b of ageBuckets) { ageMap[b.bucket] = +b.amount; ageCount[b.bucket] = +b.count; }

    const age_analysis = [
      { bucket: 'current', label: 'Not yet due',   amount: ageMap.current,  count: ageCount.current  },
      { bucket: '1_30',    label: '1–30 days',     amount: ageMap['1_30'],  count: ageCount['1_30']  },
      { bucket: '31_60',   label: '31–60 days',    amount: ageMap['31_60'], count: ageCount['31_60'] },
      { bucket: '61_90',   label: '61–90 days',    amount: ageMap['61_90'], count: ageCount['61_90'] },
      { bucket: '90plus',  label: '90+ days',      amount: ageMap['90plus'],count: ageCount['90plus']},
    ];

    // ── Credit notes applied globally ─────────────────────────
    const [{ cn_applied }] = await query(
      `SELECT COALESCE(SUM(amount), 0) AS cn_applied
       FROM credit_notes WHERE tenant_id = ? AND status = 'applied'`,
      [req.tenantId]
    );

    // ── Tenant default currency ────────────────────────────────
    const [{ currency }] = await query(
      'SELECT COALESCE(currency, \'SAR\') AS currency FROM tenants WHERE id = ?', [req.tenantId]
    ).catch(() => [{ currency: 'SAR' }]);

    res.json({
      success: true,
      data: {
        currency,
        grand_total,
        grand_paid,
        grand_outstanding,
        grand_overdue,
        cn_applied: +cn_applied,
        by_status: byStatus,
        age_analysis,
      },
    });
  } catch (err) { failure(res, err, { context: 'invoices' }); }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/invoices/:id/relations
   Returns all documents related to this invoice
   ══════════════════════════════════════════════════════════════ */
/* ── GET /api/invoices/unbilled/:clientId ───────────── */
/* What is waiting to be invoiced for this client: tracked hours and
   rebillable expenses that have not yet reached a document. */
router.get('/unbilled/:clientId', async (req, res) => {
  try {
    const [client] = await query('SELECT id, name, currency FROM clients WHERE id = ? AND tenant_id = ?',
      [req.params.clientId, req.tenantId]);
    if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');

    const work = await unbilledWorkFor({ tenantId: req.tenantId, clientId: client.id });
    res.json({ success: true, data: { client, ...work } });
  } catch (err) { failure(res, err, { context: 'invoices' }); }
});

/* ── GET /api/invoices/unbilled ─────────────────────── */
/* A roll-up across every client, so unbilled work is visible without having
   to go looking for it client by client. This is the number that tells you
   there is money sitting in the time sheet. */
router.get('/unbilled', async (req, res) => {
  try {
    const rows = await query(
      /* COALESCE, because a client with no currency of its own bills in the
         tenant's — returning NULL made every consumer invent its own fallback. */
      `SELECT c.id AS client_id, c.name AS client_name,
              COALESCE(c.currency, t.currency, 'AED') AS currency,
              COALESCE(t.hours, 0)        AS hours,
              COALESCE(t.amount, 0)       AS time_amount,
              COALESCE(t.entries, 0)      AS time_count,
              COALESCE(e.amount, 0)       AS expense_amount,
              COALESCE(e.entries, 0)      AS expense_count
         FROM clients c
         LEFT JOIN (
           SELECT client_id, SUM(hours) AS hours,
                  SUM(hours * COALESCE(hourly_rate, 0)) AS amount,
                  COUNT(*) AS entries
             FROM time_entries
            WHERE tenant_id = ? AND invoice_id IS NULL
              AND (status IS NULL OR status = 'unbilled')
            GROUP BY client_id
         ) t ON t.client_id = c.id
         LEFT JOIN (
           SELECT client_id, SUM(COALESCE(billed_amount, amount)) AS amount, COUNT(*) AS entries
             FROM expenses
            WHERE tenant_id = ? AND billable = 1 AND invoice_id IS NULL
            GROUP BY client_id
         ) e ON e.client_id = c.id
         JOIN tenants t ON t.id = c.tenant_id
        WHERE c.tenant_id = ?
          AND (t.entries > 0 OR e.entries > 0)
        ORDER BY (COALESCE(t.amount,0) + COALESCE(e.amount,0)) DESC`,
      [req.tenantId, req.tenantId, req.tenantId]
    );

    const total = rows.reduce((s, r) => s + Number(r.time_amount) + Number(r.expense_amount), 0);
    res.json({
      success: true,
      data: {
        clients: rows,
        total_value: Number(total.toFixed(2)),
        client_count: rows.length,
      },
    });
  } catch (err) { failure(res, err, { context: 'invoices' }); }
});

router.get('/:id/relations', async (req, res) => {
  try {
    const [inv] = await query(
      'SELECT id, quote_id, recurring_schedule_id, parent_invoice_id, relation_type FROM invoices WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const [quote, recurring, payments, creditNotes, parent, children, siblings] = await Promise.all([
      // Linked quote
      inv.quote_id
        ? query('SELECT id, quote_number, status, total_amount, currency FROM invroot_quotes WHERE id = ?', [inv.quote_id])
        : Promise.resolve([]),

      // Recurring schedule
      inv.recurring_schedule_id
        ? query('SELECT id, name, frequency, status FROM recurring_invoices WHERE id = ?', [inv.recurring_schedule_id])
        : Promise.resolve([]),

      // Payment history
      query(
        'SELECT id, amount, method, payment_date, reference, notes FROM payments WHERE invoice_id = ? ORDER BY payment_date ASC',
        [inv.id]
      ),

      // Credit notes applied
      query(
        'SELECT id, cn_number, amount, reason, status, created_at FROM credit_notes WHERE invoice_id = ? ORDER BY created_at DESC',
        [inv.id]
      ),

      // Parent invoice (this is a revision)
      inv.parent_invoice_id
        ? query('SELECT id, invoice_number, status, total_amount, currency, relation_type FROM invoices WHERE id = ?', [inv.parent_invoice_id])
        : Promise.resolve([]),

      // Child revisions of this invoice
      query(
        'SELECT id, invoice_number, status, total_amount, currency, relation_type FROM invoices WHERE parent_invoice_id = ? AND tenant_id = ?',
        [inv.id, req.tenantId]
      ),

      // Recurring siblings (other invoices in same schedule, excluding self)
      inv.recurring_schedule_id
        ? query(
            `SELECT id, invoice_number, status, total_amount, currency, issue_date
             FROM invoices WHERE recurring_schedule_id = ? AND tenant_id = ? AND id != ?
             ORDER BY issue_date DESC LIMIT 10`,
            [inv.recurring_schedule_id, req.tenantId, inv.id]
          )
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: {
        quote:              quote[0] || null,
        recurring_schedule: recurring[0] || null,
        recurring_siblings: siblings,
        payments,
        credit_notes:       creditNotes,
        parent_invoice:     parent[0] || null,
        child_revisions:    children,
      },
    });
  } catch (err) { failure(res, err, { context: 'invoices' }); }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/invoices
   List with balance_due + days_overdue computed columns
   ══════════════════════════════════════════════════════════════ */
router.get('/', async (req, res) => {
  try {
    await autoMarkOverdue(req.tenantId);

    const { status, client_id, search, date_from, date_to, sort, page = 1, limit = 20 } = req.query;
    const conditions = ['i.tenant_id = ?'];
    const params = [req.tenantId];
    /* `status` accepts a comma-separated list so a caller can ask for
       "everything still payable" in one request. The payment picker needs this:
       fetching a page of all invoices and filtering client-side meant the
       oldest overdue ones could sit outside the window and never be shown. */
    if (status) {
      const wanted = String(status).split(',').map(v => v.trim()).filter(Boolean);
      if (wanted.length === 1) {
        conditions.push('i.status = ?'); params.push(wanted[0]);
      } else if (wanted.length > 1) {
        conditions.push(`i.status IN (${wanted.map(() => '?').join(',')})`);
        params.push(...wanted);
      }
    }
    if (client_id) { conditions.push('i.client_id = ?');     params.push(client_id); }
    if (search)    { conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ?)'); const s = `%${search}%`; params.push(s, s); }
    if (date_from) { conditions.push('i.issue_date >= ?');   params.push(date_from); }
    if (date_to)   { conditions.push('i.issue_date <= ?');   params.push(date_to); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = conditions.join(' AND ');

    const invoices = await query(
      `SELECT i.*,
              c.name  AS client_name,
              c.email AS client_email,
              -- Derived fields
              ROUND(i.total_amount - i.paid_amount, 4)  AS balance_due,
              GREATEST(0, DATEDIFF(CURDATE(), i.due_date)) AS days_overdue,
              -- Has relations flags
              (i.quote_id IS NOT NULL)               AS has_quote,
              (i.recurring_schedule_id IS NOT NULL)  AS has_recurring,
              (i.parent_invoice_id IS NOT NULL)      AS has_parent,
              (SELECT COUNT(*) FROM credit_notes cn WHERE cn.invoice_id = i.id) AS cn_count,
              (SELECT COUNT(*) FROM payments p     WHERE p.invoice_id  = i.id) AS payment_count
       FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
       WHERE ${where} ORDER BY ${sort === 'due_asc' ? 'i.due_date ASC, i.created_at ASC' : 'i.created_at DESC'} LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE ${where}`, params
    );

    res.json({ success: true, data: invoices, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

/* ── POST /api/invoices ─────────────────────────────── */
router.post('/', enforcePlanLimit('invoices'), async (req, res) => {
  try {
    const {
      client_id, issue_date, due_date, currency,
      line_items, discount_type, discount_value,
      notes, memo, payment_terms, po_number, lang = 'en',
      stamp_url, signature_url, signatory_id,
      parent_invoice_id = null, relation_type = 'original',
    } = req.body;

    if (!client_id) {
      return res.status(400).json({ success: false, message: 'Please choose a client.' });
    }
    const cleanItems = sanitizeLineItems(line_items);
    if (!cleanItems.length) {
      return res.status(400).json({ success: false, message: 'Every line item needs a description and a quantity above zero.' });
    }
    const { subtotal, taxAmount, discountAmount, totalAmount } =
      computeTotals(cleanItems, discount_type, discount_value);

    const invoiceNumber = await nextDocNumber(req.tenantId, 'invoice');

    const result = await execute(
      `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
        line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount,
        paid_amount, notes, memo, payment_terms, po_number, lang, stamp_url, signature_url, signatory_id,
        parent_invoice_id, relation_type)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, client_id, invoiceNumber, issue_date, due_date, currency,
       JSON.stringify(cleanItems), subtotal, discount_type, discount_value, discountAmount,
       taxAmount, totalAmount, notes, memo, payment_terms, po_number || null, lang,
       stamp_url, signature_url, signatory_id, parent_invoice_id, relation_type]
    );

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'create', entity: 'invoice', entityId: result.insertId });
    await dispatchWebhookEvent({ tenantId: req.tenantId, event: 'invoice.created', payload: { id: result.insertId, invoice_number: invoiceNumber } });

    res.status(201).json({ success: true, id: result.insertId, invoice_number: invoiceNumber });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

/* ── POST /api/invoices/:id/payments ────────────────── */
router.post('/:id/payments', async (req, res) => {
  try {
    const [inv] = await query(
      'SELECT id, total_amount, paid_amount, status FROM invoices WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (inv.status === 'void') return res.status(400).json({ success: false, message: 'Cannot record payment on a voided invoice' });
    if (inv.status === 'paid') return res.status(400).json({ success: false, message: 'Invoice is already fully paid. Use a credit note for overpayment.' });

    const { amount, method, payment_date, reference, notes } = req.body;
    if (!amount || !method) return res.status(400).json({ success: false, message: 'amount and method are required' });

    const balance = parseFloat(inv.total_amount) - parseFloat(inv.paid_amount);
    const overpayment = parseFloat(amount) > balance;

    await execute(
      `INSERT INTO payments (tenant_id, invoice_id, client_id, amount, method, payment_date, reference, notes)
       SELECT ?, ?, client_id, ?, ?, ?, ?, ? FROM invoices WHERE id = ?`,
      [req.tenantId, inv.id, amount, method, payment_date || new Date().toISOString().slice(0,10), reference || null, notes || null, inv.id]
    );

    await recalcInvoice(inv.id);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'payment', entity: 'invoice', entityId: inv.id });

    res.status(201).json({ success: true, overpayment, message: overpayment ? 'Payment recorded (overpayment — consider issuing a credit note for the difference)' : 'Payment recorded' });
  } catch (err) { failure(res, err, { context: 'invoices' }); }
});

/* ── DELETE /api/invoices/:id/payments/:paymentId ────── */
router.delete('/:id/payments/:paymentId', async (req, res) => {
  try {
    const [pmt] = await query('SELECT id, invoice_id FROM payments WHERE id = ? AND invoice_id = ?', [req.params.paymentId, req.params.id]);
    if (!pmt) return res.status(404).json({ success: false, message: 'Payment not found' });

    await execute('DELETE FROM payments WHERE id = ?', [pmt.id]);
    await recalcInvoice(pmt.invoice_id);
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'delete_payment', entity: 'invoice', entityId: pmt.invoice_id });

    res.json({ success: true, message: 'Payment deleted and invoice recalculated' });
  } catch (err) { failure(res, err, { context: 'invoices' }); }
});

/* ── GET /api/invoices/:id ──────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [invoice] = await query(
      `SELECT i.*,
              c.name AS client_name, c.email AS client_email,
              c.billing_address AS client_address, c.preferred_language AS client_lang,
              ROUND(i.total_amount - i.paid_amount, 4) AS balance_due,
              GREATEST(0, DATEDIFF(CURDATE(), i.due_date)) AS days_overdue
       FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
       WHERE i.id = ? AND i.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const payments = await query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date ASC', [invoice.id]);
    const creditNotes = await query('SELECT * FROM credit_notes WHERE invoice_id = ? ORDER BY created_at DESC', [invoice.id]);

    res.json({ success: true, data: { ...invoice, payments, credit_notes: creditNotes } });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

/* ── PUT /api/invoices/:id ──────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const [inv] = await query('SELECT status FROM invoices WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    // A voided invoice is a closed audit record — it stays closed.
    // A paid/partial one MAY be edited; its status is re-derived from the
    // payments actually on file once the new total is known (see below).
    if (inv.status === 'void') {
      return res.status(400).json({ success: false, message: 'A voided invoice can no longer be edited.' });
    }

    const { issue_date, due_date, currency, line_items, discount_type, discount_value, notes, memo, payment_terms, po_number, lang, stamp_url, signature_url, signatory_id } = req.body;

    const cleanItems = sanitizeLineItems(line_items);
    if (!cleanItems.length) {
      return res.status(400).json({ success: false, message: 'Every line item needs a description and a quantity above zero.' });
    }
    const { subtotal, taxAmount, discountAmount, totalAmount } =
      computeTotals(cleanItems, discount_type, discount_value);

    await execute(
      `UPDATE invoices SET issue_date=?, due_date=?, currency=?, line_items=?, subtotal=?,
       discount_type=?, discount_value=?, discount_amount=?, tax_amount=?, total_amount=?,
       notes=?, memo=?, payment_terms=?, po_number=?, lang=?, stamp_url=?, signature_url=?, signatory_id=?
       WHERE id=? AND tenant_id=?`,
      [issue_date, due_date, currency, JSON.stringify(cleanItems), subtotal,
       discount_type, discount_value, discountAmount, taxAmount, totalAmount,
       notes, memo, payment_terms, po_number || null, lang, stamp_url, signature_url, signatory_id, req.params.id, req.tenantId]
    );

    // Re-derive the status from the payments actually recorded. Raising the
    // total above what was paid downgrades 'paid' -> 'partial' (or 'sent'),
    // so an edited invoice can never claim to be settled when it isn't.
    const recalc = await recalcInvoice(req.params.id);

    await logAudit({
      tenantId: req.tenantId, userId: req.user.id, action: 'update',
      entity: 'invoice', entityId: Number(req.params.id), ip: req.ip,
      changes: recalc && recalc.previousStatus !== recalc.status
        ? { status: [recalc.previousStatus, recalc.status] }
        : null,
    });

    res.json({
      success: true,
      message: 'Invoice updated',
      previous_status: recalc?.previousStatus,
      status: recalc?.status,
      status_changed: !!recalc && recalc.previousStatus !== recalc.status,
      paid_amount: recalc?.effectivePaid,
      total_amount: recalc?.total,
    });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

/* ── POST /api/invoices/:id/send ────────────────────── */
/* Generate the PDF and email one invoice, then mark it sent. Shared by the
   single-send route and the bulk endpoint. Throws on failure. */
async function sendInvoiceById(tenantId, id, userId, langOverride) {
  const [invoice] = await query(
    `SELECT i.*, c.email as client_email, c.name as client_name, c.preferred_language as client_lang,
            t.company_name, t.logo_url, t.address, t.tax_id, t.footer_text
     FROM invoices i
     JOIN clients c ON i.client_id = c.id
     JOIN tenants t ON i.tenant_id = t.id
     WHERE i.id = ? AND i.tenant_id = ?`,
    [id, tenantId]
  );
  if (!invoice) throw new AppError('Invoice not found', 404, 'NOT_FOUND');
  if (!invoice.client_email) throw new AppError('This client has no email address on file.', 400, 'NO_CLIENT_EMAIL');

  const lang = langOverride || invoice.lang || invoice.client_lang || 'en';
  const tenantBranding = await getTenantWithBranding(tenantId);
  const pdfBuffer = await generateInvoicePdf(invoice, tenantBranding, lang);

  await sendInvoiceEmail({
    to: invoice.client_email,
    clientName: invoice.client_name,
    // Whose invoice this is. Already joined above for the PDF.
    companyName: invoice.company_name,
    invoiceNumber: invoice.invoice_number,
    dueDate: invoice.due_date,
    totalAmount: invoice.total_amount,
    currency: invoice.currency,
    pdfBuffer,
    lang,
  });

  await execute("UPDATE invoices SET status = 'sent', sent_at = NOW() WHERE id = ?", [invoice.id]);
  await logAudit({ tenantId, userId, action: 'send', entity: 'invoice', entityId: invoice.id });
  await dispatchWebhookEvent({ tenantId, event: 'invoice.sent', payload: { id: invoice.id } });
}

/* ── POST /api/invoices/:id/mark-sent ─────────────────
   Leave draft WITHOUT emailing.

   Sending was the only way out of draft, and it always emails the client. So
   an invoice handed over in person, on WhatsApp, or through the customer's own
   portal had nowhere to go: editing it never changes the status, and the only
   button that does would mail a duplicate to the client. It sat as a draft for
   ever, missing from every "money owed" figure — because outstanding and aging
   both count sent invoices, not drafts.

   Deliberately narrow: draft → sent only. Reversing a sent invoice, voiding, or
   marking paid are different decisions with their own rules. */
router.post('/:id/mark-sent', async (req, res) => {
  try {
    const [invoice] = await query(
      'SELECT id, status, invoice_number FROM invoices WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status !== 'draft') {
      return res.status(409).json({
        success: false,
        message: `${invoice.invoice_number} is already ${invoice.status}, so it cannot be marked as sent.`,
      });
    }

    /* The same conditional-UPDATE guard used elsewhere: if someone sent it for
       real between the read and this write, affectedRows comes back 0 and we
       must not overwrite sent_at or claim we changed anything. */
    const result = await execute(
      "UPDATE invoices SET status = 'sent', sent_at = NOW() WHERE id = ? AND tenant_id = ? AND status = 'draft'",
      [invoice.id, req.tenantId]
    );
    if (!result.affectedRows) {
      return res.status(409).json({
        success: false,
        message: 'Someone changed this invoice a moment ago. Reload and try again.',
      });
    }

    /* A distinct audit action from 'send' — "we emailed the customer" and "we
       recorded that it went out somehow" are different claims, and the audit
       log is where that difference matters. */
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'mark-sent', entity: 'invoice', entityId: invoice.id });
    await dispatchWebhookEvent({ tenantId: req.tenantId, event: 'invoice.sent', payload: { id: invoice.id, emailed: false } });

    res.json({ success: true, message: `${invoice.invoice_number} is now marked as sent.`, status: 'sent' });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

router.post('/:id/send', async (req, res) => {
  try {
    await sendInvoiceById(req.tenantId, req.params.id, req.user.id, req.body.lang);
    res.json({ success: true, message: 'Invoice sent' });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

/* ── POST /api/invoices/bulk ─────────────────────────── */
/* Apply one action to many invoices: send | mark-paid | void. */
router.post('/bulk', async (req, res) => {
  try {
    const { ids, action } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No invoices selected' });
    }
    if (!['send', 'mark-paid', 'void'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Unknown bulk action' });
    }

    // Restrict to invoices owned by this tenant.
    const ph = ids.map(() => '?').join(',');
    const rows = await query(
      `SELECT id FROM invoices WHERE tenant_id = ? AND id IN (${ph})`,
      [req.tenantId, ...ids]
    );
    const validIds = rows.map(r => r.id);
    if (validIds.length === 0) return res.status(404).json({ success: false, message: 'No matching invoices' });

    let affected = 0, failed = 0;
    const vph = validIds.map(() => '?').join(',');

    if (action === 'void') {
      const r = await execute(
        `UPDATE invoices SET status = 'void' WHERE tenant_id = ? AND status <> 'paid' AND id IN (${vph})`,
        [req.tenantId, ...validIds]
      );
      affected = r.affectedRows;
      // Same reasoning as the single void: give the work back, or it is lost.
      for (const id of validIds) {
        await releaseWork(null, { tenantId: req.tenantId, invoiceId: Number(id) }).catch(() => {});
      }
    } else if (action === 'mark-paid') {
      const r = await execute(
        `UPDATE invoices SET status = 'paid', paid_amount = total_amount WHERE tenant_id = ? AND status <> 'void' AND id IN (${vph})`,
        [req.tenantId, ...validIds]
      );
      affected = r.affectedRows;
    } else if (action === 'send') {
      for (const id of validIds) {
        try { await sendInvoiceById(req.tenantId, id, req.user.id, req.body.lang); affected++; }
        catch { failed++; }
      }
    }

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: `bulk_${action}`, entity: 'invoice', entityId: 0 });
    res.json({ success: true, action, affected, failed });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

/* ── POST /api/invoices/from-unbilled ───────────────── */
/* Turn selected hours and expenses into a draft invoice.
 *
 * Everything happens in one transaction. If the work cannot be claimed —
 * because someone else invoiced it a second earlier — the invoice is not
 * created either. A partially-successful version of this would bill a customer
 * twice for the same job, which is the failure this whole path exists to
 * prevent. */
/* ── POST /api/invoices/import ────────────────────────
   Bring in invoices that already exist elsewhere.

   Deliberately NOT the normal create path. That one assigns the next number in
   sequence, forces status 'draft', recomputes totals at today's tax rates, and
   — through the payments route — emails the customer. Applied to two years of
   history that means renumbered invoices, a revenue report full of drafts, and
   every customer emailed about payments they made long ago.

   `dry_run: true` validates and reports without writing anything. The same
   planning code decides both outcomes, so a clean dry run genuinely predicts a
   clean import. */
router.post('/import', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.invoices) ? req.body.invoices : null;
    if (!rows) return res.status(400).json({ success: false, message: 'Send { invoices: [...] }.' });
    if (!rows.length) return res.status(400).json({ success: false, message: 'There are no invoices in this file.' });
    if (rows.length > 1000) {
      return res.status(400).json({
        success: false,
        message: `This file has ${rows.length} invoices. Import at most 1000 at a time so a failure is easy to unpick.`,
      });
    }

    const dryRun = req.body.dry_run !== false;   // safe by default: you must ask to commit
    const createMissingClients = !!req.body.create_missing_clients;

    /* Numbers already on record. Re-running an import after fixing a few rows
       is the normal way this gets used, so previously-imported numbers are
       skipped rather than treated as failures. */
    const existing = await query('SELECT invoice_number FROM invoices WHERE tenant_id = ?', [req.tenantId]);
    const existingNumbers = {
      inDb: new Set(existing.map(r => r.invoice_number)),
      inFile: new Set(),
    };

    const resolver = await buildClientResolver({ tenantId: req.tenantId, createMissing: createMissingClients });
    const plans = rows.map((row, i) =>
      planRow(row, { index: i, clientResolver: resolver.resolve, existingNumbers }));

    const invalid   = plans.filter(p => p.errors.length);
    const skipped   = plans.filter(p => !p.errors.length && p.skip);
    const importable = plans.filter(p => !p.errors.length && !p.skip);

    /* Capacity is checked for the WHOLE batch before anything is written.
       enforcePlanLimit() as middleware would admit the request and then fail
       partway through, leaving half a year of history imported — the worst
       possible outcome, because the second run cannot tell what is missing. */
    const limits = limitsFor(req.tenant?.plan);
    const limit = limits.maxInvoices;
    let capacity = null;
    if (limit !== -1) {
      const [{ c }] = await query(
        limits.lifetime
          ? 'SELECT COUNT(*) c FROM invoices WHERE tenant_id = ?'
          : 'SELECT COUNT(*) c FROM invoices WHERE tenant_id = ? AND YEAR(issue_date) = YEAR(CURDATE())',
        [req.tenantId]);
      capacity = { used: Number(c), limit, remaining: Math.max(0, limit - Number(c)) };
      if (!dryRun && importable.length > capacity.remaining) {
        return res.status(402).json({
          success: false,
          code: 'PLAN_LIMIT',
          message: `Your plan allows ${limit} invoices and ${capacity.used} are already recorded. ` +
                   `This file would add ${importable.length}. Nothing was imported.`,
          capacity,
        });
      }
    }

    const report = (committed) => ({
      success: true,
      dry_run: !committed,
      summary: {
        total: rows.length,
        importable: importable.length,
        skipped: skipped.length,
        invalid: invalid.length,
        clients_to_create: resolver.toCreate.size,
        value: Number(importable.reduce((s, p) => s + p.values.total_amount, 0).toFixed(2)),
      },
      capacity,
      rows: plans.map(p => ({
        index: p.index,
        invoice_number: p.invoice_number,
        outcome: p.errors.length ? 'invalid' : p.skip ? 'skipped' : (committed ? 'imported' : 'ready'),
        skip_reason: p.skip || undefined,
        client: p.client?.name || null,
        total: p.values.total_amount,
        status: p.values.status,
        errors: p.errors,
        warnings: p.warnings,
      })),
    });

    if (dryRun) return res.json(report(false));

    if (!importable.length) {
      return res.status(400).json({
        ...report(false),
        success: false,
        message: invalid.length
          ? 'Nothing could be imported — every row has an error. See the row details.'
          : 'Every invoice in this file has already been imported.',
      });
    }

    /* Clients first, in their own transaction. A row must never be written
       against a client that failed to be created. */
    const createdClients = new Map();
    if (resolver.toCreate.size) {
      await transaction(async (conn) => {
        for (const [key, c] of resolver.toCreate) {
          const [r] = await conn.query(
            `INSERT INTO clients (tenant_id, name, email, currency, status) VALUES (?, ?, ?, ?, 'active')`,
            [req.tenantId, c.name, c.email, c.currency || req.tenant?.currency || 'AED']);
          createdClients.set(key, r.insertId);
        }
      });
    }

    /* One transaction PER invoice, not one for the batch. A single bad row in
       a thousand should not roll back 999 good ones — the person would have no
       way to tell which rows to retry. Each result says what happened. */
    const results = [];
    for (const p of importable) {
      const clientId = p.client?.id ?? createdClients.get(p.client?.pending);
      if (!clientId) {
        results.push({ index: p.index, invoice_number: p.invoice_number, outcome: 'invalid',
                       errors: [{ code: 'client_create_failed', params: {},
                                  msg: 'The client for this row could not be created.' }] });
        continue;
      }
      try {
        const id = await transaction(async (conn) => {
          const v = p.values;
          const [ins] = await conn.query(
            `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
                line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount,
                paid_amount, notes, po_number, lang, relation_type, sent_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, 'en', 'original', ?)`,
            [req.tenantId, clientId, v.invoice_number, v.status, v.issue_date, v.due_date,
             v.currency || req.tenant?.currency || 'AED',
             JSON.stringify(v.line_items), v.subtotal, v.discount_amount, v.tax_amount,
             v.total_amount, v.paid_amount, v.notes, v.po_number,
             /* An imported invoice that is not a draft was, by definition,
                already issued — otherwise it would show as never sent. */
             v.status === 'draft' ? null : v.issue_date]
          );
          const invoiceId = ins.insertId;

          /* Payments are written directly. Going through the payments route
             would email the customer, fire a webhook, raise a notification and
             generate a receipt — for money received two years ago. */
          for (const pay of v.payments) {
            await conn.query(
              `INSERT INTO payments (tenant_id, invoice_id, client_id, amount, method, payment_date, reference, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [req.tenantId, invoiceId, clientId, pay.amount, pay.method, pay.payment_date, pay.reference, pay.notes]
            );
          }
          return invoiceId;
        });
        results.push({ index: p.index, invoice_number: p.invoice_number, outcome: 'imported', id,
                       warnings: p.warnings });
      } catch (err) {
        /* The unique index is the backstop against a number that appeared
           between the plan and the write. */
        const msg = err.code === 'ER_DUP_ENTRY'
          ? `Invoice ${p.invoice_number} already exists.`
          : err.sqlMessage || err.message;
        results.push({ index: p.index, invoice_number: p.invoice_number, outcome: 'failed',
                       errors: [{ code: 'write_failed', params: { detail: msg }, msg }] });
      }
    }

    const imported = results.filter(r => r.outcome === 'imported');

    /* If the imported numbers happen to match this tenant's own format — a
       migration from another Invroot workspace, say — the counter has to move
       past them, or the next new invoice would collide. Forward only: another
       request may be holding a reserved number right now, and rewinding would
       hand it out a second time.

       Legacy numbers in a foreign format (2024-001) are ignored by design;
       that other system's sequence is not ours to continue. */
    await resyncCounter(req.tenantId, 'invoice', { forwardOnly: true }).catch(() => {});

    await logAudit({
      tenantId: req.tenantId, userId: req.user.id, action: 'import', entity: 'invoice',
      entityId: null,
      changes: { imported: imported.length, of: rows.length, numbers: imported.map(r => r.invoice_number) },
    }).catch(() => {});

    const base = report(true);
    res.json({
      ...base,
      summary: {
        ...base.summary,
        imported: imported.length,
        failed: results.filter(r => r.outcome === 'failed').length,
        clients_created: createdClients.size,
      },
      rows: base.rows.map(r => {
        const actual = results.find(x => x.index === r.index);
        return actual ? { ...r, ...actual } : r;
      }),
    });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

router.post('/from-unbilled', enforcePlanLimit('invoices'), async (req, res) => {
  try {
    const {
      client_id, time_entry_ids = [], expense_ids = [],
      issue_date, due_date, currency, notes, payment_terms, lang = 'en',
    } = req.body || {};

    if (!client_id) throw new AppError('Please choose a client.', 400, 'NO_CLIENT');
    if (!time_entry_ids.length && !expense_ids.length) {
      throw new AppError('Select some work to invoice.', 400, 'NOTHING_SELECTED');
    }

    const [client] = await query('SELECT id, currency, payment_terms FROM clients WHERE id = ? AND tenant_id = ?',
      [client_id, req.tenantId]);
    if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');

    const tenantBranding = await getTenantWithBranding(req.tenantId);
    const invCurrency = currency || client.currency || tenantBranding.currency || 'AED';

    const lines = await buildLinesFromWork({
      tenantId: req.tenantId, clientId: client.id,
      timeIds: time_entry_ids, expenseIds: expense_ids, currency: invCurrency,
    });

    const cleanItems = sanitizeLineItems(lines);
    if (!cleanItems.length) throw new AppError('That work produced no billable lines.', 400, 'NO_LINES');
    const { subtotal, taxAmount, discountAmount, totalAmount } = computeTotals(cleanItems, null, 0);

    const terms = payment_terms ?? client.payment_terms ?? 30;
    const issue = issue_date || new Date().toISOString().slice(0, 10);
    const due = due_date || new Date(Date.now() + terms * 86400000).toISOString().slice(0, 10);

    const result = await transaction(async (conn) => {
      /* The number is allocated inside the transaction so a rolled-back
         attempt doesn't consume one and leave a gap in the sequence. */
      const invoiceNumber = await nextDocNumber(req.tenantId, 'invoice');

      const [ins] = await conn.query(
        `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
           line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount,
           paid_amount, notes, payment_terms, lang)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, 0, ?, ?, ?)`,
        [req.tenantId, client.id, invoiceNumber, issue, due, invCurrency,
         JSON.stringify(cleanItems), subtotal, discountAmount, taxAmount, totalAmount,
         notes || null, terms, lang]
      );

      // Throws if anything was claimed in the meantime — rolls the invoice back.
      await claimWork(conn, {
        tenantId: req.tenantId, invoiceId: ins.insertId,
        timeIds: time_entry_ids, expenseIds: expense_ids,
      });

      return { id: ins.insertId, invoiceNumber };
    });

    await logAudit({
      tenantId: req.tenantId, userId: req.user.id, action: 'create',
      entity: 'invoice', entityId: result.id,
      meta: { from: 'unbilled_work', time: time_entry_ids.length, expenses: expense_ids.length },
    }).catch(() => {});
    await dispatchWebhookEvent({
      tenantId: req.tenantId, event: 'invoice.created',
      payload: { id: result.id, invoice_number: result.invoiceNumber },
    }).catch(() => {});

    res.status(201).json({
      success: true, id: result.id, invoice_number: result.invoiceNumber,
      billed: { time: time_entry_ids.length, expenses: expense_ids.length, total: totalAmount },
    });
  } catch (err) { failure(res, err, { context: 'invoices' }); }
});

/* ── GET /api/invoices/:id/pdf ──────────────────────── */
router.get('/:id/pdf', async (req, res) => {
  try {
    const [invoice] = await query(
      `SELECT i.*, c.name as client_name, c.email as client_email, c.billing_address as client_address,
              t.company_name, t.logo_url, t.address, t.tax_id, t.footer_text
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       JOIN tenants t ON i.tenant_id = t.id
       WHERE i.id = ? AND i.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const lang = req.query.lang || invoice.lang || 'en';
    const tenantBranding = await getTenantWithBranding(req.tenantId);
    const pdfBuffer = await generateInvoicePdf(invoice, tenantBranding, lang);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

/* ── POST /api/invoices/:id/public-link ──────────────── */
/* Return (creating if needed) the shareable public payment link. */
router.post('/:id/public-link', async (req, res) => {
  try {
    const [inv] = await query('SELECT public_token FROM invoices WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    let token = inv.public_token;
    if (!token) {
      token = crypto.randomBytes(20).toString('hex');
      await execute('UPDATE invoices SET public_token = ? WHERE id = ?', [token, req.params.id]);
    }
    res.json({ success: true, token, url: `${config.app.frontendUrl}/pay/${token}` });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

/* ── POST /api/invoices/:id/void ────────────────────── */
router.post('/:id/void', async (req, res) => {
  try {
    const result = await execute(
      "UPDATE invoices SET status = 'void' WHERE id = ? AND tenant_id = ? AND status NOT IN ('paid')",
      [req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(400).json({ success: false, message: 'Cannot void this invoice' });

    /* Hand the work back. A voided invoice no longer charges for anything, so
       leaving its hours and expenses flagged 'billed' would strand them
       against a dead document — invisible to the next invoice and impossible
       to recover without editing the database by hand. */
    await releaseWork(null, { tenantId: req.tenantId, invoiceId: Number(req.params.id) });

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'void', entity: 'invoice', entityId: req.params.id });
    res.json({ success: true, message: 'Invoice voided' });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

/* ── POST /api/invoices/:id/duplicate ───────────────── */
router.post('/:id/duplicate', async (req, res) => {
  try {
    const [inv] = await query('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const newNumber = await nextDocNumber(req.tenantId, 'invoice');
    const relationType = req.body.relation_type || 'duplicate';

    // MySQL hands JSON columns back already parsed, so re-serialise before
    // writing or the driver stringifies the object into invalid JSON.
    const lineItems = typeof inv.line_items === 'string'
      ? inv.line_items
      : JSON.stringify(inv.line_items || []);

    // A copy starts its payment clock today rather than inheriting a due date
    // that may already be in the past.
    const terms = Number(inv.payment_terms) || 0;

    const result = await execute(
      `INSERT INTO invoices (tenant_id, client_id, invoice_number, status, issue_date, due_date, currency,
        line_items, subtotal, discount_type, discount_value, discount_amount, tax_amount, total_amount,
        paid_amount, notes, memo, payment_terms, po_number, lang,
        stamp_url, signature_url, signatory_id, parent_invoice_id, relation_type)
       VALUES (?, ?, ?, 'draft', CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [inv.tenant_id, inv.client_id, newNumber, terms, inv.currency,
       lineItems, inv.subtotal, inv.discount_type, inv.discount_value,
       inv.discount_amount, inv.tax_amount, inv.total_amount,
       inv.notes, inv.memo, terms, inv.po_number, inv.lang,
       inv.stamp_url, inv.signature_url, inv.signatory_id,
       inv.id, relationType]
    );

    res.status(201).json({ success: true, id: result.insertId, invoice_number: newNumber });
  } catch (err) {
    failure(res, err, { context: 'invoices' });
  }
});

export default router;
