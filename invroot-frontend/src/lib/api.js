/**
 * API client with transparent token refresh.
 *
 * The access token is short-lived by design, so a 401 during normal use is
 * expected rather than exceptional. Previously any 401 wiped the token and did
 * `window.location.href = '/login'` — which threw away whatever the person was
 * doing, a half-written invoice included.
 *
 * Now a 401 first tries to refresh and replays the original request. Only if
 * that fails does the session end, and even then the app asks for a password
 * in place instead of navigating away. See SessionGate.jsx.
 */

const BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

/** Broadcast that the session is over and a password is needed to continue. */
export const SESSION_EXPIRED_EVENT = 'invroot:session-expired';

/* Re-authentication has to prove WHO is re-authenticating, and the only thing
   that carries that is the expired access token. So it is moved aside rather
   than thrown away — `auth_token` keeps meaning "believed valid", while this
   holds a spent token that is useful for identity and nothing else. The server
   verifies its signature and ignores only the expiry. */
export const EXPIRED_TOKEN_KEY = 'auth_token_expired';

export function takeExpiredToken() {
  return localStorage.getItem(EXPIRED_TOKEN_KEY) || '';
}
export function clearExpiredToken() {
  localStorage.removeItem(EXPIRED_TOKEN_KEY);
}

/* Ending a session is not just an event — the expired token has to be moved
   aside first, because the lock screen needs it to prove WHO is
   re-authenticating. `download()` used to announce expiry without doing that,
   so a session that died during a PDF download opened a dialog that could
   never succeed: it sent an empty Bearer and the server answered "Not signed
   in" no matter how correct the password was. */
function endSession(detail) {
  const token = getToken();
  if (token) localStorage.setItem(EXPIRED_TOKEN_KEY, token);
  localStorage.removeItem('auth_token');

  const authPaths = ['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'];
  const onAuthPage = authPaths.some(p => window.location.pathname.startsWith(p));
  /* Only prompt someone who actually had a session. An anonymous visitor
     hitting /auth/me gets a 401 too and must not see a lock screen. */
  if (token && !onAuthPage) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail }));
  }
}

/* Endpoints that must never trigger a refresh attempt — refreshing in response
   to their own 401 would recurse. */
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/reauthenticate', '/auth/register'];

/* One refresh at a time. A page typically fires several requests at once; if
   each started its own refresh they would rotate the token from under one
   another, and every loser would be rejected as token REUSE — which revokes
   the whole session. Everyone waits on the same promise instead. */
let refreshing = null;

async function refreshAccessToken() {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',        // the refresh token is an httpOnly cookie
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && body.success && body.token) {
        localStorage.setItem('auth_token', body.token);
        return { ok: true, token: body.token };
      }
      return { ok: false, reason: body.reason, canReauthenticate: !!body.can_reauthenticate };
    } catch {
      // A network failure is not an expired session — don't sign anyone out.
      return { ok: false, reason: 'network' };
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/** Used by the re-authentication prompt once the password checks out. */
export function setAccessToken(token) {
  if (token) {
    localStorage.setItem('auth_token', token);
    localStorage.removeItem(EXPIRED_TOKEN_KEY);
  }
}

async function send(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers, credentials: 'include' };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, opts);
}

async function request(method, path, body) {
  const token = getToken();
  let res = await send(method, path, body, token);

  if (res.status === 401 && !NO_REFRESH.some(p => path.startsWith(p))) {
    const refreshed = await refreshAccessToken();

    if (refreshed.ok) {
      // Replay with the new token — the caller never learns it expired.
      res = await send(method, path, body, refreshed.token);
    } else if (refreshed.reason !== 'network') {
      endSession({ reason: refreshed.reason, canReauthenticate: refreshed.canReauthenticate });
      return { success: false, code: 'SESSION_EXPIRED', message: 'Your session has ended.' };
    }
  }

  if (res.status === 401) {
    let message = 'Session expired';
    try {
      if ((res.headers.get('content-type') || '').includes('application/json')) {
        message = (await res.json()).message || message;
      }
    } catch { /* ignore parse errors */ }
    return { success: false, message };
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.blob();
}

const api = {
  get:    (path)         => request('GET',    path, undefined),
  post:   (path, body)   => request('POST',   path, body),
  put:    (path, body)   => request('PUT',    path, body),
  delete: (path)         => request('DELETE', path, undefined),
  patch:  (path, body)   => request('PATCH',  path, body),

  /** Download a file (PDF etc.), refreshing once if the token has expired. */
  download: async (path, filename) => {
    const fetchOnce = (tok) => fetch(`${BASE}${path}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      credentials: 'include',
    });

    let res = await fetchOnce(getToken());
    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (!refreshed.ok) {
        if (refreshed.reason !== 'network') {
          endSession({ reason: refreshed.reason, canReauthenticate: refreshed.canReauthenticate });
        }
        return;
      }
      res = await fetchOnce(refreshed.token);
    }
    if (!res.ok) return;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'download';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
};

export default api;
