import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, CreditCard, Mail, OpenNewWindow, WarningTriangle } from 'iconoir-react';
import api from '../../lib/api.js';
import CouponField from '../../components/billing/CouponField.jsx';
import Loader from '../../components/Loader.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';
import { useToastContext } from '../../context/ToastContext.jsx';
import './BillingSettings.css';

/** Usage bar; turns amber past 80% and red once the allowance is spent. */
function UsageBar({ label, used, limit, unlimited }) {
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const tone = unlimited ? 'ok' : pct >= 100 ? 'full' : pct >= 80 ? 'warn' : 'ok';
  return (
    <div className="bil-usage">
      <div className="bil-usage-head">
        <span className="bil-usage-label">{label}</span>
        <span className={`bil-usage-count ${tone}`}>
          {used.toLocaleString()} / {unlimited ? '∞' : limit.toLocaleString()}
        </span>
      </div>
      <div className="bil-usage-track">
        <div className={`bil-usage-fill ${tone}`} style={{ width: unlimited ? '100%' : `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── Enterprise enquiry form ── */
function EnquiryForm({ onClose, onSent }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { user, tenant } = useContext(AuthContext);
  const [form, setForm] = useState({
    contact_name: user?.full_name || '',
    contact_email: user?.email || '',
    phone: tenant?.phone || '',
    team_size: '',
    message: '',
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSending(true);
    const res = await api.post('/billing/enterprise-enquiry', form);
    setSending(false);
    if (res.success) onSent(res.message);
    else setError(res.message || t('common.action_failed'));
  };

  return (
    <div className="bil-modal-backdrop" onClick={onClose}>
      <div className={`bil-modal ${isRTL ? 'rtl' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="bil-modal-head">
          <h3>{t('billing.enquiry_title')}</h3>
          <button className="bil-modal-x" onClick={onClose} aria-label={t('common.close')}>×</button>
        </div>
        <form onSubmit={submit}>
          <div className="bil-modal-body">
            <p className="bil-modal-lead">{t('billing.enquiry_lead')}</p>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-row">
              <div className="form-group">
                <label>{t('settings.full_name')}</label>
                <input value={form.contact_name} onChange={set('contact_name')} />
              </div>
              <div className="form-group">
                <label>{t('common.email')} *</label>
                <input type="email" value={form.contact_email} onChange={set('contact_email')} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('common.phone')}</label>
                <input value={form.phone} onChange={set('phone')} />
              </div>
              <div className="form-group">
                <label>{t('billing.team_size')}</label>
                <select value={form.team_size} onChange={set('team_size')}>
                  <option value="">{t('common.select')}…</option>
                  <option value="1-10">1–10</option>
                  <option value="11-25">11–25</option>
                  <option value="26-50">26–50</option>
                  <option value="51-100">51–100</option>
                  <option value="100+">100+</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>{t('billing.requirements')}</label>
              <textarea rows={4} value={form.message} onChange={set('message')}
                placeholder={t('billing.requirements_ph')} maxLength={2000} />
            </div>
          </div>
          <div className="bil-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={sending}>
              {sending ? <span className="spinner spinner-sm" /> : <><Mail style={{ width: 15, height: 15 }} /> {t('billing.send_enquiry')}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BillingSettings() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { showToast } = useToastContext();
  const [params, setParams] = useSearchParams();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState('');
  const [enquiry, setEnquiry] = useState(false);

  const load = useCallback(() => {
    api.get('/billing/plans').then(r => { if (r.success) setData(r.data); setLoading(false); });
  }, []);
  useEffect(load, [load]);

  /* Stripe sends the tenant back here with a flag. Surface the outcome, then
     strip the param so a refresh doesn't repeat the message. */
  useEffect(() => {
    if (params.get('success') === '1') {
      showToast(t('billing.upgrade_success'), 'success');
      // The plan flips when Stripe's webhook lands, which may be a moment later.
      setTimeout(load, 1500);
    } else if (params.get('cancelled') === '1') {
      showToast(t('billing.upgrade_cancelled'), 'warning');
    } else return;
    const next = new URLSearchParams(params);
    next.delete('success'); next.delete('cancelled');
    setParams(next, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Applied coupon, keyed by plan — each card prices itself independently, and
     a code valid for one plan may not be valid for another. */
  const [coupons, setCoupons] = useState({});

  const upgrade = async (plan) => {
    setBusy(plan);
    /* The code goes to the server, which validates it AGAIN before creating
       the session. The preview shown here has no authority over the charge. */
    const res = await api.post('/stripe/create-checkout', {
      plan,
      coupon: coupons[plan]?.code || undefined,
    });
    setBusy('');
    if (res.success && res.url) {
      // Hand off to Stripe's hosted checkout.
      window.location.href = res.url;
    } else {
      showToast(res.message || t('common.action_failed'), 'error');
    }
  };

  /* A plan chosen at signup but never paid for. Signup grants nothing, so this
     is the customer's own choice coming back to be completed — not an upsell.
     Auto-started once so the promised flow continues without a second click;
     if Stripe refuses (unconfigured, network) `upgrade` toasts the error and
     the banner stays put with a button, rather than dead-ending the signup. */
  const pendingPlan = params.get('checkout') || '';
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!pendingPlan || autoStarted.current || loading) return;
    autoStarted.current = true;
    upgrade(pendingPlan);
  }, [pendingPlan, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissPending = async () => {
    await api.post('/stripe/dismiss-pending');
    const next = new URLSearchParams(params);
    next.delete('checkout');
    setParams(next, { replace: true });
  };

  const manageBilling = async () => {
    setBusy('portal');
    const res = await api.post('/stripe/billing-portal');
    setBusy('');
    if (res.success && res.url) window.location.href = res.url;
    else showToast(res.message || t('common.action_failed'), 'error');
  };

  if (loading) return <Loader fullPage />;
  if (!data)   return <div className="empty-state">{t('common.no_data')}</div>;

  const usage = data.usage || {};
  const anyAtLimit = Object.values(usage).some(u => !u.unlimited && u.used >= u.limit);

  /* Plan ids are internal ("starter"); the cards carry the localised label.
     Fall back to the id so an unmapped plan still names itself rather than
     rendering a blank where the plan name should be. */
  const planLabel = (id) => (data.plans || []).find(p => p.name === id)?.label || id;

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <CreditCard className="ss-icon" />
        <div>
          <h3>{t('billing.title')}</h3>
          <p>{t('billing.subtitle')}</p>
        </div>
      </div>

      {/* The signup choice, still unpaid. Says plainly that the workspace is on
          the trial in the meantime — the old flow implied the paid plan was
          already active, which it now genuinely isn't. */}
      {pendingPlan && (
        <div className="alert alert-warning bil-pending">
          <div>
            <strong>{t('billing.pending_title', { plan: planLabel(pendingPlan) })}</strong>
            <p>{t('billing.pending_body', { plan: planLabel(pendingPlan) })}</p>
          </div>
          <div className="bil-pending-actions">
            <button className="btn btn-primary btn-sm" onClick={() => upgrade(pendingPlan)} disabled={busy === pendingPlan}>
              {busy === pendingPlan ? <span className="spinner spinner-sm" /> : t('billing.pending_pay')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={dismissPending}>{t('billing.pending_later')}</button>
          </div>
        </div>
      )}

      {data.current_is_retired && (
        <div className="alert alert-warning">
          <WarningTriangle style={{ width: 16, height: 16, verticalAlign: '-3px', marginInlineEnd: 6 }} />
          {t('billing.retired_plan', { plan: data.current_plan })}
        </div>
      )}

      {/* ── Usage ── */}
      <div className="settings-card">
        <div className="settings-card-title">{t('billing.your_usage')}</div>
        {anyAtLimit && (
          <div className="alert alert-error" style={{ marginBottom: 14 }}>
            {t('billing.at_limit')}
          </div>
        )}
        <div className="bil-usage-grid">
          <UsageBar label={t('nav.clients')}  {...usage.clients} />
          <UsageBar label={t('nav.invoices')} {...usage.invoices} />
          <UsageBar label={t('billing.team_members')} {...usage.users} />
        </div>
        <p className="bil-usage-note">{t('billing.usage_note')}</p>
      </div>

      {/* ── Plans ── */}
      <div className="bil-plans">
        {data.plans.map(p => (
          <div key={p.name} className={`bil-plan ${p.current ? 'current' : ''} ${p.sales_led ? 'sales' : ''}`}>
            {p.current && <div className="bil-plan-badge">{t('billing.current_plan')}</div>}

            <div className="bil-plan-name">{t(`billing.plan_${p.name}`, { defaultValue: p.label })}</div>

            <div className="bil-plan-price">
              {p.sales_led ? (
                <span className="bil-plan-custom">{t('billing.custom_pricing')}</span>
              ) : p.monthly === 0 ? (
                <span className="bil-plan-custom">{t('billing.free')}</span>
              ) : (
                <>
                  <span className="bil-plan-cur">{p.currency}</span>
                  <span className="bil-plan-amt">{p.monthly}</span>
                  <span className="bil-plan-per">/{t('billing.month')}</span>
                </>
              )}
            </div>

            <ul className="bil-plan-features">
              {p.features.map((f, i) => (
                <li key={i}><Check /> {f}</li>
              ))}
            </ul>

            <div className="bil-plan-action">
              {/* `manageable` not `current`: a tenant can be on a plan without a
                  Stripe subscription (seeded, or set by an admin), and there is
                  nothing to manage in the portal in that case. */}
              {p.manageable ? (
                <button className="btn btn-outline btn-full" onClick={manageBilling} disabled={busy === 'portal'}>
                  {busy === 'portal'
                    ? <span className="spinner spinner-sm" />
                    : <><OpenNewWindow style={{ width: 14, height: 14 }} /> {t('billing.manage')}</>}
                </button>
              ) : p.current && p.purchasable ? (
                <>
                  <button className="btn btn-primary btn-full" onClick={() => upgrade(p.name)} disabled={busy === p.name}>
                    {busy === p.name ? <span className="spinner spinner-sm" /> : t('billing.subscribe')}
                  </button>
                  {/* Activating your current plan is still a purchase, so a code
                      has to be offered here too — not only on an upgrade. */}
                  <CouponField
                    plan={p.name}
                    currency={p.currency || 'AED'}
                    monthly={p.monthly}
                    applied={coupons[p.name] || null}
                    onApplied={(data) => setCoupons(c => ({ ...c, [p.name]: data }))}
                  />
                </>
              ) : p.current ? (
                <button className="btn btn-outline btn-full" disabled>{t('billing.current_plan')}</button>
              ) : p.sales_led ? (
                <button className="btn btn-primary btn-full" onClick={() => setEnquiry(true)}>
                  <Mail style={{ width: 15, height: 15 }} /> {t('billing.contact_sales')}
                </button>
              ) : p.purchasable ? (
                <>
                  <button className="btn btn-primary btn-full" onClick={() => upgrade(p.name)} disabled={busy === p.name}>
                    {busy === p.name ? <span className="spinner spinner-sm" /> : t('billing.upgrade_to', { plan: p.label })}
                  </button>
                  <CouponField
                    plan={p.name}
                    currency={p.currency || 'AED'}
                    monthly={p.monthly}
                    applied={coupons[p.name] || null}
                    onApplied={(data) => setCoupons(c => ({ ...c, [p.name]: data }))}
                  />
                </>
              ) : (
                <button className="btn btn-outline btn-full" disabled>{t('billing.unavailable')}</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="bil-footnote">
        {t('billing.footnote')}{' '}
        {data.sales_email && <a href={`mailto:${data.sales_email}`}>{data.sales_email}</a>}
      </p>

      {enquiry && (
        <EnquiryForm
          onClose={() => setEnquiry(false)}
          onSent={(msg) => { setEnquiry(false); showToast(msg || t('billing.enquiry_sent'), 'success'); }}
        />
      )}
    </div>
  );
}
