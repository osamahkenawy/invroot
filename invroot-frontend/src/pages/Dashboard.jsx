import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../lib/api.js';
import KpiCard from '../components/dashboard/KpiCard.jsx';
import RevenueChart from '../components/dashboard/RevenueChart.jsx';
import Loader from '../components/Loader.jsx';
import { DollarCircle, Page, WarningTriangle, Check } from 'iconoir-react';
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

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          label={t('dashboard.total_revenue')}
          value={fmtCurrency(kpis.total_revenue)}
          icon={DollarCircle}
          color="#f2421b"
        />
        <KpiCard
          label={t('dashboard.collected')}
          value={fmtCurrency(kpis.total_collected)}
          icon={Check}
          color="#16a34a"
        />
        <KpiCard
          label={t('dashboard.outstanding')}
          value={fmtCurrency(kpis.outstanding)}
          icon={Page}
          color="#2563eb"
        />
        <KpiCard
          label={t('dashboard.overdue')}
          value={fmtCurrency(kpis.overdue_amount)}
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
            <span>{t('dashboard.overdue_alert_sub', { amount: fmtCurrency(kpis.overdue_amount) })}</span>
          </div>
          <Link to="/invoices?status=overdue" className="btn btn-sm btn-danger" style={{ marginInlineStart:'auto' }}>
            {t('dashboard.view_overdue')}
          </Link>
        </div>
      )}

      {/* Chart */}
      <RevenueChart data={data?.cashflow || []} />

      {/* Recent invoices */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h3>{t('dashboard.recent_invoices')}</h3>
          <Link to="/invoices" className="link-primary">View all →</Link>
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
                        {inv.status}
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
