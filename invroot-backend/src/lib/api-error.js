/**
 * Client-safe error responses.
 *
 * Route handlers used to return `err.message` verbatim, which pushed database
 * internals to the client — a concurrent invoice create replied with
 * "Duplicate entry '1-INV/07/2026/145' for key 'invoices.uq_tenant_invoice'",
 * exposing table and index names. Full detail now goes to the server log only.
 *
 * Known driver errors are still translated into something a user can act on,
 * because "Internal server error" for a duplicate name is unhelpful as well as
 * uninformative.
 */

import { config } from '../config.js';

/* MySQL driver codes → safe message + HTTP status. */
const KNOWN = {
  ER_DUP_ENTRY:            { status: 409, code: 'DUPLICATE',        message: 'That record already exists.' },
  ER_NO_REFERENCED_ROW:    { status: 400, code: 'INVALID_REFERENCE', message: 'A referenced record could not be found.' },
  ER_NO_REFERENCED_ROW_2:  { status: 400, code: 'INVALID_REFERENCE', message: 'A referenced record could not be found.' },
  ER_ROW_IS_REFERENCED:    { status: 409, code: 'IN_USE',           message: 'This record is still referenced elsewhere and cannot be removed.' },
  ER_ROW_IS_REFERENCED_2:  { status: 409, code: 'IN_USE',           message: 'This record is still referenced elsewhere and cannot be removed.' },
  ER_DATA_TOO_LONG:        { status: 400, code: 'TOO_LONG',         message: 'One of the values is too long.' },
  ER_BAD_NULL_ERROR:       { status: 400, code: 'MISSING_FIELD',    message: 'A required field is missing.' },
  ER_TRUNCATED_WRONG_VALUE:{ status: 400, code: 'INVALID_VALUE',    message: 'One of the values is not in the expected format.' },
  ER_LOCK_WAIT_TIMEOUT:    { status: 503, code: 'BUSY',             message: 'The server is busy. Please try again.' },
  ER_LOCK_DEADLOCK:        { status: 503, code: 'BUSY',             message: 'The server is busy. Please try again.' },
  ECONNREFUSED:            { status: 503, code: 'UNAVAILABLE',      message: 'A service is temporarily unavailable.' },
  ETIMEDOUT:               { status: 504, code: 'TIMEOUT',          message: 'The request timed out. Please try again.' },
};

/**
 * Throw this from a handler for an expected, user-facing failure — the message
 * is intentional and is always passed through untouched.
 */
export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

/** Map any thrown value to { status, code, message } that is safe to send. */
/* Upload failures arrive as MulterError from next(err), so they never pass
   through a route's try/catch and used to surface as a bare 500 — a user who
   picked a .docx or an oversized scan was told "Internal server error".
   These are the user's mistake, so they get a 400 and an actionable message. */
const MULTER = {
  LIMIT_FILE_SIZE:      { status: 400, code: 'FILE_TOO_LARGE',   message: 'That file is too large.' },
  LIMIT_UNEXPECTED_FILE:{ status: 400, code: 'FILE_TYPE',        message: 'That file type is not accepted.' },
  LIMIT_FILE_COUNT:     { status: 400, code: 'TOO_MANY_FILES',   message: 'Too many files were uploaded at once.' },
  LIMIT_PART_COUNT:     { status: 400, code: 'TOO_MANY_PARTS',   message: 'Too many form fields were submitted.' },
  LIMIT_FIELD_KEY:      { status: 400, code: 'FIELD_TOO_LONG',   message: 'A form field name was too long.' },
  LIMIT_FIELD_VALUE:    { status: 400, code: 'FIELD_TOO_LONG',   message: 'A form field value was too long.' },
  LIMIT_FIELD_COUNT:    { status: 400, code: 'TOO_MANY_FIELDS',  message: 'Too many form fields were submitted.' },
};

export function toClientError(err) {
  if (err?.name === 'MulterError') {
    const mapped = MULTER[err.code] || { status: 400, code: 'UPLOAD_FAILED', message: 'That file could not be uploaded.' };
    /* multer stashes the allowed-types list in `field` for our own filter, and
       it names the real form field otherwise. Either way it is safe to show. */
    const hint = err.code === 'LIMIT_UNEXPECTED_FILE' && err.field?.includes('allowed') ? ` ${err.field}.` : '';
    return { ...mapped, message: mapped.message + hint };
  }
  if (err?.expose) {
    return { status: err.status || 400, code: err.code || 'BAD_REQUEST', message: err.message };
  }
  const known = KNOWN[err?.code];
  if (known) return known;
  return { status: 500, code: 'INTERNAL', message: 'Something went wrong. Please try again.' };
}

/**
 * Send a sanitised failure response and log the real cause.
 *
 * @param {import('express').Response} res
 * @param {unknown} err
 * @param {object} [opts]
 * @param {string} [opts.context] - short label to make the log line searchable
 * @param {number} [opts.status]  - override the derived status
 */
export function failure(res, err, opts = {}) {
  const mapped = toClientError(err);
  const status = opts.status || mapped.status;

  // Full detail server-side, always.
  const label = opts.context ? `[${opts.context}] ` : '';
  if (status >= 500) console.error(`${label}${err?.code || 'ERROR'}:`, err?.message, err?.stack ? `\n${err.stack}` : '');
  else console.warn(`${label}${err?.code || 'WARN'}:`, err?.message);

  const body = { success: false, code: mapped.code, message: mapped.message };
  // Outside production, include the original message so developers aren't blind.
  if (config.nodeEnv !== 'production' && !err?.expose && err?.message) {
    body.detail = err.message;
  }
  return res.status(status).json(body);
}
