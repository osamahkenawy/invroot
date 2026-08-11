/**
 * Authenticated file access.
 *
 * Replaces the unauthenticated `express.static('/uploads')` mount. Every read
 * resolves the attachment row first, confirms the caller's tenant owns it, and
 * only then serves the bytes — by redirecting to a short-lived signed S3 URL,
 * or streaming from disk when running on the local driver.
 */

import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { config } from '../config.js';
import { failure, AppError } from '../lib/api-error.js';
import {
  putObject, getObjectStream, deleteObject, signedUrlFor,
  tenantOfKey, KINDS, isS3Configured, driver, isExecutableMime,
} from '../lib/storage.js';
import { uploadAny } from '../middleware/upload.js';
import { logAudit } from '../lib/audit-logger.js';

const router = express.Router();

/* ── GET /api/files/config ──────────────────────────── */
/* Lets the frontend and an admin see which driver is live. */
router.get('/config', authMiddleware, (req, res) => {
  res.json({
    success: true,
    data: {
      driver: driver().name,
      s3_configured: isS3Configured(),
      max_file_size_mb: Math.round(config.app.maxFileSize / (1024 * 1024)),
      kinds: Object.keys(KINDS),
    },
  });
});

/* ── POST /api/files ───────────────────────────────── */
/* Upload one file. `kind` decides where it lands and whether it is private. */
router.post('/', authMiddleware, tenantMiddleware, uploadAny.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new AppError('No file was uploaded.', 400, 'NO_FILE');

    const kind = String(req.body.kind || 'attachment');
    if (!KINDS[kind]) throw new AppError(`Unknown file kind "${kind}".`, 400, 'BAD_KIND');

    const entityType = req.body.entity_type || null;
    const entityId   = req.body.entity_id ? Number(req.body.entity_id) : null;

    const { key, driver: driverName } = await putObject({
      tenantId: req.tenantId,
      kind,
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const result = await execute(
      `INSERT INTO invroot_attachments
         (tenant_id, entity_type, entity_id, kind, storage_key, storage_driver,
          original_name, mime_type, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.tenantId, entityType, entityId, kind, key, driverName,
       req.file.originalname?.slice(0, 255) || null, req.file.mimetype, req.file.size, req.user.id]
    );

    await logAudit({
      tenantId: req.tenantId, userId: req.user.id,
      action: 'upload', entity: 'attachment', entityId: result.insertId, ip: req.ip,
    });

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        kind,
        url: `/api/files/${result.insertId}`,
        original_name: req.file.originalname,
        size_bytes: req.file.size,
      },
    });
  } catch (err) {
    failure(res, err, { context: 'files' });
  }
});

/* ── GET /api/files/:id ────────────────────────────── */
/* Serve a file the caller's tenant owns. */
router.get('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const [row] = await query(
      'SELECT * FROM invroot_attachments WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    // Same response whether it is missing or another tenant's — a 403 here
    // would confirm the id exists, which is itself a leak.
    if (!row) throw new AppError('File not found.', 404, 'NOT_FOUND');

    /* Defence in depth: the row said this tenant owns it, but the key encodes
       the tenant too. If they disagree, something is wrong — refuse. */
    const keyTenant = tenantOfKey(row.storage_key);
    if (keyTenant !== null && keyTenant !== Number(req.tenantId)) {
      console.error(`[files] key/row tenant mismatch on attachment ${row.id}: key=${keyTenant} row=${row.tenant_id}`);
      throw new AppError('File not found.', 404, 'NOT_FOUND');
    }

    /* Decide this BEFORE choosing how to serve: on the s3 driver the answer is
       a redirect, and the browser then fetches from the bucket without ever
       seeing a header we set here. So the instruction has to be baked into the
       signed URL itself. */
    const executable = isExecutableMime(row.mime_type);

    const signed = await signedUrlFor(row.storage_key, {
      expiresIn: config.storage.signedUrlTtl,
      // Force a download for anything a browser would otherwise execute.
      downloadAs: executable ? (row.original_name || 'download') : null,
      contentType: executable ? 'application/octet-stream' : null,
    });
    if (signed) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.redirect(signed);
    }

    // Local driver — stream it, and never let a private file be cached publicly.
    const stream = await getObjectStream(row.storage_key);
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=60');
    /* A stored SVG or HTML file rendered inline runs its script in our own
       origin, with the viewer's session. Force those to download instead, and
       tell the browser not to sniff a different type out of the bytes. */
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (executable) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const disposition = executable ? 'attachment' : 'inline';
    if (row.original_name) {
      res.setHeader('Content-Disposition', `${disposition}; filename="${row.original_name.replace(/"/g, '')}"`);
    } else if (executable) {
      res.setHeader('Content-Disposition', 'attachment');
    }
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (err) {
    failure(res, err, { context: 'files' });
  }
});

/* ── DELETE /api/files/:id ─────────────────────────── */
router.delete('/:id', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const [row] = await query(
      'SELECT * FROM invroot_attachments WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.tenantId]
    );
    if (!row) throw new AppError('File not found.', 404, 'NOT_FOUND');

    await deleteObject(row.storage_key);
    await execute('DELETE FROM invroot_attachments WHERE id = ?', [row.id]);
    // Clear the reference so a client doesn't point at a deleted avatar.
    await execute('UPDATE clients SET avatar_attachment_id = NULL WHERE avatar_attachment_id = ?', [row.id]).catch(() => {});

    await logAudit({
      tenantId: req.tenantId, userId: req.user.id,
      action: 'delete', entity: 'attachment', entityId: row.id, ip: req.ip,
    });
    res.json({ success: true, message: 'File deleted' });
  } catch (err) {
    failure(res, err, { context: 'files' });
  }
});

export default router;
