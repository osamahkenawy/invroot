import { useState, useEffect, useCallback, useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import { useToastContext } from '../context/ToastContext.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import {
  Plus, Search, Eye, Download, EditPencil, Coins, CheckCircle,
  WarningTriangle, Clock, Link as LinkIcon, Upload
} from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import InvoiceFormModal from '../components/invoices/InvoiceFormModal.jsx';
import InvoiceDetailModal from '../components/invoices/InvoiceDetailModal.jsx';
import ImportInvoicesModal from '../components/invoices/ImportInvoicesModal.jsx';
import InvoiceSavedModal from '../components/invoices/InvoiceSavedModal.jsx';
import './Invoices.css';

const STATUS_COLORS = {
  draft:   { bg: '#f1f5f9', fg: '#64748b' },
  sent:    { bg: '#eff6ff', fg: '#2563eb' },
  viewed:  { bg: '#f3e8ff', fg: '#7c3aed' },
  partial: { bg: '#fff7ed', fg: '#d97706' },
  paid:    { bg: '#f0fdf4', fg: '#16a34a' },
  overdue: { bg: '#fef2f2', fg: '#dc2626' },
  void:    { bg: '#f8fafc', fg: '#94a3b8' },
};

const AGE_COLORS = ['#3b82f6', '#f59e0b', '#f97316', '#ef4444', '#991b1b'];

export default function Invoices() {
  const { t } = useTranslation();
  const { tenant } = useContext(AuthContext);
  const { showToast } = useToastContext();
  const [invoices,       setInvoices]       = useState([]);
  const [total,          setTotal]          = useState(0);
  const [summary,        setSummary]        = useState(null);
  const [page,           setPage]           = useState(1);
  const [statusFilter,   setStatusFilter]   = useState('');
  const [search,         setSearch]         = useState('');
  const [loading,        setLoading]        = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [formModal,      setFormModal]      = useState(null);
  const [detailId,       setDetailId]       = useState(null);
  const [confirmEdit,    setConfirmEdit]    = useState(null); // invoice pending edit-confirm
  const [selected,       setSelected]       = useState(() => new Set()); // bulk-selected invoice ids
  const [bulkBusy,       setBulkBusy]       = useState(false);
  const [confirmBulk,    setConfirmBulk]    = useState(null); // pending destructive bulk action
  const [showImport,     setShowImport]     = useState(false);
  const [savedInvoice,   setSavedInvoice]   = useState(null); // just-created invoice → share/download

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(
        `/invoices?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`
      );
      if (res.success) { setInvoices(res.data); setTotal(res.total); }
    } finally { setLoading(false); }
  }, [page, statusFilter, search]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await api.get('/invoices/summary');
      if (res.success) setSummary(res.data);
    } finally { setSummaryLoading(false); }
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  /* Deep link: /invoices?open=123 opens that invoice directly.
     The dashboard's "Ready to bill" card creates a draft and sends you here —
     without this the param was ignored and you landed on an unfiltered list
     with no idea which of 145 invoices had just been made for you.
     The param is consumed so a later Back doesn't reopen the modal. */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const open = Number(searchParams.get('open'));
    if (!open) return;
    setDetailId(open);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleRefresh = () => { fetchInvoices(); fetchSummary(); };
  const handleDownloadPdf = (id, number) => api.download(`/invoices/${id}/pdf`, `invoice-${number}.pdf`);

  const copyPaymentLink = async (id) => {
    const res = await api.post(`/invoices/${id}/public-link`);
    if (res.success) {
      try { await navigator.clipboard.writeText(res.url); showToast(t('invoices.link_copied'), 'success'); }
      catch { showToast(res.url, 'success'); } // clipboard blocked — show the URL
    } else {
      showToast(res.message || t('common.save_failed'), 'error');
    }
  };

  // Reset the selection whenever the visible list changes (page/filter/search).
  useEffect(() => { setSelected(new Set()); }, [page, statusFilter, search]);

  const toggleOne = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allVisibleSelected = invoices.length > 0 && invoices.every(i => selected.has(i.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(invoices.map(i => i.id)));

  const runBulk = async (action) => {
    setBulkBusy(true);
    const res = await api.post('/invoices/bulk', { ids: [...selected], action });
    setBulkBusy(false);
    setConfirmBulk(null);
    if (res.success) {
      const verb = action === 'send' ? t('invoices.bulk_sent') : action === 'mark-paid' ? t('invoices.bulk_marked_paid') : t('invoices.bulk_voided');
      showToast(`${verb} (${res.affected})${res.failed ? ` · ${res.failed} ${t('invoices.bulk_failed')}` : ''}`, res.failed ? 'warning' : 'success');
      setSelected(new Set());
      handleRefresh();
    } else {
      showToast(res.message || t('common.save_failed'), 'error');
    }
  };
  // Send/mark-paid apply immediately; void asks for confirmation first.
  const onBulkAction = (action) => action === 'void' ? setConfirmBulk(action) : runBulk(action);

  // Editing an invoice that already has money against it can change what the
  // client owes, so confirm before opening the form.
  const openEdit = (inv) => {
    if (inv.status === 'void') {
      showToast(t('invoices.void_cannot_edit'), 'error');
      return;
    }
    if (['paid', 'partial'].includes(inv.status) || Number(inv.paid_amount) > 0) {
      setConfirmEdit(inv);
    } else {
      setFormModal(inv);
    }
  };

  const statusBadge = (status) => {
    const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
    return (
      <span className="inv-badge" style={{ background: c.bg, color: c.fg }}>
        {t(`invoices.status.${status}`, { defaultValue: status })}
      </span>
    );
  };

  const fmt = (v) => fmtCurrency(v || 0, summary?.currency || tenant?.currency || 'SAR');
  const maxAge = summary ? Math.max(...(summary.age_analysis || []).map(a => a.amount), 1) : 1;

  return (
    <div className="inv-page">

      {/* ── Financial Summary ─────────────────────────── */}
      {!summaryLoading && summary && (
        <div className="inv-summary-row">
          <div className="inv-sum-card">
            <div className="inv-sum-icon blue"><Coins /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('invoices.total_invoiced')}</div>
              <div className="inv-sum-value">{fmt(summary.grand_total)}</div>
              <div className="inv-sum-sub">
                {t('invoices.count_invoices', { count: Object.values(summary.by_status || {}).reduce((s, b) => s + (b.count || 0), 0) })}
              </div>
            </div>
          </div>
          <div className="inv-sum-card">
            <div className="inv-sum-icon green"><CheckCircle /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('invoices.total_collected')}</div>
              <div className="inv-sum-value">{fmt(summary.grand_paid)}</div>
              <div className="inv-sum-sub">
                {t('invoices.pct_of_total', { pct: summary.grand_total > 0 ? Math.round((summary.grand_paid / summary.grand_total) * 100) : 0 })}
              </div>
            </div>
          </div>
          <div className="inv-sum-card">
            <div className="inv-sum-icon orange"><Clock /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('invoices.outstanding')}</div>
              <div className="inv-sum-value">{fmt(summary.grand_outstanding)}</div>
              <div className="inv-sum-sub">{t('invoices.count_partially_paid', { count: summary.by_status?.partial?.count || 0 })}</div>
            </div>
          </div>
          <div className="inv-sum-card accent-red">
            <div className="inv-sum-icon red"><WarningTriangle /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">{t('invoices.overdue_amount')}</div>
              <div className="inv-sum-value">{fmt(summary.grand_overdue)}</div>
              <div className="inv-sum-sub">{t('invoices.count_past_due', { count: summary.by_status?.overdue?.count || 0 })}</div>
            </div>
          </div>

          {/* Age Analysis */}
          <div className="inv-age-card">
            <div className="inv-age-title">
              <WarningTriangle width={13} height={13} /> {t('invoices.aging_analysis')}
            </div>
            <div className="inv-age-bars">
              {(summary.age_analysis || []).map((a, i) => (
                <div key={a.bucket} className="inv-age-row">
                  <div className="inv-age-lbl">{t(`invoices.age_${a.bucket}`, { defaultValue: a.label })}</div>
                  <div className="inv-age-track">
                    <div className="inv-age-fill" style={{
                      width: `${Math.max((a.amount / maxAge) * 100, a.amount > 0 ? 4 : 0)}%`,
                      background: AGE_COLORS[i],
                    }} />
                  </div>
                  <div className="inv-age-amt" style={{ color: a.amount > 0 ? AGE_COLORS[i] : 'var(--text-muted)' }}>
                    {a.count > 0 ? `${fmt(a.amount)} (${a.count})` : '—'}
                  </div>
                </div>
              ))}
            </div>
            {summary.grand_total > 0 && (
              <div className="inv-cbar-wrap">
                <div className="inv-cbar-track">
                  <div className="inv-cbar-paid" style={{ width: `${(summary.grand_paid / summary.grand_total) * 100}%` }} />
                  <div className="inv-cbar-pend" style={{ width: `${((summary.grand_outstanding - summary.grand_overdue) / summary.grand_total) * 100}%` }} />
                  <div className="inv-cbar-over" style={{ width: `${(summary.grand_overdue / summary.grand_total) * 100}%` }} />
                </div>
                <div className="inv-cbar-legend">
                  <span><i style={{ background: '#16a34a' }} />{t('common.paid')}</span>
                  <span><i style={{ background: '#f59e0b' }} />{t('invoices.outstanding')}</span>
                  <span><i style={{ background: '#ef4444' }} />{t('invoices.overdue_amount')}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Toolbar ───────────────────────────────────── */}
      <div className="inv-toolbar">
        <div className="inv-status-tabs">
          {['', 'draft', 'sent', 'partial', 'paid', 'overdue', 'void'].map(s => {
            const st = s && summary?.by_status?.[s];
            return (
              <button key={s}
                className={`inv-tab${statusFilter === s ? ' active' : ''}`}
                onClick={() => { setStatusFilter(s); setPage(1); }}>
                {s ? t(`invoices.status.${s}`, { defaultValue: s }) : t('common.all')}
                {st && <span className="inv-tab-count">{st.count}</span>}
              </button>
            );
          })}
        </div>
        <div className="inv-toolbar-right">
          <div className="inv-search">
            <Search width={14} height={14} />
            <input placeholder={t('invoices.search_placeholder')} value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          {/* Deliberately a quiet secondary action: bringing in history is a
              once-per-workspace job, not something to compete with the button
              people press every day. */}
          <button className="inv-import-btn" onClick={() => setShowImport(true)}>
            <Upload /> {t('import.button')}
          </button>
          <button className="inv-new-btn" onClick={() => setFormModal('new')}>
            <Plus /> {t('invoices.new_invoice')}
          </button>
        </div>
      </div>

      {/* ── Bulk action bar ───────────────────────────── */}
      {selected.size > 0 && (
        <div className="inv-bulk-bar">
          <span className="inv-bulk-count">{t('invoices.bulk_selected', { count: selected.size })}</span>
          <div className="inv-bulk-actions">
            <button className="btn btn-sm btn-outline" disabled={bulkBusy} onClick={() => onBulkAction('send')}>
              {bulkBusy ? <span className="spinner spinner-sm" /> : t('invoices.bulk_send')}
            </button>
            <button className="btn btn-sm btn-outline" disabled={bulkBusy} onClick={() => onBulkAction('mark-paid')}>
              {t('invoices.bulk_mark_paid')}
            </button>
            <button className="btn btn-sm btn-outline inv-bulk-danger" disabled={bulkBusy} onClick={() => onBulkAction('void')}>
              {t('invoices.bulk_void')}
            </button>
          </div>
          <button className="inv-bulk-clear" onClick={() => setSelected(new Set())}>{t('common.cancel')}</button>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────── */}
      <div className="inv-table-wrap">
        {loading ? <Loader fullPage /> : (
          <table className="inv-table">
            <thead>
              <tr>
                <th className="inv-th-check">
                  <input type="checkbox" aria-label={t('common.select_all')}
                    checked={allVisibleSelected}
                    onChange={toggleAll} />
                </th>
                <th>#</th><th>{t('invoices.client')}</th><th>{t('invoices.col_issued')}</th><th>{t('invoices.col_due')}</th>
                <th>{t('common.total')}</th><th>{t('invoices.col_paid')}</th><th>{t('invoices.col_balance_due')}</th>
                <th>{t('common.status')}</th><th>{t('invoices.col_links')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={11} className="inv-empty-row">{t('invoices.none_found')}</td></tr>
              )}
              {invoices.map(inv => {
                const balance = parseFloat(inv.balance_due || 0);
                const overdue = parseInt(inv.days_overdue || 0);
                return (
                  <tr key={inv.id} className={`inv-row${selected.has(inv.id) ? ' inv-row-selected' : ''}`} onClick={() => setDetailId(inv.id)}>
                    <td className="inv-td-check" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${inv.invoice_number}`}
                        checked={selected.has(inv.id)}
                        onChange={() => toggleOne(inv.id)} />
                    </td>
                    <td className="inv-td-num">{inv.invoice_number}</td>
                    <td>{inv.client_name}</td>
                    <td className="inv-td-date">{fmtDate(inv.issue_date)}</td>
                    <td className="inv-td-date">
                      <div>{fmtDate(inv.due_date)}</div>
                      {overdue > 0 && inv.status !== 'paid' && inv.status !== 'void' && (
                        <div className="inv-late">{t('invoices.days_late', { days: overdue })}</div>
                      )}
                    </td>
                    <td className="inv-td-amt">{fmtCurrency(inv.total_amount, inv.currency)}</td>
                    <td className="inv-td-amt inv-td-paid">{fmtCurrency(inv.paid_amount, inv.currency)}</td>
                    <td className="inv-td-amt">
                      {balance > 0.009
                        ? <span className={`inv-balance${inv.status === 'overdue' ? ' red' : ''}`}>{fmtCurrency(balance, inv.currency)}</span>
                        : <span className="inv-balance green">✓ {t('invoices.fully_paid')}</span>}
                    </td>
                    <td>{statusBadge(inv.status)}</td>
                    <td className="inv-td-links" onClick={e => e.stopPropagation()}>
                      {inv.has_quote      == 1 && <span className="inv-pill q"  title={t('invoices.link_from_quote')}>Q</span>}
                      {inv.has_recurring  == 1 && <span className="inv-pill r"  title={t('invoices.link_recurring')}>↻</span>}
                      {inv.has_parent     == 1 && <span className="inv-pill p"  title={t('invoices.link_revision')}>Rev</span>}
                      {inv.cn_count       > 0  && <span className="inv-pill cn" title={t('invoices.link_credit_notes', { count: inv.cn_count })}>CN</span>}
                      {inv.payment_count  > 0  && <span className="inv-pill py" title={t('invoices.link_payments', { count: inv.payment_count })}>{inv.payment_count}P</span>}
                    </td>
                    <td className="inv-td-actions" onClick={e => e.stopPropagation()}>
                      <button className="inv-act" title={t('common.view')} onClick={() => setDetailId(inv.id)}><Eye /></button>
                      {inv.status !== 'void' && (
                        <button className="inv-act" title={t('common.edit')} onClick={() => openEdit(inv)}><EditPencil /></button>
                      )}
                      <button className="inv-act" title={t('common.download_pdf')} onClick={() => handleDownloadPdf(inv.id, inv.invoice_number)}><Download /></button>
                      {inv.status !== 'void' && (
                        <button className="inv-act" title={t('invoices.copy_pay_link')} onClick={() => copyPaymentLink(inv.id)}><LinkIcon /></button>
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
        <span>{t('common.showing')} {invoices.length} {t('common.of')} {total}</span>
        <div>
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
          <span>{t('common.page')} {page} / {Math.ceil(total / 20) || 1}</span>
          <button disabled={invoices.length < 20} onClick={() => setPage(p => p + 1)}>›</button>
        </div>
      </div>

      {formModal && (
        <InvoiceFormModal invoice={formModal === 'new' ? null : formModal}
          onClose={() => setFormModal(null)}
          onSave={(res) => {
            const isNew = formModal === 'new';
            const num = res?.invoice_number || res?.data?.invoice_number;
            if (isNew) {
              /* No toast here: the dialog below IS the confirmation, and a
                 toast on top of it would say the same thing twice. */
              setFormModal(null);
              handleRefresh();
              return setSavedInvoice({
                id: res?.id ?? res?.data?.id,
                invoice_number: num,
                client_email: res?.client_email || '',
                client_name: res?.client_name || '',
              });
            } else if (res?.status_changed) {
              // The new total no longer matches what has been paid, so the
              // invoice can't stay marked as settled — say so explicitly.
              const from = res.previous_status, to = res.status;
              showToast(
                to === 'partial'
                  ? `Invoice updated. It was ${from} — the new total is higher than the amount received, so it is now partially paid.`
                  : `Invoice updated. It was ${from} and is now marked ${to}.`,
                'warning'
              );
            } else if (res?.marked_sent) {
              showToast(t('invoices.marked_sent_success'));
            } else {
              showToast(t('invoices.updated_success'));
            }
            setFormModal(null);
            handleRefresh();
          }} />
      )}
      {savedInvoice && (
        <InvoiceSavedModal
          invoice={savedInvoice}
          onClose={() => setSavedInvoice(null)}
          onSent={handleRefresh}
          onView={(inv) => { setSavedInvoice(null); setDetailId(inv.id); }}
        />
      )}
      {showImport && (
        <ImportInvoicesModal
          currency={tenant?.currency}
          onClose={() => setShowImport(false)}
          onDone={(res) => {
            showToast(t('import.done', { count: res.summary.imported ?? 0 }));
            handleRefresh();
          }}
        />
      )}

      {detailId && (
        <InvoiceDetailModal invoiceId={detailId}
          onClose={() => setDetailId(null)} onChanged={handleRefresh}
          onEdit={(inv) => { setDetailId(null); openEdit(inv); }} />
      )}

      <ConfirmDialog
        open={!!confirmEdit}
        tone="primary"
        title={t('invoices.confirm_edit_paid_title')}
        message="This invoice already has payments recorded against it. If your changes raise the total above the amount received, it will no longer count as fully paid and will be marked partially paid. Recorded payments are not deleted."
        detail={confirmEdit
          ? `${confirmEdit.invoice_number} — ${fmt(confirmEdit.total_amount)} total, ${fmt(confirmEdit.paid_amount)} received`
          : null}
        confirmLabel="Edit anyway"
        cancelLabel="Leave it alone"
        onConfirm={() => { setFormModal(confirmEdit); setConfirmEdit(null); }}
        onCancel={() => setConfirmEdit(null)}
      />

      <ConfirmDialog
        open={!!confirmBulk}
        tone="danger"
        title={t('invoices.bulk_void_title')}
        message={t('invoices.bulk_void_msg', { count: selected.size })}
        confirmLabel={t('invoices.bulk_void')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => runBulk('void')}
        onCancel={() => setConfirmBulk(null)}
      />
    </div>
  );
}
