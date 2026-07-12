import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { Search, Download, PrintingPage } from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';

export default function Receipts() {
  const { t } = useTranslation();
  const [receipts, setReceipts] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [page,     setPage]     = useState(1);
  const [search,   setSearch]   = useState('');
  const [method,   setMethod]   = useState('');
  const [loading,  setLoading]  = useState(true);

  const fetchReceipts = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page, limit: 20 });
      if (search) qs.set('search', search);
      if (method) qs.set('method', method);
      const res = await api.get(`/receipts?${qs.toString()}`);
      if (res.success) { setReceipts(res.data); setTotal(res.total); setTotalAmount(res.total_amount || 0); }
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchReceipts(); }, [page, search, method]);

  const downloadPdf = (r) => api.download(`/receipts/${r.id}/pdf`, `receipt-${r.receipt_number}.pdf`);

  const METHODS = ['', 'cash', 'bank_transfer', 'card', 'check', 'stripe', 'paypal', 'other'];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('receipts.title')}</h1>
          <p className="page-subtitle">{t('receipts.subtitle')}</p>
        </div>
        <div className="receipts-total">
          <span>{t('receipts.total_received')}</span>
          <strong>{fmtCurrency(totalAmount)}</strong>
        </div>
      </div>

      <div className="card">
        <div className="card-toolbar">
          <div className="search-box">
            <Search className="search-icon" />
            <input
              type="text"
              placeholder={t('common.search') + '...'}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select className="toolbar-select" value={method} onChange={e => { setMethod(e.target.value); setPage(1); }}>
            {METHODS.map(m => <option key={m} value={m}>{m ? t(`payments.methods.${m}`) : t('payments.all_methods')}</option>)}
          </select>
        </div>

        {loading ? <Loader fullPage /> : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('receipts.number')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('invoices.number')}</th>
                  <th>{t('invoices.client')}</th>
                  <th className="ta-r">{t('common.amount')}</th>
                  <th>{t('payments.method')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {receipts.length === 0 && <tr><td colSpan={7} className="empty-row">{t('common.no_data')}</td></tr>}
                {receipts.map(r => (
                  <tr key={r.id}>
                    <td className="td-mono"><PrintingPage className="inline-icon" /> {r.receipt_number}</td>
                    <td>{fmtDate(r.issued_date)}</td>
                    <td className="td-mono">{r.invoice_number || '—'}</td>
                    <td>{r.client_name || '—'}</td>
                    <td className="ta-r td-amount">{fmtCurrency(r.amount, r.currency)}</td>
                    <td>{t(`payments.methods.${r.method}`)}</td>
                    <td className="td-actions">
                      <button className="icon-btn" onClick={() => downloadPdf(r)} title={t('common.download')}><Download /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <span>{t('common.showing')} {receipts.length} {t('common.of')} {total}</span>
          <div className="pagination-btns">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn btn-sm">‹</button>
            <span>{t('common.page')} {page}</span>
            <button disabled={receipts.length < 20} onClick={() => setPage(p => p + 1)} className="btn btn-sm">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}
