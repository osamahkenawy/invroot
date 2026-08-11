import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Xmark, Search, WarningTriangle } from 'iconoir-react';
import api from '../../lib/api.js';
import Loader from '../Loader.jsx';
import { fmtCurrency } from '../../utils/currency.js';
import { fmtDate } from '../../utils/date.js';
import './InvoicePicker.css';

const PAGE_SIZE = 50;
/* Statuses that can still receive a payment. */
const OPEN_STATUSES = ['sent', 'viewed', 'partial', 'overdue'];

/**
 * Pick the invoice a payment is being recorded against.
 *
 * Design notes:
 *  • The figure shown is the OUTSTANDING balance, not the invoice total. It is
 *    labelled, because an unlabelled amount on a partially-paid invoice is
 *    genuinely ambiguous — the previous version showed the balance with no
 *    indication of which it was.
 *  • Ordering puts the most overdue first: when someone is recording a payment
 *    they are usually chasing the oldest debt, not the newest invoice.
 *  • Search is debounced. It previously fired a request per keystroke.
 */
export default function InvoicePicker({ onClose, onPick, currency }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  const [raw, setRaw]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput]     = useState('');   // what's typed
  const [query, setQuery]     = useState('');   // debounced, sent to the API
  const [active, setActive]   = useState(0);    // keyboard cursor
  const [truncated, setTruncated] = useState(false);

  const listRef = useRef(null);
  const itemRefs = useRef([]);

  /* Debounce: one request when typing settles, not one per character. */
  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(id);
  }, [input]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    /* Ask the server for payable invoices only, oldest due first. Fetching a
       page of everything and filtering here meant the oldest overdue invoices
       could fall outside the window and never appear — exactly the ones someone
       recording a payment is most likely to be chasing. */
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE),
      status: OPEN_STATUSES.join(','),
      sort: 'due_asc',
    });
    if (query) qs.set('search', query);
    api.get(`/invoices?${qs}`).then(res => {
      if (cancelled) return;
      if (res.success) {
        const rows = res.data || [];
        // Belt and braces — the server has already filtered by status.
        const open = rows.filter(i => OPEN_STATUSES.includes(i.status));
        setRaw(open);
        // A full page back means there may be more payable invoices than shown.
        setTruncated(rows.length >= PAGE_SIZE);
      }
      setLoading(false);
      setActive(0);
    });
    // A stale in-flight response must not overwrite a newer one.
    return () => { cancelled = true; };
  }, [query]);

  /* Most overdue first, then soonest due, then largest balance. */
  const invoices = useMemo(() => [...raw].sort((a, b) => {
    const ao = Number(a.days_overdue || 0), bo = Number(b.days_overdue || 0);
    if (ao !== bo) return bo - ao;
    const ad = a.due_date || '', bd = b.due_date || '';
    if (ad !== bd) return ad.localeCompare(bd);
    return Number(b.balance_due || 0) - Number(a.balance_due || 0);
  }), [raw]);

  const totalOutstanding = useMemo(
    () => invoices.reduce((s, i) => s + Number(i.balance_due || 0), 0),
    [invoices]
  );

  /* Keyboard driving: ↑/↓ to move, Enter to choose, Esc to close. */
  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (!invoices.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, invoices.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const inv = invoices[active];
      if (inv) onPick(inv);
    }
  }, [invoices, active, onPick, onClose]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const hasSearch = query.length > 0;

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-panel ipk-panel ${isRTL ? 'rtl' : ''}`} onKeyDown={onKeyDown}>
        <div className="modal-header">
          <div>
            <h3>{t('payments.select_invoice')}</h3>
            {!loading && invoices.length > 0 && (
              <div className="ipk-subtitle">
                {t('payments.picker_summary', {
                  count: invoices.length,
                  amount: fmtCurrency(totalOutstanding, currency),
                })}
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}><Xmark /></button>
        </div>

        <div className="modal-body ipk-body">
          <div className="ipk-search">
            <Search />
            <input
              placeholder={t('payments.search_placeholder')}
              value={input}
              onChange={e => setInput(e.target.value)}
              autoFocus
              aria-label={t('payments.search_placeholder')}
            />
            {input && (
              <button className="ipk-clear" onClick={() => setInput('')} aria-label={t('common.cancel')}>
                <Xmark />
              </button>
            )}
          </div>

          {loading ? (
            <Loader />
          ) : invoices.length === 0 ? (
            /* "nothing matches" and "nothing outstanding" are different states
               and were previously shown with the same message. */
            <div className="ipk-empty">
              {hasSearch ? (
                <>
                  <Search className="ipk-empty-icon" />
                  <div className="ipk-empty-title">{t('payments.picker_no_match')}</div>
                  <div className="ipk-empty-sub">{t('payments.picker_no_match_sub', { term: query })}</div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setInput('')}>
                    {t('payments.picker_clear_search')}
                  </button>
                </>
              ) : (
                <>
                  <div className="ipk-empty-tick">✓</div>
                  <div className="ipk-empty-title">{t('payments.no_open_invoices')}</div>
                  <div className="ipk-empty-sub">{t('payments.picker_all_settled')}</div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="ipk-list" ref={listRef} role="listbox">
                {invoices.map((inv, idx) => {
                  const bal     = Math.max(0, Number(inv.balance_due ?? (inv.total_amount - (inv.paid_amount || 0))));
                  const total   = Number(inv.total_amount || 0);
                  const paid    = Number(inv.paid_amount || 0);
                  const overdue = Number(inv.days_overdue || 0);
                  const partial = paid > 0;
                  const pct     = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
                  const cur     = inv.currency || currency;

                  return (
                    <button
                      key={inv.id}
                      ref={el => { itemRefs.current[idx] = el; }}
                      role="option"
                      aria-selected={idx === active}
                      className={`ipk-item ${idx === active ? 'active' : ''} ${overdue > 0 ? 'overdue' : ''}`}
                      onClick={() => onPick(inv)}
                      onMouseEnter={() => setActive(idx)}
                    >
                      <div className="ipk-item-main">
                        <div className="ipk-item-top">
                          <span className="ipk-num">{inv.invoice_number}</span>
                          <span className={`status-badge status-${inv.status} ipk-status`}>
                            {t(`invoices.status.${inv.status}`, { defaultValue: inv.status })}
                          </span>
                          {overdue > 0 && (
                            <span className="ipk-overdue">
                              <WarningTriangle />
                              {t('payments.picker_days_overdue', { days: overdue })}
                            </span>
                          )}
                        </div>
                        <div className="ipk-client">{inv.client_name}</div>
                        <div className="ipk-meta">
                          {t('invoices.due_date')}: {fmtDate(inv.due_date)}
                          {partial && (
                            <> · {t('payments.picker_paid_of', {
                              paid: fmtCurrency(paid, cur),
                              total: fmtCurrency(total, cur),
                            })}</>
                          )}
                        </div>
                        {partial && (
                          <div className="ipk-progress">
                            <div className="ipk-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>

                      <div className="ipk-item-amount">
                        <div className="ipk-bal-label">{t('payments.picker_balance_due')}</div>
                        <div className="ipk-bal">{fmtCurrency(bal, cur)}</div>
                        {partial && <div className="ipk-bal-of">{t('common.total')} {fmtCurrency(total, cur)}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="ipk-foot">
                <span className="ipk-hint">{t('payments.picker_kbd_hint')}</span>
                {/* Never let a capped list look like the whole list. */}
                {truncated && <span className="ipk-truncated">{t('payments.picker_truncated', { count: PAGE_SIZE })}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
