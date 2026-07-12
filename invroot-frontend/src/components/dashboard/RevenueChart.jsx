import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { useTranslation } from 'react-i18next';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

export default function RevenueChart({ data = [] }) {
  const { t } = useTranslation();
  const labels   = data.map(d => d.date);
  const invoiced = data.map(d => parseFloat(d.invoiced || 0));
  const collected = data.map(d => parseFloat(d.collected || 0));

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Invoiced',
        data: invoiced,
        borderColor: '#e85d04',
        backgroundColor: 'rgba(232,93,4,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
      },
      {
        label: 'Collected',
        data: collected,
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22,163,74,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } },
      x: { grid: { display: false } },
    },
  };

  return (
    <div className="chart-card">
      <h3 className="chart-title">{t('dashboard.cashflow')}</h3>
      <div style={{ height: 240 }}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
