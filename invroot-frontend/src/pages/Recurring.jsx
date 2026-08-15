import { useState, useEffect, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import { useToastContext } from '../context/ToastContext.jsx';
import Loader from '../components/Loader.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import { Plus, Pause, Play, Xmark, RefreshDouble } from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import { CURRENCIES } from '../data/currencies.js';

export default function Recurring() {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const { tenant } = useContext(AuthContext);
  const [schedules, setSchedules] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);

  const fetch = () => {
    setLoading(true);
    api.get('/recurring').then(res => { if (res.success) setSchedules(res.data); setLoading(false); });
  };
  useEffect(() => { fetch(); }, []);

  const runAction = async (call, successKey) => {
    const res = await call;
    if (res?.success === false) return showToast(res.message || t('common.action_failed'), 'error');
    showToast(t(successKey));
    fetch();
  };
  const pause  = (id) => runAction(api.put(`/recurring/${id}/pause`),  'common.updated_success');
  const resume = (id) => runAction(api.put(`/recurring/${id}/resume`), 'common.updated_success');
  const cancel = (id) => {
    if (!confirm(t('recurring.confirm_cancel'))) return;
    runAction(api.delete(`/recurring/${id}`), 'common.deleted_success');
  };

  const active  = schedules.filter(s => s.status === 'active').length;
  const paused  = schedules.filter(s => s.status === 'paused').length;
  const monthlyRevenue = schedules.filter(s => s.status==='active').reduce((sum, s) => {
    const m = { daily:30, weekly:4.33, monthly:1, quarterly:1/3, yearly:1/12 };
    return sum + Number(s.total_amount) * (m[s.frequency] || 1);
  }, 0);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('recurring.title')}</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus /> {t('recurring.new')}
        </button>
      </div>

      {schedules.length > 0 && (
        <div className="stats-row" style={{ marginBottom:16 }}>
          <div className="stat-box">
            <div className="stat-box-label">{t('recurring.active_schedules')}</div>
            <div className="stat-box-val" style={{ color:'var(--success)' }}>{active}</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-label">{t('recurring.paused_schedules')}</div>
            <div className="stat-box-val" style={{ color:'var(--warning)' }}>{paused}</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-label">{t('recurring.monthly_revenue')}</div>
            <div className="stat-box-val">{fmtCurrency(monthlyRevenue, tenant?.currency)}</div>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? <Loader fullPage /> : schedules.length === 0 ? (
          <div className="empty-state">
            <RefreshDouble className="empty-state-icon" />
            <div className="empty-state-title">{t('recurring.empty_title')}</div>
            <div className="empty-state-sub">{t('recurring.empty_sub')}</div>
            <button className="btn btn-primary" style={{ marginTop:8 }} onClick={() => setShowForm(true)}>
              <Plus /> {t('recurring.new')}
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrapper mobile-hide-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('invoices.client')}</th>
                    <th>{t('recurring.frequency')}</th>
                    <th>{t('common.total')}</th>
                    <th className="hide-mobile">{t('recurring.next_billing')}</th>
                    <th className="hide-mobile">{t('recurring.end_date')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map(s => (
                    <tr key={s.id}>
                      <td>{s.client_name}</td>
                      <td>{t(`recurring.frequencies.${s.frequency}`, s.frequency)}</td>
                      <td className="td-amount">{fmtCurrency(s.total_amount, s.currency)}</td>
                      <td className="hide-mobile">{fmtDate(s.next_billing_date)}</td>
                      <td className="hide-mobile">{s.end_date ? fmtDate(s.end_date) : '∞'}</td>
                      <td><span className={`status-badge status-${s.status}`}>{t(`recurring.status.${s.status}`, s.status)}</span></td>
                      <td className="td-actions">
                        {s.status==='active' && <button className="icon-btn" title={t('recurring.pause')} onClick={() => pause(s.id)}><Pause /></button>}
                        {s.status==='paused' && <button className="icon-btn" title={t('recurring.resume')} onClick={() => resume(s.id)}><Play /></button>}
                        <button className="icon-btn danger" title={t('common.delete')} onClick={() => cancel(s.id)}><Xmark /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-card-list">
              {schedules.map(s => (
                <div key={s.id} className="m-card">
                  <div className="m-card-header">
                    <div>
                      <div className="m-card-title">{s.client_name}</div>
                      <div className="m-card-sub">{t(`recurring.frequencies.${s.frequency}`, s.frequency)}</div>
                    </div>
                    <span className={`status-badge status-${s.status}`}>{t(`recurring.status.${s.status}`, s.status)}</span>
                  </div>
                  <div className="m-card-row">
                    <span className="m-card-label">{t('common.total')}</span>
                    <span className="m-card-val">{fmtCurrency(s.total_amount, s.currency)}</span>
                  </div>
                  <div className="m-card-row">
                    <span className="m-card-label">{t('recurring.next_billing')}</span>
                    <span className="m-card-val">{fmtDate(s.next_billing_date)}</span>
                  </div>
                  <div className="m-card-actions">
                    {s.status==='active' && <button className="btn btn-sm" onClick={() => pause(s.id)}><Pause /> {t('recurring.pause')}</button>}
                    {s.status==='paused' && <button className="btn btn-sm btn-primary" onClick={() => resume(s.id)}><Play /> {t('recurring.resume')}</button>}
                    <button className="btn btn-sm btn-danger" onClick={() => cancel(s.id)}><Xmark /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="pagination"><span>{schedules.length} {t('recurring.schedules')}</span></div>
          </>
        )}
      </div>

      {showForm && (
        <RecurringFormModal onClose={() => setShowForm(false)} onSaved={() => {
          setShowForm(false);
          showToast(t('common.created_success'));
          fetch();
        }} />
      )}
      <button className="fab" onClick={() => setShowForm(true)}><Plus /></button>
    </div>
  );
}

/* ── Create Recurring Schedule Modal ────────── */
function RecurringFormModal({ onClose, onSaved }) {
  const { t } = useTranslation();
  const { tenant } = useContext(AuthContext);
  const [clients, setClients] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [form, setForm] = useState({
    client_id:'', frequency:'monthly', currency: tenant?.currency || 'SAR', start_date:'', end_date:'', notes:'',
    discount_type:'amount', discount_value:0,
  });
  const [lines, setLines] = useState([{ description:'', quantity:1, unit_price:0, tax_rate:15 }]);

  useEffect(() => {
    api.get('/clients?limit=200').then(r => { if (r.success) setClients(r.data); });
    api.get('/catalog?limit=200').then(r => { if (r.success) setCatalog(r.data); });
    const today = new Date().toISOString().split('T')[0];
    setForm(f => ({ ...f, start_date: today }));
  }, []);

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setL = (i,k,v) => setLines(ls => ls.map((l,idx) => idx===i ? {...l,[k]:v} : l));
  const addLine = () => setLines(ls => [...ls, { description:'', quantity:1, unit_price:0, tax_rate:15 }]);
  const remLine = i => setLines(ls => ls.filter((_,idx) => idx!==i));

  const subtotal = lines.reduce((s,l) => s + Number(l.quantity||0)*Number(l.unit_price||0), 0);
  const taxAmt   = lines.reduce((s,l) => s + Number(l.quantity||0)*Number(l.unit_price||0)*(Number(l.tax_rate||0)/100), 0);
  const discAmt  = form.discount_type==='percent' ? subtotal*Number(form.discount_value||0)/100 : Number(form.discount_value||0);
  const total    = subtotal + taxAmt - discAmt;

  const handleSave = async () => {
    if (!form.client_id) { setError(t('recurring.error_client')); return; }
    if (!lines.length)   { setError(t('recurring.error_lines')); return; }
    setSaving(true); setError('');
    const res = await api.post('/recurring', { ...form, line_items: lines });
    setSaving(false);
    if (res.success) onSaved(); else setError(res.message || 'Error');
  };

  const FREQS = ['daily','weekly','monthly','quarterly','yearly'];

  return (
    <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth:660 }}>
        <div className="modal-header">
          <h2>{t('recurring.new')}</h2>
          <button className="modal-close" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body" style={{ overflowY:'auto', maxHeight:'calc(90vh - 140px)' }}>
          {error && <div className="form-error" style={{ marginBottom:12 }}>{error}</div>}

          <div className="form-row">
            <div className="form-group" style={{ flex:2 }}>
              <label>{t('invoices.client')} *</label>
              <select value={form.client_id} onChange={setF('client_id')}>
                <option value="">— {t('common.select')} —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('recurring.frequency')}</label>
              <select value={form.frequency} onChange={setF('frequency')}>
                {FREQS.map(f => <option key={f} value={f}>{t(`recurring.frequencies.${f}`, f)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('common.currency')}</label>
              <select value={form.currency} onChange={setF('currency')}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t('recurring.start_date')}</label>
              <input type="date" value={form.start_date} onChange={setF('start_date')} />
            </div>
            <div className="form-group">
              <label>{t('recurring.end_date')} ({t('common.optional')})</label>
              <input type="date" value={form.end_date} onChange={setF('end_date')} />
            </div>
          </div>

          <div className="form-group">
            <label>{t('invoices.line_items')}</label>
            <div className="line-items-head">
              <span style={{ flex:3 }}>{t('invoices.description')}</span>
              <span>{t('invoices.quantity')}</span>
              <span>{t('invoices.unit_price')}</span>
              <span>{t('invoices.tax_rate')} %</span>
              <span></span>
            </div>
            {lines.map((line,i) => (
              <div key={i} className="line-item-row">
                <input style={{ flex:3 }} value={line.description} onChange={e=>setL(i,'description',e.target.value)} placeholder={t('invoices.description')} list={`rcat-${i}`} />
                <datalist id={`rcat-${i}`}>{catalog.map(x => <option key={x.id} value={x.name} />)}</datalist>
                <input type="number" min="0" value={line.quantity}   onChange={e=>setL(i,'quantity',  e.target.value)} style={{ width:60 }} />
                <input type="number" min="0" value={line.unit_price} onChange={e=>setL(i,'unit_price',e.target.value)} style={{ width:90 }} />
                <input type="number" min="0" max="100" value={line.tax_rate} onChange={e=>setL(i,'tax_rate',e.target.value)} style={{ width:60 }} />
                <button className="icon-btn danger" onClick={() => remLine(i)} disabled={lines.length===1}><Xmark /></button>
              </div>
            ))}
            <button className="btn btn-sm" style={{ marginTop:8 }} onClick={addLine}><Plus /> {t('invoices.add_item')}</button>
          </div>

          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:12 }}>
            <div className="invoice-summary" style={{ minWidth:220 }}>
              <div className="summary-row"><span>{t('invoices.sub_total')}</span><span>{fmtCurrency(subtotal,form.currency)}</span></div>
              <div className="summary-row"><span>{t('invoices.tax_rate')}</span><span>{fmtCurrency(taxAmt,form.currency)}</span></div>
              <div className="summary-row total-row"><span>{t('common.total')} / {t(`recurring.frequencies.${form.frequency}`,form.frequency)}</span><span>{fmtCurrency(total,form.currency)}</span></div>
            </div>
          </div>

          <div className="form-group" style={{ marginTop:8 }}>
            <label>{t('common.notes')}</label>
            <textarea rows={2} value={form.notes} onChange={setF('notes')} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('recurring.create_schedule')}
          </button>
        </div>
      </div>
    </div>
  );
}
