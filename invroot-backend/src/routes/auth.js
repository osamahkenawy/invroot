import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, execute } from '../lib/database.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit-logger.js';
import { config } from '../config.js';

const router = express.Router();

/* ── POST /api/auth/register ─────────────────────────── */
router.post('/register', async (req, res) => {
  try {
    const { business_name, email, phone, password, lang = 'en' } = req.body;
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

    // Create tenant
    const tenantResult = await execute(
      `INSERT INTO tenants (company_name, slug, email, phone, status, currency, lang)
       VALUES (?, ?, ?, ?, 'trialing', 'USD', ?)`,
      [business_name, slug, email, phone || null, lang]
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

    // Send verification email
    const verifyLink = `${config.app.url}/verify-email?token=${verifyToken}`;
    await sendVerificationEmail({ to: email, name: business_name, verifyLink, lang });

    res.status(201).json({ success: true, message: 'Account created. Please verify your email.' });
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
              t.logo_url, t.currency, t.lang as tenant_lang
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = ?`,
      [email]
    );

    if (!users.length) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const user = users[0];

    if (!user.email_verified) {
      return res.status(403).json({ success: false, code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before logging in.' });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = generateToken(user);
    await execute('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    // Log login
    await logAudit({ tenantId: user.tenant_id, userId: user.id, action: 'login', entity: 'user', entityId: user.id, ip: req.ip });

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const { password: _p, email_verify_token: _t, ...safeUser } = user;
    res.json({ success: true, token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

/* ── POST /api/auth/logout ───────────────────────────── */
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, message: 'Logged out' });
});

/* ── GET /api/auth/me ────────────────────────────────── */
router.get('/me', authMiddleware, async (req, res) => {
  const { password: _p, email_verify_token: _t, ...safe } = req.user;
  res.json({ success: true, user: safe });
});

/* ── GET /api/auth/verify-email ──────────────────────── */
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });

    const [user] = await query('SELECT id, tenant_id FROM users WHERE email_verify_token = ?', [token]);
    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired token' });

    await execute('UPDATE users SET email_verified = 1, email_verify_token = NULL WHERE id = ?', [user.id]);
    await execute("UPDATE tenants SET status = 'active' WHERE id = ? AND status = 'trialing'", [user.tenant_id]);

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

    const resetLink = `${config.app.url}/reset-password?token=${resetToken}`;
    await sendPasswordResetEmail({ to: email, name: user.full_name, resetLink, lang: user.lang_preference || 'en' });

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

    const hashed = await bcrypt.hash(new_password, 12);
    await execute('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Change password failed' });
  }
});

export default router;
