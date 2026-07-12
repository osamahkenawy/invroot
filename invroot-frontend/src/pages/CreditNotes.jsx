import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { Plus, Xmark, RefreshDouble } from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';

export default function CreditNotes() {
  const { t } = useTranslation();
  const [notes,    setNotes]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetch = () => {
    setLoading(true);
    api.get('/credit-notes').then(res => { if (res.success) setNotes(res.data); setLoading(false); });
  };
  useEffect(() => { fetch(); }, []);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('credit_notes.title')}</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus /> {t('credit_notes.new')}
        </button>
      </div>

      <div className="card">
        {loading ? <Loader fullPage /> : notes.length === 0 ? (
          <div className="empty-state">
            <RefreshDouble className="empty-state-icon" />
            <div className="empty-state-title">{t('credit_notes.empty_title')}</div>
            <div className="empty-state-sub">{t('credit_notes.empty_sub')}</div>
            <button className="btn btn-primary" style={{ marginTop:8 }} onClick={() => setShowForm(true)}>
              <Plus /> {t('credit_notes.new')}
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrapper mobile-hide-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('credit_notes.number')}</th>
                    <th>{t('invoices.client')}</th>
                    <th className="hide-mobile">{t('credit_notes.linked_invoice')}</th>
                    <th>{t('common.amount')}</th>
                    <th className="hide-mobile">{t('credit_notes.reason')}</th>
                    <th>{t('common.status')}</th>
                    <th className="hide-mobile">{t('common.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {notes.map(n => (
                    <tr key={n.id}>
                      <td className="td-mono">{n.cn_number}</td>
                      <td>{n.client_name}</td>
                      <td className="td-mono hide-mobile">{n.invoice_number || '—'}</td>
                      <td className="td-amount">{fmtCurrency(n.amount)}</td>
                      <td className="hide-mobile">{n.reason_code || n.reason || '—'}</td>
                      <td><span className={`status-badge status-${n.status}`}>{n.status}</span></td>
                      <td className="hide-mobile">{fmtDate(n.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-card-list">
              {notes.map(n => (
                <div key={n.id} className="m-card">
                  <div className="m-card-header">
                    <div>
                      <div className="m-card-title">{n.cn_number}</div>
                      <div className="m-card-sub">{n.client_name}</div>
                    </div>
                    <span className={`status-badge status-${n.status}`}>{n.status}</span>
                  </div>
                  <div className="m-card-row">
                    <span className="m-card-label">{t('common.amount')}</span>
                    <span className="m-card-val">{fmtCurrency(n.amount)}</span>
                  </div>
                  <div className="m-card-row">
                    <span className="m-card-label">{t('credit_notes.linked_invoice')}</span>
                    <span className="m-card-val">{n.invoice_number || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="pagination"><span>{t('common.showing')} {notes.length}</span></div>
          </>
        )}
      </div>

      {showForm && (
        <CreditNoteModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); fetch(); }} />
      )}
      <button className="fab" onClick={() => setShowForm(true)}><Plus /></button>
    </div>
  );
}

/* ── Create Credit Note Modal ──────────────────── */
function CreditNoteModal({ onClose, onSaved }) {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [form, setForm] = useState({
    invoice_id: '', amount: '', reason: '', reason_code: 'return',
  });

  useEffect(() => {
    api.get(`/invoices?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(r => {
      if (r.success) setInvoices(r.data.filter(i => !['draft','void'].includes(i.status)));
    });
  }, [search]);

  const selected = invoices.find(i => String(i.id) === String(form.invoice_id));
  const maxAmount = selected ? Math.max(0, Number(selected.total_amount) - Number(selected.paid_amount||0)) : null;

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    if (!form.invoice_id) { setError(t('credit_notes.error_invoice')); return; }
    if (!form.amount || Number(form.amount) <= 0) { setError(t('credit_notes.error_amount')); return; }
    setSaving(true); setError('');
    const res = await api.post('/credit-notes', form);
    setSaving(false);
    if (res.success) onSaved(); else setError(res.message || 'Error');
  };

  const REASON_CODES = ['return','overpayment','discount','error','goodwill','other'];

  return (
    <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth:520 }}>
        <div className="modal-header">
          <h2>{t('credit_notes.new')}</h2>
          <button className="modal-close" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error" style={{ marginBottom:12 }}>{error}</div>}

          <div className="form-group">
            <label>{t('credit_notes.search_invoice')}</label>
            <input
              className="search-input"
              placeholder={t('common.search') + ' invoice...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>{t('credit_notes.select_invoice')} *</label>
            <select value={form.invoice_id} onChange={setF('invoice_id')}>
              <option value="">— {t('common.select')} —</option>
              {invoices.map(i => (
                <option key={i.id} value={i.id}>
                  {i.invoice_number} — {i.client_name} ({fmtCurrency(i.total_amount,i.currency)})
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <div className="stats-row" style={{ marginBottom:12 }}>
              <div className="stat-box">
                <div className="stat-box-label">{t('invoices.total')}</div>
                <div className="stat-box-val">{fmtCurrency(selected.total_amount,selected.currency)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">{t('credit_notes.max_credit')}</div>
                <div className="stat-box-val" style={{ color:'var(--secondary)' }}>{fmtCurrency(maxAmount,selected.currency)}</div>
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group" style={{ flex:2 }}>
              <label>{t('common.amount')} *</label>
              <input type="number" min="0.01" step="0.01" max={maxAmount||undefined}
                value={form.amount} onChange={setF('amount')} placeholder="0.00" />
            </div>
            <div className="form-group" style={{ flex:2 }}>
              <label>{t('credit_notes.reason_code')}</label>
              <select value={form.reason_code} onChange={setF('reason_code')}>
                {REASON_CODES.map(rc => <option key={rc} value={rc}>{t(`credit_notes.reasons.${rc}`, rc)}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>{t('credit_notes.reason_note')}</label>
            <textarea rows={2} value={form.reason} onChange={setF('reason')} placeholder={t('credit_notes.reason_placeholder')} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('credit_notes.issue')}
          </button>
        </div>
      </div>
    </div>
  );
}
