import { useState, useEffect, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import { useToastContext } from '../context/ToastContext.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import {
  Plus, Xmark, SendMail, Check, Page, Trash, Download, EditPencil,
  Coins, CheckCircle, Clock, WarningTriangle, Search, Eye, Copy,
} from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import './Invoices.css';
import '../components/invoices/InvoiceFormModal.css';

/* Shares the invoice list chrome (Invoices.css) so both documents read the
   same way — same cards, same toolbar, same table. */
const STATUS_COLORS = {
  draft:     { bg: '#f1f5f9', fg: '#64748b' },
  sent:      { bg: '#eff6ff', fg: '#2563eb' },
  viewed:    { bg: '#f3e8ff', fg: '#7c3aed' },
  accepted:  { bg: '#f0fdf4', fg: '#16a34a' },
  rejected:  { bg: '#fef2f2', fg: '#dc2626' },
  expired:   { bg: '#f8fafc', fg: '#94a3b8' },
  converted: { bg: '#ecfeff', fg: '#0891b2' },
};

const PIPELINE = [
  { key: 'draft',     color: '#94a3b8' },
  { key: 'sent',      color: '#3b82f6' },
  { key: 'accepted',  color: '#16a34a' },
  { key: 'rejected',  color: '#ef4444' },
  { key: 'expired',   color: '#f59e0b' },
  { key: 'converted', color: '#0891b2' },
];

const STATUS_LIST = ['', 'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'];

export default function Quotes() {
  const { t } = useTranslation();
  const { tenant } = useContext(AuthContext);
  const { showToast } = useToastContext();
  const [confirmState, setConfirmState] = useState(null); // { kind, quote }
  const [busy,     setBusy]     = useState(false);
  const [quotes,   setQuotes]   = useState([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(true);
  const [status,   setStatus]   = useState('');
  const [search,   setSearch]   = useState('');
  const [summary,  setSummary]  = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [detail,   setDetail]   = useState(null);

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    const res = await api.get(
      `/quotes?page=${page}&limit=20${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`
    );
    if (res.success) { setQuotes(res.data); setTotal(res.total ?? res.data.length); }
    setLoading(false);
  }, [page, status, search]);

  const fetchSummary = useCallback(async () => {
    const res = await api.get('/quotes/summary');
    if (res.success) setSummary(res.data);
    setSummaryLoading(false);
  }, []);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const refresh = () => { fetchQuotes(); fetchSummary(); };

  const openEditor = async (q) => {
    const res = await api.get(`/quotes/${q.id}`);
    if (res.success) setEditing(res.data);
    else showToast(res.message || 'Could not load the quote.', 'error');
  };

  const downloadPdf = (q) => api.download(`/quotes/${q.id}/pdf`, `quote-${q.quote_number}.pdf`);

  const doDelete = async (q) => {
    setBusy(true);
    const res = await api.delete(`/quotes/${q.id}`);
    setBusy(false); setConfirmState(null);
    if (res.success) { showToast(`Quote ${q.quote_number} deleted.`); refresh(); }
    else showToast(res.message || 'Could not delete the quote.', 'error');
  };

  const doConvert = async (q) => {
    setBusy(true);
    const res = await api.post(`/quotes/${q.id}/convert`, {});
    setBusy(false); setConfirmState(null);
    if (res.success) { showToast(`Converted to invoice ${res.invoice_number}.`); refresh(); }
    else showToast(res.message || 'Could not convert the quote.', 'error');
  };

  const markStatus = async (id, s) => {
    const res = await api.put(`/quotes/${id}/status`, { status: s });
    if (res.success) { showToast(`Quote marked ${s}.`); refresh(); }
    else showToast(res.message || 'Could not update the quote.', 'error');
  };

  const statusBadge = (st) => {
    const c = STATUS_COLORS[st] || STATUS_COLORS.draft;
    return (
      <span className="inv-badge" style={{ background: c.bg, color: c.fg }}>
        {t(`quotes.status.${st}`, { defaultValue: st })}
      </span>
    );
  };

  const fmt = (v) => fmtCurrency(v || 0, summary?.currency || tenant?.currency || 'SAR');
  const byStatus  = summary?.by_status || {};
  const countOf   = k => byStatus[k]?.count || 0;
  const amountOf  = k => byStatus[k]?.amount || 0;
  const quoteCount = Object.values(byStatus).reduce((s, b) => s + (b.count || 0), 0);
  const openCount  = countOf('draft') + countOf('sent') + countOf('viewed');
  const lostAmount = amountOf('rejected') + amountOf('expired');
  const maxPipe = Math.max(...PIPELINE.map(x => amountOf(x.key)), 1);

  return (
    <div className="inv-page">

      {/* ── Summary ───────────────────────────────────── */}
      {!summaryLoading && summary && (
        <div className="inv-summary-row">
          <div className="inv-sum-card">
            <div className="inv-sum-icon blue"><Coins /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('quotes.total_quoted')}</div>
              <div className="inv-sum-value">{fmt(summary.grand_total)}</div>
              <div className="inv-sum-sub">{t('quotes.count_quotes', { count: quoteCount })}</div>
            </div>
          </div>
          <div className="inv-sum-card">
            <div className="inv-sum-icon green"><CheckCircle /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('quotes.accepted_amount')}</div>
              <div className="inv-sum-value">{fmt(amountOf('accepted') + amountOf('converted'))}</div>
              <div className="inv-sum-sub">{t('quotes.acceptance_rate', { pct: summary.acceptance_rate })}</div>
            </div>
          </div>
          <div className="inv-sum-card">
            <div className="inv-sum-icon orange"><Clock /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('quotes.awaiting_response')}</div>
              <div className="inv-sum-value">{fmt(summary.open_total)}</div>
              <div className="inv-sum-sub">{t('quotes.count_still_open', { count: openCount })}</div>
            </div>
          </div>
          <div className="inv-sum-card accent-red">
            <div className="inv-sum-icon red"><WarningTriangle /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('quotes.lost')}</div>
              <div className="inv-sum-value">{fmt(lostAmount)}</div>
              <div className="inv-sum-sub">{t('quotes.count_rejected_expired', { count: countOf('rejected'), count2: countOf('expired') })}</div>
            </div>
          </div>

          {/* Pipeline — the quote analogue of invoice aging */}
          <div className="inv-age-card">
            <div className="inv-age-title">
              <Page width={13} height={13} /> {t('quotes.pipeline')}
            </div>
            <div className="inv-age-bars">
              {PIPELINE.map(b => (
                <div key={b.key} className="inv-age-row">
                  <div className="inv-age-lbl">{t(`quotes.status.${b.key}`, { defaultValue: b.key })}</div>
                  <div className="inv-age-track">
                    <div className="inv-age-fill" style={{
                      width: `${Math.max((amountOf(b.key) / maxPipe) * 100, amountOf(b.key) > 0 ? 4 : 0)}%`,
                      background: b.color,
                    }} />
                  </div>
                  <div className="inv-age-amt" style={{ color: countOf(b.key) > 0 ? b.color : 'var(--text-muted)' }}>
                    {countOf(b.key) > 0 ? `${fmt(amountOf(b.key))} (${countOf(b.key)})` : '—'}
                  </div>
                </div>
              ))}
            </div>
            {summary.grand_total > 0 && (
              <div className="inv-cbar-wrap">
                <div className="inv-cbar-track">
                  <div className="inv-cbar-paid" style={{ width: `${((amountOf('accepted') + amountOf('converted')) / summary.grand_total) * 100}%` }} />
                  <div className="inv-cbar-pend" style={{ width: `${(summary.open_total / summary.grand_total) * 100}%` }} />
                  <div className="inv-cbar-over" style={{ width: `${(lostAmount / summary.grand_total) * 100}%` }} />
                </div>
                <div className="inv-cbar-legend">
                  <span><i style={{ background: '#16a34a' }} />{t('quotes.accepted_amount')}</span>
                  <span><i style={{ background: '#f59e0b' }} />{t('quotes.open')}</span>
                  <span><i style={{ background: '#ef4444' }} />{t('quotes.lost')}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Toolbar ───────────────────────────────────── */}
      <div className="inv-toolbar">
        <div className="inv-status-tabs">
          {STATUS_LIST.map(s => {
            const st = s && byStatus[s];
            return (
              <button key={s}
                className={`inv-tab${status === s ? ' active' : ''}`}
                onClick={() => { setStatus(s); setPage(1); }}>
                {s ? t(`quotes.status.${s}`, { defaultValue: s }) : t('common.all')}
                {st && <span className="inv-tab-count">{st.count}</span>}
              </button>
            );
          })}
        </div>
        <div className="inv-toolbar-right">
          <div className="inv-search">
            <Search width={14} height={14} />
            <input placeholder={t('quotes.search_placeholder')} value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <button className="inv-new-btn" onClick={() => setShowForm(true)}>
            <Plus /> {t('quotes.new')}
          </button>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────── */}
      <div className="inv-table-wrap">
        {loading ? <Loader fullPage /> : (
          <table className="inv-table">
            <thead>
              <tr>
                <th>#</th><th>{t('invoices.client')}</th><th>{t('quotes.col_issued')}</th><th>{t('quotes.valid_until')}</th>
                <th>{t('common.total')}</th><th>{t('common.status')}</th><th>{t('quotes.col_links')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 && (
                <tr><td colSpan={8} className="inv-empty-row">{t('quotes.none_found')}</td></tr>
              )}
              {quotes.map(q => {
                const expiringSoon = q.valid_until && !['accepted','converted','rejected','expired'].includes(q.status)
                  ? Math.ceil((new Date(q.valid_until) - new Date()) / 86400000)
                  : null;
                return (
                  <tr key={q.id} className="inv-row" onClick={() => setDetail(q)}>
                    <td className="inv-td-num">{q.quote_number}</td>
                    <td>{q.client_name}</td>
                    <td className="inv-td-date">{fmtDate(q.created_at)}</td>
                    <td className="inv-td-date">
                      <div>{fmtDate(q.valid_until)}</div>
                      {expiringSoon !== null && expiringSoon <= 7 && (
                        <div className="inv-late">
                          {expiringSoon < 0
                            ? t('quotes.days_overdue', { days: Math.abs(expiringSoon) })
                            : t('quotes.days_left', { days: expiringSoon })}
                        </div>
                      )}
                    </td>
                    <td className="inv-td-amt">{fmtCurrency(q.total_amount, q.currency)}</td>
                    <td>{statusBadge(q.status)}</td>
                    <td className="inv-td-links" onClick={e => e.stopPropagation()}>
                      {q.converted_invoice_id && <span className="inv-pill q" title={t('quotes.link_converted')}>INV</span>}
                      {Number(q.deposit_required) > 0 && <span className="inv-pill py" title={t('quotes.link_deposit')}>D</span>}
                    </td>
                    <td className="inv-td-actions" onClick={e => e.stopPropagation()}>
                      <button className="inv-act" title={t('common.view')} onClick={() => setDetail(q)}><Eye /></button>
                      {q.status !== 'converted' && (
                        <button className="inv-act" title={t('common.edit')} onClick={() => openEditor(q)}><EditPencil /></button>
                      )}
                      <button className="inv-act" title={t('common.download_pdf')} onClick={() => downloadPdf(q)}><Download /></button>
                      {q.status === 'draft' && (
                        <button className="inv-act" title={t('quotes.mark_sent')} onClick={() => markStatus(q.id, 'sent')}><SendMail /></button>
                      )}
                      {q.status === 'sent' && (
                        <button className="inv-act" title={t('quotes.accept')} onClick={() => markStatus(q.id, 'accepted')}><Check /></button>
                      )}
                      {q.status === 'sent' && (
                        <button className="inv-act" title={t('quotes.reject')} onClick={() => markStatus(q.id, 'rejected')}><Xmark /></button>
                      )}
                      {['accepted','sent'].includes(q.status) && (
                        <button className="inv-act" title={t('quotes.convert_invoice')} onClick={() => setConfirmState({ kind: 'convert', quote: q })}><Page /></button>
                      )}
                      {q.status !== 'converted' && (
                        <button className="inv-act danger" title={t('common.delete')} onClick={() => setConfirmState({ kind: 'delete', quote: q })}><Trash /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="inv-pager">
        <span>{t('common.showing')} {quotes.length} {t('common.of')} {total}</span>
        <div>
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
          <span>{t('common.page')} {page} / {Math.ceil(total / 20) || 1}</span>
          <button disabled={quotes.length < 20} onClick={() => setPage(p => p + 1)}>›</button>
        </div>
      </div>

      {(showForm || editing) && (
        <QuoteFormModal
          key={editing?.id || 'new'}
          quote={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={(res, wasEdit) => {
            const num = res?.quote_number || editing?.quote_number || '';
            setShowForm(false); setEditing(null);
            showToast(`Quote ${num} ${wasEdit ? 'updated' : 'created'} successfully.`.replace(/\s+/g, ' '));
            refresh();
          }} />
      )}
      {detail && (
        <QuoteDetailModal
          quote={detail}
          onClose={() => setDetail(null)}
          onAction={() => { setDetail(null); refresh(); }}
          onEdit={(q) => { setDetail(null); openEditor(q); }} />
      )}

      <ConfirmDialog
        open={!!confirmState}
        tone={confirmState?.kind === 'delete' ? 'danger' : 'primary'}
        title={confirmState?.kind === 'delete' ? 'Delete this quote?' : 'Convert to invoice?'}
        message={confirmState?.kind === 'delete'
          ? 'This permanently removes the quote. Quotes already converted to an invoice cannot be deleted.'
          : 'A new draft invoice will be created from this quote. The quote is then locked and can no longer be edited.'}
        detail={confirmState?.quote
          ? `${confirmState.quote.quote_number} — ${confirmState.quote.client_name || 'client'} — ${fmtCurrency(confirmState.quote.total_amount, confirmState.quote.currency)}`
          : null}
        confirmLabel={confirmState?.kind === 'delete' ? 'Delete quote' : 'Create invoice'}
        busy={busy}
        onConfirm={() => confirmState?.kind === 'delete'
          ? doDelete(confirmState.quote)
          : doConvert(confirmState.quote)}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

/* ── Quote Form Modal ──────────────────────────── */
function QuoteFormModal({ quote, onClose, onSaved }) {
  const { t } = useTranslation();
  const { tenant } = useContext(AuthContext);
  const isEdit = !!quote;
  const [clients, setClients] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [form, setForm] = useState({
    client_id:      quote?.client_id      || '',
    valid_until:    quote?.valid_until    ? String(quote.valid_until).split('T')[0] : '',
    currency:       quote?.currency       || tenant?.currency || 'SAR',
    notes:          quote?.notes          || '',
    discount_type:  quote?.discount_type  || 'fixed',
    discount_value: quote?.discount_value || 0,
  });
  const [lines, setLines] = useState(() => {
    const existing = Array.isArray(quote?.line_items) ? quote.line_items : [];
    return existing.length
      ? existing.map(l => ({
          description: l.description || '',
          quantity:    Number(l.quantity)   || 1,
          unit_price:  Number(l.unit_price) || 0,
          tax_rate:    Number(l.tax_rate)   || 0,
        }))
      : [{ description:'', quantity:1, unit_price:0, tax_rate:15 }];
  });

  useEffect(() => {
    api.get('/clients?limit=200').then(r => { if (r.success) setClients(r.data); });
    api.get('/catalog?limit=200').then(r => { if (r.success) setCatalog(r.data); });
    // Only default the validity window for new quotes — editing must keep the
    // date the user already agreed with the client.
    if (!isEdit) {
      const d = new Date(); d.setDate(d.getDate()+30);
      setForm(f => ({ ...f, valid_until: d.toISOString().split('T')[0] }));
    }
  }, [isEdit]);

  /* Clear the complaint the moment the reader acts on it. Otherwise "Please
     select a client." sat there in red with a client plainly selected,
     which reads as a second, unexplained failure. */
  const setF  = k => e => { setError(''); setForm(f => ({ ...f, [k]: e.target.value })); };
  const setL  = (i,k,v) => { setError(''); setLines(ls => ls.map((l,idx) => idx===i ? {...l,[k]:v} : l)); };
  const addLine = () => setLines(ls => [...ls, { description:'', quantity:1, unit_price:0, tax_rate:15 }]);
  const dupLine = i => setLines(ls => [...ls.slice(0,i+1), { ...ls[i] }, ...ls.slice(i+1)]);
  const pickCatalog = (i, catalogId) => {
    const item = catalog.find(c => String(c.id) === String(catalogId));
    if (!item) return;
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l,
      description: item.name,
      unit_price:  Number(item.unit_price ?? item.price ?? 0),
      tax_rate:    item.tax_rate != null && item.tax_rate !== ''
        ? Number(item.tax_rate) : l.tax_rate,
    } : l));
  };
  const remLine = i => setLines(ls => ls.filter((_,idx) => idx!==i));

  const subtotal = lines.reduce((s,l) => s + Number(l.quantity||0)*Number(l.unit_price||0), 0);
  const taxAmt   = lines.reduce((s,l) => s + Number(l.quantity||0)*Number(l.unit_price||0)*(Number(l.tax_rate||0)/100), 0);
  // Mirror the server's clamping (routes/quotes.js computeTotals) so the preview
  // can never disagree with what actually gets stored.
  const discAmt  = form.discount_type==='percent'
    ? subtotal*Number(form.discount_value||0)/100
    : Math.min(Number(form.discount_value||0), subtotal);
  const total    = Math.max(0, subtotal + taxAmt - discAmt);

  const handleSave = async () => {
    if (!form.client_id) { setError(t('quotes.error_client')); return; }
    if (!lines.some(l => String(l.description || '').trim() && Number(l.quantity) > 0)) {
      setError(t('invoices.error_line_items', 'Add at least one line item with a description and quantity.'));
      return;
    }
    setSaving(true); setError('');
    const payload = { ...form, line_items: lines };
    const res = isEdit
      ? await api.put(`/quotes/${quote.id}`, payload)
      : await api.post('/quotes', payload);
    setSaving(false);
    if (res.success) onSaved(res, isEdit); else setError(res.message || 'Error');
  };

  return (
    <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth:860 }}>
        <div className="modal-header">
          <h2>{isEdit ? `${t('common.edit')} ${quote.quote_number}` : t('quotes.new')}</h2>
          <button className="modal-close" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body" style={{ overflowY:'auto', maxHeight:'calc(90vh - 140px)' }}>
          {/* `form-error` was never a class this app defines, so "Please select
              a client." rendered as unstyled black text at the top of the
              dialog — indistinguishable from a heading, and nowhere near the
              field it is about. `alert alert-error` is the real style, and it
              sits beside the control that failed. */}
          {error && <div className="alert alert-error" style={{ marginBottom:14 }}>{error}</div>}
          <div className="form-row">
            <div className="form-group" style={{ flex:2 }}>
              <label>{t('invoices.client')} *</label>
              <select value={form.client_id} onChange={setF('client_id')}
                      className={error && !form.client_id ? 'is-invalid' : ''}>
                <option value="">— {t('common.select')} —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('quotes.valid_until')}</label>
              <input type="date" value={form.valid_until} onChange={setF('valid_until')} />
            </div>
            <div className="form-group">
              <label>{t('common.currency')}</label>
              <select value={form.currency} onChange={setF('currency')}>
                {['SAR','USD','EUR','AED','GBP','KWD'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginTop:8 }}>
            <label>{t('invoices.line_items')}</label>
            {/* Same line-item grid as the invoice editor (InvoiceFormModal.css).
                `qt-items` is the difference that matters: the invoice editor is
                a full-screen sheet and always has room for these columns, while
                this is an 860px dialog. In a narrower window the row needed
                more width than it had and `overflow-x: hidden` silently cut off
                the right-hand column — AMOUNT, the money. It scrolls now. */}
            <div className="inv-items-section qt-items">
              <div className="inv-items-head">
                <span className="inv-col-name">{t('invoices.description')}</span>
                <span className="inv-col-qty">{t('invoices.quantity')}</span>
                <span className="inv-col-rate">{t('invoices.unit_price')}</span>
                <span className="inv-col-tax">{t('invoices.tax_rate')} %</span>
                <span className="inv-col-amt">{t('common.amount')}</span>
                <span className="inv-col-actions" />
              </div>

              {lines.map((line, i) => {
                const lineTotal = (Number(line.quantity)||0) * (Number(line.unit_price)||0);
                return (
                  <div className="inv-item-row" key={i}>
                    <div className="inv-col-name">
                      <input
                        className="inv-item-desc"
                        placeholder={t('invoices.description')}
                        value={line.description}
                        onChange={e => setL(i,'description',e.target.value)}
                      />
                      {catalog.length > 0 && (
                        <select className="inv-catalog-pick" defaultValue=""
                          onChange={e => { pickCatalog(i, e.target.value); e.target.value = ''; }}>
                          <option value="">+ {t('invoices.from_catalog')}</option>
                          {catalog.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                    </div>
                    <input className="inv-col-qty inv-num-input" type="number" min={0} step="any"
                      value={line.quantity} onChange={e => setL(i,'quantity',e.target.value)} />
                    <div className="inv-rate-cell">
                      <input className="inv-col-rate inv-num-input" type="number" min={0} step="any"
                        value={line.unit_price} onChange={e => setL(i,'unit_price',e.target.value)} />
                      <span className="inv-currency-tag">{form.currency}</span>
                    </div>
                    <input className="inv-col-tax inv-num-input" type="number" min={0} max={100} step="any"
                      value={line.tax_rate} onChange={e => setL(i,'tax_rate',e.target.value)} />
                    <span className="inv-col-amt inv-line-total">{fmtCurrency(lineTotal, form.currency)}</span>
                    <div className="inv-col-actions">
                      <button type="button" className="icon-btn" title={t('common.duplicate', 'Duplicate')}
                        onClick={() => dupLine(i)}><Copy /></button>
                      <button type="button" className="icon-btn danger" title={t('common.delete')}
                        onClick={() => remLine(i)} disabled={lines.length === 1}><Trash /></button>
                    </div>
                  </div>
                );
              })}

              <button type="button" className="inv-new-line-btn" onClick={addLine}>
                <Plus /> {t('invoices.add_item')}
              </button>
            </div>
          </div>

          {/* Notes + discount on the left, money on the right — the invoice
              editor's own footer grid.

              The totals previously used `invoice-summary`/`summary-row`/
              `total-row`, none of which exist in any stylesheet. With no
              layout the label and figure collapsed into each other and the
              dialog read "SubtotalAED 1,000.00" — on the one part of the
              screen where the numbers have to be unambiguous. These are the
              real classes, so quote totals now render exactly like invoice
              totals. */}
          <div className="inv-footer-grid" style={{ marginTop:16 }}>
            <div className="inv-notes-col">
              <div className="inv-field">
                <label>{t('common.notes')}</label>
                <textarea rows={3} value={form.notes} onChange={setF('notes')} />
              </div>
              {/* `inv-field` styles the label and nothing else, so a bare
                  select/input here rendered as raw browser chrome — square
                  corners, native arrow — next to properly styled fields. The
                  controls carry their own classes. */}
              <div className="inv-field" style={{ marginTop:8 }}>
                <label>{t('common.discount')}</label>
                <div className="inv-discount-pair">
                  <select className="inv-select-sm inv-discount-type"
                          value={form.discount_type} onChange={setF('discount_type')}>
                    <option value="fixed">{form.currency}</option>
                    <option value="percent">%</option>
                  </select>
                  <input className="inv-input-sm inv-discount-value"
                         type="number" min="0" step="any" value={form.discount_value}
                         onChange={setF('discount_value')} />
                </div>
              </div>
            </div>

            <div className="inv-totals-col">
              <div className="inv-totals-row">
                <span>{t('common.subtotal')}</span>
                <span>{fmtCurrency(subtotal, form.currency)}</span>
              </div>
              {discAmt > 0 && (
                <div className="inv-totals-row">
                  <span>{t('common.discount')}</span>
                  <span>−{fmtCurrency(discAmt, form.currency)}</span>
                </div>
              )}
              {taxAmt > 0 && (
                <div className="inv-totals-row">
                  <span>
                    {t('common.tax')}
                    <span className="inv-tax-badge">
                      {lines.length === 1 ? `${lines[0].tax_rate || 0}%` : 'mixed'}
                    </span>
                  </span>
                  <span>{fmtCurrency(taxAmt, form.currency)}</span>
                </div>
              )}
              <div className="inv-totals-row inv-total-line">
                <span>{t('common.total')} ({form.currency})</span>
                <span>{fmtCurrency(total, form.currency)}</span>
              </div>
            </div>
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
function QuoteDetailModal({ quote, onClose, onAction, onEdit }) {
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
            <div><span className="detail-label">{t('common.currency')}</span><span className="detail-value">{q.currency}</span></div>
          </div>
          <table className="data-table">
            <thead><tr>
              <th>{t('invoices.description')}</th><th>{t('invoices.quantity')}</th>
              <th>{t('invoices.unit_price')}</th><th>{t('invoices.tax_rate')} %</th><th>{t('common.total')}</th>
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
              <div className="summary-row"><span>{t('common.subtotal')}</span><span>{fmtCurrency(q.subtotal,q.currency)}</span></div>
              <div className="summary-row"><span>{t('common.tax')}</span><span>{fmtCurrency(q.tax_amount,q.currency)}</span></div>
              {Number(q.discount_amount)>0 && <div className="summary-row"><span>{t('common.discount')}</span><span>-{fmtCurrency(q.discount_amount,q.currency)}</span></div>}
              <div className="summary-row total-row"><span>{t('common.total')}</span><span>{fmtCurrency(q.total_amount,q.currency)}</span></div>
            </div>
          </div>
          {q.notes && <div style={{ marginTop:12, color:'var(--text-muted)', fontSize:13 }}>{q.notes}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
          <button className="btn btn-outline" onClick={() => api.download(`/quotes/${q.id}/pdf`, `quote-${q.quote_number}.pdf`)}><Download /> PDF</button>
          {q.status!=='converted' && onEdit && (
            <button className="btn btn-outline" onClick={() => onEdit(q)}><EditPencil /> {t('common.edit')}</button>
          )}
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
