import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, Lock } from 'iconoir-react';
import api from '../lib/api.js';
import { AuthContext } from '../context/AuthContext.jsx';
import PasswordStrength from '../components/PasswordStrength.jsx';
import './LoginPage.css';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

/**
 * Shown when a user signs in with an admin-issued temporary password
 * (must_change_password). They cannot reach the app until they set their own.
 */
export default function ForcePasswordChangePage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const navigate = useNavigate();
  const { user, refreshUser, logout } = useContext(AuthContext);

  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError(isRTL ? 'يجب أن تكون كلمة المرور 8 أحرف على الأقل.' : 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError(isRTL ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.');
      return;
    }
    if (password === current) {
      setError(isRTL ? 'اختر كلمة مرور مختلفة عن المؤقتة.' : 'Choose a password different from the temporary one.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/change-password', {
        current_password: current,
        new_password: password,
      });
      if (res.success) {
        await refreshUser();       // clears must_change_password in context
        navigate('/dashboard', { replace: true });
      } else {
        setError(res.message || (isRTL ? 'تعذّر تغيير كلمة المرور.' : 'Could not change the password.'));
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
            {isRTL ? <>أمّن <span>حسابك</span></> : <>Secure your <span>account</span></>}
          </h2>
          <p className="login-tagline">
            {isRTL
              ? 'تم إنشاء حسابك بكلمة مرور مؤقتة. اختر كلمة مرور خاصة بك للمتابعة — لن يعرفها أحد غيرك.'
              : 'Your account was created with a temporary password. Choose your own to continue — no one else will know it.'}
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

          <h1 className="login-title">
            <Lock style={{ width: 22, height: 22, verticalAlign: '-3px', marginInlineEnd: 8 }} />
            {isRTL ? 'اختر كلمة مرور جديدة' : 'Set your password'}
          </h1>
          <p className="login-subtitle">
            {isRTL
              ? `مرحباً ${user?.full_name || ''} — هذه خطوة لمرة واحدة قبل الدخول.`
              : `Welcome ${user?.full_name || ''} — a one-time step before you get started.`}
          </p>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="current">{isRTL ? 'كلمة المرور المؤقتة' : 'Temporary password'}</label>
              <input
                id="current"
                type="password"
                value={current}
                onChange={e => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
                placeholder={isRTL ? 'من رسالة البريد الإلكتروني' : 'From your welcome email'}
              />
            </div>

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

            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? <span className="spinner spinner-sm" /> : (isRTL ? 'حفظ والمتابعة' : 'Save and continue')}
            </button>
          </form>

          <p className="login-switch">
            <button type="button" className="link-subtle" style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => { logout(); navigate('/login', { replace: true }); }}>
              {isRTL ? 'تسجيل الخروج' : 'Sign out'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
