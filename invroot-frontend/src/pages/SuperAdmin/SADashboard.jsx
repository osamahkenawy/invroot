import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

const STATUS_COLOR = { active:'sa-status-active', trial:'sa-status-trial', suspended:'sa-status-suspended', cancelled:'sa-status-cancelled' };
const INV_STATUS   = { paid:'sa-status-paid', overdue:'sa-status-overdue', draft:'sa-status-draft', sent:'sa-status-sent', partial:'sa-status-partial' };

function fmt(n, cur = '$') { return cur + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtN(n) { return Number(n || 0).toLocaleString(); }

export default function SADashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    saApi.get('/overview').then(r => { if (r.success) setData(r.data); setLoading(false); });
  }, []);

  if (loading) return <div className="sa-loading">Loading platform data...</div>;
  if (!data)   return <div className="sa-empty">Failed to load data.</div>;

  const k = data.kpis;

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">Platform Overview</h1>
          <p className="sa-page-sub">All tenants · All time · Live data</p>
        </div>
      </div>

      {/* ── KPI Grid ── */}
      <div className="sa-kpi-grid">
        <div className="sa-kpi-card">
          <div className="sa-kpi-label">Total Tenants</div>
          <div className="sa-kpi-value">{fmtN(k.total_tenants)}</div>
          <span className="sa-kpi-badge green">+{fmtN(k.new_tenants_30d)} last 30d</span>
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-label">Active Tenants</div>
          <div className="sa-kpi-value">{fmtN(k.active_tenants)}</div>
          <div className="sa-kpi-sub">{k.total_tenants > 0 ? Math.round(k.active_tenants/k.total_tenants*100) : 0}% of total</div>
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-label">Platform Revenue</div>
          <div className="sa-kpi-value">{fmt(k.total_revenue)}</div>
          <div className="sa-kpi-sub">{fmtN(k.total_payments)} payments</div>
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-label">Total Invoices</div>
          <div className="sa-kpi-value">{fmtN(k.total_invoices)}</div>
          {k.overdue_invoices > 0 && <span className="sa-kpi-badge red">{fmtN(k.overdue_invoices)} overdue</span>}
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-label">Registered Users</div>
          <div className="sa-kpi-value">{fmtN(k.total_users)}</div>
        </div>
        <div className="sa-kpi-card">
          <div className="sa-kpi-label">Overdue Invoices</div>
          <div className="sa-kpi-value" style={{ color: k.overdue_invoices > 0 ? '#dc2626' : '#16a34a' }}>
            {fmtN(k.overdue_invoices)}
          </div>
        </div>
      </div>

      <div className="sa-two-col" style={{ marginBottom: 20 }}>
        {/* ── Invoice status breakdown ── */}
        <div className="sa-card">
          <div className="sa-card-header">
            <span className="sa-card-title">Invoice Status Breakdown</span>
            <Link to="/admin/invoices" className="sa-btn sa-btn-ghost sa-btn-sm">View all →</Link>
          </div>
          <table className="sa-table">
            <thead>
              <tr><th>Status</th><th>Count</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {(data.invoice_status || []).map(s => (
                <tr key={s.status}>
                  <td><span className={`sa-status-badge ${INV_STATUS[s.status] || ''}`}>{s.status}</span></td>
                  <td>{fmtN(s.count)}</td>
                  <td className="td-amt">{fmt(s.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Revenue trend ── */}
        <div className="sa-card">
          <div className="sa-card-header">
            <span className="sa-card-title">Revenue Trend (6 months)</span>
          </div>
          <div className="sa-card-body">
            {(data.revenue_trend || []).length === 0
              ? <div className="sa-empty" style={{ padding: 24 }}>No payment data yet</div>
              : (data.revenue_trend || []).map(row => {
                  const max = Math.max(...data.revenue_trend.map(r => Number(r.revenue)), 1);
                  const pct = Math.round(Number(row.revenue) / max * 100);
                  return (
                    <div key={row.month} className="sa-trend-row">
                      <span className="sa-trend-label">{row.month}</span>
                      <div className="sa-trend-bar-wrap">
                        <div className="sa-trend-bar" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="sa-trend-val">{fmt(row.revenue)}</span>
                    </div>
                  );
                })
            }
          </div>
        </div>
      </div>

      {/* ── Top tenants ── */}
      <div className="sa-card">
        <div className="sa-card-header">
          <span className="sa-card-title">Top Tenants by Revenue</span>
          <Link to="/admin/tenants" className="sa-btn sa-btn-ghost sa-btn-sm">All tenants →</Link>
        </div>
        <table className="sa-table">
          <thead>
            <tr><th>#</th><th>Company</th><th>Status</th><th>Plan</th><th>Invoices</th><th>Revenue</th><th></th></tr>
          </thead>
          <tbody>
            {(data.top_tenants || []).map((t, i) => (
              <tr key={t.id}>
                <td style={{ color:'#9ca3af', fontWeight:700 }}>{i+1}</td>
                <td style={{ fontWeight:600 }}>{t.company_name}</td>
                <td><span className={`sa-status-badge ${STATUS_COLOR[t.status] || ''}`}>{t.status}</span></td>
                <td>{t.plan || 'free'}</td>
                <td>{fmtN(t.invoice_count)}</td>
                <td className="td-amt">{fmt(t.total_revenue)}</td>
                <td>
                  <Link to={`/admin/tenants/${t.id}`} className="sa-btn sa-btn-ghost sa-btn-sm">View →</Link>
                </td>
              </tr>
            ))}
            {!(data.top_tenants?.length) && (
              <tr><td colSpan={7} className="sa-empty">No tenants yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <style>{`
        .sa-trend-row { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
        .sa-trend-label { width:70px; font-size:12px; color:#6b7280; }
        .sa-trend-bar-wrap { flex:1; height:8px; background:#f1f5f9; border-radius:4px; overflow:hidden; }
        .sa-trend-bar { height:100%; background:linear-gradient(90deg,#0D1B2A,#d63a17); border-radius:4px; transition:width .5s; }
        .sa-trend-val { width:70px; text-align:right; font-size:12px; font-weight:700; color:#0D1B2A; }
      `}</style>
    </div>
  );
}
