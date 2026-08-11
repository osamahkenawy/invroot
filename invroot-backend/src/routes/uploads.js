/**
 * Generic uploads.
 *
 * These used to write straight to disk and return the bare filename, which the
 * caller stored on its own row. That had two problems: the file carried no
 * tenant, so a guessed filename crossed workspaces, and on the s3 driver the
 * bytes would land on a container disk that is wiped on the next deploy.
 *
 * Every route here now goes through the storage layer. `kind` decides whether
 * the object is a brand asset (embedded in client-facing PDFs, resolved to a
 * URL) or a private document (served only via GET /api/files/:id).
 */

import express from 'express';
import { execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { uploadAny } from '../middleware/upload.js';
import { putObject, isDisplaySafeImage, resolveAssetUrl, KINDS } from '../lib/storage.js';
import { failure, AppError } from '../lib/api-error.js';
import { logAudit } from '../lib/audit-logger.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* Brand assets must be renderable images — an SVG here would end up inline in
   an invoice PDF and on the public invoice page. */
const IMAGE_KINDS = new Set(['logo', 'stamp', 'signature', 'avatar']);

function handler(kind, folder) {
  return async (req, res) => {
    try {
      if (!req.file) throw new AppError('No file was uploaded.', 400, 'NO_FILE');
      if (IMAGE_KINDS.has(kind) && !isDisplaySafeImage(req.file.mimetype)) {
        throw new AppError('That must be a PNG, JPEG or WebP image.', 400, 'NOT_AN_IMAGE');
      }

      const { key, driver } = await putObject({
        tenantId: req.tenantId, kind,
        buffer: req.file.buffer, originalName: req.file.originalname, contentType: req.file.mimetype,
      });

      const result = await execute(
        `INSERT INTO invroot_attachments
           (tenant_id, entity_type, entity_id, kind, storage_key, storage_driver,
            original_name, mime_type, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.tenantId, req.body.entity_type || null,
         req.body.entity_id ? Number(req.body.entity_id) : null,
         kind, key, driver,
         req.file.originalname?.slice(0, 255) || null, req.file.mimetype, req.file.size, req.user.id]
      );

      await logAudit({
        tenantId: req.tenantId, userId: req.user.id,
        action: 'upload', entity: 'attachment', entityId: result.insertId, ip: req.ip,
      });

      /* `key` is what the caller stores on its own row (tenants.logo_url,
         payments.proof_url, …); `url` is what it renders. Public brand assets
         resolve to a fetchable URL, private ones go through /api/files/:id so
         the read is authorised. */
      res.status(201).json({
        success: true,
        id: result.insertId,
        key,
        // Kept so existing callers that read `filename` still get a usable value.
        filename: key,
        url: KINDS[kind]?.public
          ? await resolveAssetUrl(key, folder)
          : `/api/files/${result.insertId}`,
      });
    } catch (err) {
      failure(res, err, { context: 'uploads' });
    }
  };
}

router.post('/logo',      uploadAny.single('file'), handler('logo', 'logos'));
router.post('/signature', uploadAny.single('file'), handler('signature', 'signatures'));
router.post('/stamp',     uploadAny.single('file'), handler('stamp', 'stamps'));
router.post('/document',  uploadAny.single('file'), handler('attachment', 'documents'));
router.post('/image',     uploadAny.single('file'), handler('attachment', 'documents'));
router.post('/avatar',    uploadAny.single('file'), handler('avatar', 'avatars'));

export default router;
