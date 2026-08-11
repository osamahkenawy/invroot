/**
 * Session lock screen.
 *
 * When a session can no longer be refreshed, the old behaviour was to redirect
 * to /login. That is destructive: a half-written invoice, an unsaved client, a
 * filled-in form — all gone, and the person is left staring at a login page
 * with no idea what happened.
 *
 * Instead this overlays the app. The page underneath stays mounted with its
 * state intact; the person types their password and carries on exactly where
 * they were. Signing out remains available for anyone who actually wants it.
 */

import { useState, useEffect, useRef, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Eye, EyeClosed } from 'iconoir-react';
import { SESSION_EXPIRED_EVENT, setAccessToken, takeExpiredToken, clearExpiredToken } from '../lib/api.js';
import { AuthContext } from '../context/AuthContext.jsx';
import UserAvatar from './UserAvatar.jsx';
import './SessionGate.css';

const BASE = import.meta.env.VITE_API_URL || '/api';

export default function SessionGate() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { user, refreshUser, logout } = useContext(AuthContext);

  const [locked, setLocked]   = useState(false);
  const [detail, setDetail]   = useState(null);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]   = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const onExpired = (e) => {
      setDetail(e.detail || {});
      setError('');
      setPassword('');
      setLocked(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (locked) setTimeout(() => inputRef.current?.focus(), 60);
  }, [locked]);

  /* While locked, keep focus inside the dialog. Tabbing into the page behind
     would let someone edit a form they can no longer save. */
  useEffect(() => {
    if (!locked) return;
    const trap = (e) => {
      if (e.key !== 'Tab') return;
      const root = document.querySelector('.sg-card');
      if (!root) return;
      const focusable = root.querySelectorAll('button, input, a[href]');
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [locked]);

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;

    /* Without the spent token the server cannot know whose password this is,
       and would answer "Not signed in" however correct it was. Say so and
       offer the only thing that works, rather than letting someone retype a
       correct password into a dialog that cannot succeed. */
    const spent = takeExpiredToken();
    if (!spent) {
      setError(isRTL
        ? 'تعذّر التحقق من هويتك. يرجى تسجيل الدخول مرة أخرى.'
        : "We couldn't confirm who you are. Please sign in again.");
      setDetail(d => ({ ...(d || {}), canReauthenticate: false }));
      return;
    }

    setBusy(true);
    setError('');
    try {
      /* Deliberately a bare fetch, not the api client: that client reacts to a
         401 by announcing expiry, which would re-trigger this very dialog. */
      const res = await fetch(`${BASE}/auth/reauthenticate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          /* The SPENT token — the live one is already gone. It is what tells
             the server whose password this is; its signature is verified and
             only its expiry is ignored. */
          Authorization: `Bearer ${spent}`,
        },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && body.success) {
        setAccessToken(body.token);
        setLocked(false);
        setPassword('');
        refreshUser?.();
        return;
      }
      setError(body.message || (isRTL ? 'كلمة المرور غير صحيحة.' : 'Incorrect password.'));
    } catch {
      /* A failed fetch is a connection problem, not a rejected password — the
         session is still recoverable, so make clear this is worth retrying and
         do NOT consume the spent token. */
      setError(isRTL
        ? 'تعذّر الوصول إلى الخادم. تحقق من اتصالك ثم اضغط "متابعة" مرة أخرى.'
        : 'Couldn\'t reach the server. Check your connection and press Continue again.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setLocked(false);
    clearExpiredToken();
    await logout?.();
    window.location.href = '/login';
  };

  if (!locked) return null;

  /* A session killed for token reuse cannot be revived in place — the server
     revoked it deliberately. Say why, rather than letting someone type a
     correct password into a dialog that can never succeed. */
  const mustSignIn = detail?.canReauthenticate === false;

  return (
    <div className="sg-overlay" role="dialog" aria-modal="true" aria-labelledby="sg-title" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="sg-card">
        <div className="sg-icon"><Lock /></div>

        <h2 id="sg-title" className="sg-title">
          {mustSignIn
            ? (isRTL ? 'انتهت الجلسة' : 'Your session ended')
            : (isRTL ? 'الجلسة مقفلة' : 'Session locked')}
        </h2>

        <p className="sg-lead">
          {mustSignIn
            ? (isRTL
                ? 'لأسباب أمنية تم إنهاء هذه الجلسة. سجّل الدخول مرة أخرى للمتابعة.'
                : 'This session was ended for security reasons. Please sign in again to continue.')
            : (isRTL
                ? 'انتهت مدة جلستك. أدخل كلمة المرور للمتابعة — عملك على هذه الصفحة محفوظ كما هو.'
                : "Your session timed out. Enter your password to carry on — nothing on this page has been lost.")}
        </p>

        {user && (
          <div className="sg-who">
            <UserAvatar user={user} size={34} />
            <div className="sg-who-text">
              <div className="sg-who-name">{user.full_name || user.email}</div>
              <div className="sg-who-mail">{user.email}</div>
            </div>
          </div>
        )}

        {mustSignIn ? (
          <button type="button" className="sg-submit" onClick={signOut}>
            {isRTL ? 'تسجيل الدخول' : 'Sign in'}
          </button>
        ) : (
          <form onSubmit={submit} className="sg-form">
            <label className="sg-label" htmlFor="sg-password">
              {isRTL ? 'كلمة المرور' : 'Password'}
            </label>
            <div className="sg-input-wrap">
              <input
                id="sg-password"
                ref={inputRef}
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                autoComplete="current-password"
                placeholder={isRTL ? '••••••••' : '••••••••'}
                disabled={busy}
              />
              <button
                type="button"
                className="sg-eye"
                onClick={() => setShowPw(v => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPw ? <EyeClosed /> : <Eye />}
              </button>
            </div>

            {error && <div className="sg-error">{error}</div>}

            <button type="submit" className="sg-submit" disabled={busy || !password}>
              {busy
                ? (isRTL ? 'جارٍ التحقق…' : 'Unlocking…')
                : (isRTL ? 'متابعة' : 'Continue')}
            </button>
          </form>
        )}

        {!mustSignIn && (
          <button type="button" className="sg-signout" onClick={signOut}>
            {isRTL ? 'تسجيل الخروج بدلاً من ذلك' : 'Sign out instead'}
          </button>
        )}
      </div>
    </div>
  );
}
