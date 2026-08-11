import express from 'express';
import { query, execute, transaction } from '../lib/database.js';
import { depositPayment, withdrawPayment } from '../lib/bank-reconciliation.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { logAudit } from '../lib/audit-logger.js';
import { dispatchWebhookEvent } from '../lib/webhook-dispatcher.js';
import { createReceiptForPayment } from '../lib/receipts.js';
import { notify } from '../lib/notifications.js';
import { sendPaymentReceivedEmail } from '../lib/email.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/payments ──────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { invoice_id, client_id, method, search, date_from, date_to, page = 1, limit = 20 } = req.query;
    const conditions = ['p.tenant_id = ?'];
    const params = [req.tenantId];
    if (invoice_id) { conditions.push('p.invoice_id = ?'); params.push(invoice_id); }
    if (client_id)  { conditions.push('p.client_id = ?');  params.push(client_id); }
    if (method)     { conditions.push('p.method = ?');     params.push(method); }
    if (date_from)  { conditions.push('DATE(p.payment_date) >= ?'); params.push(date_from); }
    if (date_to)    { conditions.push('DATE(p.payment_date) <= ?'); params.push(date_to); }
    if (search)     { conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR p.reference LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = conditions.join(' AND ');
    const rows = await query(
      `SELECT p.*, i.invoice_number, i.currency, c.name as client_name,
              r.id as receipt_id, r.receipt_number
       FROM payments p
       LEFT JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN receipts r ON r.payment_id = p.id
       WHERE ${where} ORDER BY p.payment_date DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(`SELECT COUNT(*) as total FROM payments p LEFT JOIN invoices i ON p.invoice_id = i.id LEFT JOIN clients c ON p.client_id = c.id WHERE ${where}`, params);
    const [{ total_amount }] = await query(`SELECT COALESCE(SUM(p.amount),0) as total_amount FROM payments p LEFT JOIN invoices i ON p.invoice_id = i.id LEFT JOIN clients c ON p.client_id = c.id WHERE ${where}`, params);
    const [{ currency }] = await query("SELECT COALESCE(currency,'SAR') AS currency FROM tenants WHERE id = ?", [req.tenantId]).catch(() => [{ currency: 'SAR' }]);
    res.json({ success: true, data: rows, total, total_amount, currency });
  } catch (err) { failure(res, err, { context: 'payments' }); }
});

/* ── POST /api/payments ─────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { invoice_id, amount, method, payment_date, reference, notes, proof_url, bank_account_id } = req.body;
    if (!invoice_id || !method) {
      return res.status(400).json({ success: false, message: 'invoice_id, amount, method required' });
    }

    /* `!amount` was the whole check, and it is only falsy for 0 and null. A
       payment of -500 passed straight through: it drove paid_amount negative,
       could flip a paid invoice back to unpaid, and — once an account was
       named — would have REDUCED the bank balance by 500 through
       depositPayment. Money coming in is positive; a refund is a credit note,
       not a negative payment.

       This also catches 'abc', which used to survive the truthy test and fail
       in SQL as a 500. */
    const paidAmount = Number(amount);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'The payment amount must be a number greater than zero. To reverse money, raise a credit note.',
      });
    }

    const [invoice] = await query('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [invoice_id, req.tenantId]);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status === 'void') return res.status(400).json({ success: false, message: 'Cannot record payment on a voided invoice' });

    const paidOn = payment_date || new Date();

    /* One transaction for the three writes that have to agree: the payment, the
       invoice's new balance, and — if an account was named — the bank line.
       Previously these were separate statements, so a failure between them left
       an invoice marked paid by money no record could account for. */
    const { paymentId: insertId, newPaidAmount, newStatus } = await transaction(async (conn) => {
      const [ins] = await conn.query(
        `INSERT INTO payments (tenant_id, invoice_id, client_id, amount, method, payment_date, reference, notes, proof_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.tenantId, invoice_id, invoice.client_id, paidAmount, method, paidOn, reference, notes, proof_url]
      );
      const paymentId = ins.insertId;

      const [[{ total_paid }]] = await conn.query(
        'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = ?', [invoice_id]);
      const paid = parseFloat(total_paid);
      const status = paid >= invoice.total_amount ? 'paid' : paid > 0 ? 'partial' : invoice.status;

      await conn.query('UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?', [paid, status, invoice_id]);

      /* Optional by design: cash in a drawer has no bank account, and forcing a
         choice would mean inventing one. Left unreconciled, it shows up on the
         banking screen as work still to do — which is the truth. */
      if (bank_account_id) {
        await depositPayment(conn, {
          tenantId: req.tenantId,
          paymentId,
          accountId: bank_account_id,
          amount: paidAmount,
          date: paidOn,
          description: `Payment for ${invoice.invoice_number}`,
          reference: reference || invoice.invoice_number,
        });
      }

      return { paymentId, newPaidAmount: paid, newStatus: status };
    });

    const result = { insertId };

    // Auto-generate a receipt for this payment (proof of payment received)
    let receipt = null;
    try {
      receipt = await createReceiptForPayment({
        tenantId: req.tenantId,
        payment: {
          id: result.insertId,
          invoice_id,
          client_id: invoice.client_id,
          amount,
          method,
          payment_date: payment_date || new Date(),
          notes,
        },
        invoice,
      });
    } catch (receiptErr) {
      // Don't fail the payment if receipt generation hiccups; surface in logs
      console.error('Receipt generation failed:', receiptErr.message);
    }

    if (newStatus === 'paid') {
      await dispatchWebhookEvent({ tenantId: req.tenantId, event: 'payment.received', payload: { invoice_id, amount } });
    }

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'create', entity: 'payment', entityId: result.insertId });

    // In-app notification for the team (fire-and-forget).
    const [client] = await query('SELECT name, email, preferred_language FROM clients WHERE id = ?', [invoice.client_id]);
    const cur = invoice.currency || '';
    await notify({
      tenantId: req.tenantId,
      type: 'payment',
      title: 'Payment received',
      body: `${client?.name || 'A client'} paid ${cur} ${parseFloat(amount).toLocaleString()} on invoice ${invoice.invoice_number}.`,
      link: `/invoices/${invoice_id}`,
    });

    // Payment-received confirmation to the client (isolated).
    if (client?.email) {
      try {
        await sendPaymentReceivedEmail({
          to: client.email,
          clientName: client.name,
          invoiceNumber: invoice.invoice_number,
          amount: parseFloat(amount).toLocaleString(),
          currency: cur,
          method,
          lang: client.preferred_language || 'en',
        });
      } catch (mailErr) {
        console.error('Payment-received email failed:', mailErr.message);
      }
    }

    res.status(201).json({ success: true, id: result.insertId, new_status: newStatus, paid_amount: newPaidAmount, receipt });
  } catch (err) { failure(res, err, { context: 'payments' }); }
});

/* ── DELETE /api/payments/:id ───────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const [payment] = await query('SELECT * FROM payments WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    await transaction(async (conn) => {
      /* Take the money back out of the bank BEFORE the payment row goes, while
         the link still exists to find it by. Otherwise the deleted payment's
         amount stays in the account balance for ever with no transaction left
         to explain where it came from. */
      await withdrawPayment(conn, { tenantId: req.tenantId, paymentId: payment.id });

      await conn.query('DELETE FROM payments WHERE id = ? AND tenant_id = ?', [payment.id, req.tenantId]);

      const [[{ total_paid }]] = await conn.query(
        'SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = ?', [payment.invoice_id]);
      const [[invoice]] = await conn.query('SELECT total_amount, status FROM invoices WHERE id = ?', [payment.invoice_id]);
      const paid = parseFloat(total_paid);
      const status = paid <= 0 ? 'sent' : paid >= invoice.total_amount ? 'paid' : 'partial';
      await conn.query('UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?', [paid, status, payment.invoice_id]);
    });

    res.json({ success: true, message: 'Payment deleted' });
  } catch (err) { failure(res, err, { context: 'payments' }); }
});

export default router;
