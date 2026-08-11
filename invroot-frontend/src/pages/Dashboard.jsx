import { useState, useEffect, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../lib/api.js';
import KpiCard from '../components/dashboard/KpiCard.jsx';
import RevenueChart from '../components/dashboard/RevenueChart.jsx';
import DashboardInsights from '../components/dashboard/DashboardInsights.jsx';
import OnboardingChecklist from '../components/dashboard/OnboardingChecklist.jsx';
import UnbilledWork from '../components/dashboard/UnbilledWork.jsx';
import Loader from '../components/Loader.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import { DollarCircle, Page, WarningTriangle, Check, ArrowUp, ArrowDown } from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import './Dashboard.css';

const STATUS_COLOR = {
  paid:    { bg: '#dcfce7', color: '#16a34a' },
  sent:    { bg: '#dbeafe', color: '#2563eb' },
  draft:   { bg: '#f3f4f6', color: '#6b7280' },
  overdue: { bg: '#fee2e2', color: '#dc2626' },
  partial: { bg: '#fef3c7', color: '#d97706' },
  void:    { bg: '#f3f4f6', color: '#9ca3af' },
};

export default function Dashboard() {
  const { t } = useTranslation();
  const { tenant } = useContext(AuthContext);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState('30');

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/dashboard?period=${period}`);
      if (res.success) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  if (loading) return <Loader fullPage />;

  const kpis = data?.kpis || {};
  const cur  = data?.currency || tenant?.currency || 'SAR';
  const fmt  = (v) => fmtCurrency(v, cur);

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1 className="page-title">{t('dashboard.title')}</h1>
        <div className="period-tabs">
          {[['7', t('dashboard.period_7')], ['30', t('dashboard.period_30')], ['90', t('dashboard.period_90')]].map(([v, label]) => (
            <button key={v} className={`period-tab ${period === v ? 'active' : ''}`} onClick={() => setPeriod(v)}>{label}</button>
          ))}
        </div>
      </div>

      {/* Getting started — hides itself once complete or dismissed */}
      <OnboardingChecklist />

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          label={t('dashboard.total_revenue')}
          value={fmt(kpis.total_revenue)}
          icon={DollarCircle}
          color="#8A6D1F"
        />
        <KpiCard
          label={t('dashboard.collected')}
          value={fmt(kpis.total_collected)}
          icon={Check}
          color="#16a34a"
        />
        <KpiCard
          label={t('dashboard.outstanding')}
          value={fmt(kpis.outstanding)}
          icon={Page}
          color="#2563eb"
        />
        <KpiCard
          label={t('dashboard.overdue')}
          value={fmt(kpis.overdue_amount)}
          subtitle={kpis.overdue_count > 0 ? `${kpis.overdue_count} invoices` : undefined}
          icon={WarningTriangle}
          color="#dc2626"
        />
      </div>

      {/* Overdue alert banner */}
      {Number(kpis.overdue_amount) > 0 && (
        <div className="overdue-banner">
          <WarningTriangle className="overdue-banner-icon" />
          <div>
            <strong>{t('dashboard.overdue_alert_title')}</strong>
            <span>{t('dashboard.overdue_alert_sub', { amount: fmt(kpis.overdue_amount) })}</span>
          </div>
          <Link to="/invoices?status=overdue" className="btn btn-sm btn-danger" style={{ marginInlineStart:'auto' }}>
            {t('dashboard.view_overdue')}
          </Link>
        </div>
      )}

      {/* ── Receivables / Payables / Cashflow ───────── */}
      <UnbilledWork />

      <div className="dash-fin-row">
        {/* Receivables */}
        <div className="dash-fin-card">
          <div className="dash-fin-header">
            <div className="dash-fin-icon rcv"><ArrowUp /></div>
            <div>
              <div className="dash-fin-label">{t('dashboard.total_receivables')}</div>
              <div className="dash-fin-total">{fmt(data?.receivables?.total || 0)}</div>
            </div>
          </div>
          <div className="dash-fin-bars">
            <div className="dash-fin-bar-row">
              <span className="dash-fin-bar-label">{t('dashboard.current')}</span>
              <div className="dash-fin-bar-track">
                <div className="dash-fin-bar-fill blue" style={{
                  width: `${data?.receivables?.total > 0
                    ? Math.round((data.receivables.current / data.receivables.total) * 100)
                    : 0}%`
                }} />
              </div>
              <span className="dash-fin-bar-val">{fmt(data?.receivables?.current || 0)}</span>
            </div>
            <div className="dash-fin-bar-row">
              <span className="dash-fin-bar-label">{t('dashboard.overdue')}</span>
              <div className="dash-fin-bar-track">
                <div className="dash-fin-bar-fill red" style={{
                  width: `${data?.receivables?.total > 0
                    ? Math.round((data.receivables.overdue / data.receivables.total) * 100)
                    : 0}%`
                }} />
              </div>
              <span className="dash-fin-bar-val">{fmt(data?.receivables?.overdue || 0)}</span>
            </div>
          </div>
        </div>

        {/* Payables */}
        <div className="dash-fin-card">
          <div className="dash-fin-header">
            <div className="dash-fin-icon pay"><ArrowDown /></div>
            <div>
              <div className="dash-fin-label">{t('dashboard.total_payables')}</div>
              <div className="dash-fin-total">{fmt(data?.payables?.total || 0)}</div>
            </div>
          </div>
          <div className="dash-fin-bars">
            <div className="dash-fin-bar-row">
              <span className="dash-fin-bar-label">{t('dashboard.current')}</span>
              <div className="dash-fin-bar-track">
                <div className="dash-fin-bar-fill orange" style={{
                  width: `${data?.payables?.total > 0
                    ? Math.round((data.payables.current / data.payables.total) * 100)
                    : 0}%`
                }} />
              </div>
              <span className="dash-fin-bar-val">{fmt(data?.payables?.current || 0)}</span>
            </div>
            <div className="dash-fin-bar-row">
              <span className="dash-fin-bar-label">{t('dashboard.overdue')}</span>
              <div className="dash-fin-bar-track">
                <div className="dash-fin-bar-fill red" style={{
                  width: `${data?.payables?.total > 0
                    ? Math.round((data.payables.overdue / data.payables.total) * 100)
                    : 0}%`
                }} />
              </div>
              <span className="dash-fin-bar-val">{fmt(data?.payables?.overdue || 0)}</span>
            </div>
          </div>
        </div>

        {/* Cashflow Summary */}
        <div className="dash-fin-card cashflow-card">
          <div className="dash-fin-label" style={{ marginBottom:14 }}>{t('dashboard.cash_flow_summary')}</div>
          <div className="dash-cf-rows">
            <div className="dash-cf-row">
              <span className="dash-cf-lbl">{t('dashboard.opening_balance')}</span>
              <span className="dash-cf-val">{fmt(data?.cashflow_summary?.opening || 0)}</span>
            </div>
            <div className="dash-cf-row incoming">
              <span className="dash-cf-lbl"><ArrowUp style={{width:13,height:13}} /> {t('dashboard.incoming')}</span>
              <span className="dash-cf-val green">+{fmt(data?.cashflow_summary?.incoming || 0)}</span>
            </div>
            <div className="dash-cf-row outgoing">
              <span className="dash-cf-lbl"><ArrowDown style={{width:13,height:13}} /> {t('dashboard.outgoing')}</span>
              <span className="dash-cf-val red">−{fmt(data?.cashflow_summary?.outgoing || 0)}</span>
            </div>
            <div className="dash-cf-divider" />
            <div className="dash-cf-row closing">
              <span className="dash-cf-lbl" style={{ fontWeight:700 }}>{t('dashboard.closing_balance')}</span>
              <span className="dash-cf-val" style={{ fontWeight:800, fontSize:16 }}>{fmt(data?.cashflow_summary?.closing || 0)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <RevenueChart data={data?.cashflow || []} />

      {/* Top clients + AR aging */}
      <DashboardInsights />

      {/* Recent invoices */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h3>{t('dashboard.recent_invoices')}</h3>
          <Link to="/invoices" className="link-primary">{t('common.view_all')} →</Link>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('invoices.number')}</th>
                <th>{t('clients.title')}</th>
                <th>{t('common.amount')}</th>
                <th>{t('invoices.due_date')}</th>
                <th>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(!data?.recent_invoices?.length) && (
                <tr><td colSpan={5} className="empty-row">{t('common.no_data')}</td></tr>
              )}
              {(data?.recent_invoices || []).map(inv => {
                const s = STATUS_COLOR[inv.status] || STATUS_COLOR.draft;
                return (
                  <tr key={inv.id}>
                    <td className="td-mono">{inv.invoice_number}</td>
                    <td className="td-name">{inv.client_name || '—'}</td>
                    <td className="td-amount">{fmtCurrency(inv.total_amount, inv.currency)}</td>
                    <td>{fmtDate(inv.due_date)}</td>
                    <td>
                      <span className="dash-status-badge" style={{ background: s.bg, color: s.color }}>
                        <span className="dash-status-dot" style={{ background: s.color }} />
                        {t(`invoices.status.${inv.status}`, { defaultValue: inv.status })}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
