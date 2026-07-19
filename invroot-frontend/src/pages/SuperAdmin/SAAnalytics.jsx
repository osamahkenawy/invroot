import { useState, useEffect } from 'react';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

export default function SAAnalytics() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    saApi.get('/analytics').then(r => { if (r.success) setData(r.data); setLoading(false); });
  }, []);

  if (loading) return <div className="sa-loading">Loading analytics...</div>;
  if (!data)   return <div className="sa-empty">Failed to load analytics.</div>;

  const maxRev = Math.max(...(data.revenue_by_day || []).map(r => Number(r.revenue)), 1);
  const maxSig = Math.max(...(data.signups_trend  || []).map(r => Number(r.signups)), 1);

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">Analytics</h1>
          <p className="sa-page-sub">Platform-wide trends and insights</p>
        </div>
      </div>

      <div className="sa-two-col" style={{ marginBottom:20 }}>
        {/* ── Revenue by day ── */}
        <div className="sa-card">
          <div className="sa-card-header"><span className="sa-card-title">Revenue by Day (last 30)</span></div>
          <div className="sa-card-body" style={{ maxHeight:280, overflowY:'auto' }}>
            {!(data.revenue_by_day?.length)
              ? <div className="sa-empty" style={{ padding:16 }}>No data</div>
              : (data.revenue_by_day || []).map(row => (
                <div key={row.day} className="sa-trend-row">
                  <span className="sa-trend-label">{row.day?.slice(5)}</span>
                  <div className="sa-trend-bar-wrap">
                    <div className="sa-trend-bar" style={{ width: `${Math.round(Number(row.revenue)/maxRev*100)}%` }} />
                  </div>
                  <span className="sa-trend-val">{fmt(row.revenue)}</span>
                </div>
              ))
            }
          </div>
        </div>

        {/* ── Signups trend ── */}
        <div className="sa-card">
          <div className="sa-card-header"><span className="sa-card-title">New Signups (daily)</span></div>
          <div className="sa-card-body" style={{ maxHeight:280, overflowY:'auto' }}>
            {!(data.signups_trend?.length)
              ? <div className="sa-empty" style={{ padding:16 }}>No data</div>
              : (data.signups_trend || []).map(row => (
                <div key={row.day} className="sa-trend-row">
                  <span className="sa-trend-label">{row.day?.slice(5)}</span>
                  <div className="sa-trend-bar-wrap">
                    <div className="sa-trend-bar" style={{ width: `${Math.round(Number(row.signups)/maxSig*100)}%`, background:'linear-gradient(90deg,#2563eb,#60a5fa)' }} />
                  </div>
                  <span className="sa-trend-val" style={{ color:'#2563eb' }}>{row.signups}</span>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      <div className="sa-two-col">
        {/* ── Top clients ── */}
        <div className="sa-card">
          <div className="sa-card-header"><span className="sa-card-title">Top Clients by Revenue</span></div>
          <table className="sa-table">
            <thead><tr><th>#</th><th>Client</th><th>Tenant</th><th>Revenue</th></tr></thead>
            <tbody>
              {(data.top_clients || []).map((c,i) => (
                <tr key={c.id}>
                  <td style={{ color:'#9ca3af', fontWeight:700 }}>{i+1}</td>
                  <td style={{ fontWeight:600 }}>{c.client_name}</td>
                  <td style={{ fontSize:12, color:'#6b7280' }}>{c.company_name}</td>
                  <td className="td-amt">{fmt(c.total_revenue)}</td>
                </tr>
              ))}
              {!data.top_clients?.length && <tr><td colSpan={4} className="sa-empty">No client data</td></tr>}
            </tbody>
          </table>
        </div>

        {/* ── Invoice ageing ── */}
        <div className="sa-card">
          <div className="sa-card-header"><span className="sa-card-title">Invoice Ageing (overdue)</span></div>
          <table className="sa-table">
            <thead><tr><th>Bucket</th><th>Count</th><th>Amount</th></tr></thead>
            <tbody>
              {(data.invoice_ageing || []).map(row => (
                <tr key={row.bucket}>
                  <td>
                    <span className="sa-status-badge sa-status-overdue">{row.bucket}</span>
                  </td>
                  <td>{row.count}</td>
                  <td className="td-amt">{fmt(row.amount)}</td>
                </tr>
              ))}
              {!data.invoice_ageing?.length && <tr><td colSpan={3} className="sa-empty">No overdue invoices</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .sa-trend-row { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
        .sa-trend-label { width:55px; font-size:11px; color:#6b7280; flex-shrink:0; }
        .sa-trend-bar-wrap { flex:1; height:8px; background:#f1f5f9; border-radius:4px; overflow:hidden; }
        .sa-trend-bar { height:100%; background:linear-gradient(90deg,#0D1B2A,#d63a17); border-radius:4px; }
        .sa-trend-val { width:80px; text-align:right; font-size:11px; font-weight:700; color:#0D1B2A; }
      `}</style>
    </div>
  );
}
