import express from 'express';
import { query, execute } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { uploadLogo, uploadSignature, uploadStamp, uploadDocument, uploadImage } from '../middleware/upload.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

router.post('/logo',      uploadLogo.single('file'),      (req, res) => res.json({ success: true, filename: req.file?.filename }));
router.post('/signature', uploadSignature.single('file'), (req, res) => res.json({ success: true, filename: req.file?.filename }));
router.post('/stamp',     uploadStamp.single('file'),     (req, res) => res.json({ success: true, filename: req.file?.filename }));
router.post('/document',  uploadDocument.single('file'),  (req, res) => res.json({ success: true, filename: req.file?.filename }));
router.post('/image',     uploadImage.single('file'),     (req, res) => res.json({ success: true, filename: req.file?.filename }));

export default router;
