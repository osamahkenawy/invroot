import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { Plus, Xmark, SendMail, Check, Page, Trash } from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';

const STATUS_LIST = ['', 'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'];

export default function Quotes() {
  const { t } = useTranslation();
  const [quotes,   setQuotes]   = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [status,   setStatus]   = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detail,   setDetail]   = useState(null);

  const fetchQuotes = async () => {
    setLoading(true);
    const qs = status ? `status=${status}` : '';
    const res = await api.get(`/quotes?${qs}&limit=50`);
    if (res.success) { setQuotes(res.data); setTotal(res.total || res.data.length); }
    setLoading(false);
  };

  useEffect(() => { fetchQuotes(); }, [status]);

  const convertToInvoice = async (id) => {
    if (!confirm(t('quotes.confirm_convert'))) return;
    const res = await api.post(`/quotes/${id}/convert`, {});
    if (res.success) { alert(`${t('quotes.converted')}: ${res.invoice_number}`); fetchQuotes(); }
    else alert(res.message || 'Error');
  };

  const markStatus = async (id, s) => { await api.put(`/quotes/${id}`, { status: s }); fetchQuotes(); };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('quotes.title')}</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus /> {t('quotes.new')}
        </button>
      </div>

      <div className="card">
        <div className="card-toolbar">
          <div className="filter-tabs">
            {STATUS_LIST.map(s => (
              <button key={s} className={`filter-tab ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
                {s ? t(`quotes.status.${s}`) : t('common.all')}
              </button>
            ))}
          </div>
        </div>

        {loading ? <Loader fullPage /> : quotes.length === 0 ? (
          <div className="empty-state">
            <Page className="empty-state-icon" />
            <div className="empty-state-title">{t('quotes.empty_title')}</div>
            <div className="empty-state-sub">{t('quotes.empty_sub')}</div>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setShowForm(true)}>
              <Plus /> {t('quotes.new')}
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrapper mobile-hide-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('quotes.number')}</th>
                    <th>{t('invoices.client')}</th>
                    <th className="hide-mobile">{t('quotes.valid_until')}</th>
                    <th>{t('common.total')}</th>
                    <th>{t('common.status')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map(q => (
                    <tr key={q.id} className="row-clickable" onClick={() => setDetail(q)}>
                      <td className="td-mono">{q.quote_number}</td>
                      <td>{q.client_name}</td>
                      <td className="hide-mobile">{fmtDate(q.valid_until)}</td>
                      <td className="td-amount">{fmtCurrency(q.total_amount, q.currency)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <span className={`status-badge status-${q.status}`}>{t(`quotes.status.${q.status}`)}</span>
                      </td>
                      <td className="td-actions" onClick={e => e.stopPropagation()}>
                        {q.status === 'draft'  && <button className="btn btn-sm" onClick={() => markStatus(q.id,'sent')}><SendMail /></button>}
                        {q.status === 'sent'   && <button className="btn btn-sm btn-success" onClick={() => markStatus(q.id,'accepted')}><Check /></button>}
                        {q.status === 'sent'   && <button className="btn btn-sm btn-danger"  onClick={() => markStatus(q.id,'rejected')}><Xmark /></button>}
                        {['accepted','sent'].includes(q.status) && (
                          <button className="btn btn-sm btn-primary" onClick={() => convertToInvoice(q.id)}>
                            {t('quotes.convert_invoice')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-card-list">
              {quotes.map(q => (
                <div key={q.id} className="m-card" onClick={() => setDetail(q)}>
                  <div className="m-card-header">
                    <div>
                      <div className="m-card-title">{q.quote_number}</div>
                      <div className="m-card-sub">{q.client_name}</div>
                    </div>
                    <span className={`status-badge status-${q.status}`}>{t(`quotes.status.${q.status}`)}</span>
                  </div>
                  <div className="m-card-row">
                    <span className="m-card-label">{t('common.total')}</span>
                    <span className="m-card-val">{fmtCurrency(q.total_amount, q.currency)}</span>
                  </div>
                  <div className="m-card-row">
                    <span className="m-card-label">{t('quotes.valid_until')}</span>
                    <span className="m-card-val">{fmtDate(q.valid_until)}</span>
                  </div>
                  {['accepted','sent'].includes(q.status) && (
                    <div className="m-card-actions" onClick={e => e.stopPropagation()}>
                      <button className="btn btn-sm btn-primary" onClick={() => convertToInvoice(q.id)}>
                        {t('quotes.convert_invoice')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="pagination">
              <span>{t('common.showing')} {quotes.length} {t('common.of')} {total}</span>
            </div>
          </>
        )}
      </div>

      {showForm && (
        <QuoteFormModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); fetchQuotes(); }} />
      )}
      {detail && (
        <QuoteDetailModal quote={detail} onClose={() => setDetail(null)} onAction={() => { setDetail(null); fetchQuotes(); }} />
      )}

      <button className="fab" onClick={() => setShowForm(true)}><Plus /></button>
    </div>
  );
}

/* ── Quote Form Modal ──────────────────────────── */
function QuoteFormModal({ onClose, onSaved }) {
  const { t } = useTranslation();
  const [clients, setClients] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [form, setForm] = useState({
    client_id:'', valid_until:'', currency:'SAR', notes:'', discount_type:'amount', discount_value:0,
  });
  const [lines, setLines] = useState([{ description:'', quantity:1, unit_price:0, tax_rate:15 }]);

  useEffect(() => {
    api.get('/clients?limit=200').then(r => { if (r.success) setClients(r.data); });
    api.get('/catalog?limit=200').then(r => { if (r.success) setCatalog(r.data); });
    const d = new Date(); d.setDate(d.getDate()+30);
    setForm(f => ({ ...f, valid_until: d.toISOString().split('T')[0] }));
  }, []);

  const setF  = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setL  = (i,k,v) => setLines(ls => ls.map((l,idx) => idx===i ? {...l,[k]:v} : l));
  const addLine = () => setLines(ls => [...ls, { description:'', quantity:1, unit_price:0, tax_rate:15 }]);
  const remLine = i => setLines(ls => ls.filter((_,idx) => idx!==i));

  const subtotal = lines.reduce((s,l) => s + Number(l.quantity||0)*Number(l.unit_price||0), 0);
  const taxAmt   = lines.reduce((s,l) => s + Number(l.quantity||0)*Number(l.unit_price||0)*(Number(l.tax_rate||0)/100), 0);
  const discAmt  = form.discount_type==='percent' ? subtotal*Number(form.discount_value||0)/100 : Number(form.discount_value||0);
  const total    = subtotal + taxAmt - discAmt;

  const handleSave = async () => {
    if (!form.client_id) { setError(t('quotes.error_client')); return; }
    setSaving(true); setError('');
    const res = await api.post('/quotes', { ...form, line_items: lines });
    setSaving(false);
    if (res.success) onSaved(); else setError(res.message || 'Error');
  };

  return (
    <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth:680 }}>
        <div className="modal-header">
          <h2>{t('quotes.new')}</h2>
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
              <label>{t('quotes.valid_until')}</label>
              <input type="date" value={form.valid_until} onChange={setF('valid_until')} />
            </div>
            <div className="form-group">
              <label>{t('invoices.currency')}</label>
              <select value={form.currency} onChange={setF('currency')}>
                {['SAR','USD','EUR','AED','GBP','KWD'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginTop:8 }}>
            <label>{t('invoices.line_items')}</label>
            <div className="line-items-head">
              <span style={{ flex:3 }}>{t('invoices.description')}</span>
              <span>{t('invoices.qty')}</span>
              <span>{t('invoices.unit_price')}</span>
              <span>{t('invoices.tax')}%</span>
              <span></span>
            </div>
            {lines.map((line,i) => (
              <div key={i} className="line-item-row">
                <input style={{ flex:3 }} value={line.description} onChange={e=>setL(i,'description',e.target.value)} placeholder={t('invoices.description')} list={`cat-${i}`} />
                <datalist id={`cat-${i}`}>{catalog.map(x => <option key={x.id} value={x.name} />)}</datalist>
                <input type="number" min="0" value={line.quantity}   onChange={e=>setL(i,'quantity',  e.target.value)} style={{ width:60 }} />
                <input type="number" min="0" value={line.unit_price} onChange={e=>setL(i,'unit_price',e.target.value)} style={{ width:90 }} />
                <input type="number" min="0" max="100" value={line.tax_rate} onChange={e=>setL(i,'tax_rate',e.target.value)} style={{ width:60 }} />
                <button className="icon-btn danger" onClick={() => remLine(i)} disabled={lines.length===1}><Xmark /></button>
              </div>
            ))}
            <button className="btn btn-sm" style={{ marginTop:8 }} onClick={addLine}><Plus /> {t('invoices.add_line')}</button>
          </div>

          <div className="form-row" style={{ marginTop:16 }}>
            <div className="form-group">
              <label>{t('invoices.discount_type')}</label>
              <select value={form.discount_type} onChange={setF('discount_type')}>
                <option value="amount">{t('invoices.discount_fixed')}</option>
                <option value="percent">{t('invoices.discount_percent')}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t('invoices.discount_value')}</label>
              <input type="number" min="0" value={form.discount_value} onChange={setF('discount_value')} />
            </div>
            <div className="invoice-summary" style={{ flex:2 }}>
              <div className="summary-row"><span>{t('invoices.subtotal')}</span><span>{fmtCurrency(subtotal,form.currency)}</span></div>
              <div className="summary-row"><span>{t('invoices.tax')}</span><span>{fmtCurrency(taxAmt,form.currency)}</span></div>
              {discAmt>0 && <div className="summary-row"><span>{t('invoices.discount')}</span><span>-{fmtCurrency(discAmt,form.currency)}</span></div>}
              <div className="summary-row total-row"><span>{t('common.total')}</span><span>{fmtCurrency(total,form.currency)}</span></div>
            </div>
          </div>

          <div className="form-group" style={{ marginTop:8 }}>
            <label>{t('invoices.notes')}</label>
            <textarea rows={2} value={form.notes} onChange={setF('notes')} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Quote Detail Modal ────────────────────────── */
function QuoteDetailModal({ quote, onClose, onAction }) {
  const { t } = useTranslation();
  const q = quote;
  const lines = typeof q.line_items==='string' ? JSON.parse(q.line_items||'[]') : (q.line_items||[]);

  const act = async (action) => {
    if (action==='convert') {
      if (!confirm(t('quotes.confirm_convert'))) return;
      const res = await api.post(`/quotes/${q.id}/convert`, {});
      if (res.success) { alert(`${t('quotes.converted')}: ${res.invoice_number}`); onAction(); }
      else alert(res.message);
    } else {
      await api.put(`/quotes/${q.id}`, { status: action });
      onAction();
    }
  };

  return (
    <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth:600 }}>
        <div className="modal-header">
          <div>
            <h2 style={{ marginBottom:4 }}>{q.quote_number}</h2>
            <span className={`status-badge status-${q.status}`}>{t(`quotes.status.${q.status}`)}</span>
          </div>
          <button className="modal-close" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body" style={{ overflowY:'auto', maxHeight:'calc(90vh - 160px)' }}>
          <div className="detail-grid" style={{ marginBottom:16 }}>
            <div><span className="detail-label">{t('invoices.client')}</span><span className="detail-value">{q.client_name}</span></div>
            <div><span className="detail-label">{t('quotes.valid_until')}</span><span className="detail-value">{fmtDate(q.valid_until)}</span></div>
            <div><span className="detail-label">{t('invoices.currency')}</span><span className="detail-value">{q.currency}</span></div>
          </div>
          <table className="data-table">
            <thead><tr>
              <th>{t('invoices.description')}</th><th>{t('invoices.qty')}</th>
              <th>{t('invoices.unit_price')}</th><th>{t('invoices.tax')}%</th><th>{t('common.total')}</th>
            </tr></thead>
            <tbody>
              {lines.map((l,i) => (
                <tr key={i}>
                  <td>{l.description}</td><td>{l.quantity}</td>
                  <td>{fmtCurrency(l.unit_price,q.currency)}</td><td>{l.tax_rate}%</td>
                  <td className="td-amount">{fmtCurrency(l.quantity*l.unit_price,q.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:12 }}>
            <div className="invoice-summary" style={{ minWidth:240 }}>
              <div className="summary-row"><span>{t('invoices.subtotal')}</span><span>{fmtCurrency(q.subtotal,q.currency)}</span></div>
              <div className="summary-row"><span>{t('invoices.tax')}</span><span>{fmtCurrency(q.tax_amount,q.currency)}</span></div>
              {Number(q.discount_amount)>0 && <div className="summary-row"><span>{t('invoices.discount')}</span><span>-{fmtCurrency(q.discount_amount,q.currency)}</span></div>}
              <div className="summary-row total-row"><span>{t('common.total')}</span><span>{fmtCurrency(q.total_amount,q.currency)}</span></div>
            </div>
          </div>
          {q.notes && <div style={{ marginTop:12, color:'var(--text-muted)', fontSize:13 }}>{q.notes}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
          {q.status==='draft'  && <button className="btn btn-primary" onClick={() => act('sent')}><SendMail /> {t('quotes.mark_sent')}</button>}
          {q.status==='sent'   && <button className="btn btn-success" onClick={() => act('accepted')}><Check /> {t('quotes.accept')}</button>}
          {q.status==='sent'   && <button className="btn btn-danger"  onClick={() => act('rejected')}><Xmark /> {t('quotes.reject')}</button>}
          {['accepted','sent'].includes(q.status) && (
            <button className="btn btn-primary" onClick={() => act('convert')}>{t('quotes.convert_invoice')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
