import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api.js';
import { fmtCurrency } from '../../utils/currency.js';
import { toInputDate } from '../../utils/date.js';
import { Xmark } from 'iconoir-react';

const METHODS = ['cash', 'bank_transfer', 'card', 'check', 'stripe', 'paypal', 'other'];

export default function RecordPaymentModal({ invoice, onClose, onSaved }) {
  const { t } = useTranslation();
  const balanceDue = Math.max(0, Number(invoice.total_amount) - Number(invoice.paid_amount || 0));

  const [form, setForm] = useState({
    amount: balanceDue || '',
    method: 'bank_transfer',
    payment_date: toInputDate(new Date()),
    reference: '',
    notes: '',
    bank_account_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState([]);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  /* Which account the money landed in. Recording a payment used to leave the
     banking module none the wiser — the invoice said paid, the bank balance
     never moved, and reconciling meant retyping every payment by hand. */
  useEffect(() => {
    api.get('/banking/accounts').then(r => {
      if (r.success) setAccounts((r.data || []).filter(a => a.is_active !== 0));
    });
  }, []);

  /* Only offer accounts in the invoice's currency. Crediting an AED payment to
     a USD account would put a number in the balance that means nothing. */
  const eligible = accounts.filter(a => !a.currency || !invoice.currency || a.currency === invoice.currency);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!(Number(form.amount) > 0)) return setError(t('payments.amount_error'));
    setSaving(true);
    try {
      const res = await api.post('/payments', {
        invoice_id: invoice.id,
        amount: Number(form.amount),
        method: form.method,
        payment_date: form.payment_date,
        reference: form.reference,
        notes: form.notes,
        /* Omitted rather than sent empty: no account chosen is a real state
           (cash in hand), not a validation failure. It shows up on the banking
           screen as still to reconcile. */
        ...(form.bank_account_id ? { bank_account_id: Number(form.bank_account_id) } : {}),
      });
      if (res.success) onSaved(res);
      else setError(res.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2>{t('invoices.record_payment')}</h2>
          <button className="modal-close" onClick={onClose}><Xmark /></button>
        </div>

        <div className="payment-summary">
          <div><span>{t('invoices.number')}</span><strong>{invoice.invoice_number}</strong></div>
          <div><span>{t('invoices.balance_due')}</span><strong>{fmtCurrency(balanceDue, invoice.currency)}</strong></div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <div className="form-group">
              <label>{t('common.amount')} *</label>
              <input type="number" min={0} step="any" value={form.amount} onChange={set('amount')} required />
            </div>
            <div className="form-group">
              <label>{t('payments.method')}</label>
              <select value={form.method} onChange={set('method')}>
                {METHODS.map(m => <option key={m} value={m}>{t(`payments.methods.${m}`)}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('common.date')}</label>
              <input type="date" value={form.payment_date} onChange={set('payment_date')} />
            </div>
            <div className="form-group">
              <label>{t('payments.reference')}</label>
              <input value={form.reference} onChange={set('reference')} />
            </div>
          </div>
          {/* Hidden entirely when there are no accounts — an empty dropdown
              teaching you a feature exists is noise on the way to recording a
              payment. */}
          {eligible.length > 0 && (
            <div className="form-group">
              <label>{t('payments.deposited_into')}</label>
              <select value={form.bank_account_id} onChange={set('bank_account_id')}>
                <option value="">{t('payments.no_account')}</option>
                {eligible.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.bank_name ? ` — ${a.bank_name}` : ''}
                  </option>
                ))}
              </select>
              <small className="form-hint">{t('payments.deposited_hint')}</small>
            </div>
          )}
          <div className="form-group">
            <label>{t('common.notes')}</label>
            <textarea rows={2} value={form.notes} onChange={set('notes')} />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner spinner-sm" /> : t('invoices.record_payment')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
