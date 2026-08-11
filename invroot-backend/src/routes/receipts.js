import express from 'express';
import { query } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { generateReceiptPdf } from '../lib/pdf.js';
import { getTenantWithBranding } from '../lib/branding.js';
import { failure } from '../lib/api-error.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/receipts ──────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { client_id, invoice_id, method, search, date_from, date_to, page = 1, limit = 20 } = req.query;
    const conditions = ['r.tenant_id = ?'];
    const params = [req.tenantId];
    if (client_id)  { conditions.push('r.client_id = ?');   params.push(client_id); }
    if (invoice_id) { conditions.push('r.invoice_id = ?');  params.push(invoice_id); }
    if (method)     { conditions.push('r.method = ?');      params.push(method); }
    if (date_from)  { conditions.push('r.issued_date >= ?'); params.push(date_from); }
    if (date_to)    { conditions.push('r.issued_date <= ?'); params.push(date_to); }
    if (search)     { conditions.push('(r.receipt_number LIKE ? OR i.invoice_number LIKE ? OR c.name LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = conditions.join(' AND ');

    const rows = await query(
      `SELECT r.*, i.invoice_number, c.name AS client_name, c.email AS client_email
       FROM receipts r
       LEFT JOIN invoices i ON r.invoice_id = i.id
       LEFT JOIN clients c  ON r.client_id = c.id
       WHERE ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM receipts r
       LEFT JOIN invoices i ON r.invoice_id = i.id
       LEFT JOIN clients c  ON r.client_id = c.id
       WHERE ${where}`, params
    );
    const [{ total_amount }] = await query(
      `SELECT COALESCE(SUM(r.amount), 0) AS total_amount FROM receipts r
       LEFT JOIN invoices i ON r.invoice_id = i.id
       LEFT JOIN clients c  ON r.client_id = c.id
       WHERE ${where}`, params
    );

    res.json({ success: true, data: rows, total, total_amount, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    failure(res, err, { context: 'receipts' });
  }
});

/* ── GET /api/receipts/:id ──────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [receipt] = await query(
      `SELECT r.*, i.invoice_number, c.name AS client_name, c.email AS client_email,
              p.reference AS reference
       FROM receipts r
       LEFT JOIN invoices i ON r.invoice_id = i.id
       LEFT JOIN clients c  ON r.client_id = c.id
       LEFT JOIN payments p ON r.payment_id = p.id
       WHERE r.id = ? AND r.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!receipt) return res.status(404).json({ success: false, message: 'Receipt not found' });
    res.json({ success: true, data: receipt });
  } catch (err) {
    failure(res, err, { context: 'receipts' });
  }
});

/* ── GET /api/receipts/:id/pdf ──────────────────────── */
router.get('/:id/pdf', async (req, res) => {
  try {
    const [receipt] = await query(
      `SELECT r.*, i.invoice_number, c.name AS client_name, c.email AS client_email,
              p.reference AS reference
       FROM receipts r
       LEFT JOIN invoices i ON r.invoice_id = i.id
       LEFT JOIN clients c  ON r.client_id = c.id
       LEFT JOIN payments p ON r.payment_id = p.id
       WHERE r.id = ? AND r.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!receipt) return res.status(404).json({ success: false, message: 'Receipt not found' });

    /* Via getTenantWithBranding, never a raw `SELECT * FROM tenants`.
       tenants.logo_url holds a storage key, not a URL, so the raw row put
       `<img src="tenants/42/logos/ab12.png">` into the PDF — unresolvable in a
       renderer whose HTML arrives through setContent(), so every receipt
       carried a broken image where the tenant's logo belongs. */
    const tenantBranding = await getTenantWithBranding(req.tenantId);
    const pdf = await generateReceiptPdf(receipt, tenantBranding, req.query.lang || tenantBranding?.lang || 'en');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${receipt.receipt_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    failure(res, err, { context: 'receipts' });
  }
});

export default router;
