import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'iconoir-react';
import api from '../lib/api.js';
import './LoginPage.css';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

const ICON_BADGE = {
  width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
};
const BADGE_SUCCESS = { ...ICON_BADGE, background: 'linear-gradient(135deg,#16a34a,#22c55e)', boxShadow: '0 8px 32px rgba(22,163,74,0.30)' };

export default function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';

  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Backend always responds success (prevents email enumeration), so we
      // show the same confirmation regardless of whether the email exists.
      const res = await api.post('/auth/forgot-password', { email });
      if (res.success) setSent(true);
      else setError(res.message || (isRTL ? 'حدث خطأ. حاول مرة أخرى.' : 'Something went wrong. Please try again.'));
    } catch {
      setError(isRTL ? 'حدث خطأ في الشبكة.' : 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`login-root ${isRTL ? 'rtl' : ''}`}>
      <div className="login-left">
        <div className="login-branding">
          <div className="login-brand-row">
            <img src="/logos/invroot-sidebar-logo-600-200-white-logo.png" alt="INVROOT" className="login-brand-logo" />
          </div>
          <h2 className="login-headline">
            {isRTL ? <>استعد <span>الوصول</span></> : <>Recover <span>Access</span></>}
          </h2>
          <p className="login-tagline">
            {isRTL
              ? 'لا تقلق — سنرسل لك رابطاً آمناً لإعادة تعيين كلمة المرور والعودة إلى عملك بسرعة.'
              : "Don't worry — we'll email you a secure link to reset your password and get you back to business."}
          </p>
        </div>
      </div>

      <div className="login-right">
        <div className="login-card">
          <div className="login-mobile-brand">
            <img src="/logos/invroot-600_200-colored-logo.png" alt="INVROOT" />
          </div>

          <div className="login-lang-row">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                className={`lang-chip ${i18n.language === l.code ? 'active' : ''}`}
                onClick={() => i18n.changeLanguage(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>

          {sent ? (
            <>
              <div style={BADGE_SUCCESS}>
                <Check width={32} height={32} strokeWidth={3} />
              </div>
              <h1 className="login-title" style={{ textAlign: 'center' }}>
                {isRTL ? 'تحقق من بريدك' : 'Check your inbox'}
              </h1>
              <p className="login-subtitle" style={{ textAlign: 'center' }}>
                {t('auth.reset_link_sent')}
              </p>
              <div className="alert alert-success" style={{ marginTop: 4 }}>
                {isRTL
                  ? 'إذا كان هذا البريد مسجّلاً لدينا، فستصلك رسالة خلال دقائق. لا تنسَ التحقق من مجلد الرسائل غير المرغوبة.'
                  : "If that email is registered, a message will arrive within a few minutes. Don't forget to check your spam folder."}
              </div>
              <Link to="/login" className="btn btn-primary btn-full" style={{ marginTop: 16 }}>
                {isRTL ? 'العودة لتسجيل الدخول' : 'Back to sign in'}
              </Link>
            </>
          ) : (
            <>
              <h1 className="login-title">{isRTL ? 'نسيت كلمة المرور؟' : 'Forgot your password?'}</h1>
              <p className="login-subtitle">
                {isRTL
                  ? 'أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة التعيين.'
                  : "Enter your email and we'll send you a reset link."}
              </p>

              {error && <div className="alert alert-error">{error}</div>}

              <form onSubmit={handleSubmit} className="login-form">
                <div className="form-group">
                  <label htmlFor="email">{t('auth.email')}</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="you@company.com"
                  />
                </div>

                <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                  {loading ? <span className="spinner spinner-sm" /> : (isRTL ? 'إرسال رابط إعادة التعيين' : 'Send reset link')}
                </button>
              </form>

              <p className="login-switch">
                <Link to="/login" className="link-subtle">
                  {isRTL ? '← العودة لتسجيل الدخول' : '← Back to sign in'}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
