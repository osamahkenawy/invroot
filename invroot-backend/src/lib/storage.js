/**
 * File storage — local disk in development, S3 in production.
 *
 * Two problems with how uploads worked before, both fixed here:
 *
 *  1. Everything landed in shared folders (uploads/documents, uploads/logos)
 *     with no tenant in the path. A leaked or guessed filename was reachable
 *     regardless of which tenant owned it. Keys are now tenant-scoped, so
 *     isolation is structural rather than by obscurity.
 *
 *  2. `/uploads` was mounted with express.static and no auth, making every
 *     payment proof and expense receipt world-readable to anyone with the URL.
 *     Objects are private; reads go through an authenticated endpoint that
 *     checks tenant ownership and then issues a short-lived signed URL.
 *
 * The driver is chosen by STORAGE_DRIVER so development needs no AWS account
 * and production does not depend on a writable local disk.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPLOAD_ROOT = path.isAbsolute(config.app.uploadDir)
  ? config.app.uploadDir
  : path.resolve(__dirname, '..', '..', config.app.uploadDir);

/* What each upload kind is for. `public` marks assets that legitimately appear
   on documents a client receives (a logo on an invoice PDF); everything else is
   private and only reachable by the owning tenant. */
export const KINDS = {
  logo:        { folder: 'logos',      public: true  },
  stamp:       { folder: 'stamps',     public: true  },
  signature:   { folder: 'signatures', public: true  },
  avatar:      { folder: 'avatars',    public: false },
  attachment:  { folder: 'documents',  public: false },
};

/** `tenants/42/avatars/ab12….png` — tenant first so keys sort and scope cleanly. */
export function buildKey({ tenantId, kind, originalName = '' }) {
  const def = KINDS[kind];
  if (!def) throw new Error(`Unknown storage kind: ${kind}`);
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const id = crypto.randomBytes(16).toString('hex');
  return `tenants/${tenantId}/${def.folder}/${id}${ext}`;
}

/** Reject a key that tries to escape its prefix. */
function assertSafeKey(key) {
  if (typeof key !== 'string' || !key || key.includes('..') || key.startsWith('/')) {
    throw new Error('Invalid storage key');
  }
}

/** The tenant a key belongs to, or null if it isn't tenant-scoped. */
/* Types the browser will execute if it renders them inline. An SVG is a
   document, not just a picture: it can carry <script>, so an "avatar" upload is
   a stored-XSS vector against whoever views the client list. HTML and XML are
   here for the same reason. */
const EXECUTABLE_MIMES = new Set([
  'image/svg+xml', 'text/html', 'application/xhtml+xml',
  'text/xml', 'application/xml', 'text/javascript', 'application/javascript',
]);

/** True for image types that are safe to render inline in the app. */
export function isDisplaySafeImage(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  return m.startsWith('image/') && !EXECUTABLE_MIMES.has(m);
}

/** True if serving this inline would let the file run script in our origin. */
export function isExecutableMime(mime) {
  return EXECUTABLE_MIMES.has(String(mime || '').toLowerCase().split(';')[0].trim());
}

export function tenantOfKey(key) {
  const m = /^tenants\/(\d+)\//.exec(String(key || ''));
  return m ? Number(m[1]) : null;
}

/* ══════════════════════════════════════════════════════
   Local driver
   ══════════════════════════════════════════════════════ */
const localDriver = {
  name: 'local',

  async put(key, body, _contentType) {
    assertSafeKey(key);
    const dest = path.join(UPLOAD_ROOT, key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, body);
    return { key };
  },

  async getStream(key) {
    assertSafeKey(key);
    const dest = path.join(UPLOAD_ROOT, key);
    // Belt and braces: confirm the resolved path really sits under the root.
    if (!dest.startsWith(UPLOAD_ROOT)) throw new Error('Invalid storage key');
    await fsp.access(dest);
    return fs.createReadStream(dest);
  },

  async delete(key) {
    assertSafeKey(key);
    await fsp.rm(path.join(UPLOAD_ROOT, key), { force: true });
  },

  /* No signing locally — callers fall back to streaming through the API. */
  async signedUrl() { return null; },
};

/* ══════════════════════════════════════════════════════
   S3 driver
   ══════════════════════════════════════════════════════ */
let s3client = null;
let s3mod = null;

async function s3() {
  if (!s3client) {
    s3mod = await import('@aws-sdk/client-s3');
    s3client = new s3mod.S3Client({
      region: config.storage.region,
      // Credentials come from the environment or the instance role. Passing
      // them explicitly only when present lets an EC2/ECS task role work
      // without any keys in config at all.
      ...(config.storage.accessKeyId && config.storage.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.storage.accessKeyId,
              secretAccessKey: config.storage.secretAccessKey,
            },
          }
        : {}),
    });
  }
  return { client: s3client, mod: s3mod };
}

const s3Driver = {
  name: 's3',

  async put(key, body, contentType) {
    assertSafeKey(key);
    const { client, mod } = await s3();
    await client.send(new mod.PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
      // No ACL: the bucket blocks public access and reads are signed. Setting
      // public-read here would silently undo that.
      ServerSideEncryption: 'AES256',
    }));
    return { key };
  },

  async getStream(key) {
    assertSafeKey(key);
    const { client, mod } = await s3();
    const out = await client.send(new mod.GetObjectCommand({
      Bucket: config.storage.bucket, Key: key,
    }));
    return out.Body;
  },

  async delete(key) {
    assertSafeKey(key);
    const { client, mod } = await s3();
    await client.send(new mod.DeleteObjectCommand({
      Bucket: config.storage.bucket, Key: key,
    }));
  },

  /* `downloadAs` forces S3 to serve the object as an attachment rather than
     rendering it. This matters because the API answers a read with a 302 to
     this URL — the browser then talks to S3 directly, so any header the API
     would have set on a streamed response is simply not in play. Without it an
     SVG or HTML object renders inline straight from the bucket domain. */
  async signedUrl(key, { expiresIn = 300, downloadAs = null, contentType = null } = {}) {
    assertSafeKey(key);
    const { client, mod } = await s3();
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(
      client,
      new mod.GetObjectCommand({
        Bucket: config.storage.bucket,
        Key: key,
        ...(downloadAs
          ? { ResponseContentDisposition: `attachment; filename="${String(downloadAs).replace(/["\\]/g, '')}"` }
          : {}),
        ...(contentType ? { ResponseContentType: contentType } : {}),
      }),
      { expiresIn }
    );
  },
};

/* ══════════════════════════════════════════════════════
   Public surface
   ══════════════════════════════════════════════════════ */

export function isS3Configured() {
  return Boolean(config.storage.bucket && config.storage.region);
}

/** The active driver. Falls back to local if S3 is selected but unconfigured. */
export function driver() {
  if (config.storage.driver === 's3') {
    if (!isS3Configured()) {
      console.warn('⚠️  STORAGE_DRIVER=s3 but bucket/region are unset — falling back to local disk');
      return localDriver;
    }
    return s3Driver;
  }
  return localDriver;
}

export async function putObject({ tenantId, kind, buffer, originalName, contentType }) {
  const key = buildKey({ tenantId, kind, originalName });
  await driver().put(key, buffer, contentType);
  return { key, driver: driver().name };
}

export const getObjectStream = (key) => driver().getStream(key);
export const deleteObject     = (key) => driver().delete(key).catch(err => {
  // A missing object should not break deleting the row that referenced it.
  console.warn(`storage delete failed for ${key}:`, err.message);
});

/**
 * A URL the browser can use. On S3 this is a short-lived signed URL; locally
 * there is nothing to sign, so callers get null and use the streaming endpoint.
 */
export const signedUrlFor = (key, opts) => driver().signedUrl(key, opts);

/* ── Brand asset URLs ─────────────────────────────────────────────────
   Logos, stamps and signatures are different from documents: they are
   embedded in invoice PDFs and shown on public invoice pages, so they get
   rendered by people who are not logged in.

   Historically they were stored as a bare filename and served by
   express.static from /uploads/<folder>/. On the s3 driver they are stored as
   a full key instead. This resolves either form to something a browser can
   fetch, so existing tenants keep their logo after the driver switches. */
export async function resolveAssetUrl(stored, folder) {
  const value = String(stored || '').trim();
  if (!value) return null;
  // Already an absolute URL (a tenant that pasted a hosted logo).
  if (/^https?:\/\//i.test(value)) return value;

  // A storage key — sign it. Signing works for both drivers; local returns
  // null, in which case the static mount can still serve it.
  if (value.startsWith('tenants/')) {
    const signed = await signedUrlFor(value, { expiresIn: config.storage.signedUrlTtl });
    if (signed) return signed;
    return `${config.app.apiUrl}/uploads/${value}`;
  }

  /* Legacy bare filename. Absolute, not site-relative: these URLs are consumed
     by the headless browser that renders invoice PDFs and by HTML emails, and
     neither has an origin to resolve a relative path against. */
  return `${config.app.apiUrl}/uploads/${folder}/${value.replace(/^\/+/, '')}`;
}

/** Resolve the brand assets on a tenant row in place. */
export async function withAssetUrls(row) {
  if (!row) return row;
  const out = { ...row };
  const jobs = [];
  if ('logo_url' in out)      jobs.push(resolveAssetUrl(out.logo_url, 'logos').then(v => { out.logo_url = v; }));
  if ('stamp_url' in out)     jobs.push(resolveAssetUrl(out.stamp_url, 'stamps').then(v => { out.stamp_url = v; }));
  if ('signature_url' in out) jobs.push(resolveAssetUrl(out.signature_url, 'signatures').then(v => { out.signature_url = v; }));
  await Promise.all(jobs);
  return out;
}

/* ── Private-file URLs for <img> tags ─────────────────────────────────
   An <img src> cannot carry an Authorization header, so a private file
   rendered in the UI has to be reachable another way.

   This returns the STABLE route, not a presigned URL, even on s3. A presigned
   URL is handed out once and dies on a timer — fine for a download, wrong for
   an avatar, which sits in the header and in list rows for as long as the tab
   is open. Once it expired the image 404'd and the UI fell back to initials,
   which is indistinguishable from "no picture set".

   /api/files/:id has no expiry. It authenticates with the auth_token cookie
   (sent because the API is same-origin with the app), checks the caller's
   tenant owns the file, and only then redirects to a freshly signed URL. The
   cost is one extra hop; the benefit is an image that never silently vanishes.

   Note this is why the route must stay same-origin — see docs/S3-SETUP.md. */
export async function resolveAttachmentUrl(storageKey, attachmentId) {
  if (!storageKey || !attachmentId) return null;
  return `/api/files/${attachmentId}`;
}
