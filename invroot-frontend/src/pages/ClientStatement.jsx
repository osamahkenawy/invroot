import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Printer, NavArrowLeft } from 'iconoir-react';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { downloadCsv } from '../utils/csv.js';
import { fmtDate } from '../utils/date.js';
import './ClientStatement.css';

/** Money with the statement's currency; blank cells stay visually quiet. */
const money = (v, cur) =>
  Number(v) === 0 ? '—' : `${cur} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ClientStatement() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ ...(from && { from }), ...(to && { to }) });
    api.get(`/clients/${id}/statement?${q}`).then(r => {
      if (r.success) setData(r.data);
      setLoading(false);
    });
  }, [id, from, to]);
  useEffect(load, [load]);

  if (loading) return <Loader fullPage />;
  if (!data)   return <div className="empty-state">{t('statement.not_found')}</div>;

  const cur = data.currency;
  const outstanding = data.closing_balance;

  const exportCsv = () => downloadCsv(
    `statement-${data.client.name.replace(/\s+/g, '-').toLowerCase()}.csv`,
    [
      { label: 'Date',        value: 'date' },
      { label: 'Type',        value: r => r.type.replace('_', ' ') },
      { label: 'Reference',   value: 'ref' },
      { label: 'Description', value: 'description' },
      { label: `Debit (${cur})`,   value: r => r.debit  || '' },
      { label: `Credit (${cur})`,  value: r => r.credit || '' },
      { label: `Balance (${cur})`, value: 'balance' },
    ],
    data.entries
  );

  return (
    <div className={`stmt-page ${isRTL ? 'rtl' : ''}`}>
      {/* Toolbar — hidden when printing */}
      <div className="stmt-toolbar no-print">
        <Link to="/clients" className="link-subtle stmt-back">
          <NavArrowLeft /> {t('statement.back_to_clients')}
        </Link>
        <div className="stmt-toolbar-right">
          <label className="stmt-date">
            {t('statement.from')}
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label className="stmt-date">
            {t('statement.to')}
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </label>
          {(from || to) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); }}>
              {t('statement.clear')}
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={exportCsv} disabled={!data.entries.length}>
            <Download style={{ width: 14, height: 14 }} /> {t('statement.export_csv')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
            <Printer style={{ width: 14, height: 14 }} /> {t('statement.print')}
          </button>
        </div>
      </div>

      {/* The printable sheet */}
      <div className="stmt-sheet">
        <div className="stmt-head">
          <div className="stmt-from">
            {data.company?.logo_url
              ? <img className="stmt-logo" src={data.company.logo_url} alt={data.company.company_name} />
              : <div className="stmt-company">{data.company?.company_name}</div>}
            {data.company?.address && <div className="stmt-muted">{data.company.address}</div>}
            {data.company?.tax_id && <div className="stmt-muted">{t('statement.tax_id')}: {data.company.tax_id}</div>}
          </div>
          <div className="stmt-title-block">
            <h1>{t('statement.title')}</h1>
            <div className="stmt-muted">
              {data.from || data.to
                ? `${data.from ? fmtDate(data.from) : '…'} → ${data.to ? fmtDate(data.to) : t('statement.today')}`
                : t('statement.all_time')}
            </div>
          </div>
        </div>

        <div className="stmt-billto">
          <div className="stmt-label">{t('statement.statement_for')}</div>
          <div className="stmt-client-name">{data.client.name}</div>
          {data.client.billing_address && <div className="stmt-muted">{data.client.billing_address}</div>}
          {data.client.email && <div className="stmt-muted">{data.client.email}</div>}
        </div>

        {/* Summary */}
        <div className="stmt-summary">
          <div className="stmt-sum-item">
            <span>{t('statement.opening_balance')}</span>
            <strong>{cur} {Number(data.opening_balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
          </div>
          <div className="stmt-sum-item">
            <span>{t('statement.invoiced')}</span>
            <strong>{cur} {Number(data.total_invoiced).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
          </div>
          <div className="stmt-sum-item">
            <span>{t('statement.paid')}</span>
            <strong className="green">− {cur} {Number(data.total_paid).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
          </div>
          <div className={`stmt-sum-item total ${outstanding > 0 ? 'due' : 'clear'}`}>
            <span>{outstanding > 0 ? t('statement.balance_due') : t('statement.balance')}</span>
            <strong>{cur} {Number(outstanding).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
          </div>
        </div>

        {/* Ledger */}
        <table className="stmt-table">
          <thead>
            <tr>
              <th>{t('common.date')}</th>
              <th>{t('statement.description')}</th>
              <th className="r">{t('statement.debit')}</th>
              <th className="r">{t('statement.credit')}</th>
              <th className="r">{t('statement.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {data.opening_balance !== 0 && (
              <tr className="stmt-opening">
                <td>{data.from ? fmtDate(data.from) : ''}</td>
                <td><em>{t('statement.opening_balance')}</em></td>
                <td className="r">—</td><td className="r">—</td>
                <td className="r">{cur} {Number(data.opening_balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
            )}
            {data.entries.map((e, i) => (
              <tr key={i}>
                <td className="stmt-date-cell">{fmtDate(e.date)}</td>
                <td>
                  <span className={`stmt-tag ${e.type}`}>{t(`statement.type_${e.type}`, { defaultValue: e.type })}</span>
                  {e.description}
                </td>
                <td className="r">{money(e.debit, cur)}</td>
                <td className="r green">{money(e.credit, cur)}</td>
                <td className="r bold">{cur} {Number(e.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
            {!data.entries.length && (
              <tr><td colSpan={5} className="stmt-empty">{t('statement.no_activity')}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{t('statement.closing_balance')}</td>
              <td className="r">{cur} {Number(data.total_invoiced).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td className="r green">{cur} {Number(data.total_paid).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td className="r bold">{cur} {Number(outstanding).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tfoot>
        </table>

        <div className="stmt-footnote">{t('statement.footnote')}</div>
      </div>
    </div>
  );
}
