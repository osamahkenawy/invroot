import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware, requireActiveTenant } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/role-gate.js';
import { uploadLogo, uploadSignature, uploadStamp } from '../middleware/upload.js';
import { logAudit } from '../lib/audit-logger.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/company ───────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const [tenant] = await query('SELECT * FROM tenants WHERE id = ?', [req.tenantId]);
    res.json({ success: true, data: tenant });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── PUT /api/company ───────────────────────────────── */
router.put('/', requireOwner, async (req, res) => {
  try {
    const {
      company_name, trading_name, tax_id, registration_id,
      address, city, country, phone, website,
      currency, timezone, date_format, fiscal_year_start,
      footer_text, invoice_terms, lang, industry,
    } = req.body;

    await execute(
      `UPDATE tenants SET company_name=?, trading_name=?, tax_id=?, registration_id=?,
       address=?, city=?, country=?, phone=?, website=?,
       currency=?, timezone=?, date_format=?, fiscal_year_start=?,
       footer_text=?, invoice_terms=?, lang=?, industry=?
       WHERE id=?`,
      [company_name, trading_name, tax_id, registration_id,
       address, city, country, phone, website,
       currency, timezone, date_format, fiscal_year_start,
       footer_text, invoice_terms, lang, industry, req.tenantId]
    );

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'update', entity: 'company', entityId: req.tenantId });
    const [updated] = await query('SELECT * FROM tenants WHERE id = ?', [req.tenantId]);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/company/logo ─────────────────────────── */
router.post('/logo', requireOwner, uploadLogo.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    await execute('UPDATE tenants SET logo_url = ? WHERE id = ?', [req.file.filename, req.tenantId]);
    res.json({ success: true, logo_url: req.file.filename });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/company/stamp ────────────────────────── */
router.post('/stamp', requireOwner, uploadStamp.single('stamp'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    await execute('UPDATE tenants SET stamp_url = ? WHERE id = ?', [req.file.filename, req.tenantId]);
    res.json({ success: true, stamp_url: req.file.filename });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/company/signature ────────────────────── */
router.post('/signature', requireOwner, uploadSignature.single('signature'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const { signatory_name, signatory_title, is_default } = req.body;
    const result = await execute(
      `INSERT INTO company_signatories (tenant_id, name, title, signature_url, is_default)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), title=VALUES(title), signature_url=VALUES(signature_url)`,
      [req.tenantId, signatory_name, signatory_title, req.file.filename, is_default ? 1 : 0]
    );
    res.json({ success: true, id: result.insertId, signature_url: req.file.filename });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/company/signatories ───────────────────── */
router.get('/signatories', async (req, res) => {
  try {
    const signatories = await query('SELECT * FROM company_signatories WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: signatories });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/company/numbering ─────────────────────── */
router.get('/numbering', async (req, res) => {
  try {
    const [settings] = await query('SELECT * FROM invoice_numbering WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: settings || {} });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── PUT /api/company/numbering ─────────────────────── */
router.put('/numbering', requireOwner, async (req, res) => {
  try {
    const {
      invoice_prefix, invoice_start,
      quote_prefix, quote_start,
      credit_note_prefix, credit_note_start,
      receipt_prefix, receipt_start,
      reset_frequency, number_format,
    } = req.body;
    await execute(
      `INSERT INTO invoice_numbering
         (tenant_id, invoice_prefix, invoice_start, quote_prefix, quote_start,
          credit_note_prefix, credit_note_start, receipt_prefix, receipt_start,
          reset_frequency, number_format)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         invoice_prefix=VALUES(invoice_prefix), invoice_start=VALUES(invoice_start),
         quote_prefix=VALUES(quote_prefix), quote_start=VALUES(quote_start),
         credit_note_prefix=VALUES(credit_note_prefix), credit_note_start=VALUES(credit_note_start),
         receipt_prefix=VALUES(receipt_prefix), receipt_start=VALUES(receipt_start),
         reset_frequency=VALUES(reset_frequency), number_format=VALUES(number_format)`,
      [req.tenantId,
       invoice_prefix, invoice_start,
       quote_prefix, quote_start,
       credit_note_prefix, credit_note_start,
       receipt_prefix || 'RCP', receipt_start || 1,
       reset_frequency, number_format || 'date']
    );
    res.json({ success: true, message: 'Numbering settings saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── GET /api/company/branches ─────────────────────── */
router.get('/branches', async (req, res) => {
  try {
    const branches = await query('SELECT * FROM branches WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: branches });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ── POST /api/company/branches ─────────────────────── */
router.post('/branches', requireOwner, async (req, res) => {
  try {
    const { name, address, phone } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Branch name required' });
    const result = await execute(
      'INSERT INTO branches (tenant_id, name, address, phone) VALUES (?, ?, ?, ?)',
      [req.tenantId, name, address, phone]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
