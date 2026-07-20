import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

function fmtAmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }
function fmtN(n)   { return Number(n || 0).toLocaleString(); }

const INV_STATUS = ['paid','sent','overdue','draft','partial'];
const AVATAR_COLORS = ['#3b82f6','#10b981','#7c3aed','#d63a17','#0891b2','#f59e0b','#ec4899'];
const avatarColor   = (name = '') => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

const KIco = {
  invoiced: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  collected:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
  users:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  rate:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
};

export default function SATenantDetail() {
  const { id }      = useParams();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan,    setPlan]    = useState('');
  const [tab,     setTab]     = useState('overview');

  const reload = async () => {
    const r = await saApi.get(`/tenants/${id}`);
    if (r.success) { setData(r.data); setPlan(r.data.tenant?.plan || 'free'); }
  };

  useEffect(() => { setLoading(true); reload().finally(() => setLoading(false)); }, [id]);

  const updateStatus = async (newStatus) => { await saApi.put(`/tenants/${id}/status`, { status: newStatus }); reload(); };
  const updatePlan   = async () => { await saApi.put(`/tenants/${id}/plan`, { plan }); reload(); };

  const impersonate = async () => {
    const r = await saApi.post(`/tenants/${id}/impersonate`);
    if (r.success && r.data?.token) { localStorage.setItem('auth_token', r.data.token); window.open('/','_blank'); }
    else alert('Impersonation failed');
  };

  if (loading) return <div className="sa-loading">Loading tenant…</div>;
  if (!data)   return <div className="sa-empty">Tenant not found.</div>;

  const t       = data.tenant;
  const bg      = avatarColor(t.company_name);
  const initial = (t.company_name || '?')[0].toUpperCase();
  const collectionRate = data.total_invoiced > 0
    ? Math.round(data.total_collected / data.total_invoiced * 100)
    : 0;

  return (
    <div>
      {/* ── Breadcrumb ── */}
      <div style={{ marginBottom: 16 }}>
        <Link to="/admin/tenants" style={{ color:'#64748b', textDecoration:'none', fontSize:13, display:'inline-flex', alignItems:'center', gap:4 }}>
          ← All Tenants
        </Link>
      </div>

      {/* ── Hero ── */}
      <div className="sa-tenant-hero">
        <div className="sa-tenant-hero-avatar" style={{ background:`linear-gradient(135deg,${bg},${bg}88)` }}>
          {initial}
        </div>
        <div className="sa-tenant-hero-info">
          <div className="sa-tenant-hero-name">{t.company_name}</div>
          <div className="sa-tenant-hero-email">
            {t.owner_email}
            &nbsp;&nbsp;
            <span className={`sa-badge ${t.status || 'active'}`} style={{ fontSize: 11 }}>{t.status}</span>
            &nbsp;
            <span className="sa-badge no-dot" style={{ background:'rgba(255,255,255,.1)', color:'rgba(255,255,255,.7)', fontSize:11 }}>
              {t.plan || 'free'} plan
            </span>
          </div>
        </div>
        <div className="sa-tenant-hero-actions">
          <button className="sa-btn sa-btn-amber sa-btn-sm" onClick={impersonate}>Login as Tenant</button>
          {t.status === 'active'
            ? <button className="sa-btn sa-btn-danger sa-btn-sm" onClick={() => updateStatus('suspended')}>Suspend</button>
            : <button className="sa-btn sa-btn-success sa-btn-sm" onClick={() => updateStatus('active')}>Activate</button>
          }
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="sa-kpi-grid sa-kpi-grid-3" style={{ marginBottom: 20, gridTemplateColumns:'repeat(4,1fr)' }}>
        <div className="sa-kpi-card">
          <div className="sa-kpi-top">
            <div className="sa-kpi-icon-box purple">{KIco.invoiced}</div>
          </div>
          <div className="sa-kpi-value">{fmtAmt(data.total_invoiced)}</div>
          <div className="sa-kpi-label">Total Invoiced</div>
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-top">
            <div className="sa-kpi-icon-box green">{KIco.collected}</div>
          </div>
          <div className="sa-kpi-value">{fmtAmt(data.total_collected)}</div>
          <div className="sa-kpi-label">Total Collected</div>
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-top">
            <div className="sa-kpi-icon-box blue">{KIco.users}</div>
          </div>
          <div className="sa-kpi-value">{fmtN(data.users?.length || 0)}</div>
          <div className="sa-kpi-label">Team Members</div>
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-top">
            <div className="sa-kpi-icon-box teal">{KIco.rate}</div>
          </div>
          <div className="sa-kpi-value">{collectionRate}%</div>
          <div className="sa-kpi-label">Collection Rate</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="sa-card">
        <div className="sa-tabs">
          {['overview','invoices','payments','users'].map(t => (
            <button key={t} className={`sa-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === 'overview' && (
          <div className="sa-tab-pane">
            <div className="sa-two-col">
              {/* Plan management */}
              <div>
                <div className="sa-section-label">Plan Management</div>
                <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:16 }}>
                  <select className="sa-select" style={{ flex:1 }} value={plan} onChange={e => setPlan(e.target.value)}>
                    <option value="free">Free</option>
                    <option value="starter">Starter</option>
                    <option value="growth">Growth</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                  <button className="sa-btn sa-btn-primary" onClick={updatePlan}>Update Plan</button>
                </div>
                <div style={{ fontSize:12, color:'#6b7280', lineHeight:1.8 }}>
                  <div>Current plan: <strong>{t.plan || 'free'}</strong></div>
                  <div>Tenant ID: <code style={{ background:'#f1f5f9', padding:'1px 6px', borderRadius:4 }}>#{t.id}</code></div>
                  <div>Joined: <strong>{t.created_at?.slice(0,10)}</strong></div>
                </div>
              </div>

              {/* Invoice summary */}
              <div>
                <div className="sa-section-label">Invoice Breakdown</div>
                {(data.invoice_summary || INV_STATUS).map((s, i) => {
                  const status = typeof s === 'string' ? s : s.status;
                  const count  = typeof s === 'string' ? 0  : Number(s.count);
                  const amount = typeof s === 'string' ? 0  : Number(s.total_amount);
                  return (
                    <div key={status} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                      <span className={`sa-badge ${status}`}>{status}</span>
                      <div style={{ textAlign:'right' }}>
                        <span style={{ fontWeight:700, fontSize:13 }}>{fmtAmt(amount)}</span>
                        <span style={{ color:'#94a3b8', fontSize:11, marginLeft:8 }}>{count} inv.</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Invoices tab */}
        {tab === 'invoices' && (
          <table className="sa-table">
            <thead>
              <tr><th>Invoice #</th><th>Client</th><th>Amount</th><th>Status</th><th>Issue Date</th><th>Due Date</th></tr>
            </thead>
            <tbody>
              {(data.recent_invoices || []).map(inv => (
                <tr key={inv.id}>
                  <td className="td-mono">{inv.invoice_number}</td>
                  <td>{inv.client_name}</td>
                  <td className="td-amt">{fmtAmt(inv.total_amount)}</td>
                  <td><span className={`sa-badge ${inv.status}`}>{inv.status}</span></td>
                  <td className="td-mono">{inv.issue_date?.slice(0,10)}</td>
                  <td className="td-mono">{inv.due_date?.slice(0,10)}</td>
                </tr>
              ))}
              {!data.recent_invoices?.length && (
                <tr><td colSpan={6}><div className="sa-empty">No invoices yet</div></td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* Payments tab */}
        {tab === 'payments' && (
          <table className="sa-table">
            <thead>
              <tr><th>Date</th><th>Invoice #</th><th>Amount</th><th>Method</th><th>Reference</th></tr>
            </thead>
            <tbody>
              {(data.recent_payments || []).map(p => (
                <tr key={p.id}>
                  <td className="td-mono">{p.payment_date?.slice(0,10)}</td>
                  <td className="td-mono">{p.invoice_number || '—'}</td>
                  <td className="td-amt">{fmtAmt(p.amount)}</td>
                  <td>
                    <span className="sa-badge no-dot" style={{ background:'#f5f3ff', color:'#6d28d9' }}>
                      {p.payment_method?.replace('_',' ')}
                    </span>
                  </td>
                  <td className="td-mono">{p.reference_number || '—'}</td>
                </tr>
              ))}
              {!data.recent_payments?.length && (
                <tr><td colSpan={5}><div className="sa-empty">No payments yet</div></td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* Users tab */}
        {tab === 'users' && (
          <table className="sa-table">
            <thead>
              <tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th></tr>
            </thead>
            <tbody>
              {(data.users || []).map(u => {
                const ubg = avatarColor(u.full_name);
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="sa-company-cell">
                        <div className="sa-company-avatar" style={{ width:30, height:30, fontSize:11, background:`linear-gradient(135deg,${ubg},${ubg}bb)` }}>
                          {(u.full_name||'?')[0].toUpperCase()}
                        </div>
                        <span className="sa-company-name">{u.full_name}</span>
                      </div>
                    </td>
                    <td style={{ fontSize:12 }}>{u.email}</td>
                    <td>
                      <span className="sa-badge no-dot" style={{ background:'#f1f5f9', color:'#374151' }}>{u.role}</span>
                    </td>
                    <td className="td-mono">{u.created_at?.slice(0,10)}</td>
                  </tr>
                );
              })}
              {!data.users?.length && (
                <tr><td colSpan={4}><div className="sa-empty">No users found</div></td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
