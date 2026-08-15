import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware, requireActiveTenant } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/role-gate.js';
import { uploadAny } from '../middleware/upload.js';
import { putObject, deleteObject, isDisplaySafeImage, resolveAssetUrl, withAssetUrls } from '../lib/storage.js';
import { logAudit } from '../lib/audit-logger.js';
import { failure } from '../lib/api-error.js';
import { usageFor, limitsFor } from '../middleware/plan-limit.js';
import { isSupportedCurrency } from '../lib/currency.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/company ───────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const [tenant] = await query('SELECT * FROM tenants WHERE id = ?', [req.tenantId]);
    res.json({ success: true, data: await withAssetUrls(tenant) });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

/* ── PUT /api/company ───────────────────────────────── */
router.put('/', requireOwner, async (req, res) => {
  try {
    /* Partial update: the Company Profile and Branding screens each submit
       only their own fields, so anything absent from the body must be left
       alone rather than overwritten with NULL. */
    const EDITABLE = [
      'company_name', 'trading_name', 'tax_id', 'registration_id',
      'address', 'city', 'country', 'phone', 'website',
      'currency', 'timezone', 'date_format', 'fiscal_year_start',
      'footer_text', 'invoice_terms', 'lang', 'industry',
      'primary_color', 'accent_color', 'invoice_template',
    ];

    const provided = EDITABLE.filter(k => req.body[k] !== undefined);
    if (!provided.length) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    /* ── Validate before writing ───────────────────────────────
       These land on every invoice, quote and receipt PDF, so a blank company
       name or a junk colour is not a cosmetic problem. */
    if (provided.includes('company_name') && !String(req.body.company_name || '').trim()) {
      return res.status(400).json({ success: false, message: 'Company name cannot be empty.' });
    }
    /* Against the shared list, not a local one. The inline array this replaced
       held ten Gulf-and-major codes while Settings offered a hundred and forty,
       so a tenant in India, Japan, Kenya or Canada picked their own currency
       and was told it was unsupported. */
    if (provided.includes('currency') && !isSupportedCurrency(req.body.currency)) {
      return res.status(400).json({ success: false, message: 'Unsupported currency.' });
    }
    if (provided.includes('lang') && !['en','ar'].includes(req.body.lang)) {
      return res.status(400).json({ success: false, message: 'Unsupported language.' });
    }
    for (const key of ['primary_color', 'accent_color']) {
      if (provided.includes(key) && !/^#[0-9a-fA-F]{3,8}$/.test(String(req.body[key]).trim())) {
        return res.status(400).json({ success: false, message: 'Colours must be a hex value such as #0D1B2A.' });
      }
    }
    if (provided.includes('invoice_template') && !['classic','modern','minimal'].includes(req.body.invoice_template)) {
      return res.status(400).json({ success: false, message: 'Unknown invoice template.' });
    }

    await execute(
      `UPDATE tenants SET ${provided.map(k => `${k}=?`).join(', ')} WHERE id=?`,
      [...provided.map(k => req.body[k]), req.tenantId]
    );

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'update', entity: 'company', entityId: req.tenantId });
    const [updated] = await query('SELECT * FROM tenants WHERE id = ?', [req.tenantId]);
    res.json({ success: true, data: await withAssetUrls(updated) });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

/* ── POST /api/company/logo ─────────────────────────── */
/* Goes through the storage layer rather than straight to disk: on the s3
   driver a container's local disk is wiped on every deploy, which would
   silently blank the logo on every invoice the tenant issues afterwards. */
router.post('/logo', requireOwner, uploadAny.single('logo'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    if (!isDisplaySafeImage(file.mimetype)) {
      return res.status(400).json({ success: false, message: 'The logo must be a PNG, JPEG or WebP image.' });
    }
    const { key } = await putObject({
      tenantId: req.tenantId, kind: 'logo',
      buffer: file.buffer, originalName: file.originalname, contentType: file.mimetype,
    });
    /* Replace, don't accumulate. Without this every re-upload leaves the old
       object in the bucket, billed forever and referenced by nothing. Read the
       previous value first, and only delete once the new one is committed. */
    const [prev] = await query('SELECT logo_url AS old FROM tenants WHERE id = ?', [req.tenantId]);
    await execute('UPDATE tenants SET logo_url = ? WHERE id = ?', [key, req.tenantId]);
    // Only storage keys are ours to delete — legacy bare filenames and
    // externally hosted URLs are not.
    if (prev?.old && prev.old !== key && String(prev.old).startsWith('tenants/')) {
      await deleteObject(prev.old);
    }
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'update', entity: 'company', entityId: req.tenantId });
    res.json({ success: true, logo_url: await resolveAssetUrl(key, 'logos') });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

/* ── POST /api/company/stamp ─────────────────────────── */
/* Goes through the storage layer rather than straight to disk: on the s3
   driver a container's local disk is wiped on every deploy, which would
   silently blank the stamp on every invoice the tenant issues afterwards. */
router.post('/stamp', requireOwner, uploadAny.single('stamp'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    if (!isDisplaySafeImage(file.mimetype)) {
      return res.status(400).json({ success: false, message: 'The stamp must be a PNG, JPEG or WebP image.' });
    }
    const { key } = await putObject({
      tenantId: req.tenantId, kind: 'stamp',
      buffer: file.buffer, originalName: file.originalname, contentType: file.mimetype,
    });
    /* Replace, don't accumulate. Without this every re-upload leaves the old
       object in the bucket, billed forever and referenced by nothing. Read the
       previous value first, and only delete once the new one is committed. */
    const [prev] = await query('SELECT stamp_url AS old FROM tenants WHERE id = ?', [req.tenantId]);
    await execute('UPDATE tenants SET stamp_url = ? WHERE id = ?', [key, req.tenantId]);
    // Only storage keys are ours to delete — legacy bare filenames and
    // externally hosted URLs are not.
    if (prev?.old && prev.old !== key && String(prev.old).startsWith('tenants/')) {
      await deleteObject(prev.old);
    }
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'update', entity: 'company', entityId: req.tenantId });
    res.json({ success: true, stamp_url: await resolveAssetUrl(key, 'stamps') });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

/* ── POST /api/company/signature ────────────────────── */
router.post('/signature', requireOwner, uploadAny.single('signature'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    if (!isDisplaySafeImage(req.file.mimetype)) {
      return res.status(400).json({ success: false, message: 'The signature must be a PNG, JPEG or WebP image.' });
    }
    const { key: signatureKey } = await putObject({
      tenantId: req.tenantId, kind: 'signature',
      buffer: req.file.buffer, originalName: req.file.originalname, contentType: req.file.mimetype,
    });
    const { signatory_name, signatory_title, is_default } = req.body;

    /* The first signature a tenant uploads becomes their default.
       Only the DEFAULT signatory is rendered on documents — getTenantWithBranding
       selects `WHERE is_default = 1`. Without this, someone uploads their one
       and only signature, the request succeeds, and it then never appears on a
       single invoice: no error, no explanation, just an unsigned PDF. Choosing
       a default is meaningful when there are several to choose between; with
       one, it is a question the product should not be asking. */
    const [{ existing }] = await query(
      'SELECT COUNT(*) AS existing FROM company_signatories WHERE tenant_id = ? AND is_default = 1',
      [req.tenantId]
    );
    const makeDefault = is_default ? 1 : (existing ? 0 : 1);

    // Only one default at a time, or the document renderer picks arbitrarily.
    if (makeDefault) {
      await execute('UPDATE company_signatories SET is_default = 0 WHERE tenant_id = ?', [req.tenantId]);
    }

    const result = await execute(
      `INSERT INTO company_signatories (tenant_id, name, title, signature_url, is_default)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), title=VALUES(title),
                               signature_url=VALUES(signature_url), is_default=VALUES(is_default)`,
      [req.tenantId, signatory_name, signatory_title, signatureKey, makeDefault]
    );
    res.json({ success: true, id: result.insertId, signature_url: await resolveAssetUrl(signatureKey, 'signatures') });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

/* ── GET /api/company/signatories ───────────────────── */
router.get('/signatories', async (req, res) => {
  try {
    const signatories = await query('SELECT * FROM company_signatories WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: await Promise.all(signatories.map(withAssetUrls)) });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

/* ── GET /api/company/numbering ─────────────────────── */
router.get('/numbering', async (req, res) => {
  try {
    const [settings] = await query('SELECT * FROM invoice_numbering WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: settings || {} });
  } catch (err) {
    failure(res, err, { context: 'company' });
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
    // ON DUPLICATE KEY UPDATE overwrites every column, so a screen that posts
    // only some fields wiped the rest. Merge onto whatever is already stored.
    const [cur] = await query('SELECT * FROM invoice_numbering WHERE tenant_id = ?', [req.tenantId]);
    const keep = (val, existing, fallback) =>
      val !== undefined && val !== null && val !== '' ? val : (existing ?? fallback);
    const vals = {
      invoice_prefix:     keep(invoice_prefix,     cur?.invoice_prefix,     'INV'),
      invoice_start:      keep(invoice_start,      cur?.invoice_start,      1),
      quote_prefix:       keep(quote_prefix,       cur?.quote_prefix,       'QUO'),
      quote_start:        keep(quote_start,        cur?.quote_start,        1),
      credit_note_prefix: keep(credit_note_prefix, cur?.credit_note_prefix, 'CN'),
      credit_note_start:  keep(credit_note_start,  cur?.credit_note_start,  1),
      receipt_prefix:     keep(receipt_prefix,     cur?.receipt_prefix,     'RCP'),
      receipt_start:      keep(receipt_start,      cur?.receipt_start,      1),
      reset_frequency:    keep(reset_frequency,    cur?.reset_frequency,    'never'),
      number_format:      keep(number_format,      cur?.number_format,      'date'),
    };
    // Prefixes are embedded in every document number — keep them short and sane.
    for (const k of ['invoice_prefix','quote_prefix','credit_note_prefix','receipt_prefix']) {
      vals[k] = String(vals[k]).trim().slice(0, 10);
      if (!vals[k]) return res.status(400).json({ success: false, message: 'Document prefixes cannot be empty.' });
    }

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
       vals.invoice_prefix, vals.invoice_start,
       vals.quote_prefix, vals.quote_start,
       vals.credit_note_prefix, vals.credit_note_start,
       vals.receipt_prefix, vals.receipt_start,
       vals.reset_frequency, vals.number_format]
    );
    res.json({ success: true, message: 'Numbering settings saved' });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

/* ── GET /api/company/branches ─────────────────────── */
router.get('/branches', async (req, res) => {
  try {
    const branches = await query('SELECT * FROM branches WHERE tenant_id = ?', [req.tenantId]);
    res.json({ success: true, data: branches });
  } catch (err) {
    failure(res, err, { context: 'company' });
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
    failure(res, err, { context: 'company' });
  }
});

/* ── GET /api/company/onboarding ────────────────────── */
/* Getting-started checklist for a new workspace. Completion is derived from
   real data rather than stored flags, so it stays honest if a tenant deletes
   everything or completes a step outside the checklist. */
router.get('/onboarding', async (req, res) => {
  try {
    const tid = req.tenantId;
    const [tenant] = await query(
      `SELECT company_name, address, city, country, tax_id, phone, logo_url,
              stamp_url, currency, onboarding_dismissed_at
       FROM tenants WHERE id = ?`,
      [tid]
    );
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

    const [[clients], [invoices], [payments], [members]] = await Promise.all([
      query('SELECT COUNT(*) AS c FROM clients  WHERE tenant_id = ?', [tid]),
      query('SELECT COUNT(*) AS c FROM invoices WHERE tenant_id = ?', [tid]),
      query('SELECT COUNT(*) AS c FROM payments WHERE tenant_id = ?', [tid]),
      query(`SELECT COUNT(*) AS c FROM users
             WHERE tenant_id = ? AND (is_super_admin = 0 OR is_super_admin IS NULL)`, [tid]),
    ]);

    // A profile counts as filled once it has an address or a tax id — the two
    // things an invoice actually needs beyond the company name.
    const profileDone = !!(tenant.company_name && (tenant.address || tenant.tax_id));

    const steps = [
      {
        key: 'profile', done: profileDone,
        title: 'Complete your company profile',
        body: 'Add your address and tax ID so they appear on every invoice.',
        cta: 'Open settings', link: '/settings',
      },
      {
        key: 'logo', done: !!tenant.logo_url,
        title: 'Upload your logo',
        body: 'Your logo is placed on invoices, quotes and receipts.',
        cta: 'Add logo', link: '/settings/branding',
      },
      {
        key: 'client', done: clients.c > 0,
        title: 'Add your first client',
        body: 'Clients are who you bill — you need one before invoicing.',
        cta: 'Add client', link: '/clients',
      },
      {
        key: 'invoice', done: invoices.c > 0,
        title: 'Create your first invoice',
        body: 'Build it, send it as a PDF, and share a payment link.',
        cta: 'New invoice', link: '/invoices',
      },
      {
        key: 'payment', done: payments.c > 0,
        title: 'Record your first payment',
        body: 'Log a payment to see collections and receipts come to life.',
        cta: 'Go to payments', link: '/payments',
      },
    ];

    const completed = steps.filter(s => s.done).length;

    res.json({
      success: true,
      data: {
        steps,
        completed,
        total: steps.length,
        all_done: completed === steps.length,
        dismissed: !!tenant.onboarding_dismissed_at,
        stats: {
          clients: clients.c, invoices: invoices.c,
          payments: payments.c, team_members: members.c,
        },
      },
    });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

/* ── POST /api/company/onboarding/dismiss ───────────── */
router.post('/onboarding/dismiss', async (req, res) => {
  try {
    // `restore: true` brings the checklist back (used by the dashboard link).
    const clearing = req.body?.restore === true;
    await execute(
      `UPDATE tenants SET onboarding_dismissed_at = ${clearing ? 'NULL' : 'NOW()'} WHERE id = ?`,
      [req.tenantId]
    );
    res.json({ success: true, dismissed: !clearing });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

/* ── GET /api/company/usage ─────────────────────────── */
/* Current consumption against the tenant's plan allowance. */
router.get('/usage', async (req, res) => {
  try {
    const plan = req.tenant?.plan;
    res.json({
      success: true,
      data: { plan: plan || 'free', limits: limitsFor(plan), usage: await usageFor(req.tenantId, plan) },
    });
  } catch (err) {
    failure(res, err, { context: 'company' });
  }
});

export default router;
