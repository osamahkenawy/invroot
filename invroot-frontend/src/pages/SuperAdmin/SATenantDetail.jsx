import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

const STATUS_COLOR = { active:'sa-status-active', trial:'sa-status-trial', suspended:'sa-status-suspended', cancelled:'sa-status-cancelled' };
const INV_STATUS   = { paid:'sa-status-paid', overdue:'sa-status-overdue', draft:'sa-status-draft', sent:'sa-status-sent', partial:'sa-status-partial' };
function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function SATenantDetail() {
  const { id }      = useParams();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan,    setPlan]    = useState('');

  useEffect(() => {
    saApi.get(`/tenants/${id}`).then(r => {
      if (r.success) { setData(r.data); setPlan(r.data.tenant?.plan || 'free'); }
      setLoading(false);
    });
  }, [id]);

  const updateStatus = async (newStatus) => {
    await saApi.put(`/tenants/${id}/status`, { status: newStatus });
    const r = await saApi.get(`/tenants/${id}`);
    if (r.success) setData(r.data);
  };

  const updatePlan = async () => {
    await saApi.put(`/tenants/${id}/plan`, { plan });
    const r = await saApi.get(`/tenants/${id}`);
    if (r.success) setData(r.data);
  };

  if (loading) return <div className="sa-loading">Loading tenant...</div>;
  if (!data)   return <div className="sa-empty">Tenant not found.</div>;

  const t = data.tenant;

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <Link to="/admin/tenants" style={{ color:'#6b7280', textDecoration:'none', fontSize:13 }}>← All Tenants</Link>
          <h1 className="sa-page-title" style={{ marginTop:6 }}>{t.company_name}</h1>
          <p className="sa-page-sub">{t.owner_email}</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {t.status === 'active'
            ? <button className="sa-btn sa-btn-danger" onClick={() => updateStatus('suspended')}>Suspend Tenant</button>
            : <button className="sa-btn sa-btn-success" onClick={() => updateStatus('active')}>Activate Tenant</button>
          }
        </div>
      </div>

      {/* ── Tenant KPIs ── */}
      <div className="sa-kpi-grid" style={{ gridTemplateColumns:'repeat(3,1fr)', marginBottom:20 }}>
        <div className="sa-kpi-card">
          <div className="sa-kpi-label">Total Invoiced</div>
          <div className="sa-kpi-value">{fmt(data.total_invoiced)}</div>
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-label">Total Collected</div>
          <div className="sa-kpi-value">{fmt(data.total_collected)}</div>
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-label">Status</div>
          <div className="sa-kpi-value">
            <span className={`sa-status-badge ${STATUS_COLOR[t.status] || ''}`} style={{ fontSize:16 }}>{t.status}</span>
          </div>
        </div>
      </div>

      <div className="sa-two-col" style={{ marginBottom:20 }}>
        {/* ── Plan management ── */}
        <div className="sa-card">
          <div className="sa-card-header"><span className="sa-card-title">Plan Management</span></div>
          <div className="sa-card-body">
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <select className="sa-select" style={{ flex:1 }} value={plan} onChange={e => setPlan(e.target.value)}>
                <option>free</option><option>starter</option><option>growth</option><option>enterprise</option>
              </select>
              <button className="sa-btn sa-btn-primary" onClick={updatePlan}>Update Plan</button>
            </div>
            <p style={{ marginTop:12, fontSize:12, color:'#9ca3af' }}>
              Current plan: <strong>{t.plan || 'free'}</strong> · Created: {t.created_at?.slice(0,10)}
            </p>
          </div>
        </div>

        {/* ── Users ── */}
        <div className="sa-card">
          <div className="sa-card-header">
            <span className="sa-card-title">Users ({data.users?.length || 0})</span>
          </div>
          <div style={{ maxHeight:200, overflowY:'auto' }}>
            <table className="sa-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
              <tbody>
                {(data.users || []).map(u => (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td style={{ fontSize:12 }}>{u.email}</td>
                    <td>{u.role}</td>
                  </tr>
                ))}
                {!data.users?.length && <tr><td colSpan={3} className="sa-empty">No users</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Recent invoices ── */}
      <div className="sa-card" style={{ marginBottom:20 }}>
        <div className="sa-card-header">
          <span className="sa-card-title">Recent Invoices</span>
        </div>
        <table className="sa-table">
          <thead><tr><th>Invoice #</th><th>Client</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            {(data.recent_invoices || []).map(inv => (
              <tr key={inv.id}>
                <td className="td-mono">{inv.invoice_number}</td>
                <td>{inv.client_name}</td>
                <td className="td-amt">{fmt(inv.total_amount)}</td>
                <td><span className={`sa-status-badge ${INV_STATUS[inv.status] || ''}`}>{inv.status}</span></td>
                <td className="td-mono">{inv.issue_date?.slice(0,10)}</td>
              </tr>
            ))}
            {!data.recent_invoices?.length && <tr><td colSpan={5} className="sa-empty">No invoices</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ── Recent payments ── */}
      <div className="sa-card">
        <div className="sa-card-header">
          <span className="sa-card-title">Recent Payments</span>
        </div>
        <table className="sa-table">
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
          <tbody>
            {(data.recent_payments || []).map(p => (
              <tr key={p.id}>
                <td className="td-mono">{p.payment_date?.slice(0,10)}</td>
                <td className="td-amt">{fmt(p.amount)}</td>
                <td>{p.payment_method}</td>
                <td className="td-mono">{p.reference_number || '—'}</td>
              </tr>
            ))}
            {!data.recent_payments?.length && <tr><td colSpan={4} className="sa-empty">No payments</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
