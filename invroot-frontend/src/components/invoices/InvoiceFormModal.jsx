import { useState, useEffect, useMemo, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api.js';
import { AuthContext } from '../../context/AuthContext.jsx';
import { useToastContext } from '../../context/ToastContext.jsx';
import { fmtCurrency } from '../../utils/currency.js';
import { toInputDate } from '../../utils/date.js';
import BrandAssetModal from '../BrandAssetModal.jsx';
import PhoneInput, { stripDialOnly } from '../PhoneInput.jsx';
import { Plus, Trash, Xmark, Copy, User, WarningTriangle, Upload } from 'iconoir-react';
import './InvoiceFormModal.css';
import { CURRENCIES } from '../../data/currencies.js';

const DUE_OPTIONS = [
  { days: 0,  key: 'on_receipt'  },
  { days: 7  },
  { days: 14 },
  { days: 30 },
  { days: 45 },
  { days: 60 },
  { days: 90 },
  { days: -1, key: 'custom_date' },
];

function emptyLine() {
  return { description: '', quantity: 1, unit_price: 0, tax_rate: 15 };
}

function addDays(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return toInputDate(d);
}

export default function InvoiceFormModal({ invoice, onClose, onSave }) {
  const { t } = useTranslation();
  const { tenant } = useContext(AuthContext);
  const isEdit = !!invoice;

  const [clients,     setClients]     = useState([]);
  const [catalog,     setCatalog]     = useState([]);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [selClient,   setSelClient]   = useState(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [branding,    setBranding]    = useState(null);  // company branding check
  const [logoBroken,  setLogoBroken]  = useState(false); // the URL loaded but the image didn't
  const [assetModal,  setAssetModal]  = useState(null);  // 'logo' | 'stamp' | null

  const [form, setForm] = useState(() => ({
    client_id:     invoice?.client_id     || '',
    issue_date:    invoice?.issue_date    ? toInputDate(invoice.issue_date) : toInputDate(new Date()),
    due_date:      invoice?.due_date      ? toInputDate(invoice.due_date)   : addDays(new Date(), 30),
    currency:      invoice?.currency      || tenant?.currency || 'SAR',
    payment_terms: invoice?.payment_terms ?? 30,
    custom_due:    false,
    discount_type: invoice?.discount_type || '',
    discount_value:invoice?.discount_value|| 0,
    notes:         invoice?.notes         || '',
    memo:          invoice?.memo          || 'Thank you for your business. Timely payment is appreciated.',
    po_number:     invoice?.po_number     || '',
    lang:          invoice?.lang          || 'en',
  }));

  const [lines, setLines] = useState(() => {
    const li = invoice?.line_items;
    const parsed = typeof li === 'string' ? JSON.parse(li || '[]') : (li || []);
    return parsed.length ? parsed.map(l => ({
      description: l.description || '',
      quantity:    Number(l.quantity)   || 1,
      unit_price:  Number(l.unit_price) || 0,
      tax_rate:    Number(l.tax_rate)   || 0,
    })) : [emptyLine()];
  });

  const reloadClients = () => api.get('/clients?limit=200').then(r => {
    if (r.success) {
      setClients(r.data);
      if (invoice?.client_id) setSelClient(r.data.find(c => String(c.id) === String(invoice.client_id)) || null);
    }
  });

  useEffect(() => {
    reloadClients();
    api.get('/catalog?limit=200').then(r => { if (r.success) setCatalog(r.data); });
    // Load company branding to check logo + stamp
    api.get('/company').then(r => { if (r.success) setBranding(r.data); });
  }, []);

  // A new URL deserves a fresh attempt.
  useEffect(() => { setLogoBroken(false); }, [branding?.logo_url]);

  /* Stop the page behind from scrolling while this covers it — otherwise a
     wheel gesture past the end of the form scrolls the list underneath, and
     closing the sheet leaves you somewhere you never navigated to. */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const showLogo = !!branding?.logo_url && !logoBroken;

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const onClientChange = e => {
    const cid = e.target.value;
    const c = clients.find(x => String(x.id) === String(cid)) || null;
    setSelClient(c);
    setForm(f => ({ ...f, client_id: cid, currency: c?.currency || f.currency }));
  };

  const onTermsChange = e => {
    const days = Number(e.target.value);
    if (days === -1) {
      setForm(f => ({ ...f, payment_terms: days, custom_due: true }));
    } else {
      setForm(f => ({ ...f, payment_terms: days, custom_due: false, due_date: addDays(f.issue_date, days) }));
    }
  };

  const onIssueChange = e => {
    const issue = e.target.value;
    setForm(f => ({
      ...f, issue_date: issue,
      due_date: f.custom_due ? f.due_date : addDays(issue, f.payment_terms),
    }));
  };

  const updateLine = (idx, key, val) =>
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, [key]: val } : l));

  const addLine    = ()    => setLines(ls => [...ls, emptyLine()]);
  const removeLine = idx   => setLines(ls => ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls);
  const dupLine    = idx   => setLines(ls => { const copy = [...ls]; copy.splice(idx+1, 0, { ...ls[idx] }); return copy; });

  const pickCatalog = (idx, itemId) => {
    const item = catalog.find(c => String(c.id) === String(itemId));
    if (!item) return;
    updateLine(idx, 'description', item.name + (item.description ? ` — ${item.description}` : ''));
    updateLine(idx, 'unit_price',  Number(item.unit_price) || 0);
    // Only override the tax when the catalog item actually carries a rate.
    // `|| 0` used to zero the line whenever the item had no linked tax rate,
    // silently dropping VAT from the invoice.
    if (item.tax_rate != null && item.tax_rate !== '') {
      updateLine(idx, 'tax_rate', Number(item.tax_rate) || 0);
    }
  };

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.quantity)||0) * (Number(l.unit_price)||0), 0);
    const taxAmount = lines.reduce((s, l) => s + (Number(l.quantity)||0) * (Number(l.unit_price)||0) * (Number(l.tax_rate)||0) / 100, 0);
    let discountAmount = 0;
    if (form.discount_type === 'percent') discountAmount = subtotal * (Number(form.discount_value)||0) / 100;
    else if (form.discount_type === 'fixed') discountAmount = Number(form.discount_value)||0;
    const total = subtotal + taxAmount - discountAmount;
    return { subtotal, taxAmount, discountAmount, total };
  }, [lines, form.discount_type, form.discount_value]);

  const handleSubmit = async (e, { markSent = false } = {}) => {
    e?.preventDefault();
    setError('');
    if (!form.client_id) return setError(t('invoices.select_client_error'));
    const cleanLines = lines
      .filter(l => l.description.trim() && Number(l.quantity) > 0)
      .map(l => ({
        description: l.description.trim(),
        quantity:    Number(l.quantity),
        unit_price:  Number(l.unit_price),
        tax_rate:    Number(l.tax_rate),
        total:       Number(l.quantity) * Number(l.unit_price),
      }));
    if (!cleanLines.length) return setError(t('invoices.line_items_error'));

    const payload = {
      client_id:      form.client_id,
      issue_date:     form.issue_date,
      due_date:       form.due_date,
      currency:       form.currency,
      payment_terms:  Number(form.payment_terms) || 0,
      discount_type:  form.discount_type || null,
      discount_value: Number(form.discount_value) || 0,
      notes:          form.notes,
      memo:           form.memo,
      po_number:      form.po_number || null,
      lang:           form.lang,
      line_items:     cleanLines,
    };

    setSaving(markSent ? 'sent' : true);
    try {
      const res = isEdit
        ? await api.put(`/invoices/${invoice.id}`, payload)
        : await api.post('/invoices', payload);
      if (!res.success) return setError(res.message || 'Error');

      /* Two steps deliberately, in this order: the edit is saved first, so if
         marking it sent fails the work is not lost and the invoice is simply
         still a draft — the honest state. */
      if (markSent) {
        const sent = await api.post(`/invoices/${invoice.id}/mark-sent`, {});
        if (!sent.success) return setError(sent.message || t('common.action_failed'));
        return onSave({ ...res, marked_sent: true });
      }
      /* The client travels with the result. The create endpoint answers with
         only an id and a number, and the "what next" dialog has to know
         whether there is an address to email before it offers to. */
      onSave({ ...res, client_email: selClient?.email || '', client_name: selClient?.name || '' });
    } finally {
      setSaving(false);
    }
  };

  const fromAddress = [
    tenant?.name,
    tenant?.address,
    tenant?.city,
    tenant?.country,
  ].filter(Boolean).join('\n') || 'Your Company Name\nYour Address';

  const toAddress = selClient
    ? [selClient.name, selClient.address, selClient.city, selClient.country].filter(Boolean).join('\n')
    : '';

  return (
    <div className="modal-overlay inv-form-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-form-sheet">

        {/* ── Sheet header bar ───────────────────────── */}
        <div className="inv-form-bar">
          <div className="inv-form-bar-left">
            <button className="btn btn-sm" onClick={onClose} type="button">← {t('common.back')}</button>
            <span className="inv-form-bar-title">
              {isEdit ? `${t('common.edit')} ${invoice.invoice_number}` : t('invoices.new')}
            </span>
          </div>
          <div className="inv-form-bar-right">
            <button type="button" className="btn btn-sm" onClick={onClose}>{t('common.cancel')}</button>
            {/* Saving a draft leaves it a draft — correct, but it left people
                editing the same invoice repeatedly wondering why it never left
                the Draft list. This is the way out that does not email anyone. */}
            {isEdit && invoice?.status === 'draft' && (
              <button type="button" className="btn btn-sm" onClick={() => handleSubmit(null, { markSent: true })} disabled={saving}>
                {saving === 'sent' ? t('common.saving') : t('invoices.save_and_mark_sent')}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>

        <div className="inv-form-body">
          {error && <div className="form-error inv-form-error">{error}</div>}

          {/* ── Missing branding warnings ────────────── */}
          {branding !== null && (!showLogo || !branding?.stamp_url) && (
            <div className="inv-branding-warnings">
              {!showLogo && (
                <div className="inv-branding-alert">
                  <WarningTriangle className="inv-branding-alert-icon" />
                  <div className="inv-branding-alert-text">
                    <strong>{t('invoices.no_logo')}</strong>
                    {' '}{t('invoices.no_logo_sub')}
                    <button
                      type="button"
                      className="inv-branding-link"
                      onClick={() => setAssetModal('logo')}
                    >
                      {t('invoices.add_logo')} →
                    </button>
                  </div>
                </div>
              )}
              {!branding?.stamp_url && (
                <div className="inv-branding-alert inv-branding-alert--stamp">
                  <WarningTriangle className="inv-branding-alert-icon" />
                  <div className="inv-branding-alert-text">
                    <strong>{t('invoices.no_stamp')}</strong>
                    {' '}{t('invoices.no_stamp_sub')}
                    <button
                      type="button"
                      className="inv-branding-link"
                      onClick={() => setAssetModal('stamp')}
                    >
                      {t('invoices.add_stamp')} →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Banner message ──────────────────────── */}
          <div className="inv-banner-row">
            <input
              className="inv-banner-input"
              value={form.memo}
              onChange={set('memo')}
              placeholder={t('invoices.memo_placeholder')}
            />
          </div>

          {/* ── Top meta row ────────────────────────── */}
          <div className="inv-meta-row">
            <div className="inv-meta-left">
              <div className="inv-doc-type">
                <span className="inv-doc-label">{t('invoices.doc_label')}</span>
                {isEdit && invoice?.invoice_number && (
                  <span className="inv-doc-number">#{invoice.invoice_number}</span>
                )}
              </div>
              <div className="inv-field-row">
                <div className="inv-field">
                  <label>{t('invoices.invoice_no')}</label>
                  <input readOnly value={isEdit ? invoice.invoice_number : 'Auto-generated'} className="inv-input-sm inv-input-mono" />
                </div>
                <div className="inv-field">
                  <label>{t('invoices.lang_invoice')}</label>
                  <select value={form.lang} onChange={set('lang')} className="inv-select-sm">
                    <option value="en">English</option>
                    <option value="ar">العربية</option>
                  </select>
                </div>
                <div className="inv-field">
                  <label>{t('common.currency')}</label>
                  <select value={form.currency} onChange={set('currency')} className="inv-select-sm">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
            {/* Logo box — clickable if there is no usable logo.
                `logoBroken` matters: the URL can be valid-looking yet fail to
                load — a signed S3 link that has expired while the form sat
                open, or a stored key whose object is gone. A broken-image icon
                on an invoice is worse than no logo, so fall back to the
                "add your logo" prompt, which is also the fix. */}
            <div
              className={`inv-logo-box ${!showLogo ? 'inv-logo-box--empty' : ''}`}
              onClick={() => !showLogo && setAssetModal('logo')}
              title={showLogo ? tenant?.company_name : 'Click to add your company logo'}
            >
              {showLogo
                ? <img src={branding.logo_url} alt="" onError={() => setLogoBroken(true)} />
                : (
                  <div className="inv-logo-placeholder">
                    <Upload style={{ width: 22, height: 22, color: 'var(--secondary)' }} />
                    <span style={{ color: 'var(--secondary)', fontSize: 10, fontWeight: 700, marginTop: 4 }}>{t('invoices.add_logo_short')}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{t('invoices.click_here')}</span>
                  </div>
                )
              }
            </div>
          </div>

          {/* ── From / To + Dates ───────────────────── */}
          <div className="inv-from-to-grid">
            <div className="inv-from-to-col">
              <div className="inv-section-label">{t('invoices.from')}</div>
              <div className="inv-address-box">{fromAddress}</div>
            </div>
            <div className="inv-from-to-col">
              <div className="inv-section-label">
                {t('invoices.to')} *
                <div style={{ display:'flex', alignItems:'center', gap:6, flex:1 }}>
                  <select
                    value={form.client_id}
                    onChange={onClientChange}
                    className="inv-client-select"
                    style={{ flex:1 }}
                  >
                    <option value="">— {t('invoices.select_client')} —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button
                    type="button"
                    title={t('invoices.add_new_client')}
                    onClick={() => setShowNewClient(true)}
                    style={{
                      width:30, height:30, borderRadius:8, border:'1.5px dashed var(--primary)',
                      background:'transparent', color:'var(--primary)', cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                      fontSize:18, fontWeight:700, transition:'all .15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background='var(--primary)'; e.currentTarget.style.color='#fff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--primary)'; }}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="inv-address-box inv-to-address">
                {toAddress || <span className="inv-addr-placeholder">{t('invoices.address_placeholder')}</span>}
              </div>
            </div>
            <div className="inv-dates-col">
              <div className="inv-field">
                <label>{t('invoices.issue_date')}</label>
                <input type="date" value={form.issue_date} onChange={onIssueChange} className="inv-input-sm" />
              </div>
              <div className="inv-field">
                <label>{t('invoices.invoice_due')}</label>
                <select
                  value={form.payment_terms}
                  onChange={onTermsChange}
                  className="inv-select-sm"
                >
                  {DUE_OPTIONS.map(o => (
                    <option key={o.days} value={o.days}>
                      {o.key ? t(`invoices.${o.key}`) : t('invoices.after_days', { count: o.days })}
                    </option>
                  ))}
                </select>
              </div>
              {form.custom_due && (
                <div className="inv-field">
                  <label>{t('invoices.due_date')}</label>
                  <input type="date" value={form.due_date} onChange={set('due_date')} className="inv-input-sm" />
                </div>
              )}
              <div className="inv-field">
                <label>{t('invoices.po_number')}</label>
                <input
                  value={form.po_number}
                  onChange={set('po_number')}
                  placeholder="PO-123"
                  className="inv-input-sm"
                />
              </div>
            </div>
          </div>

          {/* ── Line items ──────────────────────────── */}
          <div className="inv-items-section">
            <div className="inv-items-head">
              <span className="inv-col-name">{t('invoices.item_name')}</span>
              <span className="inv-col-qty">{t('invoices.quantity')}</span>
              <span className="inv-col-rate">{t('invoices.rate')}</span>
              <span className="inv-col-tax">{t('invoices.tax_rate')} %</span>
              <span className="inv-col-amt">{t('common.amount')}</span>
              <span className="inv-col-actions" />
            </div>

            {lines.map((l, idx) => {
              const lineTotal = (Number(l.quantity)||0) * (Number(l.unit_price)||0);
              return (
                <div className="inv-item-row" key={idx}>
                  <div className="inv-col-name">
                    <input
                      className="inv-item-desc"
                      placeholder={t('invoices.item_placeholder')}
                      value={l.description}
                      onChange={e => updateLine(idx, 'description', e.target.value)}
                    />
                    {catalog.length > 0 && (
                      <select
                        className="inv-catalog-pick"
                        defaultValue=""
                        onChange={e => { pickCatalog(idx, e.target.value); e.target.value = ''; }}
                      >
                        <option value="">+ {t('invoices.from_catalog')}</option>
                        {catalog.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                  </div>
                  <input
                    className="inv-col-qty inv-num-input"
                    type="number" min={0} step="any"
                    value={l.quantity}
                    onChange={e => updateLine(idx, 'quantity', e.target.value)}
                  />
                  <div className="inv-rate-cell">
                    <input
                      className="inv-col-rate inv-num-input"
                      type="number" min={0} step="any"
                      value={l.unit_price}
                      onChange={e => updateLine(idx, 'unit_price', e.target.value)}
                    />
                    <span className="inv-currency-tag">{form.currency}</span>
                  </div>
                  <input
                    className="inv-col-tax inv-num-input"
                    type="number" min={0} max={100} step="any"
                    value={l.tax_rate}
                    onChange={e => updateLine(idx, 'tax_rate', e.target.value)}
                  />
                  <span className="inv-col-amt inv-line-total">
                    {fmtCurrency(lineTotal, form.currency)}
                  </span>
                  <div className="inv-col-actions">
                    <button type="button" className="icon-btn" title={t('common.duplicate')} onClick={() => dupLine(idx)}><Copy /></button>
                    <button type="button" className="icon-btn danger" title={t('common.delete')} onClick={() => removeLine(idx)} disabled={lines.length === 1}><Trash /></button>
                  </div>
                </div>
              );
            })}

            <button type="button" className="inv-new-line-btn" onClick={addLine}>
              <Plus /> {t('invoices.new_line')}
            </button>
          </div>

          {/* ── Totals + notes ──────────────────────── */}
          <div className="inv-footer-grid">
            <div className="inv-notes-col">
              <div className="inv-field">
                <label>{t('common.notes')}</label>
                <textarea rows={3} value={form.notes} onChange={set('notes')} placeholder={t('invoices.notes_placeholder')} />
              </div>
              {form.discount_type !== '' && (
                <div className="inv-field" style={{ marginTop:8 }}>
                  <label>{t('common.discount')}</label>
                  {/* Same fix as the quote editor: `inv-field` styles only the
                      label, so these two rendered as raw browser controls
                      beside properly styled fields. */}
                  <div className="inv-discount-pair">
                    <select className="inv-select-sm inv-discount-type"
                            value={form.discount_type} onChange={set('discount_type')}>
                      <option value="">{t('common.none')}</option>
                      <option value="percent">%</option>
                      <option value="fixed">{form.currency}</option>
                    </select>
                    <input className="inv-input-sm inv-discount-value"
                           type="number" min={0} step="any" value={form.discount_value} onChange={set('discount_value')} />
                  </div>
                </div>
              )}
              {form.discount_type === '' && (
                <button type="button" className="inv-add-discount-btn" onClick={() => setForm(f => ({...f, discount_type:'percent'}))}>
                  + {t('invoices.add_discount')}
                </button>
              )}
            </div>

            <div className="inv-totals-col">
              <div className="inv-totals-row">
                <span>{t('invoices.sub_total')}</span>
                <span>{fmtCurrency(totals.subtotal, form.currency)}</span>
              </div>
              {totals.discountAmount > 0 && (
                <div className="inv-totals-row">
                  <span>{t('common.discount')}</span>
                  <span>−{fmtCurrency(totals.discountAmount, form.currency)}</span>
                </div>
              )}
              {totals.taxAmount > 0 && (
                <div className="inv-totals-row">
                  <span>
                    {t('invoices.value_added_tax')}
                    <span className="inv-tax-badge">
                      {lines.length === 1 ? `${lines[0].tax_rate}%` : 'mixed'}
                    </span>
                  </span>
                  <span>{fmtCurrency(totals.taxAmount, form.currency)}</span>
                </div>
              )}
              <div className="inv-totals-row inv-total-line">
                <span>{t('common.total')} ({form.currency})</span>
                <span>{fmtCurrency(totals.total, form.currency)}</span>
              </div>
              <div className="inv-total-due-bar">
                <span>{t('invoices.total_due')}</span>
                <span className="inv-total-due-amount">
                  {form.currency} {totals.total.toLocaleString('en', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* ── Footer info ─────────────────────────── */}
          {(tenant?.email || tenant?.phone) && (
            <div className="inv-form-footer">
              {tenant.email && <span>Email: {tenant.email}</span>}
              {tenant.phone && <span>Phone: {tenant.phone}</span>}
            </div>
          )}
        </div>
      </div>

      {showNewClient && (
        <QuickAddClientModal
          onClose={() => setShowNewClient(false)}
          onCreated={async newClient => {
            setShowNewClient(false);
            await reloadClients();
            setSelClient(newClient);
            setForm(f => ({ ...f, client_id: String(newClient.id), currency: newClient.currency || f.currency }));
          }}
        />
      )}

      {assetModal && (
        <BrandAssetModal
          asset={assetModal}
          currentUrl={assetModal === 'logo' ? branding?.logo_url : branding?.stamp_url}
          onClose={() => setAssetModal(null)}
          /* Update in place so the warning clears and the logo shows
             without discarding the invoice being drafted. */
          onUploaded={(field, filename) => setBranding(b => ({ ...(b || {}), [field]: filename }))}
        />
      )}
    </div>
  );
}

/* ── Quick-Add Client popup ───────────────────────────── */
function QuickAddClientModal({ onClose, onCreated }) {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const { tenant } = useContext(AuthContext);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company_name: '', billing_address: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.name.trim()) { setError(t('common.name_required')); return; }
    setSaving(true);
    setError('');
    try {
      // "+971" on its own is a dial code, not a phone number — don't save it.
      const res = await api.post('/clients', { ...form, phone: stripDialOnly(form.phone), status: 'active' });
      if (res.success) {
        showToast(t('common.created_success'));
        onCreated({ id: res.id, name: form.name, currency: null });
      } else {
        setError(res.message || 'Failed to create client');
      }
    } catch { setError(t('common.network_error')); }
    finally { setSaving(false); }
  };

  return (
    <div
      style={{
        position:'fixed', inset:0, zIndex:3000,
        background:'rgba(0,0,0,.55)',
        display:'flex', alignItems:'center', justifyContent:'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background:'#fff', borderRadius:20, width:'100%', maxWidth:460,
        boxShadow:'0 20px 60px rgba(0,0,0,.2)', overflow:'hidden',
        animation:'slideUp .22s ease',
      }}>
        {/* Header */}
        <div style={{
          background:'linear-gradient(135deg,#0D1B2A,#1e3448)',
          padding:'20px 24px', display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          <div>
            <div style={{ color:'#fff', fontWeight:700, fontSize:17 }}>{t('invoices.new_client')}</div>
            <div style={{ color:'rgba(255,255,255,.7)', fontSize:12, marginTop:2 }}>{t('invoices.new_client_sub')}</div>
          </div>
          <button onClick={onClose} style={{
            width:32, height:32, borderRadius:8, border:'1px solid rgba(255,255,255,.3)',
            background:'rgba(255,255,255,.1)', color:'#fff', cursor:'pointer',
            fontSize:18, display:'flex', alignItems:'center', justifyContent:'center',
          }}>×</button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ padding:'24px' }}>
          {error && (
            <div style={{ background:'#fef2f2', color:'#dc2626', padding:'10px 14px', borderRadius:8, fontSize:13, marginBottom:16 }}>
              {error}
            </div>
          )}

          {/* Avatar preview */}
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
            <div style={{
              width:52, height:52, borderRadius:14, background:'#0D1B2A', color:'#fff',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:20, fontWeight:700, flexShrink:0,
            }}>
              {(form.name || '?').slice(0,2).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight:700, fontSize:15, color:'#1a1a2e' }}>{form.name || 'New Client'}</div>
              <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{form.company_name || 'No company'}</div>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 16px' }}>
            <div style={{ gridColumn:'1/-1' }}>
              <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:5 }}>{t('common.full_name')} *</label>
              <input
                value={form.name} onChange={set('name')} required
                placeholder={t('common.ph_person')}
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:8, fontSize:14, boxSizing:'border-box', outline:'none' }}
                onFocus={e => e.target.style.borderColor='#0D1B2A'}
                onBlur={e => e.target.style.borderColor='#e5e7eb'}
              />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:5 }}>{t('common.company')}</label>
              <input
                value={form.company_name} onChange={set('company_name')}
                placeholder={t('invoices.ph_company')}
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:8, fontSize:14, boxSizing:'border-box', outline:'none' }}
                onFocus={e => e.target.style.borderColor='#0D1B2A'}
                onBlur={e => e.target.style.borderColor='#e5e7eb'}
              />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:5 }}>{t('common.email')}</label>
              <input
                type="email" value={form.email} onChange={set('email')}
                placeholder="client@example.com"
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:8, fontSize:14, boxSizing:'border-box', outline:'none' }}
                onFocus={e => e.target.style.borderColor='#0D1B2A'}
                onBlur={e => e.target.style.borderColor='#e5e7eb'}
              />
            </div>
            <div style={{ gridColumn:'1/-1', '--ph-pad-y':'9px', '--ph-pad-x':'12px', '--ph-radius':'8px', '--ph-border':'1.5px', '--ph-font':'14px' }}>
              <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:5 }}>{t('common.phone')}</label>
              <PhoneInput
                value={form.phone}
                onChange={v => setForm(f => ({ ...f, phone: v }))}
                defaultCountry={tenant?.country || 'AE'}
                placeholder="5X XXX XXXX"
              />
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:5 }}>{t('common.billing_address')}</label>
              <textarea
                value={form.billing_address} onChange={set('billing_address')} rows={2}
                placeholder={t('invoices.ph_address')}
                style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:8, fontSize:14, boxSizing:'border-box', outline:'none', resize:'vertical' }}
                onFocus={e => e.target.style.borderColor='#0D1B2A'}
                onBlur={e => e.target.style.borderColor='#e5e7eb'}
              />
            </div>
          </div>

          {/* Footer */}
          <div style={{ display:'flex', gap:10, marginTop:20 }}>
            <button type="button" onClick={onClose} style={{
              flex:1, padding:'10px', borderRadius:10, border:'1.5px solid #e5e7eb',
              background:'#fff', cursor:'pointer', fontWeight:600, fontSize:14, color:'#374151',
            }}>{t('common.cancel')}</button>
            <button type="submit" disabled={saving} style={{
              flex:2, padding:'10px', borderRadius:10, border:'none',
              background:'linear-gradient(135deg,#0D1B2A,#1e3448)', color:'#fff',
              cursor:saving?'not-allowed':'pointer', fontWeight:700, fontSize:14,
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              opacity:saving?0.7:1,
            }}>
              {saving
                ? <><span style={{ width:16,height:16,border:'2px solid rgba(255,255,255,.4)',borderTopColor:'#fff',borderRadius:'50%',display:'inline-block',animation:'spin .6s linear infinite' }} /> Saving…</>
                : <><User style={{width:15,height:15}} /> Create &amp; Select</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
