import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { Plus, Xmark, Trash } from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import RecordPaymentModal from '../components/invoices/RecordPaymentModal.jsx';

export default function Payments() {
  const { t } = useTranslation();
  const [payments, setPayments] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [picker,   setPicker]   = useState(false);      // invoice picker open
  const [payInvoice, setPayInvoice] = useState(null);   // invoice selected for payment

  const fetchPayments = async () => {
    setLoading(true);
    try {
      const res = await api.get('/payments?limit=50');
      if (res.success) { setPayments(res.data); setTotal(res.total); }
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchPayments(); }, []);

  const handleDelete = async (id) => {
    if (!confirm(t('payments.confirm_delete'))) return;
    await api.delete(`/payments/${id}`);
    fetchPayments();
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('payments.title')}</h1>
        <button className="btn btn-primary" onClick={() => setPicker(true)}><Plus /> {t('payments.record')}</button>
      </div>
      <div className="card">
        {loading ? <Loader fullPage /> : (
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
                    <td className="td-mono">{p.invoice_number}</td>
                    <td>{p.client_name}</td>
                    <td className="ta-r td-amount">{fmtCurrency(p.amount)}</td>
                    <td>{t(`payments.methods.${p.method}`)}</td>
                    <td>{p.reference || '—'}</td>
                    <td className="td-actions">
                      <button className="icon-btn danger" onClick={() => handleDelete(p.id)} title={t('common.delete')}><Trash /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && <div className="pagination"><span>{t('common.showing')} {payments.length} {t('common.of')} {total}</span></div>}
      </div>

      {picker && (
        <InvoicePicker
          onClose={() => setPicker(false)}
          onPick={(inv) => { setPicker(false); setPayInvoice(inv); }}
        />
      )}

      {payInvoice && (
        <RecordPaymentModal
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          onSaved={() => { setPayInvoice(null); fetchPayments(); }}
        />
      )}
    </div>
  );
}

/* Modal to choose an open invoice to record a payment against */
function InvoicePicker({ onClose, onPick }) {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/invoices?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(res => {
      if (res.success) {
        setInvoices(res.data.filter(i => !['paid', 'void', 'draft'].includes(i.status)));
      }
      setLoading(false);
    });
  }, [search]);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{t('payments.select_invoice')}</h2>
          <button className="modal-close" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body">
          <input
            className="picker-search"
            placeholder={t('common.search') + '...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {loading ? <Loader /> : invoices.length === 0 ? (
            <div className="detail-muted" style={{ padding: 16 }}>{t('payments.no_open_invoices')}</div>
          ) : (
            <div className="picker-list">
              {invoices.map(inv => {
                const bal = Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount || 0));
                return (
                  <button key={inv.id} className="picker-item" onClick={() => onPick(inv)}>
                    <div>
                      <div className="picker-item-title">{inv.invoice_number}</div>
                      <div className="picker-item-sub">{inv.client_name}</div>
                    </div>
                    <div className="picker-item-amount">{fmtCurrency(bal, inv.currency)}</div>
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
