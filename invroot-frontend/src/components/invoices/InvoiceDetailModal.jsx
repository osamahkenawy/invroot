import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api.js';
import { fmtCurrency } from '../../utils/currency.js';
import { fmtDate } from '../../utils/date.js';
import Loader from '../Loader.jsx';
import RecordPaymentModal from './RecordPaymentModal.jsx';
import { Xmark, Download, Send, DollarCircle, Copy, Trash, PrintingPage } from 'iconoir-react';

const STATUS_COLORS = {
  draft: '#9ca3af', sent: '#2563eb', viewed: '#7c3aed',
  partial: '#d97706', paid: '#16a34a', overdue: '#dc2626', void: '#6b7280',
};

export default function InvoiceDetailModal({ invoiceId, onClose, onChanged }) {
  const { t } = useTranslation();
  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [showPay, setShowPay] = useState(false);
  const [receipts, setReceipts] = useState([]);

  const load = async () => {
    setLoading(true);
    const res = await api.get(`/invoices/${invoiceId}`);
    if (res.success) setInv(res.data);
    setLoading(false);
    const rc = await api.get(`/receipts?invoice_id=${invoiceId}&limit=100`);
    if (rc.success) setReceipts(rc.data);
  };

  useEffect(() => { load(); }, [invoiceId]);

  const lineItems = inv ? (typeof inv.line_items === 'string' ? JSON.parse(inv.line_items || '[]') : (inv.line_items || [])) : [];
  const balanceDue = inv ? Math.max(0, Number(inv.total_amount) - Number(inv.paid_amount || 0)) : 0;
  const canPay = inv && !['void', 'paid'].includes(inv.status);

  const downloadPdf = () => api.download(`/invoices/${inv.id}/pdf`, `invoice-${inv.invoice_number}.pdf`);
  const downloadReceipt = (r) => api.download(`/receipts/${r.id}/pdf`, `receipt-${r.receipt_number}.pdf`);

  const doSend = async () => {
    setBusy('send');
    const res = await api.post(`/invoices/${inv.id}/send`, {});
    setBusy('');
    if (res.success) { await load(); onChanged?.(); }
  };
  const doVoid = async () => {
    if (!confirm(t('invoices.confirm_void'))) return;
    setBusy('void');
    const res = await api.post(`/invoices/${inv.id}/void`, {});
    setBusy('');
    if (res.success) { await load(); onChanged?.(); }
  };
  const doDuplicate = async () => {
    setBusy('dup');
    const res = await api.post(`/invoices/${inv.id}/duplicate`, {});
    setBusy('');
    if (res.success) { onChanged?.(); onClose(); }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg">
        {loading || !inv ? (
          <div style={{ padding: 40 }}><Loader /></div>
        ) : (
          <>
            <div className="modal-header">
              <div className="detail-title">
                <h2>{inv.invoice_number}</h2>
                <span className="status-badge" style={{ background: STATUS_COLORS[inv.status] + '20', color: STATUS_COLORS[inv.status] }}>
                  {t(`invoices.status.${inv.status}`)}
                </span>
              </div>
              <button className="modal-close" onClick={onClose}><Xmark /></button>
            </div>

            <div className="modal-body">
              {/* Action bar */}
              <div className="detail-actions">
                <button className="btn btn-outline btn-sm" onClick={downloadPdf}><Download /> {t('common.download')}</button>
                {inv.status === 'draft' && (
                  <button className="btn btn-outline btn-sm" onClick={doSend} disabled={busy === 'send'}>
                    {busy === 'send' ? <span className="spinner spinner-sm" /> : <><Send /> {t('invoices.send_invoice')}</>}
                  </button>
                )}
                {canPay && (
                  <button className="btn btn-primary btn-sm" onClick={() => setShowPay(true)}><DollarCircle /> {t('invoices.record_payment')}</button>
                )}
                <button className="btn btn-outline btn-sm" onClick={doDuplicate} disabled={busy === 'dup'}><Copy /> {t('common.duplicate')}</button>
                {inv.status !== 'void' && inv.status !== 'paid' && (
                  <button className="btn btn-ghost btn-sm danger-text" onClick={doVoid} disabled={busy === 'void'}><Trash /> {t('common.void')}</button>
                )}
              </div>

              {/* Parties + dates */}
              <div className="detail-grid">
                <div>
                  <h4 className="detail-label">{t('invoices.client')}</h4>
                  <div className="detail-strong">{inv.client_name}</div>
                  <div className="detail-muted">{inv.client_email}</div>
                </div>
                <div>
                  <h4 className="detail-label">{t('invoices.issue_date')}</h4>
                  <div>{fmtDate(inv.issue_date)}</div>
                  <h4 className="detail-label" style={{ marginTop: 8 }}>{t('invoices.due_date')}</h4>
                  <div>{fmtDate(inv.due_date)}</div>
                </div>
                <div className="detail-amounts">
                  <div className="totals-line"><span>{t('common.total')}</span><strong>{fmtCurrency(inv.total_amount, inv.currency)}</strong></div>
                  <div className="totals-line"><span>{t('invoices.paid_amount')}</span><span>{fmtCurrency(inv.paid_amount, inv.currency)}</span></div>
                  <div className="totals-line grand"><span>{t('invoices.balance_due')}</span><span>{fmtCurrency(balanceDue, inv.currency)}</span></div>
                </div>
              </div>

              {/* Line items */}
              <table className="data-table detail-items">
                <thead>
                  <tr>
                    <th>{t('invoices.description')}</th>
                    <th className="ta-r">{t('invoices.quantity')}</th>
                    <th className="ta-r">{t('invoices.unit_price')}</th>
                    <th className="ta-r">{t('invoices.tax_rate')}</th>
                    <th className="ta-r">{t('common.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((l, i) => (
                    <tr key={i}>
                      <td>{l.description}</td>
                      <td className="ta-r">{l.quantity}</td>
                      <td className="ta-r">{fmtCurrency(l.unit_price, inv.currency)}</td>
                      <td className="ta-r">{l.tax_rate || 0}%</td>
                      <td className="ta-r">{fmtCurrency((l.quantity * l.unit_price), inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Payments + receipts */}
              <div className="detail-section">
                <h4 className="detail-section-title">{t('invoices.payments_receipts')}</h4>
                {(!inv.payments || inv.payments.length === 0) ? (
                  <div className="detail-muted">{t('common.no_data')}</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('common.date')}</th>
                        <th>{t('payments.method')}</th>
                        <th className="ta-r">{t('common.amount')}</th>
                        <th>{t('payments.reference')}</th>
                        <th>{t('receipts.receipt')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.payments.map(p => {
                        const rec = receipts.find(r => String(r.payment_id) === String(p.id));
                        return (
                          <tr key={p.id}>
                            <td>{fmtDate(p.payment_date)}</td>
                            <td>{t(`payments.methods.${p.method}`)}</td>
                            <td className="ta-r">{fmtCurrency(p.amount, inv.currency)}</td>
                            <td>{p.reference || '—'}</td>
                            <td>
                              {rec ? (
                                <button className="link-btn" onClick={() => downloadReceipt(rec)}>
                                  <PrintingPage /> {rec.receipt_number}
                                </button>
                              ) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {inv.notes && (
                <div className="detail-section">
                  <h4 className="detail-section-title">{t('common.notes')}</h4>
                  <div className="detail-muted">{inv.notes}</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showPay && inv && (
        <RecordPaymentModal
          invoice={inv}
          onClose={() => setShowPay(false)}
          onSaved={async () => { setShowPay(false); await load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
