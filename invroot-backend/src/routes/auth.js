import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, execute } from '../lib/database.js';
import { generateToken, authMiddleware, verifyToken } from '../middleware/auth.js';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit-logger.js';
import { config } from '../config.js';
import { failure } from '../lib/api-error.js';
import { withAssetUrls, resolveAttachmentUrl } from '../lib/storage.js';
import { currencyForCountry, countryFromRequest } from '../lib/currency.js';
import {
  createSession, rotateRefresh, reissueAfterReauth, revokeSession,
  REFRESH_OUTCOME, REFRESH_COOKIE, REFRESH_COOKIE_PATH,
  refreshCookieOptions, accessCookieOptions, accessTokenMaxAge,
} from '../lib/sessions.js';


/* Everything on the users row that must never leave the server.
 *
 * The three places that build a user response each stripped their own ad-hoc
 * list, and every one of them missed `password_reset_token`. If a reset had
 * been requested, a live token was handed to the client on every login — and
 * a reset token is a password. One list, applied everywhere, so adding a
 * sensitive column can't silently start leaking it. */
const SENSITIVE_USER_FIELDS = [
  'password',
  'password_reset_token',
  'password_reset_expires',
  'email_verify_token',
  'avatar_key',
];

function publicUser(row) {
  const safe = { ...row };
  for (const f of SENSITIVE_USER_FIELDS) delete safe[f];
  return safe;
}

const router = express.Router();

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Record a sign-in attempt (success or failure) for the security log. */
async function recordLogin({ tenantId = null, userId = null, email, req, success, reason = null }) {
  try {
    await execute(
      `INSERT INTO login_history (tenant_id, user_id, email, ip, user_agent, success, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, userId, email || null, req.ip || null, (req.headers['user-agent'] || '').slice(0, 400), success ? 1 : 0, reason]
    );
  } catch (err) {
    console.error('login_history insert failed:', err.message);
  }
}

/* ── POST /api/auth/register ─────────────────────────── */
router.post('/register', async (req, res) => {
  try {
    const { business_name, email, phone, password, lang = 'en', plan, country } = req.body;
    if (!business_name || !email || !password) {
      return res.status(400).json({ success: false, message: 'business_name, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    // Check email not already used
    const [existing] = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ success: false, message: 'Email already registered' });

    const slug = business_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30)
      + '-' + crypto.randomBytes(3).toString('hex');

    /* Plan. Two bugs have lived on this line. First the choice was ignored
       entirely and everyone landed on the trial. The fix for that wrote the
       chosen plan straight onto the tenant — which handed out Starter, a PAID
       tier, to anyone who picked it from the signup dropdown: plan-limit.js
       reads tenants.plan and grants that tier's limits, and nothing here ever
       took a card.

       Signup cannot grant a paid plan. The only code allowed to do that is
       applySubscription() in routes/stripe.js, driven by a Stripe subscription
       event. So the workspace always starts on the default (trial) tier, and a
       paid choice is recorded as `pending_plan` — an intent that entitles the
       tenant to nothing, and exists so we can resume checkout once they verify
       and sign in. Sales-led tiers (Enterprise) are not self-serve at all and
       are deliberately not recorded as a pending checkout. */
    const requested = String(plan || '').toLowerCase();
    const known = config.plans[requested];
    const selfServePaid = Boolean(known && !known.retired && !known.salesLed && (known.monthly ?? 0) > 0);
    const selectedPlan = config.defaultPlan;
    const pendingPlan = selfServePaid ? requested : null;

    /* Currency followed from nowhere and was hardcoded USD for every tenant,
       including the UAE businesses this is mainly sold to. Derive it from the
       country when we know it, and leave the tenant free to change it later in
       Settings. */
    const countryCode = String(country || '').toUpperCase().slice(0, 2) || countryFromRequest(req);
    const currency = currencyForCountry(countryCode) || 'AED';

    // Create tenant
    const tenantResult = await execute(
      `INSERT INTO tenants (company_name, slug, email, phone, status, currency, country, plan, pending_plan, lang)
       VALUES (?, ?, ?, ?, 'trialing', ?, ?, ?, ?, ?)`,
      [business_name, slug, email, phone || null, currency, countryCode || null, selectedPlan, pendingPlan, lang]
    );
    const tenantId = tenantResult.insertId;

    // Create owner user
    const hashed = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const userResult = await execute(
      `INSERT INTO users (tenant_id, email, username, full_name, password, role, is_owner, is_active, email_verified, email_verify_token, lang_preference)
       VALUES (?, ?, ?, ?, ?, 'admin', 1, 1, 0, ?, ?)`,
      [tenantId, email, email, business_name, hashed, verifyToken, lang]
    );

    // Send verification email — a transport failure here must not undo the
    // account that was just created, so it's isolated from the outer try/catch.
    const verifyLink = `${config.app.frontendUrl}/verify-email?token=${verifyToken}`;
    try {
      await sendVerificationEmail({ to: email, name: business_name, verifyLink, lang });
    } catch (mailErr) {
      console.error('Verification email failed to send:', mailErr);
    }

    /* Tell the client whether money is still owed on this signup, so the
       success screen can say "verify, sign in, then complete payment" rather
       than "you're all set" — which is what it said while quietly handing out
       the paid tier for free. */
    res.status(201).json({
      success: true,
      message: 'Account created. Please verify your email.',
      data: { pending_plan: pendingPlan },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

/* ── POST /api/auth/login ────────────────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const users = await query(
      `SELECT u.*, t.company_name, t.slug as tenant_slug, t.status as tenant_status,
              t.logo_url, t.currency, t.lang as tenant_lang,
              /* pending_plan drives the post-sign-in checkout prompt: the plan
                 the customer picked at signup but has not paid for yet. */
              t.plan as tenant_plan, t.pending_plan,
              a.storage_key AS avatar_key
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN invroot_attachments a
              ON a.id = u.avatar_attachment_id AND a.tenant_id = u.tenant_id
       WHERE u.email = ?`,
      [email]
    );

    if (!users.length) {
      await recordLogin({ email, req, success: false, reason: 'no_such_user' });
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const user = users[0];

    if (!user.email_verified) {
      await recordLogin({ tenantId: user.tenant_id, userId: user.id, email, req, success: false, reason: 'email_not_verified' });
      return res.status(403).json({ success: false, code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before logging in.' });
    }
    if (!user.is_active) {
      await recordLogin({ tenantId: user.tenant_id, userId: user.id, email, req, success: false, reason: 'deactivated' });
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      await recordLogin({ tenantId: user.tenant_id, userId: user.id, email, req, success: false, reason: 'bad_password' });
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    /* Session row (so this login appears under "active sessions" and can be
       revoked) plus the first refresh token. The access token carries the
       session id as `sid`. */
    const { sessionId, refresh, accessToken: token } = await createSession({ user, req });

    await execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await recordLogin({ tenantId: user.tenant_id, userId: user.id, email, req, success: true });
    await logAudit({ tenantId: user.tenant_id, userId: user.id, action: 'login', entity: 'user', entityId: user.id, ip: req.ip });

    res.cookie('auth_token', token, accessCookieOptions(accessTokenMaxAge()));
    res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions());

    const safeUser = publicUser(user);
    safeUser.avatar_url = await resolveAttachmentUrl(user.avatar_key, user.avatar_attachment_id);
    res.json({
      success: true, token, user: await withAssetUrls(safeUser),
      // Lets the client refresh slightly early rather than wait for a 401.
      expires_in: Math.floor(accessTokenMaxAge() / 1000),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

/* ── POST /api/auth/refresh ──────────────────────────── */
/* Exchange the refresh cookie for a new access token, rotating the refresh
   token in the process. Deliberately NOT behind authMiddleware — the whole
   point is that the access token has already expired. */
router.post('/refresh', async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] || req.body?.refresh_token;
    const result = await rotateRefresh({ rawToken: raw, req });

    if (result.outcome === REFRESH_OUTCOME.OK) {
      res.cookie('auth_token', result.accessToken, accessCookieOptions(accessTokenMaxAge()));
      res.cookie(REFRESH_COOKIE, result.refresh, refreshCookieOptions());
      return res.json({
        success: true,
        token: result.accessToken,
        expires_in: Math.floor(accessTokenMaxAge() / 1000),
      });
    }

    /* Every failure clears both cookies — leaving a dead refresh cookie in
       place makes the client retry forever against a token that will never
       work again. */
    res.clearCookie('auth_token', { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });

    /* `reason` tells the client whether re-entering a password can recover the
       session (expired) or whether it must start over (reused/revoked). The
       message stays vague — a caller poking at tokens learns nothing about
       whether one ever existed. */
    const recoverable = new Set([
      REFRESH_OUTCOME.EXPIRED,
      REFRESH_OUTCOME.ABSOLUTE_EXPIRED,
      REFRESH_OUTCOME.MISSING,
      REFRESH_OUTCOME.UNKNOWN,
    ]);

    if (result.outcome === REFRESH_OUTCOME.REUSED) {
      await logAudit({
        userId: result.userId || null, action: 'security',
        entity: 'session', entityId: null, ip: req.ip,
        meta: { event: 'refresh_token_reuse' },
      }).catch(() => {});
    }

    return res.status(401).json({
      success: false,
      code: 'SESSION_EXPIRED',
      reason: result.outcome,
      can_reauthenticate: recoverable.has(result.outcome),
      message: 'Your session has ended. Please sign in again.',
    });
  } catch (err) {
    failure(res, err, { context: 'auth' });
  }
});

/* ── POST /api/auth/reauthenticate ───────────────────── */
/* Re-enter your password to revive an aged-out session in place.
   Without this, an expired session meant a redirect to /login and the loss of
   whatever was on screen — a half-written invoice included. The identity comes
   from the expired token, never from the request body, so this cannot be used
   to sign in as somebody else. */
router.post('/reauthenticate', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password required' });
    }

    /* Read the identity out of the expired access token. verifyToken() rejects
       expired tokens, so decode without verifying the expiry — but still verify
       the SIGNATURE, or anyone could mint a token naming any user. */
    const raw = req.cookies?.auth_token || req.headers.authorization?.split(' ')[1];
    if (!raw) return res.status(401).json({ success: false, message: 'Not signed in' });

    let claims;
    try {
      claims = jwt.verify(raw, config.jwt.secret, { ignoreExpiration: true });
    } catch {
      return res.status(401).json({ success: false, message: 'Not signed in' });
    }

    const [user] = await query(
      `SELECT u.*, t.company_name, t.slug as tenant_slug, t.status as tenant_status,
              t.logo_url, t.currency, t.lang as tenant_lang,
              /* pending_plan drives the post-sign-in checkout prompt: the plan
                 the customer picked at signup but has not paid for yet. */
              t.plan as tenant_plan, t.pending_plan,
              a.storage_key AS avatar_key
         FROM users u
         LEFT JOIN tenants t ON u.tenant_id = t.id
         LEFT JOIN invroot_attachments a
                ON a.id = u.avatar_attachment_id AND a.tenant_id = u.tenant_id
        WHERE u.id = ?`,
      [claims.id]
    );
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'Account is not available' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      await recordLogin({
        tenantId: user.tenant_id, userId: user.id, email: user.email,
        req, success: false, reason: 'bad_password_reauth',
      });
      // Same wording as login, so this can't be used to probe for valid accounts.
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    const { sessionId, refresh, accessToken } = await reissueAfterReauth({
      sessionId: claims.sid, user, req,
    });

    await recordLogin({ tenantId: user.tenant_id, userId: user.id, email: user.email, req, success: true });
    await logAudit({
      tenantId: user.tenant_id, userId: user.id, action: 'login',
      entity: 'user', entityId: user.id, ip: req.ip,
      meta: { event: 'reauthenticate' },
    }).catch(() => {});

    res.cookie('auth_token', accessToken, accessCookieOptions(accessTokenMaxAge()));
    res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions());

    const safeUser = publicUser(user);
    safeUser.avatar_url = await resolveAttachmentUrl(user.avatar_key, user.avatar_attachment_id);

    res.json({
      success: true, token: accessToken, session_id: sessionId,
      user: await withAssetUrls(safeUser),
      expires_in: Math.floor(accessTokenMaxAge() / 1000),
    });
  } catch (err) {
    failure(res, err, { context: 'auth' });
  }
});

/* ── POST /api/auth/logout ───────────────────────────── */
router.post('/logout', async (req, res) => {
  // Revoke the session tied to this token so it can't be reused.
  try {
    const token = req.cookies?.auth_token || req.headers.authorization?.split(' ')[1];
    const decoded = token && verifyToken(token);
    if (decoded?.sid) await revokeSession(decoded.sid, 'logout');
  } catch { /* best-effort */ }
  res.clearCookie('auth_token', { path: '/' });
  /* Must match the path the cookie was set with, or the browser keeps it and
     the "signed out" session can be refreshed straight back to life. */
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  res.json({ success: true, message: 'Logged out' });
});

/* ── GET /api/auth/sessions ──────────────────────────── */
/* Active sessions for the current user (most recent first). */
router.get('/sessions', authMiddleware, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at
       FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY last_seen_at DESC`,
      [req.user.id]
    );
    const data = rows.map(r => ({ ...r, current: r.id === req.sessionId }));
    res.json({ success: true, data });
  } catch (err) {
    failure(res, err, { context: 'auth' });
  }
});

/* ── POST /api/auth/sessions/:id/revoke ──────────────── */
router.post('/sessions/:id/revoke', authMiddleware, async (req, res) => {
  try {
    const result = await execute(
      'UPDATE user_sessions SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, message: 'Session revoked' });
  } catch (err) {
    failure(res, err, { context: 'auth' });
  }
});

/* ── POST /api/auth/logout-all ───────────────────────── */
/* Revoke every OTHER session, keeping the current one signed in. */
router.post('/logout-all', authMiddleware, async (req, res) => {
  try {
    const result = await execute(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE user_id = ? AND revoked_at IS NULL AND id <> ?`,
      [req.user.id, req.sessionId || '']
    );
    await logAudit({ tenantId: req.user.tenant_id, userId: req.user.id, action: 'logout_all_devices', entity: 'user', entityId: req.user.id, ip: req.ip });
    res.json({ success: true, message: 'Signed out of all other devices', revoked: result.affectedRows });
  } catch (err) {
    failure(res, err, { context: 'auth' });
  }
});

/* ── GET /api/auth/login-history ─────────────────────── */
router.get('/login-history', authMiddleware, async (req, res) => {
  try {
    const rows = await query(
      `SELECT ip, user_agent, success, reason, created_at
       FROM login_history
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    failure(res, err, { context: 'auth' });
  }
});

/* ── POST /api/auth/resend-verification ──────────────── */
/* Public + enumeration-safe: re-sends the verify email if the account exists
   and is still unverified. Always responds success. */
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });

    const [user] = await query(
      'SELECT id, full_name, email_verified, lang_preference FROM users WHERE email = ?',
      [email]
    );
    if (user && !user.email_verified) {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      await execute('UPDATE users SET email_verify_token = ? WHERE id = ?', [verifyToken, user.id]);
      const verifyLink = `${config.app.frontendUrl}/verify-email?token=${verifyToken}`;
      try {
        await sendVerificationEmail({ to: email, name: user.full_name, verifyLink, lang: user.lang_preference || 'en' });
      } catch (mailErr) {
        console.error('Resend verification email failed:', mailErr);
      }
    }
    res.json({ success: true, message: 'If that account exists and is unverified, a new link was sent.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Request failed' });
  }
});

/* ── GET /api/auth/me ────────────────────────────────── */
router.get('/me', authMiddleware, async (req, res) => {
  const safe = publicUser(req.user);
  /* authMiddleware loads the user for authorisation and doesn't join the
     avatar. Resolve it here so a page reload doesn't drop the picture. */
  const [row] = await query(
    `SELECT u.avatar_attachment_id, a.storage_key
     FROM users u
     LEFT JOIN invroot_attachments a
            ON a.id = u.avatar_attachment_id AND a.tenant_id = u.tenant_id
     WHERE u.id = ?`,
    [req.user.id]
  );
  safe.avatar_url = await resolveAttachmentUrl(row?.storage_key, row?.avatar_attachment_id);
  res.json({ success: true, user: safe });
});

/* ── GET /api/auth/verify-email ──────────────────────── */
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, code: 'TOKEN_MISSING', message: 'Token required' });

    const [user] = await query('SELECT id, tenant_id, email, full_name, lang_preference FROM users WHERE email_verify_token = ?', [token]);
    /* The client localises from `code`; the message is a fallback for anything
       that reads the API directly. This is by far the most common failure —
       the link is single-use, so it usually means it was already used. */
    if (!user) return res.status(400).json({ success: false, code: 'TOKEN_INVALID', message: 'Invalid or expired token' });

    await execute('UPDATE users SET email_verified = 1, email_verify_token = NULL WHERE id = ?', [user.id]);
    await execute("UPDATE tenants SET status = 'active' WHERE id = ? AND status = 'trialing'", [user.tenant_id]);

    // Welcome the user into the app (isolated from the verify response).
    try {
      await sendWelcomeEmail({
        to: user.email,
        name: user.full_name,
        loginLink: `${config.app.frontendUrl}/login?verified=1`,
        lang: user.lang_preference || 'en',
      });
    } catch (mailErr) {
      console.error('Welcome email failed to send:', mailErr);
    }

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

/* ── POST /api/auth/forgot-password ──────────────────── */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });

    const [user] = await query('SELECT id, full_name, lang_preference FROM users WHERE email = ?', [email]);
    // Always respond success to prevent email enumeration
    if (!user) return res.json({ success: true, message: 'If that email exists, a reset link was sent.' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await execute('UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?',
      [resetToken, expiry, user.id]);

    const resetLink = `${config.app.frontendUrl}/reset-password?token=${resetToken}`;
    try {
      await sendPasswordResetEmail({ to: email, name: user.full_name, resetLink, lang: user.lang_preference || 'en' });
    } catch (mailErr) {
      console.error('Password reset email failed to send:', mailErr);
    }

    res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Request failed' });
  }
});

/* ── POST /api/auth/reset-password ──────────────────── */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ success: false, message: 'Token and new password required' });
    if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });

    const [user] = await query(
      'SELECT id FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()',
      [token]
    );
    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });

    const hashed = await bcrypt.hash(password, 12);
    await execute('UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?',
      [hashed, user.id]);

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Reset failed' });
  }
});

/* ── POST /api/auth/change-password ─────────────────── */
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ success: false, message: 'Both passwords required' });
    if (new_password.length < 8) return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });

    const [user] = await query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    // Reusing the temporary password would defeat the forced-change step.
    if (current_password === new_password) {
      return res.status(400).json({ success: false, message: 'New password must be different from the current one' });
    }

    const hashed = await bcrypt.hash(new_password, 12);
    // Clearing must_change_password releases the first-login block.
    await execute('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?', [hashed, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Change password failed' });
  }
});

export default router;
