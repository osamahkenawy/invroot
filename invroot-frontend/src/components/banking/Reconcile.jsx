/**
 * Reconciliation — the two sides that have not been paired up.
 *
 * Banking and payments were separate worlds: 109 recorded payments, and a
 * banking screen that had never heard of any of them. The only way to make the
 * two agree was to retype every payment, with nothing to stop you typing one
 * twice.
 *
 * Left: money the app knows about that is not in any account yet.
 * Right: statement lines with no payment behind them.
 *
 * Matching is deliberately a human act. Pairing by amount alone is wrong the
 * moment two customers pay the same round number, and a wrong match is far more
 * expensive to unpick than a right one is to make. Suggestions are shown, never
 * applied.
 *
 * Two things this panel got wrong, both about restraint:
 *
 *  · It printed every unmatched payment — up to 200 rows — as a full-height
 *    card with no scroll box of its own, so the Banking page became a mile of
 *    payments and the accounts, the actual subject of the page, were pushed
 *    below the fold.
 *  · It printed that list even when the right-hand side was empty. With no
 *    bank lines to match against, 109 rows of "recorded in Invroot" is not a
 *    task, it is a wall: nothing on it can be acted on, and nothing on screen
 *    said why or what to do instead.
 *
 * So: the list only appears when there is something to match it against, it
 * lives in its own scroll box, and it is filterable once it is long enough to
 * need it.
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, ArrowRight, Search, InfoCircle, Plus } from 'iconoir-react';
import api from '../../lib/api.js';
import { useToastContext } from '../../context/ToastContext.jsx';
import { fmtCurrency } from '../../utils/currency.js';
import { fmtDate } from '../../utils/date.js';
import './Reconcile.css';

/* Past this many rows a column gets its own search box. Below it, scanning is
   faster than typing. */
const FILTER_THRESHOLD = 8;

export default function Reconcile({ currency = 'AED', hasAccounts = true, onAddAccount, onChanged }) {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const [data, setData] = useState(null);
  const [pick, setPick] = useState({ payment: null, transaction: null });
  const [busy, setBusy] = useState(false);
  const [qPay, setQPay] = useState('');
  const [qTx,  setQTx]  = useState('');

  const load = () => api.get('/banking/reconciliation').then(r => { if (r.success) setData(r.data); });
  useEffect(() => { load(); }, []);

  const match = async () => {
    if (!pick.payment || !pick.transaction) return;
    setBusy(true);
    try {
      const res = await api.post(`/banking/transactions/${pick.transaction}/match`, { payment_id: pick.payment });
      if (res.success) {
        showToast(t('banking.matched'));
        setPick({ payment: null, transaction: null });
        await load();
        onChanged?.();
      } else {
        /* The server refuses mismatched amounts and already-matched rows. Show
           its reason verbatim — it is more specific than anything generic. */
        showToast(res.message || t('common.action_failed'), 'error');
        await load();
      }
    } finally { setBusy(false); }
  };

  const { payments = [], transactions = [], suggestions = [] } = data || {};

  /* Amounts are stored raw ("2281.00") and displayed grouped ("AED 2,281.00").
     People search for what is on their screen, so strip the separators from
     both sides — otherwise typing the amount you can see finds nothing. */
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s,]/g, '');
  const hay = (...parts) => norm(parts.filter(Boolean).join(' '));
  const shownPayments = useMemo(() => {
    const q = norm(qPay.trim());
    if (!q) return payments;
    return payments.filter(p => hay(p.client_name, p.invoice_number, p.reference, p.amount).includes(q));
  }, [payments, qPay]);
  const shownTx = useMemo(() => {
    const q = norm(qTx.trim());
    if (!q) return transactions;
    return transactions.filter(x => hay(x.description, x.reference, x.account_name, x.amount).includes(q));
  }, [transactions, qTx]);

  if (!data) return null;
  if (!payments.length && !transactions.length) return null;

  const suggestedTx = pick.payment
    ? suggestions.find(s => s.payment_id === pick.payment)?.transaction_id
    : null;

  const total = data.unreconciled_total > 0
    ? fmtCurrency(data.unreconciled_total, currency) : null;

  /* Nothing on the bank side means nothing on this panel can be completed. Say
     what reconciling is for and what is missing, rather than rendering a list
     whose every row is a dead end. */
  const nothingToMatchAgainst = payments.length > 0 && transactions.length === 0;

  return (
    <div className="rec-card">
      <div className="rec-head">
        <div>
          <div className="rec-title">{t('banking.reconcile')}</div>
          <div className="rec-sub">
            {t('banking.reconcile_sub', { count: payments.length })}
            {total && <> · <strong>{total}</strong></>}
          </div>
        </div>
        {!nothingToMatchAgainst && (
          <button
            className="rec-match-btn"
            disabled={!pick.payment || !pick.transaction || busy}
            onClick={match}
            /* A disabled button that never says why is a dead end. */
            title={!pick.payment ? t('banking.match_need_payment')
                 : !pick.transaction ? t('banking.match_need_line') : t('banking.match')}
          >
            {busy ? <span className="spinner spinner-sm" /> : <><Link /> {t('banking.match')}</>}
          </button>
        )}
      </div>

      {nothingToMatchAgainst ? (
        <div className="rec-blocked">
          <div className="rec-blocked-icon"><InfoCircle /></div>
          <div className="rec-blocked-body">
            <strong>{t('banking.rec_blocked_title')}</strong>
            <p>{t('banking.rec_blocked_body')}</p>
            {!hasAccounts && onAddAccount && (
              <button className="rec-blocked-cta" onClick={onAddAccount}>
                <Plus /> {t('banking.add_account')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* The mechanic in one sentence. Two lists and a button do not, on
              their own, tell anyone that this is a pairing exercise. */}
          <p className="rec-howto">{t('banking.rec_howto')}</p>

          <div className="rec-cols">
            <RecColumn
              head={t('banking.payments_side')}
              count={payments.length}
              shown={shownPayments.length}
              query={qPay}
              onQuery={setQPay}
              placeholder={t('banking.rec_search_payments')}
              emptyAll={t('banking.all_reconciled')}
              emptyFiltered={t('banking.rec_no_matches')}
            >
              {shownPayments.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`rec-row${pick.payment === p.id ? ' rec-row-on' : ''}`}
                  onClick={() => setPick(s => ({ ...s, payment: s.payment === p.id ? null : p.id }))}
                >
                  <div className="rec-row-main">
                    <span className="rec-row-title">{p.client_name || t('banking.unknown_client')}</span>
                    <span className="rec-row-meta">
                      {p.invoice_number || '—'} · {fmtDate(p.payment_date)}
                    </span>
                  </div>
                  <span className="rec-row-amt">{fmtCurrency(p.amount, currency)}</span>
                </button>
              ))}
            </RecColumn>

            <div className="rec-arrow"><ArrowRight /></div>

            <RecColumn
              head={t('banking.bank_side')}
              count={transactions.length}
              shown={shownTx.length}
              query={qTx}
              onQuery={setQTx}
              placeholder={t('banking.rec_search_lines')}
              emptyAll={t('banking.no_unmatched_lines')}
              emptyFiltered={t('banking.rec_no_matches')}
            >
              {shownTx.map(tx => (
                <button
                  key={tx.id}
                  type="button"
                  className={
                    `rec-row${pick.transaction === tx.id ? ' rec-row-on' : ''}` +
                    (suggestedTx === tx.id && pick.transaction !== tx.id ? ' rec-row-hint' : '')
                  }
                  onClick={() => setPick(s => ({ ...s, transaction: s.transaction === tx.id ? null : tx.id }))}
                >
                  <div className="rec-row-main">
                    <span className="rec-row-title">{tx.description || tx.reference || t('banking.bank_credit')}</span>
                    <span className="rec-row-meta">{tx.account_name} · {fmtDate(tx.transaction_date)}</span>
                  </div>
                  <span className="rec-row-amt">{fmtCurrency(tx.amount, currency)}</span>
                  {/* A hint, not a decision — the person still has to press Match. */}
                  {suggestedTx === tx.id && <span className="rec-badge">{t('banking.likely')}</span>}
                </button>
              ))}
            </RecColumn>
          </div>
        </>
      )}
    </div>
  );
}

/** One side of the pairing: a heading, an optional filter, and a scroll box. */
function RecColumn({ head, count, shown, query, onQuery, placeholder, emptyAll, emptyFiltered, children }) {
  return (
    <div className="rec-col">
      <div className="rec-col-head">
        <span>{head}</span>
        {count > 0 && <span className="rec-col-count">{count}</span>}
      </div>

      {count > FILTER_THRESHOLD && (
        <div className="rec-search">
          <Search />
          <input value={query} onChange={e => onQuery(e.target.value)} placeholder={placeholder} />
        </div>
      )}

      {/* The scroll box is the whole point: without it a long side stretched
          the page instead of itself. */}
      <div className="rec-scroll">
        {count === 0 ? <div className="rec-empty">{emptyAll}</div>
          : shown === 0 ? <div className="rec-empty">{emptyFiltered}</div>
          : children}
      </div>
    </div>
  );
}
