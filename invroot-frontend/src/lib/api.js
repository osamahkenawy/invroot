const BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers, credentials: 'include' };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);

  if (res.status === 401) {
    // Try to read the actual error message from the response body first
    let bodyMessage = 'Session expired';
    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const body = await res.json();
        bodyMessage = body.message || bodyMessage;
      }
    } catch { /* ignore parse errors */ }

    localStorage.removeItem('auth_token');
    const authPaths = ['/login', '/signup', '/forgot-password', '/reset-password'];
    const onAuthPage = authPaths.some((p) => window.location.pathname.startsWith(p));
    // Only hard-redirect when a real session expired (we had a token) and we're
    // not already on a public auth page. Prevents an infinite reload loop when
    // the initial auth check (GET /me) returns 401 for an anonymous visitor.
    if (token && !onAuthPage) {
      window.location.href = '/login';
    }
    return { success: false, message: onAuthPage ? bodyMessage : 'Session expired' };
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.blob();
}

const api = {
  get:    (path)         => request('GET',    path, undefined),
  post:   (path, body)   => request('POST',   path, body),
  put:    (path, body)   => request('PUT',    path, body),
  delete: (path)         => request('DELETE', path, undefined),
  patch:  (path, body)   => request('PATCH',  path, body),

  /** Download a file (PDF etc.) */
  download: async (path, filename) => {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
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
