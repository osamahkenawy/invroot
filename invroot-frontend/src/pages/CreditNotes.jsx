import { useState, useEffect, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import { useToastContext } from '../context/ToastContext.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import {
  Plus, Xmark, RefreshDouble, Coins, CheckCircle, Clock,
  Check, Slash, Trash, Search, Page,
} from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import './Invoices.css';

/* Shares the invoice list chrome so all three billing documents read alike. */
const STATUS_COLORS = {
  draft:    { bg: '#f1f5f9', fg: '#64748b' },
  issued:   { bg: '#eff6ff', fg: '#2563eb' },
  applied:  { bg: '#f0fdf4', fg: '#16a34a' },
  voided:   { bg: '#f8fafc', fg: '#94a3b8' },
  refunded: { bg: '#f3e8ff', fg: '#7c3aed' },
};

const STATUS_LIST  = ['', 'issued', 'applied', 'voided'];
const REASON_CODES = ['return', 'overpayment', 'discount', 'error', 'goodwill', 'other'];

export default function CreditNotes() {
  const { t } = useTranslation();
  const { tenant } = useContext(AuthContext);
  const { showToast } = useToastContext();

  const [notes,   setNotes]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [status,  setStatus]  = useState('');
  const [search,  setSearch]  = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmState, setConfirmState] = useState(null); // { kind, note }
  const [busy, setBusy] = useState(false);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    const res = await api.get(
      `/credit-notes?page=${page}&limit=20${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`
    );
    if (res.success) { setNotes(res.data); setTotal(res.total ?? res.data.length); }
    setLoading(false);
  }, [page, status, search]);

  const loadSummary = useCallback(async () => {
    const res = await api.get('/credit-notes/summary');
    if (res.success) setSummary(res.data);
    setSummaryLoading(false);
  }, []);

  useEffect(() => { loadNotes(); },   [loadNotes]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const refresh = () => { loadNotes(); loadSummary(); };

  const doApply = async (n) => {
    setBusy(true);
    const res = await api.put(`/credit-notes/${n.id}/apply`, {});
    setBusy(false); setConfirmState(null);
    if (res.success) {
      const st = res.invoice_status ? t(`invoices.status.${res.invoice_status}`, res.invoice_status) : '';
      showToast(t('credit_notes.applied_toast', { status: st }));
      refresh();
    } else showToast(res.message || 'Could not apply the credit note.', 'error');
  };

  const doVoid = async (n) => {
    setBusy(true);
    const res = await api.put(`/credit-notes/${n.id}/void`, {});
    setBusy(false); setConfirmState(null);
    if (res.success) { showToast(t('credit_notes.voided_toast')); refresh(); }
    else showToast(res.message || 'Could not void the credit note.', 'error');
  };

  const doDelete = async (n) => {
    setBusy(true);
    const res = await api.delete(`/credit-notes/${n.id}`);
    setBusy(false); setConfirmState(null);
    if (res.success) { showToast(t('credit_notes.deleted_toast')); refresh(); }
    else showToast(res.message || 'Could not delete the credit note.', 'error');
  };

  const statusBadge = (st) => {
    const c = STATUS_COLORS[st] || STATUS_COLORS.draft;
    return (
      <span className="inv-badge" style={{ background: c.bg, color: c.fg }}>
        {t(`credit_notes.status.${st}`, { defaultValue: st })}
      </span>
    );
  };

  const cur = summary?.currency || tenant?.currency || 'SAR';
  const fmt = (v) => fmtCurrency(v || 0, cur);
  const byStatus = summary?.by_status || {};

  const confirmCopy = {
    apply:  { title: t('credit_notes.confirm_apply'),  message: t('credit_notes.confirm_apply_msg'),  label: t('credit_notes.apply'),  tone: 'primary' },
    void:   { title: t('credit_notes.confirm_void'),   message: t('credit_notes.confirm_void_msg'),   label: t('credit_notes.void'),   tone: 'danger'  },
    delete: { title: t('credit_notes.confirm_delete'), message: t('credit_notes.confirm_delete_msg'), label: t('common.delete'),       tone: 'danger'  },
  }[confirmState?.kind] || {};

  return (
    <div className="inv-page">

      {/* ── Summary ───────────────────────────────────── */}
      {!summaryLoading && summary && (
        <div className="inv-summary-row">
          <div className="inv-sum-card">
            <div className="inv-sum-icon blue"><Coins /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('credit_notes.total_issued')}</div>
              <div className="inv-sum-value">{fmt(summary.total_issued)}</div>
              <div className="inv-sum-sub">{summary.count || 0} {t('credit_notes.title').toLowerCase()}</div>
            </div>
          </div>
          <div className="inv-sum-card">
            <div className="inv-sum-icon green"><CheckCircle /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('credit_notes.total_applied')}</div>
              <div className="inv-sum-value">{fmt(summary.total_applied)}</div>
              <div className="inv-sum-sub">{byStatus.applied?.count || 0} {t('credit_notes.status.applied').toLowerCase()}</div>
            </div>
          </div>
          <div className="inv-sum-card">
            <div className="inv-sum-icon orange"><Clock /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('credit_notes.pending')}</div>
              <div className="inv-sum-value">{fmt(summary.total_pending)}</div>
              <div className="inv-sum-sub">{byStatus.issued?.count || 0} {t('credit_notes.status.issued').toLowerCase()}</div>
            </div>
          </div>
          <div className="inv-sum-card">
            <div className="inv-sum-icon red"><Slash /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('credit_notes.total_voided')}</div>
              <div className="inv-sum-value">{fmt(summary.total_voided)}</div>
              <div className="inv-sum-sub">{byStatus.voided?.count || 0} {t('credit_notes.status.voided').toLowerCase()}</div>
            </div>
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
                {s ? t(`credit_notes.status.${s}`) : t('common.all')}
                {st && <span className="inv-tab-count">{st.count}</span>}
              </button>
            );
          })}
        </div>
        <div className="inv-toolbar-right">
          <div className="inv-search">
            <Search width={14} height={14} />
            <input placeholder={t('credit_notes.search_placeholder')} value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <button className="inv-new-btn" onClick={() => setShowForm(true)}>
            <Plus /> {t('credit_notes.new')}
          </button>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────── */}
      <div className="inv-table-wrap">
        {loading ? <Loader fullPage /> : notes.length === 0 ? (
          <div className="empty-state">
            <RefreshDouble className="empty-state-icon" />
            <div className="empty-state-title">{t('credit_notes.empty_title')}</div>
            <div className="empty-state-sub">{t('credit_notes.empty_sub')}</div>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setShowForm(true)}>
              <Plus /> {t('credit_notes.new')}
            </button>
          </div>
        ) : (
          <table className="inv-table">
            <thead>
              <tr>
                <th>{t('credit_notes.number')}</th>
                <th>{t('invoices.client')}</th>
                <th>{t('credit_notes.linked_invoice')}</th>
                <th>{t('common.amount')}</th>
                <th>{t('credit_notes.reason')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.date')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notes.map(n => (
                <tr key={n.id} className={`inv-row${n.status === 'voided' ? ' cn-voided' : ''}`}>
                  <td className="inv-td-num">{n.cn_number}</td>
                  <td>{n.client_name}</td>
                  <td className="inv-td-num">{n.invoice_number || '—'}</td>
                  <td className="inv-td-amt">{fmtCurrency(n.amount, n.currency || cur)}</td>
                  <td>
                    {n.reason_code ? t(`credit_notes.reasons.${n.reason_code}`, { defaultValue: n.reason_code }) : '—'}
                    {n.reason ? <div className="cn-reason-note">{n.reason}</div> : null}
                  </td>
                  <td>{statusBadge(n.status)}</td>
                  <td className="inv-td-date">{fmtDate(n.created_at)}</td>
                  <td className="inv-td-actions">
                    {n.status === 'issued' && (
                      <button className="inv-act" title={t('credit_notes.apply')}
                        onClick={() => setConfirmState({ kind: 'apply', note: n })}><Check /></button>
                    )}
                    {n.status !== 'voided' && (
                      <button className="inv-act" title={t('credit_notes.void')}
                        onClick={() => setConfirmState({ kind: 'void', note: n })}><Slash /></button>
                    )}
                    {n.status !== 'applied' && (
                      <button className="inv-act danger" title={t('common.delete')}
                        onClick={() => setConfirmState({ kind: 'delete', note: n })}><Trash /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {notes.length > 0 && (
        <div className="inv-pager">
          <span>{t('common.showing')} {notes.length} {t('common.of')} {total}</span>
          <div>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span>{page} / {Math.ceil(total / 20) || 1}</span>
            <button disabled={notes.length < 20} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        </div>
      )}

      {showForm && (
        <CreditNoteModal
          onClose={() => setShowForm(false)}
          onSaved={(res) => {
            setShowForm(false);
            showToast(t('credit_notes.created_toast', { number: res?.cn_number || '' }));
            refresh();
          }} />
      )}

      <ConfirmDialog
        open={!!confirmState}
        tone={confirmCopy.tone}
        title={confirmCopy.title}
        message={confirmCopy.message}
        detail={confirmState?.note
          ? `${confirmState.note.cn_number} — ${fmtCurrency(confirmState.note.amount, confirmState.note.currency || cur)} — ${confirmState.note.invoice_number || ''}`
          : null}
        confirmLabel={confirmCopy.label}
        busy={busy}
        onConfirm={() => {
          const { kind, note } = confirmState;
          if (kind === 'apply')  return doApply(note);
          if (kind === 'void')   return doVoid(note);
          return doDelete(note);
        }}
        onCancel={() => setConfirmState(null)}
      />

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
  const [credited, setCredited] = useState(null);   // already credited on the picked invoice
  const [form, setForm] = useState({ invoice_id: '', amount: '', reason: '', reason_code: 'return' });

  useEffect(() => {
    api.get(`/invoices?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`).then(r => {
      // A draft has not been issued and a void invoice owes nothing, so neither
      // can be credited — the server rejects both.
      if (r.success) setInvoices(r.data.filter(i => !['draft', 'void'].includes(i.status)));
    });
  }, [search]);

  const selected = invoices.find(i => String(i.id) === String(form.invoice_id));

  // Ask the server what is genuinely left to credit — other notes may already
  // exist against this invoice, and the list row cannot know about them.
  useEffect(() => {
    if (!form.invoice_id) { setCredited(null); return; }
    api.get(`/credit-notes?invoice_id=${form.invoice_id}&limit=100`).then(r => {
      if (!r.success) return setCredited(0);
      setCredited(r.data
        .filter(n => n.status !== 'voided')
        .reduce((s, n) => s + Number(n.amount || 0), 0));
    });
  }, [form.invoice_id]);

  const invoiceTotal = selected ? Number(selected.total_amount) : 0;
  const remaining    = selected ? Math.max(0, invoiceTotal - (credited || 0)) : null;
  const overLimit    = remaining !== null && Number(form.amount) > remaining + 1e-6;

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    if (!form.invoice_id) { setError(t('credit_notes.error_invoice')); return; }
    if (!form.amount || Number(form.amount) <= 0) { setError(t('credit_notes.error_amount')); return; }
    setSaving(true); setError('');
    const res = await api.post('/credit-notes', { ...form, amount: Number(form.amount) });
    setSaving(false);
    if (res.success) onSaved(res); else setError(res.message || 'Error');
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2>{t('credit_notes.new')}</h2>
          <button className="modal-close" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

          <div className="form-group">
            <label>{t('credit_notes.search_invoice')}</label>
            <input className="search-input" placeholder={t('credit_notes.search_placeholder')}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="form-group">
            <label>{t('credit_notes.select_invoice')} *</label>
            <select value={form.invoice_id} onChange={setF('invoice_id')}>
              <option value="">— {t('common.select')} —</option>
              {invoices.map(i => (
                <option key={i.id} value={i.id}>
                  {i.invoice_number} — {i.client_name} ({fmtCurrency(i.total_amount, i.currency)})
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <div className="stats-row" style={{ marginBottom: 12 }}>
              <div className="stat-box">
                <div className="stat-box-label">{t('credit_notes.invoice_total')}</div>
                <div className="stat-box-val">{fmtCurrency(invoiceTotal, selected.currency)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">{t('credit_notes.already_credited')}</div>
                <div className="stat-box-val">{fmtCurrency(credited || 0, selected.currency)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-box-label">{t('credit_notes.max_credit')}</div>
                <div className="stat-box-val" style={{ color: 'var(--secondary)' }}>
                  {fmtCurrency(remaining, selected.currency)}
                </div>
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>{t('common.amount')} *</label>
              <input type="number" min="0.01" step="0.01" max={remaining ?? undefined}
                value={form.amount} onChange={setF('amount')} placeholder="0.00" />
              {overLimit && (
                <div className="form-error" style={{ marginTop: 6 }}>
                  {t('credit_notes.max_credit')}: {fmtCurrency(remaining, selected?.currency)}
                </div>
              )}
            </div>
            <div className="form-group" style={{ flex: 2 }}>
              <label>{t('credit_notes.reason_code')}</label>
              <select value={form.reason_code} onChange={setF('reason_code')}>
                {REASON_CODES.map(rc => (
                  <option key={rc} value={rc}>{t(`credit_notes.reasons.${rc}`, { defaultValue: rc })}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>{t('credit_notes.reason_note')}</label>
            <textarea rows={2} value={form.reason} onChange={setF('reason')}
              placeholder={t('credit_notes.reason_placeholder')} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || overLimit}>
            {saving ? t('common.saving') : t('credit_notes.issue')}
          </button>
        </div>
      </div>
    </div>
  );
}
