import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

/* ── Helpers ── */
/* Tenants bill in different currencies, so amounts are labelled with the
   currency they belong to rather than a hardcoded '$'. */
function fmtAmt(n, currency = '') {
  const v = Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return currency ? `${currency} ${v}` : v;
}
function fmtN(n)   { return Number(n || 0).toLocaleString(); }

/* '2026-07' → 'Jul' (a plain slice(0,3) rendered every bar as "202"). */
function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = String(ym).split('-');
  if (!m) return String(ym).slice(0, 3);
  const d = new Date(Number(y), Number(m) - 1, 1);
  return isNaN(d) ? ym : d.toLocaleDateString('en-US', { month: 'short' });
}

/* ── KPI icons (inline SVG) ── */
const KIco = {
  tenants: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 22h18"/><path d="M5 22V7l7-4 7 4v15"/><path d="M9 22v-5h6v5"/></svg>,
  revenue: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
  active:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  invoices:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  users:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  overdue: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
};

/* ── Vertical Bar Chart ── */
function BarChart({ items, color = 'primary' }) {
  const max = Math.max(...items.map(d => Number(d.value)), 1);
  return (
    <div className="sa-vchart-wrap">
      <div className="sa-vchart">
        <div className="sa-vchart-grid">
          {[0, 1, 2, 3].map(i => <div key={i} className="sa-vchart-gridline" />)}
        </div>
        {items.map((d, i) => (
          <div key={i} className="sa-vchart-col">
            <div className="sa-vchart-bar-area">
              <div
                className={`sa-vchart-bar ${color}`}
                style={{ height: `${Math.max(2, (Number(d.value) / max) * 100)}%`, '--d': `${i * 60}ms` }}
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

/* ── Donut Chart ── */
const DONUT_COLORS = {
  paid: '#10b981', draft: '#94a3b8', sent: '#3b82f6',
  overdue: '#ef4444', partial: '#f59e0b', cancelled: '#64748b',
};

function DonutChart({ segments }) {
  const total = segments.reduce((s, d) => s + Number(d.count), 0);
  if (!total) return <div className="sa-empty" style={{ padding: 20 }}>No data</div>;

  const r  = 52;
  const C  = 2 * Math.PI * r;
  let cumLen = 0;

  return (
    <div className="sa-donut-wrap">
      <svg viewBox="0 0 160 160" style={{ width: 140, height: 140, flexShrink: 0 }}>
        {/* Track */}
        <circle cx="80" cy="80" r={r} fill="none" stroke="#f0f2f7" strokeWidth="20" />
        {/* Segments */}
        <g transform="rotate(-90 80 80)">
          {segments.map((seg, i) => {
            const segLen = (Number(seg.count) / total) * C;
            const dashOffset = C - cumLen;
            cumLen += segLen;
            return (
              <circle
                key={i}
                cx="80" cy="80" r={r}
                fill="none"
                stroke={DONUT_COLORS[seg.status] || '#e5e7eb'}
                strokeWidth="20"
                strokeDasharray={`${segLen} ${C}`}
                strokeDashoffset={dashOffset}
              />
            );
          })}
        </g>
        {/* Centre label */}
        <text x="80" y="74" textAnchor="middle" fontSize="22" fontWeight="800" fill="#0D1B2A" fontFamily="sans-serif">
          {fmtN(total)}
        </text>
        <text x="80" y="91" textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="sans-serif">
          invoices
        </text>
      </svg>
      <div className="sa-donut-legend">
        {segments.map((seg, i) => (
          <div key={i} className="sa-donut-item">
            <div className="sa-donut-dot" style={{ background: DONUT_COLORS[seg.status] || '#e5e7eb' }} />
            <span className="sa-donut-lname">{seg.status}</span>
            <span className="sa-donut-lcount">{fmtN(seg.count)}</span>
            <span className="sa-donut-lpct">{total ? Math.round(seg.count/total*100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Rank badge helper ── */
const rankClass = i => ['rank-1','rank-2','rank-3'][i] || 'rank-n';

/* ── Avatar colour palette ── */
const AVATAR_COLORS = ['#3b82f6','#10b981','#7c3aed','#d63a17','#0891b2','#f59e0b','#ec4899'];
const avatarColor   = (name) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

export default function SADashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    saApi.get('/overview').then(r => { if (r.success) setData(r.data); setLoading(false); });
  }, []);

  if (loading) return <div className="sa-loading">Loading platform data…</div>;
  if (!data)   return <div className="sa-empty">Failed to load data.</div>;

  const k   = data.kpis || {};
  const byCurrency = data.revenue_by_currency || [];
  // Report in the currency most revenue is billed in; if tenants span several,
  // the breakdown below makes the split explicit instead of faking one total.
  const primaryCur  = byCurrency[0]?.currency || '';
  const multiCur    = byCurrency.length > 1;

  const trend = (data.revenue_trend || []).map(row => ({
    label:   monthLabel(row.month),
    value:   Number(row.revenue),
    display: fmtAmt(row.revenue, primaryCur),
  }));

  const activePct = k.total_tenants > 0 ? Math.round(k.active_tenants / k.total_tenants * 100) : 0;

  return (
    <div>
      {/* ── Welcome banner ── */}
      <div className="sa-welcome">
        <div className="sa-welcome-text">
          <div className="sa-welcome-title">Platform Overview</div>
          <div className="sa-welcome-sub">All tenants · Real-time data · {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
        </div>
        <div className="sa-welcome-stats">
          <div className="sa-welcome-stat">
            <div className="sa-welcome-stat-val">{fmtAmt(k.total_revenue, primaryCur)}</div>
            <div className="sa-welcome-stat-label">{multiCur ? 'Revenue (all currencies)' : 'Total Revenue'}</div>
          </div>
          <div className="sa-welcome-stat">
            <div className="sa-welcome-stat-val">{fmtN(k.total_tenants)}</div>
            <div className="sa-welcome-stat-label">Companies</div>
          </div>
          <div className="sa-welcome-stat">
            <div className="sa-welcome-stat-val">{activePct}%</div>
            <div className="sa-welcome-stat-label">Active rate</div>
          </div>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="sa-kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="sa-kpi-card">
          <div className="sa-kpi-top">
            <div className="sa-kpi-icon-box blue">{KIco.tenants}</div>
            <span className="sa-kpi-delta up">+{fmtN(k.new_tenants_30d)} new</span>
          </div>
          <div className="sa-kpi-value">{fmtN(k.total_tenants)}</div>
          <div className="sa-kpi-label">Total Tenants</div>
          <div className="sa-kpi-sub">{fmtN(k.active_tenants)} active</div>
        </div>

        <div className="sa-kpi-card">
          <div className="sa-kpi-top">
            <div className="sa-kpi-icon-box green">{KIco.revenue}</div>
            <span className="sa-kpi-delta neu">{fmtN(k.total_payments)} txns</span>
          </div>
          <div className="sa-kpi-value">{fmtAmt(k.total_revenue, primaryCur)}</div>
          <div className="sa-kpi-label">Platform Revenue</div>
        </div>

        <div className="sa-kpi-card">
          <div className="sa-kpi-top">
            <div className="sa-kpi-icon-box teal">{KIco.active}</div>
            <span className="sa-kpi-delta up">{activePct}%</span>
          </div>
          <div className="sa-kpi-value">{fmtN(k.active_tenants)}</div>
          <div className="sa-kpi-label">Active Tenants</div>
        </div>

        <div className="sa-kpi-card">
          <div className="sa-kpi-top">
            <div className="sa-kpi-icon-box purple">{KIco.invoices}</div>
            {k.overdue_invoices > 0 && <span className="sa-kpi-delta down">{fmtN(k.overdue_invoices)} overdue</span>}
          </div>
          <div className="sa-kpi-value">{fmtN(k.total_invoices)}</div>
          <div className="sa-kpi-label">Total Invoices</div>
        </div>

        <div className="sa-kpi-card">
          <div className="sa-kpi-top">
            <div className="sa-kpi-icon-box amber">{KIco.users}</div>
          </div>
          <div className="sa-kpi-value">{fmtN(k.total_users)}</div>
          <div className="sa-kpi-label">Registered Users</div>
        </div>
      </div>

      {/* ── Revenue by currency ──
          Shown whenever tenants bill in more than one currency, so the headline
          total is never mistaken for a single-currency figure. */}
      {multiCur && (
        <div className="sa-card" style={{ marginBottom: 20 }}>
          <div className="sa-card-header">
            <div>
              <div className="sa-card-title">Revenue by Currency</div>
              <div className="sa-card-subtitle">Tenants bill in different currencies — totals are not converted</div>
            </div>
          </div>
          <div className="sa-cur-grid">
            {byCurrency.map(c => (
              <div key={c.currency} className="sa-cur-item">
                <div className="sa-cur-code">{c.currency}</div>
                <div className="sa-cur-total">{fmtAmt(c.total, c.currency)}</div>
                <div className="sa-cur-sub">{fmtN(c.payments)} payments</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Chart row ── */}
      <div className="sa-two-col" style={{ marginBottom: 20 }}>
        {/* Revenue trend bar chart */}
        <div className="sa-card">
          <div className="sa-card-header">
            <div>
              <div className="sa-card-title">Revenue Trend</div>
              <div className="sa-card-subtitle">Monthly collected payments</div>
            </div>
            <Link to="/admin/payments" className="sa-btn sa-btn-ghost sa-btn-sm">View all →</Link>
          </div>
          {trend.length > 0
            ? <BarChart items={trend} color="primary" />
            : <div className="sa-empty">No payment data yet</div>
          }
        </div>

        {/* Invoice status donut */}
        <div className="sa-card">
          <div className="sa-card-header">
            <div>
              <div className="sa-card-title">Invoice Status</div>
              <div className="sa-card-subtitle">Distribution across all tenants</div>
            </div>
            <Link to="/admin/invoices" className="sa-btn sa-btn-ghost sa-btn-sm">View all →</Link>
          </div>
          <div className="sa-card-body">
            <DonutChart segments={data.invoice_status || []} />
          </div>
        </div>
      </div>

      {/* ── Top Tenants ── */}
      <div className="sa-card">
        <div className="sa-card-header">
          <div>
            <div className="sa-card-title">Top Tenants by Revenue</div>
            <div className="sa-card-subtitle">Highest performing companies on the platform</div>
          </div>
          <Link to="/admin/tenants" className="sa-btn sa-btn-ghost sa-btn-sm">All tenants →</Link>
        </div>
        <div className="sa-ranked-list">
          {(data.top_tenants || []).map((t, i) => {
            const bg = avatarColor(t.company_name);
            const initial = (t.company_name || '?')[0].toUpperCase();
            return (
              <div key={t.id} className="sa-ranked-item">
                <div className={`sa-rank-badge ${rankClass(i)}`}>{i + 1}</div>
                <div
                  className="sa-company-avatar"
                  style={{ background: `linear-gradient(135deg, ${bg}, ${bg}cc)`, marginRight: 0 }}
                >
                  {initial}
                </div>
                <div className="sa-ranked-info">
                  <div className="sa-ranked-name">{t.company_name}</div>
                  <div className="sa-ranked-meta">
                    <span className={`sa-badge ${t.status || 'active'}`} style={{ fontSize: 10 }}>
                      {t.status}
                    </span>
                    {' '}&middot; {t.plan || 'free'} plan
                  </div>
                </div>
                <div className="sa-ranked-right">
                  <div className="sa-ranked-amt">{fmtAmt(t.total_revenue, t.currency)}</div>
                  <div className="sa-ranked-sub">{fmtN(t.invoice_count)} invoices</div>
                </div>
                <Link to={`/admin/tenants/${t.id}`} className="sa-btn sa-btn-ghost sa-btn-sm" style={{ marginLeft: 8 }}>
                  View →
                </Link>
              </div>
            );
          })}
          {!(data.top_tenants?.length) && <div className="sa-empty">No tenant data yet</div>}
        </div>
      </div>
    </div>
  );
}
