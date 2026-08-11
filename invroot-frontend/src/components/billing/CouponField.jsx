/**
 * Coupon entry for the subscription flow.
 *
 * Applying a code here is a preview, not a commitment: the server re-validates
 * when the checkout session is created, because nothing stops a client posting
 * a code it never checked. What is shown is what Stripe will charge — the
 * figures come from Stripe's own coupon object, not from local arithmetic.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Xmark, Percentage } from 'iconoir-react';
import api from '../../lib/api.js';
import './CouponField.css';

export default function CouponField({ plan, currency, monthly, onApplied, applied }) {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  const [open, setOpen]   = useState(false);
  const [code, setCode]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const money = (n) => {
    try {
      return new Intl.NumberFormat(isRTL ? 'ar-AE' : 'en-US', {
        style: 'currency', currency: currency || 'AED', maximumFractionDigits: 2,
      }).format(n);
    } catch { return `${currency} ${n}`; }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/billing/validate-coupon', { code: code.trim(), plan });
      if (res.valid) {
        onApplied(res.data);
        setError('');
      } else {
        /* The server decides the wording. Inventing client-side reasons would
           let someone tell "no such code" apart from "not for this plan",
           which is a nudge towards guessing valid ones. */
        setError(res.message || (isRTL ? 'هذا الرمز غير صالح.' : "That code isn't valid."));
        onApplied(null);
      }
    } catch {
      setError(isRTL ? 'تعذّر التحقق. حاول مرة أخرى.' : "Couldn't check that code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    onApplied(null);
    setCode('');
    setError('');
    setOpen(false);
  };

  if (applied) {
    return (
      <div className="cf-applied">
        <div className="cf-applied-head">
          <span className="cf-applied-badge"><Check /> {applied.code}</span>
          <button type="button" className="cf-remove" onClick={remove}>
            {isRTL ? 'إزالة' : 'Remove'}
          </button>
        </div>
        <div className="cf-applied-lines">
          <div className="cf-line">
            <span>{isRTL ? 'السعر' : 'Plan'}</span>
            <span className="cf-strike">{money(applied.original)}</span>
          </div>
          <div className="cf-line cf-line--off">
            <span>
              {applied.discount_type === 'percent'
                ? `${applied.percent_off}% ${isRTL ? 'خصم' : 'off'}`
                : (isRTL ? 'خصم' : 'Discount')}
            </span>
            <span>−{money(applied.discount)}</span>
          </div>
          <div className="cf-line cf-line--total">
            <span>{isRTL ? 'الإجمالي' : 'You pay'}</span>
            <span>{money(applied.total)}</span>
          </div>
        </div>
        {/* A one-off 50% and a forever 50% are very different purchases. */}
        <p className="cf-duration">
          {isRTL ? 'الخصم يسري ' : 'Discount applies '}{applied.duration_label}.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="cf-toggle" onClick={() => setOpen(true)}>
        <Percentage /> {isRTL ? 'لديك رمز خصم؟' : 'Have a discount code?'}
      </button>
    );
  }

  return (
    <form className="cf-form" onSubmit={submit}>
      <div className="cf-row">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
          placeholder={isRTL ? 'رمز الخصم' : 'Discount code'}
          autoFocus
          disabled={busy}
          // Codes are matched case-insensitively; uppercase is just clearer.
          style={{ textTransform: 'uppercase' }}
        />
        <button type="submit" className="cf-apply" disabled={busy || !code.trim()}>
          {busy ? '…' : (isRTL ? 'تطبيق' : 'Apply')}
        </button>
      </div>
      {error && <div className="cf-error"><Xmark /> {error}</div>}
    </form>
  );
}
