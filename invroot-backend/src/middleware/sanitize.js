/**
 * XSS input sanitization middleware.
 * Recursively strips HTML tags and dangerous protocols from all string
 * values in req.body. No external dependency — uses a conservative
 * tag/entity stripper suitable for plain-text fields (invoice notes,
 * client names, company details, etc.).
 */

const TAG_RE = /<\/?[^>]+(>|$)/g;                 // any HTML tag
const SCRIPT_RE = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const PROTO_RE = /(javascript|vbscript|data)\s*:/gi;
const ON_ATTR_RE = /\son\w+\s*=\s*(["']).*?\1/gi; // inline event handlers

/**
 * Sanitize a single string value.
 * @param {*} value
 * @returns {*}
 */
export function sanitizeValue(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(SCRIPT_RE, '')
    .replace(ON_ATTR_RE, '')
    .replace(TAG_RE, '')
    .replace(PROTO_RE, '')
    .trim();
}

/**
 * Deep-sanitize an object/array/string in place-safe manner.
 * @param {*} input
 * @returns {*}
 */
export function sanitizeDeep(input) {
  if (Array.isArray(input)) return input.map(sanitizeDeep);
  if (input && typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = sanitizeDeep(v);
    return out;
  }
  return sanitizeValue(input);
}

/**
 * Express middleware — cleans req.body of XSS payloads.
 */
export function sanitizeBody(req, _res, next) {
  /* Never touch a raw body. `typeof Buffer === 'object'`, so the deep walk below
     used to iterate a Buffer's bytes and hand back a plain object of index→byte
     pairs. That destroyed the exact bytes Stripe signs, so every webhook failed
     verification with "Invalid signature" — the endpoint could not work at all,
     regardless of which signing secret was configured. */
  if (Buffer.isBuffer(req.body)) return next();

  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeDeep(req.body);
  }
  next();
}
