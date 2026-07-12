import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_DOC_TYPES   = ['application/pdf', ...ALLOWED_IMAGE_TYPES];

function buildStorage(subfolder) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(config.app.uploadDir, subfolder));
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
