import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import {
  Plus, Search, Eye, Download, Coins, CheckCircle,
  WarningTriangle, Clock
} from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import InvoiceFormModal from '../components/invoices/InvoiceFormModal.jsx';
import InvoiceDetailModal from '../components/invoices/InvoiceDetailModal.jsx';
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

  const handleRefresh = () => { fetchInvoices(); fetchSummary(); };
  const handleDownloadPdf = (id, number) => api.download(`/invoices/${id}/pdf`, `invoice-${number}.pdf`);

  const statusBadge = (status) => {
    const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
    return (
      <span className="inv-badge" style={{ background: c.bg, color: c.fg }}>
        {t(`invoices.status.${status}`, { defaultValue: status })}
      </span>
    );
  };

  const fmt = (v) => fmtCurrency(v || 0, summary?.currency || 'SAR');
  const maxAge = summary ? Math.max(...(summary.age_analysis || []).map(a => a.amount), 1) : 1;

  return (
    <div className="inv-page">

      {/* ── Financial Summary ─────────────────────────── */}
      {!summaryLoading && summary && (
        <div className="inv-summary-row">
          <div className="inv-sum-card">
            <div className="inv-sum-icon blue"><Coins /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">Total Invoiced</div>
              <div className="inv-sum-value">{fmt(summary.grand_total)}</div>
              <div className="inv-sum-sub">
                {Object.values(summary.by_status || {}).reduce((s, b) => s + (b.count || 0), 0)} invoices
              </div>
            </div>
          </div>
          <div className="inv-sum-card">
            <div className="inv-sum-icon green"><CheckCircle /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">Total Collected</div>
              <div className="inv-sum-value">{fmt(summary.grand_paid)}</div>
              <div className="inv-sum-sub">
                {summary.grand_total > 0 ? Math.round((summary.grand_paid / summary.grand_total) * 100) : 0}% of total
              </div>
            </div>
          </div>
          <div className="inv-sum-card">
            <div className="inv-sum-icon orange"><Clock /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">Outstanding</div>
              <div className="inv-sum-value">{fmt(summary.grand_outstanding)}</div>
              <div className="inv-sum-sub">{(summary.by_status?.partial?.count || 0)} partially paid</div>
            </div>
          </div>
          <div className="inv-sum-card accent-red">
            <div className="inv-sum-icon red"><WarningTriangle /></div>
            <div className="inv-sum-body">
              <div className="inv-sum-label">Overdue</div>
              <div className="inv-sum-value">{fmt(summary.grand_overdue)}</div>
              <div className="inv-sum-sub">{(summary.by_status?.overdue?.count || 0)} past due</div>
            </div>
          </div>

          {/* Age Analysis */}
          <div className="inv-age-card">
            <div className="inv-age-title">
              <WarningTriangle width={13} height={13} /> Aging Analysis
            </div>
            <div className="inv-age-bars">
              {(summary.age_analysis || []).map((a, i) => (
                <div key={a.bucket} className="inv-age-row">
                  <div className="inv-age-lbl">{a.label}</div>
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
                  <span><i style={{ background: '#16a34a' }} />Paid</span>
                  <span><i style={{ background: '#f59e0b' }} />Outstanding</span>
                  <span><i style={{ background: '#ef4444' }} />Overdue</span>
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
                {s ? t(`invoices.status.${s}`, { defaultValue: s }) : 'All'}
                {st && <span className="inv-tab-count">{st.count}</span>}
              </button>
            );
          })}
        </div>
        <div className="inv-toolbar-right">
          <div className="inv-search">
            <Search width={14} height={14} />
            <input placeholder="Invoice # or client…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <button className="inv-new-btn" onClick={() => setFormModal('new')}>
            <Plus /> New Invoice
          </button>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────── */}
      <div className="inv-table-wrap">
        {loading ? <Loader fullPage /> : (
          <table className="inv-table">
            <thead>
              <tr>
                <th>#</th><th>Client</th><th>Issued</th><th>Due</th>
                <th>Total</th><th>Paid</th><th>Balance Due</th>
                <th>Status</th><th>Links</th><th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr><td colSpan={10} className="inv-empty-row">No invoices found</td></tr>
              )}
              {invoices.map(inv => {
                const balance = parseFloat(inv.balance_due || 0);
                const overdue = parseInt(inv.days_overdue || 0);
                return (
                  <tr key={inv.id} className="inv-row" onClick={() => setDetailId(inv.id)}>
                    <td className="inv-td-num">{inv.invoice_number}</td>
                    <td>{inv.client_name}</td>
                    <td className="inv-td-date">{fmtDate(inv.issue_date)}</td>
                    <td className="inv-td-date">
                      <div>{fmtDate(inv.due_date)}</div>
                      {overdue > 0 && inv.status !== 'paid' && inv.status !== 'void' && (
                        <div className="inv-late">{overdue}d late</div>
                      )}
                    </td>
                    <td className="inv-td-amt">{fmtCurrency(inv.total_amount, inv.currency)}</td>
                    <td className="inv-td-amt inv-td-paid">{fmtCurrency(inv.paid_amount, inv.currency)}</td>
                    <td className="inv-td-amt">
                      {balance > 0.009
                        ? <span className={`inv-balance${inv.status === 'overdue' ? ' red' : ''}`}>{fmtCurrency(balance, inv.currency)}</span>
                        : <span className="inv-balance green">✓ Paid</span>}
                    </td>
                    <td>{statusBadge(inv.status)}</td>
                    <td className="inv-td-links" onClick={e => e.stopPropagation()}>
                      {inv.has_quote      == 1 && <span className="inv-pill q"  title="Converted from quote">Q</span>}
                      {inv.has_recurring  == 1 && <span className="inv-pill r"  title="Recurring">↻</span>}
                      {inv.has_parent     == 1 && <span className="inv-pill p"  title="Revision">Rev</span>}
                      {inv.cn_count       > 0  && <span className="inv-pill cn" title={`${inv.cn_count} credit note(s)`}>CN</span>}
                      {inv.payment_count  > 0  && <span className="inv-pill py" title={`${inv.payment_count} payment(s)`}>{inv.payment_count}P</span>}
                    </td>
                    <td className="inv-td-actions" onClick={e => e.stopPropagation()}>
                      <button className="inv-act" title="View" onClick={() => setDetailId(inv.id)}><Eye /></button>
                      <button className="inv-act" title="Download PDF" onClick={() => handleDownloadPdf(inv.id, inv.invoice_number)}><Download /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="inv-pager">
        <span>Showing {invoices.length} of {total}</span>
        <div>
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
          <span>Page {page} of {Math.ceil(total / 20) || 1}</span>
          <button disabled={invoices.length < 20} onClick={() => setPage(p => p + 1)}>›</button>
        </div>
      </div>

      {formModal && (
        <InvoiceFormModal invoice={formModal === 'new' ? null : formModal}
          onClose={() => setFormModal(null)} onSave={() => { setFormModal(null); handleRefresh(); }} />
      )}
      {detailId && (
        <InvoiceDetailModal invoiceId={detailId}
          onClose={() => setDetailId(null)} onChanged={handleRefresh} />
      )}
    </div>
  );
}
