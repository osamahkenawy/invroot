import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import './PayInvoicePage.css';

/* Status wording comes from the locale file — this page is read by the
   tenant's own customers, who may not share the tenant's language. */

function parseLineItems(li) {
  if (Array.isArray(li)) return li;
  if (typeof li === 'string') { try { return JSON.parse(li); } catch { return []; } }
  return [];
}

export default function PayInvoicePage() {
  const { token } = useParams();
  const { t, i18n } = useTranslation();
  const [inv, setInv]       = useState(null);
  const [state, setState]   = useState('loading'); // loading | ok | error

  useEffect(() => {
    api.get(`/public/invoices/${token}`).then(res => {
      if (res.success) { setInv(res.data); setState('ok'); }
      else setState('error');
    }).catch(() => setState('error'));
  }, [token]);

  /* Follow the INVOICE's language, not the browser's. The tenant chose it when
     they created the document; a recipient opening an Arabic invoice should
     not be shown an English page because their browser happens to be English. */
  useEffect(() => {
    if (inv?.lang && inv.lang !== i18n.language) i18n.changeLanguage(inv.lang);
  }, [inv?.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const isRTL = (inv?.lang || i18n.language) === 'ar';

  if (state === 'loading') {
    return <div className="pay-root"><div className="pay-card pay-center"><span className="spinner spinner-lg" /></div></div>;
  }
  if (state === 'error' || !inv) {
    return (
      <div className="pay-root" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="pay-card pay-center">
          <div className="pay-error-icon">!</div>
          <h2>{t('public.not_found_title')}</h2>
          <p>{t('public.not_found_body')}</p>
        </div>
      </div>
    );
  }

  const cur = inv.currency;
  const items = parseLineItems(inv.line_items);
  const balance = Number(inv.balance_due);
  const isPaid = balance <= 0.009;
  const primary = inv.primary_color || '#1b2a4a';

  return (
    <div className="pay-root" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="pay-card">
        <div className="pay-header" style={{ background: primary }}>
          <div className="pay-header-co">
            {inv.logo_url
              ? <img src={inv.logo_url} alt={inv.company_name} className="pay-logo" />
              : <span className="pay-co-name">{inv.company_name}</span>}
          </div>
          <div className="pay-header-meta">
            <div className="pay-inv-label">INVOICE</div>
            <div className="pay-inv-num">{inv.invoice_number}</div>
          </div>
        </div>

        <div className="pay-body">
          <div className={`pay-status pay-status-${inv.status}`}>{t(`public.status.${inv.status}`, { defaultValue: inv.status })}</div>

          {/* Amount due hero */}
          <div className="pay-due">
            <div className="pay-due-label">{isPaid ? t('public.amount_paid') : t('public.amount_due')}</div>
            <div className="pay-due-amount">{fmtCurrency(isPaid ? inv.total_amount : balance, cur)}</div>
            {!isPaid && Number(inv.paid_amount) > 0 && (
              <div className="pay-due-sub">{fmtCurrency(inv.paid_amount, cur)} paid of {fmtCurrency(inv.total_amount, cur)}</div>
            )}
            {isPaid && <div className="pay-paid-badge">✓ {t('public.paid_in_full')}</div>}
          </div>

          <div className="pay-meta-row">
            <div><span className="pay-meta-k">{t('public.billed_to')}</span><span className="pay-meta-v">{inv.client_name}</span></div>
            <div><span className="pay-meta-k">{t('public.issued')}</span><span className="pay-meta-v">{fmtDate(inv.issue_date)}</span></div>
            <div><span className="pay-meta-k">{t('public.due')}</span><span className="pay-meta-v">{fmtDate(inv.due_date)}</span></div>
          </div>

          {/* Line items */}
          <table className="pay-items">
            <thead>
              <tr><th>{t('public.description')}</th><th className="r">{t('public.qty')}</th><th className="r">{t('public.price')}</th><th className="r">{t('public.total')}</th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{it.description || it.name || '—'}</td>
                  <td className="r">{it.quantity ?? 1}</td>
                  <td className="r">{fmtCurrency(it.unit_price ?? it.price ?? 0, cur)}</td>
                  <td className="r">{fmtCurrency(it.total ?? ((it.quantity ?? 1) * (it.unit_price ?? it.price ?? 0)), cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pay-totals">
            <div><span>{t('public.subtotal')}</span><span>{fmtCurrency(inv.subtotal, cur)}</span></div>
            {Number(inv.discount_amount) > 0 && <div><span>{t('public.discount')}</span><span>−{fmtCurrency(inv.discount_amount, cur)}</span></div>}
            {Number(inv.tax_amount) > 0 && <div><span>{t('public.tax')}</span><span>{fmtCurrency(inv.tax_amount, cur)}</span></div>}
            <div className="pay-totals-grand"><span>{t('public.total')}</span><span>{fmtCurrency(inv.total_amount, cur)}</span></div>
          </div>

          <div className="pay-actions">
            <a className="pay-btn pay-btn-primary" href={inv.pdf_url} target="_blank" rel="noreferrer" style={{ background: primary }}>
              {t('public.download_pdf')}
            </a>
          </div>

          {!isPaid && (
            <p className="pay-note">
              {t('public.settle_note', { company: inv.company_name })}
            </p>
          )}

          {inv.footer_text && <p className="pay-footer-text">{inv.footer_text}</p>}
        </div>

        <div className="pay-brandline">{t('public.powered_by')} <strong>Invroot</strong></div>
      </div>
    </div>
  );
}
