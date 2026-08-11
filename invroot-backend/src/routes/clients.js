import express from 'express';
import { query, execute, transaction } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { logAudit } from '../lib/audit-logger.js';
import { failure, AppError } from '../lib/api-error.js';
import { uploadAny } from '../middleware/upload.js';
import { putObject, deleteObject, isDisplaySafeImage, withAssetUrls, resolveAttachmentUrl } from '../lib/storage.js';
import { enforcePlanLimit } from '../middleware/plan-limit.js';


/* ── Atomic avatar swap ───────────────────────────────────────────────
   Uploading a picture is read-old → insert-new → point-at-new → delete-old.
   Done without a lock that sequence races: two requests (a double-click, or a
   client retry) both read the same old id, both insert, and both delete that
   same old row — leaving the loser's object in the bucket forever, billed and
   referenced by nothing.

   SELECT … FOR UPDATE serialises the swap on the owning row, so each request
   sees whatever the previous one committed and deletes exactly that. Last
   upload wins, which is what someone clicking twice expects, and no object is
   left behind.

   Returns the storage key that was superseded, or null. The caller deletes the
   bytes AFTER the transaction commits — an S3 round trip inside a held row
   lock would make the lock as slow as the network. */
async function swapAvatar({ table, ownerId, tenantId, kind, entityType, file, uploaderId }) {
  const { key, driver: driverName } = await putObject({
    tenantId, kind, buffer: file.buffer,
    originalName: file.originalname, contentType: file.mimetype,
  });

  try {
    return await transaction(async (conn) => {
      const [[owner]] = await conn.query(
        `SELECT avatar_attachment_id FROM ${table} WHERE id = ? FOR UPDATE`, [ownerId]);
      if (!owner) throw new AppError('Not found', 404, 'NOT_FOUND');

      const [ins] = await conn.query(
        `INSERT INTO invroot_attachments
           (tenant_id, entity_type, entity_id, kind, storage_key, storage_driver,
            original_name, mime_type, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tenantId, entityType, ownerId, kind, key, driverName,
         file.originalname?.slice(0, 255) || null, file.mimetype, file.size, uploaderId]);

      await conn.query(`UPDATE ${table} SET avatar_attachment_id = ? WHERE id = ?`, [ins.insertId, ownerId]);

      let supersededKey = null;
      if (owner.avatar_attachment_id) {
        const [[old]] = await conn.query(
          'SELECT storage_key FROM invroot_attachments WHERE id = ?', [owner.avatar_attachment_id]);
        supersededKey = old?.storage_key || null;
        await conn.query('DELETE FROM invroot_attachments WHERE id = ?', [owner.avatar_attachment_id]);
      }
      return { attachmentId: ins.insertId, key, supersededKey };
    });
  } catch (err) {
    // The object is already in the bucket but no row will reference it.
    await deleteObject(key).catch(() => {});
    throw err;
  }
}

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

const buildWhere = (tenantId, filters) => {
  const conditions = ['c.tenant_id = ?'];
  const params = [tenantId];
  if (filters.search) {
    conditions.push('(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)');
    const s = `%${filters.search}%`;
    params.push(s, s, s);
  }
  if (filters.status) { conditions.push('c.status = ?'); params.push(filters.status); }
  if (filters.tag) { conditions.push('JSON_CONTAINS(c.tags, ?)'); params.push(JSON.stringify(filters.tag)); }
  return { where: conditions.join(' AND '), params };
};

/* ── GET /api/clients ───────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const { search, status, tag, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const { where, params } = buildWhere(req.tenantId, { search, status, tag });

    const clients = await query(
      `SELECT c.*, a.storage_key AS avatar_key,
        (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM invoices WHERE client_id = c.id AND status NOT IN ('paid','void')) AS outstanding_balance,
        (SELECT MAX(created_at) FROM invoices WHERE client_id = c.id) AS last_invoice_date
       FROM clients c
       LEFT JOIN invroot_attachments a ON a.id = c.avatar_attachment_id AND a.tenant_id = c.tenant_id
       WHERE ${where}
       ORDER BY c.name ASC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    /* Signing is a local HMAC, not an API call, so doing it per row is cheap. */
    await Promise.all(clients.map(async (c) => {
      c.avatar_url = await resolveAttachmentUrl(c.avatar_key, c.avatar_attachment_id);
      delete c.avatar_key;
    }));

    const [{ total }] = await query(`SELECT COUNT(*) as total FROM clients c WHERE ${where}`, params);
    res.json({ success: true, data: clients, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    failure(res, err, { context: 'clients' });
  }
});

/* ── POST /api/clients ──────────────────────────────── */
router.post('/', enforcePlanLimit('clients'), async (req, res) => {
  try {
    const { name, company_name, email, phone, billing_address, shipping_address, currency, payment_terms, credit_limit, preferred_language, tags, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Client name required' });

    const result = await execute(
      `INSERT INTO clients (tenant_id, name, company_name, email, phone, billing_address, shipping_address, currency, payment_terms, credit_limit, preferred_language, tags, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [req.tenantId, name, company_name || null, email, phone, billing_address, shipping_address, currency || null,
       payment_terms || 30, credit_limit || null, preferred_language || 'en',
       tags ? JSON.stringify(tags) : null, notes]
    );

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'create', entity: 'client', entityId: result.insertId });
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    failure(res, err, { context: 'clients' });
  }
});

/* ── GET /api/clients/:id/statement ─────────────────── */
/* Account ledger: invoices (debit), payments and applied credit notes (credit),
   in date order with a running balance. Optional ?from=&to= window; anything
   before `from` is folded into an opening balance so the maths still ties out. */
router.get('/:id/statement', async (req, res) => {
  try {
    const { from, to } = req.query;
    const [client] = await query(
      'SELECT id, name, email, phone, billing_address, currency FROM clients WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    const [tenant] = await query(
      'SELECT company_name, address, tax_id, logo_url, currency AS tenant_currency FROM tenants WHERE id = ?',
      [req.tenantId]
    );
    const currency = client.currency || tenant?.tenant_currency || '';

    // Void invoices never hit the ledger; draft ones aren't owed yet.
    const invoices = await query(
      `SELECT id, invoice_number AS ref, issue_date AS date, total_amount AS amount, status
       FROM invoices
       WHERE tenant_id = ? AND client_id = ? AND status NOT IN ('void','draft')`,
      [req.tenantId, client.id]
    );
    const payments = await query(
      `SELECT p.id, p.payment_date AS date, p.amount, p.method, i.invoice_number AS ref
       FROM payments p
       LEFT JOIN invoices i ON p.invoice_id = i.id
       WHERE p.tenant_id = ? AND p.client_id = ?`,
      [req.tenantId, client.id]
    );
    const creditNotes = await query(
      `SELECT id, cn_number AS ref, created_at AS date, amount
       FROM credit_notes
       WHERE tenant_id = ? AND client_id = ? AND status IN ('issued','applied','refunded')`,
      [req.tenantId, client.id]
    );

    const rows = [
      ...invoices.map(r => ({
        date: String(r.date).slice(0, 10), type: 'invoice', ref: r.ref,
        description: `Invoice ${r.ref}`, debit: Number(r.amount), credit: 0, status: r.status,
      })),
      ...payments.map(r => ({
        date: String(r.date).slice(0, 10), type: 'payment', ref: r.ref || '—',
        description: `Payment received${r.ref ? ` — ${r.ref}` : ''}${r.method ? ` (${r.method.replace('_', ' ')})` : ''}`,
        debit: 0, credit: Number(r.amount),
      })),
      ...creditNotes.map(r => ({
        date: String(r.date).slice(0, 10), type: 'credit_note', ref: r.ref,
        description: `Credit note ${r.ref}`, debit: 0, credit: Number(r.amount),
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));

    // Everything before the window becomes the opening balance.
    let opening = 0;
    const windowed = [];
    for (const r of rows) {
      if (from && r.date < from) { opening += r.debit - r.credit; continue; }
      if (to && r.date > to) continue;
      windowed.push(r);
    }

    let balance = opening;
    const entries = windowed.map(r => {
      balance += r.debit - r.credit;
      return { ...r, balance: Number(balance.toFixed(2)) };
    });

    const totalDebit  = windowed.reduce((s, r) => s + r.debit, 0);
    const totalCredit = windowed.reduce((s, r) => s + r.credit, 0);

    res.json({
      success: true,
      data: {
        client, company: await withAssetUrls(tenant), currency,
        from: from || null, to: to || null,
        opening_balance: Number(opening.toFixed(2)),
        closing_balance: Number(balance.toFixed(2)),
        total_invoiced: Number(totalDebit.toFixed(2)),
        total_paid: Number(totalCredit.toFixed(2)),
        entries,
      },
    });
  } catch (err) {
    failure(res, err, { context: 'clients' });
  }
});

/* ── GET /api/clients/:id ───────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const [client] = await query(
      `SELECT c.*, a.storage_key AS avatar_key
       FROM clients c
       LEFT JOIN invroot_attachments a ON a.id = c.avatar_attachment_id AND a.tenant_id = c.tenant_id
       WHERE c.id = ? AND c.tenant_id = ?`,
      [req.params.id, req.tenantId]
    );
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    client.avatar_url = await resolveAttachmentUrl(client.avatar_key, client.avatar_attachment_id);
    delete client.avatar_key;

    const invoices    = await query('SELECT id, invoice_number, status, total_amount, due_date FROM invoices WHERE client_id = ? ORDER BY created_at DESC LIMIT 10', [client.id]);
    const quotes      = await query('SELECT id, quote_number, status, total_amount FROM invroot_quotes WHERE client_id = ? ORDER BY created_at DESC LIMIT 10', [client.id]);
    const payments    = await query('SELECT id, amount, method, payment_date FROM payments WHERE client_id = ? ORDER BY payment_date DESC LIMIT 10', [client.id]);
    const notes       = await query('SELECT * FROM client_notes WHERE client_id = ? ORDER BY created_at DESC', [client.id]);

    res.json({ success: true, data: { ...client, invoices, quotes, payments, notes } });
  } catch (err) {
    failure(res, err, { context: 'clients' });
  }
});

/* ── PUT /api/clients/:id ───────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const { name, company_name, email, phone, billing_address, shipping_address, currency, payment_terms, credit_limit, preferred_language, tags, notes, status } = req.body;
    const result = await execute(
      `UPDATE clients SET name=?, company_name=?, email=?, phone=?, billing_address=?, shipping_address=?,
       currency=?, payment_terms=?, credit_limit=?, preferred_language=?, tags=?, notes=?, status=?
       WHERE id=? AND tenant_id=?`,
      [name, company_name || null, email, phone, billing_address, shipping_address, currency, payment_terms, credit_limit,
       preferred_language, tags ? JSON.stringify(tags) : null, notes, status, req.params.id, req.tenantId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Client not found' });
    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'update', entity: 'client', entityId: req.params.id });
    res.json({ success: true, message: 'Client updated' });
  } catch (err) {
    failure(res, err, { context: 'clients' });
  }
});

/* ── DELETE /api/clients/:id ────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const [hasInvoices] = await query('SELECT id FROM invoices WHERE client_id = ? LIMIT 1', [req.params.id]);
    if (hasInvoices) {
      // Soft-delete (archive) if they have invoices
      await execute('UPDATE clients SET status = ? WHERE id = ? AND tenant_id = ?', ['archived', req.params.id, req.tenantId]);
      return res.json({ success: true, message: 'Client archived (has existing invoices)' });
    }
    await execute('DELETE FROM clients WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
    res.json({ success: true, message: 'Client deleted' });
  } catch (err) {
    failure(res, err, { context: 'clients' });
  }
});

/* ── POST /api/clients/:id/notes ────────────────────── */
router.post('/:id/notes', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ success: false, message: 'Note content required' });
    const result = await execute(
      'INSERT INTO client_notes (client_id, tenant_id, user_id, content) VALUES (?, ?, ?, ?)',
      [req.params.id, req.tenantId, req.user.id, content]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    failure(res, err, { context: 'clients' });
  }
});

/* ── POST /api/clients/:id/avatar ───────────────────── */
/* Client profile picture. Stored privately and served through /api/files/:id,
   so a client photo is never reachable by guessing a URL. */
router.post('/:id/avatar', uploadAny.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new AppError('No image was uploaded.', 400, 'NO_FILE');
    /* Not just "is it an image" — an SVG passes that test and can carry a
       <script> that runs whenever the avatar is rendered. */
    if (!isDisplaySafeImage(req.file.mimetype)) {
      throw new AppError('Profile pictures must be a PNG, JPEG or WebP image.', 400, 'NOT_AN_IMAGE');
    }

    // Confirm the client is ours before writing anything to the bucket.
    const [client] = await query('SELECT id FROM clients WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]);
    if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');

    const { attachmentId, key, supersededKey } = await swapAvatar({
      table: 'clients', ownerId: client.id, tenantId: req.tenantId,
      kind: 'avatar', entityType: 'client', file: req.file, uploaderId: req.user.id,
    });
    if (supersededKey) await deleteObject(supersededKey);

    await logAudit({ tenantId: req.tenantId, userId: req.user.id, action: 'update', entity: 'client', entityId: client.id });
    res.status(201).json({
      success: true,
      data: { attachment_id: attachmentId, avatar_url: await resolveAttachmentUrl(key, attachmentId) },
    });
  } catch (err) {
    failure(res, err, { context: 'clients' });
  }
});

/* ── DELETE /api/clients/:id/avatar ─────────────────── */
router.delete('/:id/avatar', async (req, res) => {
  try {
    const [client] = await query(
      'SELECT id, avatar_attachment_id FROM clients WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
    if (!client.avatar_attachment_id) return res.json({ success: true, message: 'No picture to remove' });

    const [att] = await query('SELECT storage_key FROM invroot_attachments WHERE id = ? AND tenant_id = ?',
      [client.avatar_attachment_id, req.tenantId]);
    await execute('UPDATE clients SET avatar_attachment_id = NULL WHERE id = ?', [client.id]);
    if (att) {
      await deleteObject(att.storage_key);
      await execute('DELETE FROM invroot_attachments WHERE id = ?', [client.avatar_attachment_id]);
    }
    res.json({ success: true, message: 'Profile picture removed' });
  } catch (err) {
    failure(res, err, { context: 'clients' });
  }
});

export default router;
