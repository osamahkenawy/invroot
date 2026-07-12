import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { fmtCurrency } from '../utils/currency.js';
import { Download, StatsReport, Archive, DataTransferBoth } from 'iconoir-react';
import './Reports.css';

const PERIODS = [
  { label: '7d',  value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
  { label: '1y',  value: '365' },
];

export default function Reports() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('dashboard');
  const [period, setPeriod] = useState('30');

  const TABS = [
    { key: 'dashboard', label: t('reports.dashboard'), icon: StatsReport },
    { key: 'aging',     label: t('reports.aging'),     icon: Archive },
    { key: 'sales',     label: t('reports.sales'),     icon: DataTransferBoth },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('reports.title')}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {tab === 'dashboard' && (
            <div className="filter-tabs">
              {PERIODS.map(p => (
                <button key={p.value} className={`filter-tab ${period === p.value ? 'active' : ''}`} onClick={() => setPeriod(p.value)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="reports-tab-bar">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} className={`reports-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            <Icon className="reports-tab-icon" />
            {label}
          </button>
        ))}
      </div>

      <div className="tab-content" style={{ paddingTop: 20 }}>
        {tab === 'dashboard' && <DashboardReport period={period} />}
        {tab === 'aging'     && <AgingReport />}
        {tab === 'sales'     && <SalesReport />}
      </div>
    </div>
  );
}

/* ── KPI Card ───────────────────────────────────────── */
function KpiCard({ label, value, sub, accent, icon: Icon }) {
  return (
    <div className={`report-kpi-card ${accent ? 'accent-' + accent : ''}`}>
      <div className="report-kpi-top">
        <span className="report-kpi-label">{label}</span>
        {Icon && <div className="report-kpi-icon"><Icon /></div>}
      </div>
      <div className="report-kpi-value">{value}</div>
      {sub && <div className="report-kpi-sub">{sub}</div>}
    </div>
  );
}

/* ── Dashboard Report ───────────────────────────────── */
function DashboardReport({ period }) {
  const { t } = useTranslation();
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/reports/dashboard?period=${period}`).then(res => {
      if (res.success) setData(res.data);
      setLoading(false);
    });
  }, [period]);

  if (loading) return <Loader fullPage />;
  const k = data?.kpis || {};
  const cf = data?.cashflow || [];

  const collectionRate = k.total_revenue > 0
    ? Math.round((k.total_collected / k.total_revenue) * 100)
    : 0;

  return (
    <div className="report-section">
      <div className="report-kpi-grid">
        <KpiCard label="Total Invoiced" value={fmtCurrency(k.total_revenue)} sub={`${k.invoice_count || 0} invoices`} accent="blue" />
        <KpiCard label="Collected" value={fmtCurrency(k.total_collected)} sub={`${collectionRate}% collection rate`} accent="green" />
        <KpiCard label="Outstanding" value={fmtCurrency(k.outstanding)} sub="Awaiting payment" accent="amber" />
        <KpiCard label="Overdue" value={fmtCurrency(k.overdue_amount)} sub={`${k.overdue_count || 0} overdue invoice${k.overdue_count !== 1 ? 's' : ''}`} accent="red" />
      </div>

      {/* Collection rate bar */}
      <div className="report-card">
        <div className="report-card-title">Collection Rate</div>
        <div className="collection-bar-wrap">
          <div className="collection-bar-track">
            <div className="collection-bar-fill" style={{ width: `${collectionRate}%` }} />
          </div>
          <span className="collection-bar-pct">{collectionRate}%</span>
        </div>
        <div className="collection-bar-labels">
          <span>Collected: {fmtCurrency(k.total_collected)}</span>
          <span>Outstanding: {fmtCurrency(k.outstanding)}</span>
        </div>
      </div>

      {/* Cashflow table */}
      {cf.length > 0 && (
        <div className="report-card">
          <div className="report-card-title">Cashflow — Last {period} Days</div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoiced</th>
                  <th>Collected</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody>
                {cf.map(row => {
                  const gap = (row.invoiced || 0) - (row.collected || 0);
                  return (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td className="td-amount">{fmtCurrency(row.invoiced)}</td>
                      <td className="td-amount" style={{ color: '#16a34a' }}>{fmtCurrency(row.collected)}</td>
                      <td className="td-amount" style={{ color: gap > 0 ? '#dc2626' : '#16a34a' }}>{fmtCurrency(gap)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Aging Report ───────────────────────────────────── */
function AgingReport() {
  const { t } = useTranslation();
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/reports/aging').then(res => { if (res.success) setRows(res.data); setLoading(false); });
  }, []);

  if (loading) return <Loader fullPage />;

  const maxTotal = Math.max(...rows.map(r => parseFloat(r.total_outstanding) || 0), 1);
  const grandTotal = rows.reduce((acc, r) => acc + (parseFloat(r.total_outstanding) || 0), 0);

  const BUCKETS = [
    { key: 'd0_30',  label: '0–30 days',  color: '#22c55e' },
    { key: 'd31_60', label: '31–60 days', color: '#f59e0b' },
    { key: 'd61_90', label: '61–90 days', color: '#f97316' },
    { key: 'd90plus',label: '90+ days',   color: '#ef4444' },
  ];

  return (
    <div className="report-section">
      {/* Summary buckets */}
      <div className="aging-summary-grid">
        {BUCKETS.map(b => {
          const total = rows.reduce((acc, r) => acc + (parseFloat(r[b.key]) || 0), 0);
          return (
            <div key={b.key} className="aging-bucket-card" style={{ borderTopColor: b.color }}>
              <div className="aging-bucket-label" style={{ color: b.color }}>{b.label}</div>
              <div className="aging-bucket-value">{fmtCurrency(total)}</div>
              <div className="aging-bucket-sub">{rows.filter(r => parseFloat(r[b.key]) > 0).length} clients</div>
            </div>
          );
        })}
      </div>

      <div className="report-card">
        <div className="report-card-header">
          <div className="report-card-title">Accounts Receivable Aging</div>
          <div className="report-card-sub">Total outstanding: <strong>{fmtCurrency(grandTotal)}</strong></div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <Archive className="empty-state-icon" />
            <div className="empty-state-title">No outstanding balances</div>
            <div className="empty-state-sub">All invoices are paid — great work!</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  {BUCKETS.map(b => <th key={b.key} style={{ color: b.color }}>{b.label}</th>)}
                  <th>Total</th>
                  <th>Exposure</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.client_name}>
                    <td style={{ fontWeight: 600 }}>{r.client_name}</td>
                    {BUCKETS.map(b => (
                      <td key={b.key} className="td-amount" style={{ color: parseFloat(r[b.key]) > 0 ? b.color : 'var(--text-muted)' }}>
                        {parseFloat(r[b.key]) > 0 ? fmtCurrency(r[b.key]) : '—'}
                      </td>
                    ))}
                    <td className="td-amount" style={{ fontWeight: 700 }}>{fmtCurrency(r.total_outstanding)}</td>
                    <td>
                      <div className="aging-exposure-bar">
                        <div className="aging-exposure-fill" style={{ width: `${Math.round((parseFloat(r.total_outstanding) / maxTotal) * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sales Report ───────────────────────────────────── */
function SalesReport() {
  const { t } = useTranslation();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState('client');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const fetchData = () => {
    setLoading(true);
    const params = new URLSearchParams({ group_by: groupBy });
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo)   params.append('date_to', dateTo);
    api.get(`/reports/sales?${params}`).then(res => {
      if (res.success) setRows(res.data);
      setLoading(false);
    });
  };

  useEffect(fetchData, [groupBy, dateFrom, dateTo]);

  const maxRevenue = Math.max(...rows.map(r => parseFloat(r.revenue) || 0), 1);
  const totalRevenue = rows.reduce((acc, r) => acc + (parseFloat(r.revenue) || 0), 0);

  return (
    <div className="report-section">
      <div className="report-card">
        <div className="report-card-header">
          <div className="filter-tabs">
            {[['client','By Client'], ['product','By Product']].map(([v, l]) => (
              <button key={v} className={`filter-tab ${groupBy === v ? 'active' : ''}`} onClick={() => setGroupBy(v)}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginInlineStart: 'auto' }}>
            <input type="date" className="report-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From" />
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>to</span>
            <input type="date" className="report-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To" />
          </div>
        </div>

        {loading ? <Loader /> : (
          <>
            <div className="sales-total-bar">
              Total revenue: <strong>{fmtCurrency(totalRevenue)}</strong>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{groupBy === 'client' ? 'Client' : 'Product / Service'}</th>
                    <th>Revenue</th>
                    <th>{groupBy === 'client' ? 'Invoices' : 'Qty'}</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={5}><div className="empty-state"><DataTransferBoth className="empty-state-icon" /><div className="empty-state-title">No data</div><div className="empty-state-sub">Adjust the filters or date range</div></div></td></tr>
                  )}
                  {rows.map((r, i) => {
                    const rev = parseFloat(r.revenue) || 0;
                    const pct = totalRevenue > 0 ? Math.round((rev / totalRevenue) * 100) : 0;
                    return (
                      <tr key={i}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{r.client_name || r.description || '—'}</td>
                        <td className="td-amount" style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmtCurrency(rev)}</td>
                        <td>{r.invoice_count || r.quantity || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="sales-bar-track">
                              <div className="sales-bar-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 32 }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

