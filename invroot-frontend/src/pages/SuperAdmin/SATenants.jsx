import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

const STATUS_COLOR = { active:'sa-status-active', trial:'sa-status-trial', suspended:'sa-status-suspended', cancelled:'sa-status-cancelled' };
function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 }); }

export default function SATenants() {
  const navigate = useNavigate();
  const [tenants,  setTenants]  = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [status,   setStatus]   = useState('');
  const [plan,     setPlan]     = useState('');
  const [page,     setPage]     = useState(1);
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
      if (r.success) { setTenants(r.data || []); setTotal(r.total || 0); }
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
      const orig = localStorage.getItem('sa_token');
      localStorage.setItem('sa_token_backup', orig);
      localStorage.setItem('auth_token', r.data.token);
      window.open('/', '_blank');
    } else alert('Impersonation failed: ' + (r.message || 'unknown'));
  };

  const pages = Math.ceil(total / LIMIT);

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">Tenants</h1>
          <p className="sa-page-sub">{total} total companies</p>
        </div>
      </div>

      <div className="sa-card">
        <div className="sa-toolbar">
          <div className="sa-search">
            🔍 <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by company name or email..."
            />
          </div>
          <select className="sa-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option>active</option>
            <option>trial</option>
            <option>suspended</option>
            <option>cancelled</option>
          </select>
          <select className="sa-select" value={plan} onChange={e => { setPlan(e.target.value); setPage(1); }}>
            <option value="">All plans</option>
            <option>free</option>
            <option>starter</option>
            <option>growth</option>
            <option>enterprise</option>
          </select>
        </div>

        {loading
          ? <div className="sa-empty">Loading...</div>
          : (
          <table className="sa-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Company</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Users</th>
                <th>Invoices</th>
                <th>Revenue</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.id}>
                  <td className="td-mono">{t.id}</td>
                  <td>
                    <div style={{ fontWeight:600 }}>{t.company_name}</div>
                    <div style={{ fontSize:11, color:'#9ca3af' }}>{t.owner_email}</div>
                  </td>
                  <td>
                    <span className={`sa-status-badge ${STATUS_COLOR[t.status] || ''}`}>{t.status}</span>
                  </td>
                  <td>{t.plan || 'free'}</td>
                  <td>{t.user_count}</td>
                  <td>{t.invoice_count}</td>
                  <td className="td-amt">{fmt(t.total_revenue)}</td>
                  <td className="td-mono">{t.created_at?.slice(0,10)}</td>
                  <td>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      <button className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => navigate(`/admin/tenants/${t.id}`)}>
                        View
                      </button>
                      {t.status === 'active'
                        ? <button className="sa-btn sa-btn-danger sa-btn-sm" onClick={() => updateStatus(t.id,'suspended')}>Suspend</button>
                        : <button className="sa-btn sa-btn-success sa-btn-sm" onClick={() => updateStatus(t.id,'active')}>Activate</button>
                      }
                      <button className="sa-btn sa-btn-sm" style={{ background:'#fef3c7',color:'#d97706' }} onClick={() => impersonate(t.id)}>
                        Impersonate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!tenants.length && <tr><td colSpan={9} className="sa-empty">No tenants found</td></tr>}
            </tbody>
          </table>
        )}

        {pages > 1 && (
          <div className="sa-pagination">
            <span>Page {page} of {pages}</span>
            <button className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setPage(p=>p-1)} disabled={page===1}>← Prev</button>
            <button className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setPage(p=>p+1)} disabled={page===pages}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
