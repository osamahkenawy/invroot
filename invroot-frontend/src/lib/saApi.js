/**
 * Lightweight API helper for super admin — same base URL, separate token key.
 * Super admin token is stored as 'sa_token' in localStorage.
 */
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

const saApi = {
  _token: () => localStorage.getItem('sa_token'),

  _req: async (method, path, body) => {
    const token = localStorage.getItem('sa_token');
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const res = await fetch(`${BASE}${path}`, opts);
    if (res.status === 401) { localStorage.removeItem('sa_token'); window.location.href = '/admin/login'; return {}; }
    return res.json().catch(() => ({}));
  },

  get:    (path)         => saApi._req('GET',    `/super-admin${path}`),
  post:   (path, body)   => saApi._req('POST',   `/super-admin${path}`, body),
  put:    (path, body)   => saApi._req('PUT',    `/super-admin${path}`, body),
  // Coupons expose activation over PATCH; without this the toggle had no verb.
  patch:  (path, body)   => saApi._req('PATCH',  `/super-admin${path}`, body),
  delete: (path)         => saApi._req('DELETE', `/super-admin${path}`),

  /** Login uses the normal auth endpoint */
  login: async (email, password) => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return res.json().catch(() => ({}));
  },
};

export default saApi;
