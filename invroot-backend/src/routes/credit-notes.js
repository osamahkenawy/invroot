import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { nextDocNumber } from '../lib/numbering.js';
import { recalcInvoice } from '../lib/invoice-totals.js';
import { logAudit } from '../lib/audit-logger.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

const REASON_CODES = ['return', 'overpayment', 'discount', 'error', 'goodwill', 'other'];

/** Money already credited against an invoice, ignoring voided notes. */
async function creditedSoFar(invoiceId, excludeId = null) {
  const [{ total }] = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM credit_notes
     WHERE invoice_id = ? AND status <> 'voided' ${excludeId ? 'AND id <> ?' : ''}`,
    excludeId ? [invoiceId, excludeId] : [invoiceId]
  );
  return Number(total);
}

/* ── GET /api/credit-notes ──────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { status, invoice_id, client_id, search, page = 1, limit = 20 } = req.query;
    const conditions = ['cn.tenant_id = ?'];
    const params = [req.tenantId];
    if (status)     { conditions.push('cn.status = ?');     params.push(status); }
    if (invoice_id) { conditions.push('cn.invoice_id = ?'); params.push(invoice_id); }
    if (client_id)  { conditions.push('cn.client_id = ?');  params.push(client_id); }
    if (search) {
      conditions.push('(cn.cn_number LIKE ? OR c.name LIKE ? OR i.invoice_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const lim = Math.min(parseInt(limit) || 20, 100);
    const offset = ((parseInt(page) || 1) - 1) * lim;
    const where = conditions.join(' AND ');

    const rows = await query(
      `SELECT cn.*, c.name AS client_name, i.invoice_number,
              i.total_amount AS invoice_total, i.status AS invoice_status
       FROM credit_notes cn
       LEFT JOIN clients  c ON cn.client_id  = c.id
       LEFT JOIN invoices i ON cn.invoice_id = i.id
       WHERE ${where}
       ORDER BY cn.created_at DESC
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );
    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM credit_notes cn
       LEFT JOIN clients  c ON cn.client_id  = c.id
       LEFT JOIN invoices i ON cn.invoice_id = i.id
       WHERE ${where}`,
      params
    );

    res.json({ success: true, data: rows, total, page: parseInt(page) || 1, limit: lim });
  } catch (err) { failure(res, err, { context: 'credit-notes' }); }
});

/* ── GET /api/credit-notes/summary ──────────────────── */
router.get('/summary', async (req, res) => {
  try {
    const rows = await query(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount
       FROM credit_notes WHERE tenant_id = ? GROUP BY status`,
      [req.tenantId]
    );
    const [{ currency }] = await query(
      "SELECT COALESCE(currency,'SAR') AS currency FROM tenants WHERE id = ?", [req.tenantId]
    ).catch(() => [{ currency: 'SAR' }]);

    const by_status = {};
    let total_issued = 0;
    for (const r of rows) {
      by_status[r.status] = { count: Number(r.count), amount: Number(r.amount) };
      // Voided notes are cancelled paper — they must not inflate the totals.
      if (r.status !== 'voided') total_issued += Number(r.amount);
    }

    res.json({ success: true, data: {
      currency,
      by_status,
      total_issued,
      total_applied: by_status.applied?.amount || 0,
      total_pending: by_status.issued?.amount  || 0,
      total_voided:  by_status.voided?.amount  || 0,
      count: rows.reduce((s, r) => s + Number(r.count), 0),
    } });
  } catch (err) { failure(res, err, { context: 'credit-notes' }); }
});

/* ── GET /api/credit-notes/:id ──────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [cn] = await query(
      `SELECT cn.*, c.name AS client_name, c.email AS client_email,
              i.invoice_number, i.total_amount AS invoice_total,
              i.paid_amount AS invoice_paid, i.status AS invoice_status
       FROM credit_notes cn
       LEFT JOIN clients  c ON cn.client_id  = c.id
       LEFT JOIN invoices i ON cn.invoice_id = i.id
       WHERE cn.id = ? AND cn.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!cn) return res.status(404).json({ success: false, message: 'Credit note not found' });
    res.json({ success: true, data: cn });
  } catch (err) { failure(res, err, { context: 'credit-notes' }); }
});

/* ── POST /api/credit-notes ─────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { invoice_id, reason, reason_code } = req.body;
    // JSON bodies deliver numbers as strings; comparing them raw does a string
    // comparison, so "2000" > "750.0000" is false and the guard never fires.
    const amount = Number(req.body.amount);

    if (!invoice_id) {
      return res.status(400).json({ success: false, message: 'Select the invoice this credit note applies to.' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter a credit amount greater than zero.' });
    }
    if (reason_code && !REASON_CODES.includes(reason_code)) {
      return res.status(400).json({ success: false, message: 'Unknown reason code.' });
    }

    const [invoice] = await query(
      'SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [invoice_id, req.tenantId]);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status === 'draft') {
      return res.status(400).json({ success: false, message: 'A draft invoice cannot be credited — send it first, or edit the invoice instead.' });
    }
    if (invoice.status === 'void') {
      return res.status(400).json({ success: false, message: 'This invoice is void, so there is nothing to credit.' });
    }

    // Every non-voided note against this invoice counts. The old check compared
    // one note to the invoice total, so several notes could together exceed it.
    const invoiceTotal = Number(invoice.total_amount);
    const already      = await creditedSoFar(invoice_id);
    const remaining    = Math.max(0, invoiceTotal - already);
    if (amount > remaining + 1e-6) {
      return res.status(400).json({
        success: false,
        message: already > 0
          ? `Only ${remaining.toFixed(2)} of this invoice is left to credit — ${already.toFixed(2)} has already been credited.`
          : `A credit note cannot exceed the invoice total of ${invoiceTotal.toFixed(2)}.`,
      });
    }

    const cnNumber = await nextDocNumber(req.tenantId, 'credit_note');

    const result = await execute(
      `INSERT INTO credit_notes
         (tenant_id, invoice_id, client_id, cn_number, amount, currency, reason, reason_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
      [req.tenantId, invoice_id, invoice.client_id, cnNumber, amount,
       invoice.currency || null, reason || null, reason_code || 'other']
    );

    // Issued-but-unapplied credit sits on the client's account.
    await execute(
      'UPDATE clients SET credit_balance = COALESCE(credit_balance,0) + ? WHERE id = ? AND tenant_id = ?',
      [amount, invoice.client_id, req.tenantId]
    );

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'create',
      entity: 'credit_note', entityId: result.insertId,
      changes: { cn_number: cnNumber, invoice_id, amount }, ip: req.ip });

    res.status(201).json({ success: true, id: result.insertId, cn_number: cnNumber, amount, remaining_after: remaining - amount });
  } catch (err) { failure(res, err, { context: 'credit-notes' }); }
});

/* ── PUT /api/credit-notes/:id/apply ────────────────── */
router.put('/:id/apply', async (req, res) => {
  try {
    const [cn] = await query(
      'SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!cn) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (cn.status === 'applied') {
      return res.status(400).json({ success: false, message: 'This credit note has already been applied.' });
    }
    if (cn.status === 'voided') {
      return res.status(400).json({ success: false, message: 'A voided credit note cannot be applied.' });
    }
    if (cn.status !== 'issued') {
      return res.status(400).json({ success: false, message: 'Only an issued credit note can be applied.' });
    }

    // Notes created before the over-credit guard existed can exceed the invoice
    // total. Applying one would push paid_amount past the total, so refuse and
    // say why rather than corrupting the invoice.
    const [invoice] = await query(
      'SELECT total_amount FROM invoices WHERE id = ? AND tenant_id = ?', [cn.invoice_id, req.tenantId]);
    if (invoice) {
      const [{ alreadyApplied }] = await query(
        `SELECT COALESCE(SUM(amount),0) AS alreadyApplied
         FROM credit_notes WHERE invoice_id = ? AND status = 'applied' AND id <> ?`,
        [cn.invoice_id, cn.id]
      );
      const wouldTotal = Number(alreadyApplied) + Number(cn.amount);
      if (wouldTotal > Number(invoice.total_amount) + 1e-6) {
        return res.status(400).json({
          success: false,
          message: `This credit note is ${Number(cn.amount).toFixed(2)} but only ${Math.max(0, Number(invoice.total_amount) - Number(alreadyApplied)).toFixed(2)} of the invoice remains. Void it and issue one for the correct amount.`,
        });
      }
    }

    await execute(
      "UPDATE credit_notes SET status = 'applied', applied_at = NOW() WHERE id = ?", [cn.id]);

    // Applying moves the money off the client's open credit and onto the
    // invoice. recalcInvoice already counts applied notes toward paid_amount —
    // this route simply never called it, so applying changed nothing but a label.
    await execute(
      'UPDATE clients SET credit_balance = GREATEST(COALESCE(credit_balance,0) - ?, 0) WHERE id = ? AND tenant_id = ?',
      [Number(cn.amount), cn.client_id, req.tenantId]
    );
    const recalc = await recalcInvoice(cn.invoice_id);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'apply',
      entity: 'credit_note', entityId: cn.id,
      changes: { amount: Number(cn.amount), invoice_id: cn.invoice_id, invoice_status: recalc?.status },
      ip: req.ip });

    res.json({
      success: true,
      invoice_status: recalc?.status,
      invoice_previous_status: recalc?.previousStatus,
      invoice_paid: recalc?.effectivePaid,
      invoice_total: recalc?.total,
    });
  } catch (err) { failure(res, err, { context: 'credit-notes' }); }
});

/* ── PUT /api/credit-notes/:id/void ─────────────────── */
router.put('/:id/void', async (req, res) => {
  try {
    const [cn] = await query(
      'SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!cn) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (cn.status === 'voided') {
      return res.status(400).json({ success: false, message: 'This credit note is already voided.' });
    }

    const wasApplied = cn.status === 'applied';

    await execute(
      "UPDATE credit_notes SET status = 'voided', voided_at = NOW() WHERE id = ?", [cn.id]);

    // Only unapplied credit still sits on the client account. Reversing an
    // applied note here too would deduct the same money twice.
    if (!wasApplied) {
      await execute(
        'UPDATE clients SET credit_balance = GREATEST(COALESCE(credit_balance,0) - ?, 0) WHERE id = ? AND tenant_id = ?',
        [Number(cn.amount), cn.client_id, req.tenantId]
      );
    }

    // A voided note no longer counts toward the invoice, so the invoice may
    // drop back from paid to partial/sent.
    const recalc = await recalcInvoice(cn.invoice_id);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'void',
      entity: 'credit_note', entityId: cn.id,
      changes: { amount: Number(cn.amount), was_applied: wasApplied, invoice_status: recalc?.status },
      ip: req.ip });

    res.json({
      success: true,
      was_applied: wasApplied,
      invoice_status: recalc?.status,
      invoice_previous_status: recalc?.previousStatus,
    });
  } catch (err) { failure(res, err, { context: 'credit-notes' }); }
});

/* ── DELETE /api/credit-notes/:id ───────────────────────
   Voiding is the correct way to cancel an issued note (it keeps the audit
   trail). Deleting is only for a note that never touched an invoice. */
router.delete('/:id', async (req, res) => {
  try {
    const [cn] = await query(
      'SELECT * FROM credit_notes WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!cn) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (cn.status === 'applied') {
      return res.status(400).json({ success: false, message: 'An applied credit note cannot be deleted — void it instead so the invoice is corrected.' });
    }

    if (cn.status !== 'voided') {
      await execute(
        'UPDATE clients SET credit_balance = GREATEST(COALESCE(credit_balance,0) - ?, 0) WHERE id = ? AND tenant_id = ?',
        [Number(cn.amount), cn.client_id, req.tenantId]
      );
    }
    await execute('DELETE FROM credit_notes WHERE id = ? AND tenant_id = ?', [cn.id, req.tenantId]);
    await recalcInvoice(cn.invoice_id);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'delete',
      entity: 'credit_note', entityId: cn.id, changes: { cn_number: cn.cn_number }, ip: req.ip });

    res.json({ success: true });
  } catch (err) { failure(res, err, { context: 'credit-notes' }); }
});

export default router;
