import { useState, useEffect, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../../lib/api.js';
import { AuthContext } from '../../context/AuthContext.jsx';
import { fmtCurrency } from '../../utils/currency.js';
import { Group, Timer } from 'iconoir-react';

const AGING = [
  { key: 'd0_30',  label: '0–30',  color: '#22c55e' },
  { key: 'd31_60', label: '31–60', color: '#f59e0b' },
  { key: 'd61_90', label: '61–90', color: '#f97316' },
  { key: 'd90plus',label: '90+',   color: '#ef4444' },
];

export default function DashboardInsights() {
  const { t } = useTranslation();
  const { tenant } = useContext(AuthContext);
  const fmt = (v) => fmtCurrency(v, tenant?.currency);
  const [clients, setClients] = useState([]);
  const [aging, setAging]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/reports/sales?group_by=client'),
      api.get('/reports/aging'),
    ]).then(([s, a]) => {
      if (s.success) setClients((s.data || []).slice(0, 5));
      if (a.success) setAging(a.data || []);
      setLoading(false);
    });
  }, []);

  const maxRev = Math.max(...clients.map(c => parseFloat(c.revenue) || 0), 1);
  const bucketTotals = AGING.map(b => aging.reduce((acc, r) => acc + (parseFloat(r[b.key]) || 0), 0));
  const agingTotal = bucketTotals.reduce((a, b) => a + b, 0);

  return (
    <div className="dash-insights-row">
      {/* Top clients */}
      <div className="card dash-insight-card">
        <div className="card-header">
          <h3><Group style={{ width: 18, height: 18, verticalAlign: '-3px', marginInlineEnd: 6 }} />{t('dashboard.top_clients')}</h3>
          <Link to="/reports" className="link-primary">{t('common.view_all')} →</Link>
        </div>
        <div className="dash-topclients">
          {loading ? <div className="empty-row">…</div>
            : clients.length === 0 ? <div className="empty-row">{t('common.no_data')}</div>
            : clients.map((c, i) => (
              <div key={i} className="dash-tc-row">
                <span className="dash-tc-rank">{i + 1}</span>
                <span className="dash-tc-name">{c.client_name}</span>
                <div className="dash-tc-bar-track">
                  <div className="dash-tc-bar-fill" style={{ width: `${Math.round((parseFloat(c.revenue) / maxRev) * 100)}%` }} />
                </div>
                <span className="dash-tc-val">{fmt(c.revenue)}</span>
              </div>
            ))}
        </div>
      </div>

      {/* AR aging */}
      <div className="card dash-insight-card">
        <div className="card-header">
          <h3><Timer style={{ width: 18, height: 18, verticalAlign: '-3px', marginInlineEnd: 6 }} />{t('dashboard.ar_aging')}</h3>
          <Link to="/reports" className="link-primary">{t('common.view_all')} →</Link>
        </div>
        {/* Stacked bar */}
        <div className="dash-aging-bar">
          {agingTotal > 0 ? AGING.map((b, i) => bucketTotals[i] > 0 && (
            <div key={b.key} style={{ width: `${(bucketTotals[i] / agingTotal) * 100}%`, background: b.color }}
              title={`${b.label}: ${fmt(bucketTotals[i])}`} />
          )) : <div className="dash-aging-empty" />}
        </div>
        <div className="dash-aging-legend">
          {AGING.map((b, i) => (
            <div key={b.key} className="dash-aging-leg">
              <span className="dash-aging-dot" style={{ background: b.color }} />
              <span className="dash-aging-leg-label">{b.label}{t('dashboard.days_short')}</span>
              <span className="dash-aging-leg-val">{fmt(bucketTotals[i])}</span>
            </div>
          ))}
        </div>
        <div className="dash-aging-total">
          <span>{t('dashboard.total_outstanding')}</span>
          <strong>{fmt(agingTotal)}</strong>
        </div>
      </div>
    </div>
  );
}
