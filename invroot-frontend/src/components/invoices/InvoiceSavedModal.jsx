import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, Send, Link as LinkIcon, Eye, Xmark } from 'iconoir-react';
import api from '../../lib/api.js';
import { useToastContext } from '../../context/ToastContext.jsx';
import './InvoiceSavedModal.css';

/**
 * What happens the moment an invoice is saved.
 *
 * Saving used to fire a toast and drop you back on the list. But nobody writes
 * an invoice in order to have an invoice — they write it to send it, and every
 * way of doing that was somewhere else: the PDF behind a row icon, the share
 * link behind another, emailing it behind a third. The one moment the intent
 * is unambiguous is the moment it is saved, so the three things anyone does
 * next are offered here, together.
 *
 * Emailing is the primary action but not an automatic one — an invoice reaches
 * a customer exactly when its author says so, never as a side effect of
 * pressing Save.
 */
export default function InvoiceSavedModal({ invoice, onClose, onSent, onView }) {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const [busy, setBusy] = useState('');
  const [sent, setSent] = useState(false);

  const { id, invoice_number: number, client_email: clientEmail, client_name: clientName } = invoice;

  const download = async () => {
    setBusy('pdf');
    try { await api.download(`/invoices/${id}/pdf`, `invoice-${number}.pdf`); }
    finally { setBusy(''); }
  };

  const copyLink = async () => {
    setBusy('link');
    const res = await api.post(`/invoices/${id}/public-link`);
    setBusy('');
    if (!res.success) return showToast(res.message || t('common.action_failed'), 'error');
    /* Clipboard access is refused outside a secure context and in some
       embedded browsers. Falling back to showing the URL keeps the link
       reachable instead of reporting a copy that never happened. */
    try {
      await navigator.clipboard.writeText(res.url);
      showToast(t('invoices.link_copied'), 'success');
    } catch { showToast(res.url, 'success'); }
  };

  const send = async () => {
    setBusy('send');
    const res = await api.post(`/invoices/${id}/send`, {});
    setBusy('');
    if (!res.success) return showToast(res.message || t('common.action_failed'), 'error');
    /* Stay open, but change what the dialog says. Closing on send would hide
       the outcome, and the PDF and link are still worth having afterwards. */
    setSent(true);
    showToast(t('invoices.sent_success', { client: clientName || '' }).trim(), 'success');
    onSent?.();
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-sm isv-modal">
        <button className="isv-x" onClick={onClose} aria-label={t('common.close')}><Xmark /></button>

        <div className="isv-head">
          <div className="isv-badge"><Check strokeWidth={3} /></div>
          <h3>{sent ? t('invoices.saved_sent_title') : t('invoices.saved_title')}</h3>
          <p className="isv-number">{number}</p>
          <p className="isv-lead">
            {sent ? t('invoices.saved_sent_lead', { email: clientEmail }) : t('invoices.saved_lead')}
          </p>
        </div>

        <div className="isv-actions">
          {/* Email first: it is what the document is for. Without an address on
              file the row states that plainly rather than failing on click. */}
          <button className="isv-action isv-action--primary" onClick={send}
                  disabled={!clientEmail || !!busy || sent}>
            <span className="isv-ico"><Send /></span>
            <span className="isv-label">
              <strong>{sent ? t('invoices.saved_sent_done') : t('invoices.saved_send')}</strong>
              <small>{clientEmail || t('invoices.saved_no_email')}</small>
            </span>
            {busy === 'send' && <span className="spinner spinner-sm" />}
          </button>

          <button className="isv-action" onClick={download} disabled={!!busy}>
            <span className="isv-ico"><Download /></span>
            <span className="isv-label">
              <strong>{t('invoices.saved_download')}</strong>
              <small>{t('invoices.saved_download_sub')}</small>
            </span>
            {busy === 'pdf' && <span className="spinner spinner-sm" />}
          </button>

          <button className="isv-action" onClick={copyLink} disabled={!!busy}>
            <span className="isv-ico"><LinkIcon /></span>
            <span className="isv-label">
              <strong>{t('invoices.saved_link')}</strong>
              <small>{t('invoices.saved_link_sub')}</small>
            </span>
            {busy === 'link' && <span className="spinner spinner-sm" />}
          </button>
        </div>

        <div className="isv-foot">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('invoices.saved_later')}</button>
          <button className="btn btn-primary btn-sm" onClick={() => onView?.(invoice)}>
            <Eye style={{ width: 15, height: 15 }} /> {t('invoices.saved_view')}
          </button>
        </div>
      </div>
    </div>
  );
}
