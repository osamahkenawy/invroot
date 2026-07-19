import { useState } from 'react';
import saApi from '../../lib/saApi.js';
import './SuperAdminLogin.css';

export default function SuperAdminLogin() {
  const [email,    setEmail]    = useState('superadmin@invroot.com');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Email and password are required.'); return; }
    setLoading(true); setError('');
    const res = await saApi.login(email, password);
    setLoading(false);
    if (!res.success) { setError(res.message || 'Invalid credentials'); return; }
    if (!res.data?.is_super_admin && !res.user?.is_super_admin) {
      setError('This account does not have super admin access.');
      return;
    }
    const token = res.data?.token || res.token;
    if (token) { localStorage.setItem('sa_token', token); window.location.href = '/admin'; }
    else setError('Login failed — no token returned.');
  };

  return (
    <div className="sa-login-root">
      <div className="sa-login-card">
        <div className="sa-login-brand">
          <div className="sa-login-logo">
            <span className="sa-login-logo-icon">⚡</span>
          </div>
          <h1 className="sa-login-title">Invroot</h1>
          <p className="sa-login-sub">Platform Administration</p>
        </div>

        <form className="sa-login-form" onSubmit={handleLogin}>
          {error && <div className="sa-login-error">{error}</div>}

          <div className="sa-field">
            <label className="sa-label">Email</label>
            <input
              className="sa-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="superadmin@invroot.com"
              autoFocus
            />
          </div>

          <div className="sa-field">
            <label className="sa-label">Password</label>
            <input
              className="sa-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button className="sa-login-btn" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In to Admin Panel'}
          </button>
        </form>

        <p className="sa-login-back">
          <a href="/">← Back to app</a>
        </p>
      </div>
    </div>
  );
}
