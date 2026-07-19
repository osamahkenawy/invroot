import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { logAudit } from '../lib/audit-logger.js';
import { dispatchWebhookEvent } from '../lib/webhook-dispatcher.js';
import { createReceiptForPayment } from '../lib/receipts.js';

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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── POST /api/payments ─────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const { invoice_id, amount, method, payment_date, reference, notes, proof_url } = req.body;
    if (!invoice_id || !amount || !method) return res.status(400).json({ success: false, message: 'invoice_id, amount, method required' });

    const [invoice] = await query('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [invoice_id, req.tenantId]);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (invoice.status === 'void') return res.status(400).json({ success: false, message: 'Cannot record payment on a voided invoice' });

    const result = await execute(
      `INSERT INTO payments (tenant_id, invoice_id, client_id, amount, method, payment_date, reference, notes, proof_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, invoice_id, invoice.client_id, amount, method, payment_date || new Date(), reference, notes, proof_url]
    );

    // Recalculate paid amount
    const [{ total_paid }] = await query('SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = ?', [invoice_id]);
    const newPaidAmount = parseFloat(total_paid);
    const newStatus = newPaidAmount >= invoice.total_amount ? 'paid'
      : newPaidAmount > 0 ? 'partial'
      : invoice.status;

    await execute('UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?', [newPaidAmount, newStatus, invoice_id]);

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
    res.status(201).json({ success: true, id: result.insertId, new_status: newStatus, paid_amount: newPaidAmount, receipt });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── DELETE /api/payments/:id ───────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const [payment] = await query('SELECT * FROM payments WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    await execute('DELETE FROM payments WHERE id = ?', [payment.id]);

    // Recalculate
    const [{ total_paid }] = await query('SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = ?', [payment.invoice_id]);
    const [invoice] = await query('SELECT total_amount, status FROM invoices WHERE id = ?', [payment.invoice_id]);
    const newPaidAmount = parseFloat(total_paid);
    const newStatus = newPaidAmount <= 0 ? 'sent' : newPaidAmount >= invoice.total_amount ? 'paid' : 'partial';
    await execute('UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?', [newPaidAmount, newStatus, payment.invoice_id]);

    res.json({ success: true, message: 'Payment deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
