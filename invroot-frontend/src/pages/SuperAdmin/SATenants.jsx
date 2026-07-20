import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

function fmtAmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 }); }

const AVATAR_COLORS = ['#3b82f6','#10b981','#7c3aed','#d63a17','#0891b2','#f59e0b','#ec4899','#14b8a6'];
const avatarColor   = (name = '') => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

const SearchIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

export default function SATenants() {
  const navigate = useNavigate();
  const [tenants, setTenants]  = useState([]);
  const [total,   setTotal]    = useState(0);
  const [maxRev,  setMaxRev]   = useState(1);
  const [loading, setLoading]  = useState(true);
  const [search,  setSearch]   = useState('');
  const [status,  setStatus]   = useState('');
  const [plan,    setPlan]     = useState('');
  const [page,    setPage]     = useState(1);
  const LIMIT = 15;

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({
      ...(search && { search }),
      ...(status && { status }),
      ...(plan   && { plan }),
      page, limit: LIMIT,
    });
    saApi.get(`/tenants?${q}`).then(r => {
      if (r.success) {
        const rows = r.data || [];
        setTenants(rows);
        setTotal(r.total || 0);
        setMaxRev(Math.max(...rows.map(t => Number(t.total_revenue)), 1));
      }
      setLoading(false);
    });
  }, [search, status, plan, page]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, newStatus) => {
    await saApi.put(`/tenants/${id}/status`, { status: newStatus });
    load();
  };

  const impersonate = async (id) => {
    const r = await saApi.post(`/tenants/${id}/impersonate`);
    if (r.success && r.data?.token) {
      localStorage.setItem('auth_token', r.data.token);
      window.open('/', '_blank');
    } else alert('Impersonation failed: ' + (r.message || 'unknown error'));
  };

  const pages = Math.ceil(total / LIMIT);

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">Tenants</h1>
          <p className="sa-page-sub">{total} companies registered on the platform</p>
        </div>
      </div>

      <div className="sa-card">
        <div className="sa-toolbar">
          <div className="sa-search">
            {SearchIcon}
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search company name or email…"
            />
          </div>
          <select className="sa-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select className="sa-select" value={plan} onChange={e => { setPlan(e.target.value); setPage(1); }}>
            <option value="">All plans</option>
            <option value="free">Free</option>
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>

        {loading ? (
          <div className="sa-empty">Loading…</div>
        ) : (
          <table className="sa-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Users</th>
                <th>Invoices</th>
                <th>Revenue</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => {
                const bg      = avatarColor(t.company_name);
                const initial = (t.company_name || '?')[0].toUpperCase();
                const revPct  = Math.round(Number(t.total_revenue) / maxRev * 100);
                return (
                  <tr key={t.id}>
                    <td style={{ minWidth: 220 }}>
                      <div className="sa-company-cell">
                        <div className="sa-company-avatar"
                          style={{ background: `linear-gradient(135deg, ${bg}, ${bg}bb)` }}>
                          {initial}
                        </div>
                        <div>
                          <div className="sa-company-name">{t.company_name}</div>
                          <div className="sa-company-email">{t.owner_email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`sa-badge ${t.status || 'active'}`}>{t.status}</span>
                    </td>
                    <td>
                      <span className="sa-badge no-dot" style={{ background:'#f8fafc', color:'#374151' }}>
                        {t.plan || 'free'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{t.user_count}</td>
                    <td style={{ fontWeight: 600 }}>{t.invoice_count}</td>
                    <td>
                      <div className="td-amt">{fmtAmt(t.total_revenue)}</div>
                      <div className="sa-mini-bar-wrap">
                        <div className="sa-mini-bar" style={{ width:`${revPct}%`, background: `linear-gradient(90deg, ${bg}, ${bg}88)` }} />
                      </div>
                    </td>
                    <td className="td-mono">{t.created_at?.slice(0, 10)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <button className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => navigate(`/admin/tenants/${t.id}`)}>
                          View
                        </button>
                        {t.status === 'active'
                          ? <button className="sa-btn sa-btn-danger sa-btn-sm" onClick={() => updateStatus(t.id,'suspended')}>Suspend</button>
                          : <button className="sa-btn sa-btn-success sa-btn-sm" onClick={() => updateStatus(t.id,'active')}>Activate</button>
                        }
                        <button className="sa-btn sa-btn-amber sa-btn-sm" onClick={() => impersonate(t.id)}>
                          Login as
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!tenants.length && (
                <tr><td colSpan={8}><div className="sa-empty">No tenants found</div></td></tr>
              )}
            </tbody>
          </table>
        )}

        {pages > 1 && (
          <div className="sa-pagination">
            <span>Page {page} of {pages} · {total} total</span>
            <button className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>← Prev</button>
            <button className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setPage(p => p + 1)} disabled={page >= pages}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
