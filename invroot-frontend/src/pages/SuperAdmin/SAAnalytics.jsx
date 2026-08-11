import { useState, useEffect } from 'react';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

import { fmtAmt } from './saFormat.js';
function fmtN(n)   { return Number(n || 0).toLocaleString(); }

const AVATAR_COLORS = ['#3b82f6','#10b981','#7c3aed','#d63a17','#0891b2','#f59e0b','#ec4899'];
const avatarColor   = (name) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

const AGEING_COLORS = {
  '0-30 days':   { bar: 'linear-gradient(90deg,#fbbf24,#f59e0b)', badge: { background:'#fffbeb',color:'#d97706' } },
  '31-60 days':  { bar: 'linear-gradient(90deg,#f97316,#ea580c)', badge: { background:'#fff7ed',color:'#ea580c' } },
  '61-90 days':  { bar: 'linear-gradient(90deg,#ef4444,#dc2626)', badge: { background:'#fef2f2',color:'#dc2626' } },
  '90+ days':    { bar: 'linear-gradient(90deg,#991b1b,#7f1d1d)', badge: { background:'#fee2e2',color:'#991b1b' } },
};

/* Vertical bar chart (CSS) */
function VBarChart({ items, color, height = 200 }) {
  const max = Math.max(...items.map(d => Number(d.value)), 1);
  return (
    <div className="sa-vchart-wrap">
      <div className="sa-vchart" style={{ height }}>
        <div className="sa-vchart-grid">
          {[0,1,2,3].map(i => <div key={i} className="sa-vchart-gridline" />)}
        </div>
        {items.map((d, i) => (
          <div key={i} className="sa-vchart-col">
            <div className="sa-vchart-bar-area">
              <div
                className={`sa-vchart-bar ${color}`}
                style={{ height: `${Math.max(2, Number(d.value)/max*100)}%`, '--d': `${i*50}ms` }}
                data-val={d.display}
              />
            </div>
            <div className="sa-vchart-label">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SAAnalytics() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    saApi.get('/analytics').then(r => { if (r.success) setData(r.data); setLoading(false); });
  }, []);

  if (loading) return <div className="sa-loading">Loading analytics…</div>;
  if (!data)   return <div className="sa-empty">Failed to load analytics.</div>;

  const revenueItems = (data.revenue_by_day || []).slice(-20).map(row => ({
    label: (row.day || '').slice(5),
    value: Number(row.revenue),
    display: fmtAmt(row.revenue),
  }));

  const signupItems = (data.signups_trend || []).slice(-20).map(row => ({
    label: (row.day || '').slice(5),
    value: Number(row.signups),
    display: fmtN(row.signups),
  }));

  const maxAgeing = Math.max(...(data.invoice_ageing || []).map(r => Number(r.amount)), 1);

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">Analytics</h1>
          <p className="sa-page-sub">Platform-wide trends and business insights</p>
        </div>
      </div>

      {/* ── Charts row ── */}
      <div className="sa-two-col" style={{ marginBottom: 20 }}>
        <div className="sa-card">
          <div className="sa-card-header">
            <div>
              <div className="sa-card-title">Daily Revenue</div>
              <div className="sa-card-subtitle">Last 20 days of collected payments</div>
            </div>
          </div>
          {revenueItems.length > 0
            ? <VBarChart items={revenueItems} color="primary" />
            : <div className="sa-empty">No revenue data yet</div>
          }
        </div>

        <div className="sa-card">
          <div className="sa-card-header">
            <div>
              <div className="sa-card-title">New Signups</div>
              <div className="sa-card-subtitle">Daily tenant registrations</div>
            </div>
          </div>
          {signupItems.length > 0
            ? <VBarChart items={signupItems} color="blue" />
            : <div className="sa-empty">No signup data yet</div>
          }
        </div>
      </div>

      {/* ── Top clients + Invoice ageing ── */}
      <div className="sa-two-col">
        {/* Top clients */}
        <div className="sa-card">
          <div className="sa-card-header">
            <div className="sa-card-title">Top Clients by Revenue</div>
          </div>
          {(data.top_clients || []).length > 0 ? (
            <table className="sa-table">
              <thead>
                <tr><th>#</th><th>Client</th><th>Tenant</th><th>Revenue</th></tr>
              </thead>
              <tbody>
                {(data.top_clients || []).map((c, i) => (
                  <tr key={c.id || i}>
                    <td style={{ width: 32, color:'#94a3b8', fontWeight:700 }}>{i + 1}</td>
                    <td>
                      <div className="sa-company-cell">
                        <div className="sa-company-avatar" style={{ width:30, height:30, fontSize:11, background:`linear-gradient(135deg,${avatarColor(c.client_name)},${avatarColor(c.client_name)}cc)` }}>
                          {(c.client_name||'?')[0].toUpperCase()}
                        </div>
                        <span className="sa-company-name">{c.client_name}</span>
                      </div>
                    </td>
                    <td style={{ fontSize:12, color:'#6b7280' }}>{c.tenant_name}</td>
                    <td className="td-amt">{fmtAmt(c.total_value, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="sa-empty">No client data</div>
          )}
        </div>

        {/* Invoice ageing */}
        <div className="sa-card">
          <div className="sa-card-header">
            <div className="sa-card-title">Overdue Invoice Ageing</div>
            <div className="sa-card-subtitle">Past-due invoice buckets</div>
          </div>
          <div className="sa-card-body">
            {(data.invoice_ageing || []).length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {(data.invoice_ageing || []).map(row => {
                  const theme = AGEING_COLORS[row.bucket] || AGEING_COLORS['0-30 days'];
                  const pct   = Math.round(Number(row.amount) / maxAgeing * 100);
                  return (
                    <div key={row.bucket}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                        <span className="sa-badge no-dot" style={theme.badge}>{row.bucket}</span>
                        <span style={{ fontWeight:700, fontSize:13 }}>{fmtAmt(row.amount)}</span>
                      </div>
                      <div className="sa-hbar-track" style={{ height: 8 }}>
                        <div className="sa-hbar-fill" style={{ width:`${pct}%`, background:theme.bar }} />
                      </div>
                      <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>{fmtN(row.count)} invoice{row.count !== 1 ? 's':''}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="sa-empty" style={{ padding: 24 }}>No overdue invoices 🎉</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
