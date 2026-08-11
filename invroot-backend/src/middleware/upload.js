import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Resolve the upload root absolutely so it never depends on process.cwd(),
   and keep it in step with the static mount in server.js. */
const UPLOAD_ROOT = path.isAbsolute(config.app.uploadDir)
  ? config.app.uploadDir
  : path.resolve(__dirname, '..', '..', config.app.uploadDir);

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_DOC_TYPES   = ['application/pdf', ...ALLOWED_IMAGE_TYPES];

function buildStorage(subfolder) {
  const dir = path.join(UPLOAD_ROOT, subfolder);
  // multer does not create its destination — without this every upload
  // fails with ENOENT on a fresh checkout.
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = crypto.randomBytes(16).toString('hex');
      cb(null, `${name}${ext}`);
    },
  });
}

function fileFilter(allowedTypes) {
  return (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Only these types are allowed: ${allowedTypes.join(', ')}`));
    }
  };
}

export const uploadImage = multer({
  storage: buildStorage('images'),
  limits: { fileSize: config.app.maxFileSize },
  fileFilter: fileFilter(ALLOWED_IMAGE_TYPES),
});

export const uploadDocument = multer({
  storage: buildStorage('documents'),
  limits: { fileSize: config.app.maxFileSize },
  fileFilter: fileFilter(ALLOWED_DOC_TYPES),
});

export const uploadLogo = multer({
  storage: buildStorage('logos'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cap for logos
  fileFilter: fileFilter(ALLOWED_IMAGE_TYPES),
});

export const uploadSignature = multer({
  storage: buildStorage('signatures'),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: fileFilter(ALLOWED_IMAGE_TYPES),
});

export const uploadStamp = multer({
  storage: buildStorage('stamps'),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: fileFilter(ALLOWED_IMAGE_TYPES),
});

/**
 * Memory-backed upload for the storage layer.
 *
 * The disk-based exports above write straight to UPLOAD_ROOT, which the storage
 * abstraction cannot use — it needs the bytes so it can hand them to whichever
 * driver is active (local disk or S3). Memory storage keeps the file in a buffer
 * and lets storage.js decide where it lives.
 *
 * Safe because maxFileSize is capped; large-file support would want a streaming
 * multipart upload instead.
 */
export const uploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.app.maxFileSize },
  fileFilter: fileFilter(ALLOWED_DOC_TYPES),
});
