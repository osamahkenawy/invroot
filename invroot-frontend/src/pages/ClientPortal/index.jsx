import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api.js';
import Loader from '../../components/Loader.jsx';
import { fmtCurrency } from '../../utils/currency.js';
import './index.css';

const PORTAL_TOKEN_KEY = 'portal_token';
const PORTAL_CLIENT_KEY = 'portal_client';

function getPortalHeaders() {
  const token = sessionStorage.getItem(PORTAL_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function portalRequest(path) {
  const res = await fetch(`/api/client-portal${path}`, { headers: getPortalHeaders(), credentials: 'include' });
  return res.json();
}

export default function ClientPortal() {
  return (
    <Routes>
      <Route path="login" element={<PortalLogin />} />
      <Route path="dashboard" element={<PortalDashboard />} />
      <Route path="invoices" element={<PortalInvoices />} />
      <Route path="payments" element={<PortalPayments />} />
      <Route index element={<PortalLogin />} />
    </Routes>
  );
}

function PortalLogin() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail]   = useState('');
  const [token, setToken]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const isRTL = i18n.language === 'ar';

  const handleLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await fetch('/api/client-portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token }),
      }).then(r => r.json());

      if (res.success) {
        sessionStorage.setItem(PORTAL_TOKEN_KEY, res.token);
        sessionStorage.setItem(PORTAL_CLIENT_KEY, JSON.stringify(res.client));
        navigate('/portal/dashboard');
      } else {
        setError(res.message || 'Login failed');
      }
    } finally { setLoading(false); }
  };

  return (
    <div className={`portal-login ${isRTL ? 'rtl' : ''}`}>
      <div className="portal-login-card">
        <h1 className="portal-brand">INVROOT</h1>
        <p className="portal-subtitle">{isRTL ? 'بوابة العميل' : 'Client Portal'}</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleLogin}>
          <div className="form-group"><label>{t('auth.email')}</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <div className="form-group"><label>{isRTL ? 'رمز الوصول' : 'Access Token'}</label><input value={token} onChange={e => setToken(e.target.value)} required /></div>
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>{loading ? <span className="spinner spinner-sm" /> : (isRTL ? 'دخول' : 'Enter Portal')}</button>
        </form>
      </div>
    </div>
  );
}

function PortalDashboard() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const isRTL = i18n.language === 'ar';

  useEffect(() => {
    if (!sessionStorage.getItem(PORTAL_TOKEN_KEY)) { navigate('/portal/login'); return; }
    portalRequest('/dashboard').then(res => {
      if (res.success) setData(res.data);
      else navigate('/portal/login');
      setLoading(false);
    });
  }, []);

  const client = JSON.parse(sessionStorage.getItem(PORTAL_CLIENT_KEY) || '{}');

  if (loading) return <Loader fullPage />;

  return (
    <div className={`portal-root ${isRTL ? 'rtl' : ''}`}>
      <header className="portal-header">
        <span className="portal-brand">INVROOT</span>
        <span className="portal-client-name">{client.name}</span>
      </header>
      <main className="portal-main">
        <h2>{isRTL ? 'مرحباً' : 'Welcome'}, {client.name}</h2>
        <div className="kpi-grid" style={{ marginTop: 16 }}>
          {[
            [isRTL ? 'الرصيد المستحق' : 'Open Balance', fmtCurrency(data?.open_balance, client.tenant_currency)],
            [isRTL ? 'إجمالي الفواتير' : 'Total Invoices', data?.total_invoices],
            [isRTL ? 'الفواتير المتأخرة' : 'Overdue', data?.overdue_count],
          ].map(([label, val]) => (
            <div key={label} className="kpi-card"><div className="kpi-label">{label}</div><div className="kpi-value">{val ?? '—'}</div></div>
          ))}
        </div>
      </main>
    </div>
  );
}

function PortalInvoices() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { portalRequest('/invoices').then(res => { if (res.success) setInvoices(res.data); setLoading(false); }); }, []);
  const client = JSON.parse(sessionStorage.getItem(PORTAL_CLIENT_KEY) || '{}');
  return (
    <div className="portal-root">
      <h2 style={{ marginBottom: 16 }}>{t('invoices.title')}</h2>
      {loading ? <Loader /> : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>#</th><th>{t('common.total')}</th><th>{t('invoices.due_date')}</th><th>{t('common.status')}</th></tr></thead>
            <tbody>
              {invoices.map(inv => <tr key={inv.id}><td>{inv.invoice_number}</td><td>{fmtCurrency(inv.total_amount, inv.currency || client.tenant_currency)}</td><td>{inv.due_date}</td><td>{inv.status}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PortalPayments() {
  const { t } = useTranslation();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { portalRequest('/payments').then(res => { if (res.success) setPayments(res.data); setLoading(false); }); }, []);
  const client = JSON.parse(sessionStorage.getItem(PORTAL_CLIENT_KEY) || '{}');
  return (
    <div className="portal-root">
      <h2 style={{ marginBottom: 16 }}>{t('payments.title')}</h2>
      {loading ? <Loader /> : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>{t('invoices.number')}</th><th>{t('common.amount')}</th><th>{t('payments.method')}</th><th>{t('common.date')}</th></tr></thead>
            <tbody>
              {payments.map(p => <tr key={p.id}><td>{p.invoice_number}</td><td>{fmtCurrency(p.amount, p.currency || client.tenant_currency)}</td><td>{p.method}</td><td>{p.payment_date}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
