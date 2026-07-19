import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { Plus, Xmark, Trash, Download, Search, DollarCircle, Check, CreditCard } from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import RecordPaymentModal from '../components/invoices/RecordPaymentModal.jsx';
import './Payments.css';

const METHODS = ['', 'cash', 'bank_transfer', 'card', 'check', 'stripe', 'paypal', 'other'];
const METHOD_ICON = { cash: '💵', bank_transfer: '🏦', card: '💳', check: '📝', stripe: '⚡', paypal: '🅿️', other: '•' };

export default function Payments() {
  const { t } = useTranslation();
  const [payments,   setPayments]   = useState([]);
  const [total,      setTotal]      = useState(0);
  const [totalAmt,   setTotalAmt]   = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [pg,         setPg]         = useState(1);
  const [method,     setMethod]     = useState('');
  const [search,     setSearch]     = useState('');
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [picker,     setPicker]     = useState(false);
  const [payInvoice, setPayInvoice] = useState(null);
  const [currency,   setCurrency]   = useState('SAR');
  const LIMIT = 20;

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: pg, limit: LIMIT });
      if (method)   qs.set('method', method);
      if (search)   qs.set('search', search);
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo)   qs.set('date_to', dateTo);
      const res = await api.get('/payments?' + qs.toString());
      if (res.success) {
        setPayments(res.data);
        setTotal(res.total || 0);
        const computed = res.data.reduce((s, p) => s + Number(p.amount), 0);
        setTotalAmt(res.total_amount || computed);
        setCurrency(res.currency || res.data[0]?.currency || 'SAR');
      }
    } finally { setLoading(false); }
  }, [pg, method, search, dateFrom, dateTo]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const handleDelete = async (id) => {
    if (!confirm(t('payments.confirm_delete'))) return;
    await api.delete('/payments/' + id);
    fetchPayments();
  };

  const downloadReceipt = (p) => {
    if (p.receipt_id) api.download('/receipts/' + p.receipt_id + '/pdf', 'receipt-' + (p.receipt_number || p.receipt_id) + '.pdf');
  };

  const methodCounts = payments.reduce((acc, p) => { acc[p.method] = (acc[p.method] || 0) + Number(p.amount); return acc; }, {});
  const topMethod = Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('payments.title')}</h1>
          <p className="page-subtitle">{t('payments.subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setPicker(true)}><Plus /> {t('payments.record')}</button>
      </div>

      <div className="pay-stats-row">
        <div className="pay-stat-card">
          <div className="pay-stat-icon" style={{ background:'#dcfce7' }}><DollarCircle style={{ color:'#16a34a' }} /></div>
          <div><div className="pay-stat-label">{t('payments.total_collected')}</div><div className="pay-stat-value">{fmtCurrency(totalAmt, currency)}</div></div>
        </div>
        <div className="pay-stat-card">
          <div className="pay-stat-icon" style={{ background:'#dbeafe' }}><Check style={{ color:'#2563eb' }} /></div>
          <div><div className="pay-stat-label">{t('payments.total_transactions')}</div><div className="pay-stat-value">{total}</div></div>
        </div>
        <div className="pay-stat-card">
          <div className="pay-stat-icon" style={{ background:'#fef3c7' }}><CreditCard style={{ color:'#d97706' }} /></div>
          <div><div className="pay-stat-label">{t('payments.top_method')}</div>
            <div className="pay-stat-value">{topMethod ? (METHOD_ICON[topMethod[0]] || '') + ' ' + topMethod[0].replace('_',' ') : '—'}</div></div>
        </div>
        <div className="pay-stat-card">
          <div className="pay-stat-icon" style={{ background:'#ede9fe' }}><DollarCircle style={{ color:'#7c3aed' }} /></div>
          <div><div className="pay-stat-label">{t('payments.avg_payment')}</div>
            <div className="pay-stat-value">{total > 0 ? fmtCurrency(totalAmt / total, currency) : '—'}</div></div>
        </div>
      </div>

      <div className="card" style={{ marginTop:16 }}>
        <div className="card-toolbar">
          <div className="search-box">
            <Search className="search-icon" />
            <input type="text" placeholder={t('payments.search_placeholder')} value={search}
              onChange={e => { setSearch(e.target.value); setPg(1); }} />
          </div>
          <select className="toolbar-select" value={method} onChange={e => { setMethod(e.target.value); setPg(1); }}>
            {METHODS.map(m => <option key={m} value={m}>{m ? (METHOD_ICON[m] || '') + ' ' + m.replace('_',' ') : t('payments.all_methods')}</option>)}
          </select>
          <input type="date" className="toolbar-date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPg(1); }} />
          <input type="date" className="toolbar-date" value={dateTo}   onChange={e => { setDateTo(e.target.value);   setPg(1); }} />
        </div>

        {loading ? <Loader fullPage /> : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('invoices.number')}</th>
                    <th>{t('invoices.client')}</th>
                    <th className="ta-r">{t('common.amount')}</th>
                    <th>{t('payments.method')}</th>
                    <th>{t('payments.reference')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 && <tr><td colSpan={7} className="empty-row">{t('common.no_data')}</td></tr>}
                  {payments.map(p => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.payment_date)}</td>
                      <td className="td-mono">{p.invoice_number || '—'}</td>
                      <td>{p.client_name || '—'}</td>
                      <td className="ta-r td-amount">{fmtCurrency(p.amount, p.currency || currency)}</td>
                      <td><span className="pay-method-badge">{(METHOD_ICON[p.method] || '')} {p.method?.replace('_',' ')}</span></td>
                      <td>{p.reference || '—'}</td>
                      <td className="td-actions">
                        {p.receipt_id && <button className="icon-btn" title="Download Receipt" onClick={() => downloadReceipt(p)}><Download /></button>}
                        <button className="icon-btn danger" onClick={() => handleDelete(p.id)}><Trash /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              {total > LIMIT && <>
                <button className="btn btn-sm btn-outline" disabled={pg<=1} onClick={() => setPg(p=>p-1)}>‹ {t('common.prev')}</button>
                <span>{t('common.page')} {pg} / {Math.ceil(total/LIMIT)}</span>
                <button className="btn btn-sm btn-outline" disabled={pg>=Math.ceil(total/LIMIT)} onClick={() => setPg(p=>p+1)}>{t('common.next')} ›</button>
              </>}
              {total <= LIMIT && <span>{t('common.showing')} {payments.length} {t('common.of')} {total}</span>}
            </div>
          </>
        )}
      </div>

      {picker && (
        <InvoicePicker onClose={() => setPicker(false)} onPick={inv => { setPicker(false); setPayInvoice(inv); }} currency={currency} />
      )}
      {payInvoice && (
        <RecordPaymentModal invoice={payInvoice} onClose={() => setPayInvoice(null)} onSaved={() => { setPayInvoice(null); fetchPayments(); }} />
      )}
    </div>
  );
}

function InvoicePicker({ onClose, onPick, currency }) {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get('/invoices?limit=50' + (search ? '&search=' + encodeURIComponent(search) : '')).then(res => {
      if (res.success) setInvoices(res.data.filter(i => !['paid','void','draft'].includes(i.status)));
      setLoading(false);
    });
  }, [search]);

  return (
    <div className="modal-overlay" onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div className="modal-panel" style={{ maxWidth:520 }}>
        <div className="modal-header">
          <h3>{t('payments.select_invoice')}</h3>
          <button className="icon-btn" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body">
          <input className="field-input" placeholder={t('common.search') + '...'} value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom:12 }} />
          {loading ? <Loader /> : invoices.length===0 ? (
            <p style={{ color:'var(--text-muted)', padding:16, textAlign:'center' }}>{t('payments.no_open_invoices')}</p>
          ) : (
            <div className="pay-picker-list">
              {invoices.map(inv => {
                const bal = Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount||0));
                return (
                  <button key={inv.id} className="pay-picker-item" onClick={() => onPick(inv)}>
                    <div><div className="pay-picker-num">{inv.invoice_number}</div><div className="pay-picker-client">{inv.client_name}</div></div>
                    <div style={{ textAlign:'right' }}>
                      <div className="pay-picker-amount">{fmtCurrency(bal, inv.currency || currency)}</div>
                      <span className={'status-badge status-' + inv.status} style={{ fontSize:10 }}>{inv.status}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
