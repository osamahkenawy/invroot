import { useTranslation } from 'react-i18next';
import { ArrowUp, ArrowDown } from 'iconoir-react';

/**
 * KPI card component for the dashboard.
 * @param {string} label - Translation key or plain text
 * @param {string|number} value - Main value to display
 * @param {string} [subtitle] - Secondary text
 * @param {number} [trend] - Positive/negative percentage change
 * @param {string} [color] - Accent color override
 * @param {React.ReactNode} [icon] - Icon component
 */
export default function KpiCard({ label, value, subtitle, trend, color, icon: Icon }) {
  const trendUp = trend > 0;
  return (
    <div className="kpi-card" style={{ '--kpi-color': color || 'var(--primary)' }}>
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        {Icon && <div className="kpi-icon"><Icon /></div>}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-footer">
        {subtitle && <span className="kpi-subtitle">{subtitle}</span>}
        {trend !== undefined && trend !== null && (
          <span className={`kpi-trend ${trendUp ? 'up' : 'down'}`}>
            {trendUp ? <ArrowUp /> : <ArrowDown />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
