import { useState, useEffect, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import { fmtCurrency } from '../utils/currency.js';
import { downloadCsv } from '../utils/csv.js';
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
  const { tenant } = useContext(AuthContext);
  const fmt = (v) => fmtCurrency(v, tenant?.currency);
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
        <KpiCard label={t('invoices.total_invoiced')} value={fmt(k.total_revenue)}
          sub={t('reports.sub_invoices', { count: k.invoice_count || 0 })} accent="blue" />
        <KpiCard label={t('reports.collected')} value={fmt(k.total_collected)}
          sub={t('reports.sub_collection_rate', { pct: collectionRate })} accent="green" />
        <KpiCard label={t('reports.outstanding')} value={fmt(k.outstanding)}
          sub={t('reports.awaiting_payment')} accent="amber" />
        <KpiCard label={t('invoices.overdue_amount')} value={fmt(k.overdue_amount)}
          sub={t('reports.sub_overdue', { count: k.overdue_count || 0 })} accent="red" />
      </div>

      {/* Collection rate bar */}
      <div className="report-card">
        <div className="report-card-title">{t('reports.collection_rate')}</div>
        <div className="collection-bar-wrap">
          <div className="collection-bar-track">
            <div className="collection-bar-fill" style={{ width: `${collectionRate}%` }} />
          </div>
          <span className="collection-bar-pct">{collectionRate}%</span>
        </div>
        <div className="collection-bar-labels">
          <span>{t('reports.collected')}: {fmt(k.total_collected)}</span>
          <span>{t('reports.outstanding')}: {fmt(k.outstanding)}</span>
        </div>
      </div>

      {/* Cashflow table */}
      {cf.length > 0 && (
        <div className="report-card">
          <div className="report-card-title">{t('reports.cashflow_last_days', { count: period })}</div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('reports.invoiced')}</th>
                  <th>{t('reports.collected')}</th>
                  <th>{t('reports.gap')}</th>
                </tr>
              </thead>
              <tbody>
                {cf.map(row => {
                  const gap = (row.invoiced || 0) - (row.collected || 0);
                  return (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td className="td-amount">{fmt(row.invoiced)}</td>
                      <td className="td-amount" style={{ color: '#16a34a' }}>{fmt(row.collected)}</td>
                      <td className="td-amount" style={{ color: gap > 0 ? '#dc2626' : '#16a34a' }}>{fmt(gap)}</td>
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
  const { tenant } = useContext(AuthContext);
  const fmt = (v) => fmtCurrency(v, tenant?.currency);
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
              <div className="aging-bucket-value">{fmt(total)}</div>
              <div className="aging-bucket-sub">{rows.filter(r => parseFloat(r[b.key]) > 0).length} clients</div>
            </div>
          );
        })}
      </div>

      <div className="report-card">
        <div className="report-card-header">
          <div className="report-card-title">{t('reports.ar_aging')}</div>
          <div className="report-card-sub" style={{ marginInlineEnd: 'auto' }}>{t('reports.total_outstanding')} <strong>{fmt(grandTotal)}</strong></div>
          <button className="btn btn-outline btn-sm" disabled={rows.length === 0}
            onClick={() => downloadCsv(
              'ar-aging.csv',
              [
                { label: 'Client', value: 'client_name' },
                { label: '0-30 days', value: 'd0_30' },
                { label: '31-60 days', value: 'd31_60' },
                { label: '61-90 days', value: 'd61_90' },
                { label: '90+ days', value: 'd90plus' },
                { label: t('reports.total_outstanding').replace(/:$/, ''), value: 'total_outstanding' },
              ],
              rows
            )}>
            <Download style={{ width: 14, height: 14 }} /> {t('reports.export_csv')}
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <Archive className="empty-state-icon" />
            <div className="empty-state-title">{t('reports.no_outstanding')}</div>
            <div className="empty-state-sub">{t('reports.all_paid')}</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('invoices.client')}</th>
                  {BUCKETS.map(b => <th key={b.key} style={{ color: b.color }}>{b.label}</th>)}
                  <th>{t('common.total')}</th>
                  <th>{t('reports.exposure')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.client_name}>
                    <td style={{ fontWeight: 600 }}>{r.client_name}</td>
                    {BUCKETS.map(b => (
                      <td key={b.key} className="td-amount" style={{ color: parseFloat(r[b.key]) > 0 ? b.color : 'var(--text-muted)' }}>
                        {parseFloat(r[b.key]) > 0 ? fmt(r[b.key]) : '—'}
                      </td>
                    ))}
                    <td className="td-amount" style={{ fontWeight: 700 }}>{fmt(r.total_outstanding)}</td>
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
  const { tenant } = useContext(AuthContext);
  const fmt = (v) => fmtCurrency(v, tenant?.currency);
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
            <input type="date" className="report-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title={t('reports.from')} />
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>to</span>
            <input type="date" className="report-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To" />
            <button className="btn btn-outline btn-sm" disabled={rows.length === 0}
              onClick={() => downloadCsv(
                `sales-by-${groupBy}.csv`,
                groupBy === 'client'
                  ? [{ label: 'Client', value: r => r.client_name }, { label: 'Revenue', value: 'revenue' }, { label: 'Invoices', value: 'invoice_count' }]
                  : [{ label: 'Product / Service', value: r => r.description }, { label: 'Revenue', value: 'revenue' }, { label: 'Quantity', value: 'quantity' }],
                rows
              )}>
              <Download style={{ width: 14, height: 14 }} /> {t('reports.export_csv')}
            </button>
          </div>
        </div>

        {loading ? <Loader /> : (
          <>
            <div className="sales-total-bar">
              Total revenue: <strong>{fmt(totalRevenue)}</strong>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{groupBy === 'client' ? 'Client' : 'Product / Service'}</th>
                    <th>{t('reports.revenue')}</th>
                    <th>{groupBy === 'client' ? 'Invoices' : 'Qty'}</th>
                    <th>{t('reports.share')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={5}><div className="empty-state"><DataTransferBoth className="empty-state-icon" /><div className="empty-state-title">{t('reports.no_data')}</div><div className="empty-state-sub">{t('reports.adjust_filters')}</div></div></td></tr>
                  )}
                  {rows.map((r, i) => {
                    const rev = parseFloat(r.revenue) || 0;
                    const pct = totalRevenue > 0 ? Math.round((rev / totalRevenue) * 100) : 0;
                    return (
                      <tr key={i}>
                        <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{r.client_name || r.description || '—'}</td>
                        <td className="td-amount" style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmt(rev)}</td>
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

