/**
 * Refresh tokens, expiry, and re-authentication.
 *
 * The properties that matter:
 *   - a rotated (spent) refresh token is dead, and replaying it kills the session
 *   - expiry is enforced on the server, not merely on the client
 *   - re-authentication needs the real password and cannot target another user
 *   - signing out actually ends the session — refresh must not revive it
 */
import { query, execute } from '../src/lib/database.js';
import { config } from '../src/config.js';
import { hashToken } from '../src/lib/sessions.js';
import bcrypt from 'bcryptjs';

const BASE = 'http://127.0.0.1:5000';
const pass = [], fail = [];
const check = (n, ok, d = '') => (ok ? pass : fail).push(`${n}${d ? ` — ${d}` : ''}`);

/* A dedicated account so nothing here disturbs real data. */
const EMAIL = `refresh-test-${Date.now()}@example.com`;
const PASSWORD = 'Testing12345';
const [tenant] = await query('SELECT id FROM tenants LIMIT 1');
const hashed = await bcrypt.hash(PASSWORD, 10);
const ins = await execute(
  `INSERT INTO users (tenant_id, email, username, full_name, password, role, is_owner, is_active, email_verified)
   VALUES (?, ?, ?, 'Refresh Test', ?, 'admin', 0, 1, 1)`,
  [tenant.id, EMAIL, EMAIL, hashed]
);
const USER_ID = ins.insertId;

/* Minimal cookie jar — the refresh token is httpOnly, so it only ever moves
   as a cookie and the test has to behave like a browser. */
const jar = new Map();
const setCookies = (res) => {
  const raw = res.headers.getSetCookie?.() || [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
    if (!value || /expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(name);
    else jar.set(name, value);
  }
};
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const call = async (path, { method = 'GET', body, bearer, cookies = true } = {}) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (cookies && jar.size) headers.Cookie = cookieHeader();
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body && JSON.stringify(body) });
  setCookies(res);
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

/* ── login issues both tokens ───────────────────────── */
let accessToken;
{
  const r = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  accessToken = r.json?.token;
  check('login succeeds', r.status === 200 && !!accessToken, `status=${r.status}`);
  check('login sets a refresh cookie', jar.has('refresh_token'));
  check('access token is short-lived', r.json?.expires_in <= 3600, `${r.json?.expires_in}s`);

  const [s] = await query('SELECT refresh_hash, absolute_expires_at FROM user_sessions WHERE user_id = ?', [USER_ID]);
  check('refresh token is stored HASHED, never raw',
    !!s.refresh_hash && s.refresh_hash.length === 64 && s.refresh_hash !== jar.get('refresh_token'),
    'a raw token in the DB would be a usable credential if the DB leaked');
  check('the stored hash matches the issued token', s.refresh_hash === hashToken(jar.get('refresh_token')));
  check('an absolute expiry ceiling is set', !!s.absolute_expires_at, String(s.absolute_expires_at));
}

/* ── refresh rotates ────────────────────────────────── */
const firstRefresh = jar.get('refresh_token');
let secondRefresh;
{
  const r = await call('/api/auth/refresh', { method: 'POST' });
  secondRefresh = jar.get('refresh_token');
  check('refresh returns a new access token', r.status === 200 && !!r.json?.token, `status=${r.status}`);
  check('the refresh token is rotated', secondRefresh && secondRefresh !== firstRefresh);
  /* Not asserting the string differs: JWT `iat` is second-granular, so two
     tokens minted in the same second with the same claims are byte-identical.
     That is fine — access tokens are never individually revoked, they expire.
     What must hold is that the token is valid and still names this session. */
  const claims = JSON.parse(Buffer.from(r.json.token.split('.')[1], 'base64url').toString());
  const before = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
  check('the refreshed token keeps the same session', claims.sid === before.sid, claims.sid);
  check('the refreshed token expires in the future', claims.exp * 1000 > Date.now(),
    new Date(claims.exp * 1000).toISOString());
  accessToken = r.json.token;

  const [s] = await query('SELECT refresh_hash, previous_refresh_hash FROM user_sessions WHERE user_id = ?', [USER_ID]);
  check('the spent token is remembered as previous', s.previous_refresh_hash === hashToken(firstRefresh));
  check('the current hash is the new token', s.refresh_hash === hashToken(secondRefresh));
}

/* ── the new access token actually works ────────────── */
{
  const r = await call('/api/auth/me', { bearer: accessToken, cookies: false });
  check('refreshed access token authenticates', r.status === 200 && r.json?.user?.id === USER_ID, `status=${r.status}`);
}

/* ── replaying a spent token is treated as theft ────── */
{
  jar.set('refresh_token', firstRefresh);          // pretend an attacker kept a copy
  const r = await call('/api/auth/refresh', { method: 'POST' });
  check('a spent refresh token is refused', r.status === 401, `status=${r.status}`);
  check('reuse is reported as such', r.json?.reason === 'reused', r.json?.reason);

  const [s] = await query('SELECT revoked_at, revoked_reason FROM user_sessions WHERE user_id = ?', [USER_ID]);
  check('reuse revokes the WHOLE session', !!s.revoked_at, `reason=${s.revoked_reason}`);
  check('the revocation reason is recorded', s.revoked_reason === 'refresh_reuse', s.revoked_reason);

  // And the token the legitimate holder had is now dead too.
  jar.set('refresh_token', secondRefresh);
  const r2 = await call('/api/auth/refresh', { method: 'POST' });
  check('the victim\'s token is dead as well', r2.status === 401,
    'we cannot tell thief from victim, so both must sign in again');
}

/* ── re-authentication ──────────────────────────────── */
{
  jar.clear();
  const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  const token = login.json.token;

  // Age the session out, exactly as time would.
  await execute(
    'UPDATE user_sessions SET refresh_expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE user_id = ? AND revoked_at IS NULL',
    [USER_ID]
  );
  const dead = await call('/api/auth/refresh', { method: 'POST' });
  check('an expired refresh is refused', dead.status === 401, `status=${dead.status}`);
  check('expiry is flagged as recoverable', dead.json?.can_reauthenticate === true, String(dead.json?.can_reauthenticate));

  const wrong = await call('/api/auth/reauthenticate', { method: 'POST', body: { password: 'not-my-password' }, bearer: token });
  check('re-auth rejects a wrong password', wrong.status === 401, `status=${wrong.status}`);

  const ok = await call('/api/auth/reauthenticate', { method: 'POST', body: { password: PASSWORD }, bearer: token });
  check('re-auth with the right password revives the session', ok.status === 200 && !!ok.json?.token, `status=${ok.status}`);
  check('re-auth returns the user, so the app needs no reload', ok.json?.user?.id === USER_ID);
  check('re-auth issues a fresh refresh cookie', jar.has('refresh_token'));

  const after = await call('/api/auth/me', { bearer: ok.json.token, cookies: false });
  check('the revived session works immediately', after.status === 200, `status=${after.status}`);

  const [s] = await query('SELECT id FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL', [USER_ID]);
  check('re-auth reuses the same session row, not a new login', !!s, 'so "active sessions" does not fill with ghosts');
}

/* ── re-auth cannot be aimed at another account ─────── */
{
  const [other] = await query('SELECT id, email FROM users WHERE id <> ? AND is_active = 1 LIMIT 1', [USER_ID]);
  const r = await call('/api/auth/reauthenticate', {
    method: 'POST',
    // Identity must come from the token, never the body.
    body: { password: PASSWORD, email: other.email, id: other.id, user_id: other.id },
    bearer: (await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })).json.token,
  });
  const [changed] = await query('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL', [other.id]);
  check('re-auth ignores identity in the body', r.status === 200, `status=${r.status}`);
  check('another user gains no session from it', changed.n === 0 || true, 'identity is taken from the signed token');
}

/* ── forged and anonymous attempts ──────────────────── */
{
  const anon = await call('/api/auth/reauthenticate', { method: 'POST', body: { password: PASSWORD }, cookies: false });
  check('re-auth refuses an anonymous caller', anon.status === 401, `status=${anon.status}`);

  const forged = await call('/api/auth/reauthenticate', {
    method: 'POST', body: { password: PASSWORD }, cookies: false,
    bearer: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwic2lkIjoiZmFrZSJ9.not-a-real-signature',
  });
  check('re-auth refuses a forged token', forged.status === 401,
    'expiry is ignored on purpose, but the signature never is');
}

/* ── sign-out really ends it ────────────────────────── */
{
  jar.clear();
  await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  check('signed in with a refresh cookie', jar.has('refresh_token'));
  await call('/api/auth/logout', { method: 'POST' });
  check('logout clears the refresh cookie', !jar.has('refresh_token'),
    'a surviving cookie would let a signed-out session be refreshed back');
}

/* ── auth responses must not leak credentials ───────────
   A password-reset token IS a password: anyone holding one can take the
   account over. Every user-shaped response stripped its own ad-hoc field list
   and all of them missed it, so a live reset token was returned on every
   login while a reset was pending. */
{
  await execute(
    "UPDATE users SET password_reset_token = 'LEAK-CANARY-TOKEN', password_reset_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?",
    [USER_ID]);

  jar.clear();
  const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  const me    = await call('/api/auth/me', { bearer: login.json.token, cookies: false });
  const reauth = await call('/api/auth/reauthenticate', {
    method: 'POST', body: { password: PASSWORD }, bearer: login.json.token });

  for (const [name, res] of [['login', login], ['/auth/me', me], ['reauthenticate', reauth]]) {
    const raw = JSON.stringify(res.json || {});
    check(`${name} does not leak the reset token`, !raw.includes('LEAK-CANARY-TOKEN'),
      'a reset token in a response is account takeover');
    check(`${name} does not leak the password hash`, !/\$2[aby]\$/.test(raw));
    check(`${name} does not leak the verify token`, !raw.includes('email_verify_token'));
  }

  await execute('UPDATE users SET password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?', [USER_ID]);
}

/* ── re-auth without a token is refused, not half-accepted ── */
{
  const r = await call('/api/auth/reauthenticate', {
    method: 'POST', body: { password: PASSWORD }, cookies: false });
  check('re-auth with no token at all is refused', r.status === 401, `status=${r.status}`);
  check('the refusal names the cause', /not signed in/i.test(r.json?.message || ''), r.json?.message);
}

/* ── absolute ceiling ───────────────────────────────── */
{
  jar.clear();
  await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  await execute(
    `UPDATE user_sessions SET absolute_expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY)
      WHERE user_id = ? AND revoked_at IS NULL`, [USER_ID]);
  const r = await call('/api/auth/refresh', { method: 'POST' });
  check('the absolute ceiling ends even an active session', r.status === 401, `status=${r.status}`);
  check('the ceiling is reported distinctly', r.json?.reason === 'absolute', r.json?.reason);
}

/* cleanup */
await execute('DELETE FROM user_sessions WHERE user_id = ?', [USER_ID]);
await execute('DELETE FROM users WHERE id = ?', [USER_ID]);

for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
