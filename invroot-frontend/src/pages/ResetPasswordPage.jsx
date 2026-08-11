import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, Check, Xmark } from 'iconoir-react';
import api from '../lib/api.js';
import PasswordStrength from '../components/PasswordStrength.jsx';
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
const BADGE_ERROR   = { ...ICON_BADGE, background: 'linear-gradient(135deg,#dc2626,#ef4444)', boxShadow: '0 8px 32px rgba(220,38,38,0.30)' };

export default function ResetPasswordPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [done,     setDone]     = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) { setError(isRTL ? 'رابط غير صالح.' : 'Invalid reset link.'); return; }
    if (password.length < 8) {
      setError(isRTL ? 'يجب أن تكون كلمة المرور 8 أحرف على الأقل.' : 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError(isRTL ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/reset-password', { token, password });
      if (res.success) {
        setDone(true);
        setTimeout(() => navigate('/login?reset=1'), 2500);
      } else {
        setError(res.message || (isRTL ? 'رابط غير صالح أو منتهي الصلاحية.' : 'Invalid or expired reset link.'));
      }
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
            {isRTL ? <>كلمة مرور <span>جديدة</span></> : <>Set a new <span>Password</span></>}
          </h2>
          <p className="login-tagline">
            {isRTL
              ? 'اختر كلمة مرور قوية للحفاظ على أمان حسابك وبياناتك المالية.'
              : 'Choose a strong password to keep your account and financial data secure.'}
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

          {done ? (
            <div style={{ textAlign: 'center' }}>
              <div style={BADGE_SUCCESS}>
                <Check width={32} height={32} strokeWidth={3} />
              </div>
              <h1 className="login-title">{t('auth.password_reset_success')}</h1>
              <p className="login-subtitle">
                {isRTL ? 'جارٍ تحويلك إلى صفحة تسجيل الدخول…' : 'Redirecting you to sign in…'}
              </p>
              <Link to="/login" className="btn btn-primary btn-full" style={{ marginTop: 12 }}>
                {t('auth.login')}
              </Link>
            </div>
          ) : !token ? (
            <div style={{ textAlign: 'center' }}>
              <div style={BADGE_ERROR}>
                <Xmark width={32} height={32} strokeWidth={3} />
              </div>
              <h1 className="login-title">{isRTL ? 'رابط غير صالح' : 'Invalid link'}</h1>
              <p className="login-subtitle">
                {isRTL
                  ? 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية. اطلب رابطاً جديداً.'
                  : 'This reset link is invalid or has expired. Please request a new one.'}
              </p>
              <Link to="/forgot-password" className="btn btn-primary btn-full" style={{ marginTop: 12 }}>
                {isRTL ? 'اطلب رابطاً جديداً' : 'Request a new link'}
              </Link>
            </div>
          ) : (
            <>
              <h1 className="login-title">{t('auth.reset_password')}</h1>
              <p className="login-subtitle">
                {isRTL ? 'أدخل كلمة المرور الجديدة أدناه.' : 'Enter your new password below.'}
              </p>

              {error && <div className="alert alert-error">{error}</div>}

              <form onSubmit={handleSubmit} className="login-form">
                <div className="form-group">
                  <label htmlFor="password">{isRTL ? 'كلمة المرور الجديدة' : 'New password'}</label>
                  <div className="input-with-icon">
                    <input
                      id="password"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder={isRTL ? '8 أحرف على الأقل' : 'At least 8 characters'}
                    />
                    <button type="button" className="input-icon-btn" onClick={() => setShowPw(s => !s)}>
                      {showPw ? <EyeClosed /> : <Eye />}
                    </button>
                  </div>
                  <PasswordStrength password={password} isRTL={isRTL} />
                </div>

                <div className="form-group">
                  <label htmlFor="confirm">{t('auth.confirm_password')}</label>
                  <div className="input-with-icon">
                    <input
                      id="confirm"
                      type={showPw ? 'text' : 'password'}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder={isRTL ? 'أعد إدخال كلمة المرور' : 'Re-enter password'}
                    />
                  </div>
                </div>

                <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                  {loading ? <span className="spinner spinner-sm" /> : t('auth.reset_password')}
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
