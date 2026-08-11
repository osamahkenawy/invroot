/**
 * Session and refresh-token handling.
 *
 * The access token is a short-lived JWT the API verifies without a database
 * lookup. The refresh token is opaque random bytes whose SHA-256 is stored on
 * the session row, exchanged for a new access token and rotated every time.
 *
 * Rotation is what makes a stolen refresh token detectable. After a successful
 * refresh the old value is dead but remembered; if it is ever presented again,
 * two parties hold the same token. We cannot tell the thief from the victim,
 * so the whole session is revoked and both are sent back to sign in — an
 * interruption for the legitimate user, and the end of the road for the other.
 */

import crypto from 'crypto';
import { query, execute } from './database.js';
import { config } from '../config.js';
import { generateToken } from '../middleware/auth.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** SHA-256 is right here, not bcrypt: the token is 256 bits of real entropy,
 *  so there is nothing to brute-force, and refresh runs on every expiry. */
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

const newRefreshToken = () => crypto.randomBytes(32).toString('base64url');

/** Compare two hex digests without leaking position through timing. */
function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Create a session and its first refresh token.
 * Returns the raw refresh token — the only time it exists in plaintext.
 */
export async function createSession({ user, req }) {
  const sessionId = crypto.randomUUID();
  const refresh = newRefreshToken();
  const now = Date.now();

  await execute(
    `INSERT INTO user_sessions
       (id, tenant_id, user_id, ip, user_agent,
        refresh_hash, refresh_expires_at, absolute_expires_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId, user.tenant_id, user.id,
      req?.ip || null, (req?.headers?.['user-agent'] || '').slice(0, 400),
      hashToken(refresh),
      new Date(now + config.session.refreshDays * DAY_MS),
      new Date(now + config.session.absoluteDays * DAY_MS),
      new Date(now + config.session.refreshDays * DAY_MS),
    ]
  );

  return { sessionId, refresh, accessToken: generateToken(user, sessionId) };
}

export const REFRESH_OUTCOME = {
  OK: 'ok',
  MISSING: 'missing',            // no token presented
  UNKNOWN: 'unknown',            // never issued, or long since replaced
  REUSED: 'reused',              // presented after rotation — treated as theft
  EXPIRED: 'expired',            // rolling window elapsed
  ABSOLUTE_EXPIRED: 'absolute',  // hard ceiling reached; password required
  REVOKED: 'revoked',            // signed out, or revoked elsewhere
  INACTIVE: 'inactive',          // user disabled since
};

/**
 * Exchange a refresh token for a new access token, rotating the refresh token.
 * Never throws for an invalid token — returns an outcome the caller maps to a
 * response, so a bad token can't be distinguished from a server fault by
 * timing or status alone.
 */
export async function rotateRefresh({ rawToken, req }) {
  if (!rawToken) return { outcome: REFRESH_OUTCOME.MISSING };

  const hash = hashToken(rawToken);

  /* Look for the token as EITHER the current or the previous value. Matching
     `previous_refresh_hash` means this token was already spent — the signal
     that someone else has a copy. */
  const [session] = await query(
    `SELECT s.*, u.id AS uid, u.tenant_id AS utenant, u.username, u.role,
            u.is_super_admin, u.is_active
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.refresh_hash = ? OR s.previous_refresh_hash = ?
      LIMIT 1`,
    [hash, hash]
  );

  if (!session) return { outcome: REFRESH_OUTCOME.UNKNOWN };

  if (safeEqual(session.previous_refresh_hash, hash) && !safeEqual(session.refresh_hash, hash)) {
    /* Replayed a spent token. Kill the session rather than guess which holder
       is genuine — the legitimate user signs in again, the thief gets nothing. */
    await execute(
      "UPDATE user_sessions SET revoked_at = NOW(), revoked_reason = 'refresh_reuse' WHERE id = ?",
      [session.id]
    );
    console.warn(`[auth] refresh token reuse on session ${session.id} (user ${session.user_id}) — session revoked`);
    return { outcome: REFRESH_OUTCOME.REUSED };
  }

  if (session.revoked_at) return { outcome: REFRESH_OUTCOME.REVOKED };
  if (!session.is_active)  return { outcome: REFRESH_OUTCOME.INACTIVE };

  const now = Date.now();
  if (session.absolute_expires_at && new Date(session.absolute_expires_at).getTime() < now) {
    return { outcome: REFRESH_OUTCOME.ABSOLUTE_EXPIRED, sessionId: session.id, userId: session.user_id };
  }
  if (session.refresh_expires_at && new Date(session.refresh_expires_at).getTime() < now) {
    return { outcome: REFRESH_OUTCOME.EXPIRED, sessionId: session.id, userId: session.user_id };
  }

  /* Rotate. The rolling window moves forward but is clamped to the absolute
     ceiling, so an active session still ends when the cap says so. */
  const next = newRefreshToken();
  const rollingUntil = new Date(now + config.session.refreshDays * DAY_MS);
  const cap = session.absolute_expires_at ? new Date(session.absolute_expires_at) : null;
  const refreshUntil = cap && cap < rollingUntil ? cap : rollingUntil;

  const result = await execute(
    `UPDATE user_sessions
        SET previous_refresh_hash = refresh_hash,
            refresh_hash = ?,
            refresh_expires_at = ?,
            expires_at = ?,
            rotated_at = NOW(),
            last_seen_at = NOW(),
            ip = ?,
            user_agent = ?
      WHERE id = ? AND refresh_hash = ?`,
    [
      hashToken(next), refreshUntil, refreshUntil,
      req?.ip || session.ip,
      (req?.headers?.['user-agent'] || session.user_agent || '').slice(0, 400),
      session.id, session.refresh_hash,
    ]
  );

  /* The WHERE pinned the hash we read. Zero rows means another request rotated
     first — two tabs refreshing at once. That is not an attack, and the loser
     must not hand back a token it did not persist. */
  if (!result.affectedRows) return { outcome: REFRESH_OUTCOME.UNKNOWN, raced: true };

  const user = {
    id: session.uid, tenant_id: session.utenant, username: session.username,
    role: session.role, is_super_admin: session.is_super_admin,
  };

  return {
    outcome: REFRESH_OUTCOME.OK,
    sessionId: session.id,
    refresh: next,
    accessToken: generateToken(user, session.id),
    refreshExpiresAt: refreshUntil,
  };
}

/**
 * Issue a fresh refresh token on an existing session after the user has proven
 * who they are again. Used by re-authentication so someone whose session aged
 * out keeps their place instead of being thrown back to a blank login page.
 */
export async function reissueAfterReauth({ sessionId, user, req }) {
  const refresh = newRefreshToken();
  const now = Date.now();
  const until = new Date(now + config.session.reauthExtendsDays * DAY_MS);

  const result = await execute(
    `UPDATE user_sessions
        SET refresh_hash = ?, previous_refresh_hash = NULL,
            refresh_expires_at = ?, expires_at = ?,
            /* Re-entering the password is exactly the proof the absolute cap
               exists to demand, so the ceiling moves out from here. */
            absolute_expires_at = ?,
            revoked_at = NULL, revoked_reason = NULL,
            rotated_at = NOW(), last_seen_at = NOW(), ip = ?, user_agent = ?
      WHERE id = ? AND user_id = ?`,
    [
      hashToken(refresh), until, until,
      new Date(now + config.session.absoluteDays * DAY_MS),
      req?.ip || null, (req?.headers?.['user-agent'] || '').slice(0, 400),
      sessionId, user.id,
    ]
  );

  // The session may have been pruned; start a new one rather than fail.
  if (!result.affectedRows) return createSession({ user, req });

  return { sessionId, refresh, accessToken: generateToken(user, sessionId) };
}

export async function revokeSession(sessionId, reason = 'logout') {
  if (!sessionId) return;
  await execute(
    'UPDATE user_sessions SET revoked_at = NOW(), revoked_reason = ? WHERE id = ? AND revoked_at IS NULL',
    [reason, sessionId]
  );
}

/* ── Cookies ──────────────────────────────────────────────────────────
   The refresh cookie is scoped to the auth routes. It is only ever sent to
   the endpoint that consumes it, so it isn't attached to every image, PDF and
   API call the app makes — fewer places it can be logged or leaked. */
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/auth';

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: config.session.refreshDays * DAY_MS,
  };
}

export function accessCookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

/** Access-token lifetime in ms, parsed from the configured value. */
export function accessTokenMaxAge() {
  const raw = String(config.jwt.expiresIn || '15m').trim();
  const m = /^(\d+)([smhd])$/.exec(raw);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  return n * { s: 1000, m: 60000, h: 3600000, d: DAY_MS }[m[2]];
}

export { hashToken };
