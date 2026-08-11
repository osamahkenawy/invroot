import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Xmark, MailOut } from 'iconoir-react';
import api from '../lib/api.js';
import './LoginPage.css';
import './SignupPage.css';

/**
 * Email verification landing page.
 *
 * This previously rendered against `.su-success` and `.su-success-icon`, which
 * exist in no stylesheet — so the page came out as raw unstyled HTML at the
 * exact moment a new customer first sees the product. It now reuses the
 * signup completion card, which is already designed and already handles RTL
 * and reduced motion.
 */
export default function VerifyEmailPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('');
  const requested = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage(isRTL ? 'رابط التحقق غير صالح.' : 'This verification link is not valid.');
      return;
    }
    // Guard against React StrictMode's double-invoke in dev — the token is
    // single-use, so a second call would report a false failure.
    if (requested.current) return;
    requested.current = true;
    api.get(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(res => {
        if (res.success) { setStatus('success'); return; }
        setStatus('error');
        /* Localise from the code. The server's `message` is English-only, and
           showing it verbatim put an English sentence in the middle of an
           otherwise Arabic page. */
        const byCode = {
          TOKEN_INVALID: isRTL
            ? 'هذا الرابط لم يعد صالحاً — رابط التحقق يُستخدم مرة واحدة فقط وينتهي بعد فترة.'
            : 'This link is no longer valid — verification links are single-use and expire after a while.',
          TOKEN_MISSING: isRTL ? 'رابط التحقق غير مكتمل.' : 'This verification link is incomplete.',
        };
        setMessage(byCode[res.code]
          || (isRTL ? 'فشل التحقق من البريد الإلكتروني.' : 'Email verification failed.'));
      })
      .catch(() => {
        setStatus('error');
        setMessage(isRTL ? 'حدث خطأ في الشبكة. حاول مرة أخرى.' : 'Network error. Please try again.');
      });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`su-root su-done-root ${isRTL ? 'rtl' : ''}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="su-done-card">
        <img src="/logos/invroot-600_200-colored-logo.png" alt="INVROOT" className="su-done-logo" />

        {status === 'verifying' && (
          <>
            <div className="su-done-badge su-done-badge--neutral">
              <MailOut strokeWidth={2} />
            </div>
            <h2 className="su-done-title">{isRTL ? 'جارٍ التحقق…' : 'Verifying your email…'}</h2>
            <p className="su-done-lead">
              {isRTL ? 'لحظة من فضلك، نحن نؤكد بريدك الإلكتروني.' : 'One moment while we confirm your address.'}
            </p>
            <span className="spinner spinner-lg su-verify-spinner" />
          </>
        )}

        {status === 'success' && (
          <>
            <div className="su-done-badge">
              <span className="su-done-ring" />
              <span className="su-done-ring su-done-ring--2" />
              <Check strokeWidth={3} />
            </div>
            <h2 className="su-done-title">
              {isRTL ? 'تم التحقق من بريدك!' : 'Email verified'}
            </h2>
            <p className="su-done-lead">
              {isRTL
                ? 'حسابك جاهز. سجّل الدخول لإكمال إعداد شركتك وإصدار أول فاتورة.'
                : 'Your account is ready. Sign in to finish setting up your company and send your first invoice.'}
            </p>
            <Link to="/login?verified=1" className="su-done-cta">
              {isRTL ? 'تسجيل الدخول' : 'Sign in'}
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="su-done-badge su-done-badge--error">
              <Xmark strokeWidth={3} />
            </div>
            <h2 className="su-done-title">{isRTL ? 'تعذّر التحقق' : "We couldn't verify that link"}</h2>
            <p className="su-done-lead">{message}</p>
            <Link to="/login" className="su-done-cta">{isRTL ? 'تسجيل الدخول' : 'Sign in'}</Link>
            {/* Below the button, matching the signup card — above it, this
                collided with the CTA. Most failures are simply a link that was
                already used, so say so rather than leave a dead end. */}
            <p className="su-done-spam">
              {isRTL
                ? 'إذا كنت قد تحققت من بريدك بالفعل، يمكنك تسجيل الدخول مباشرة.'
                : "If you've already verified this address, you can just sign in."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
