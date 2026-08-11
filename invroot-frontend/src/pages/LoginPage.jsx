import { useState, useContext } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, Check } from 'iconoir-react';
import { AuthContext } from '../context/AuthContext.jsx';
import api from '../lib/api.js';
import './LoginPage.css';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

const FEATURES_EN = [
  'Full Arabic & English support',
  'Professional invoices with stamp & signature',
  'Comprehensive financial reports',
  'Client & catalog management',
];
const FEATURES_AR = [
  'دعم كامل للغة العربية والإنجليزية',
  'فواتير احترافية بختم وتوقيع',
  'تقارير مالية متكاملة',
  'إدارة العملاء والكتالوج',
];

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const { login } = useContext(AuthContext);
  const navigate  = useNavigate();
  const [searchParams] = useSearchParams();
  const justVerified = searchParams.get('verified') === '1';

  /* Empty, not seeded. These held a development account's address and
     password, which shipped to production: every visitor to the sign-in page
     was shown someone's credentials pre-filled, and a returning customer had
     to clear a stranger's email before typing their own. */
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resent,   setResent]   = useState(false);
  const [resending, setResending] = useState(false);

  const isRTL = i18n.language === 'ar';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNeedsVerify(false);
    setResent(false);
    setLoading(true);
    try {
      const res = await login(email, password);
      if (res.success) {
        if (res.user?.is_super_admin) {
          localStorage.setItem('sa_token', res.token);
          navigate('/admin');
        } else if (res.user?.pending_plan) {
          /* They picked a paid plan at signup and have not paid for it. Signup
             deliberately grants nothing, so this is where the choice is
             honoured — carrying `onboarding` through so a first-time customer
             still gets their company-profile setup after the card step. */
          const first = !res.user?.last_login_at ? '&onboarding=1' : '';
          navigate(`/settings/billing?checkout=${res.user.pending_plan}${first}`);
        } else if (!res.user?.last_login_at) {
          // First login ever — send them to set up their company profile.
          navigate('/settings?onboarding=1');
        } else {
          navigate('/dashboard');
        }
      } else {
        if (res.code === 'EMAIL_NOT_VERIFIED') setNeedsVerify(true);
        setError(res.message || 'Login failed');
      }
    } catch {
      setError(t('common.network_error'));
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    setResending(true);
    await api.post('/auth/resend-verification', { email });
    setResending(false);
    setResent(true);
  };

  return (
    <div className={`login-root ${isRTL ? 'rtl' : ''}`}>
      <div className="login-left">
        <div className="login-branding">
          <div className="login-brand-row">
            <img src="/logos/invroot-sidebar-logo-600-200-white-logo.png" alt="INVROOT" className="login-brand-logo" />
          </div>

          <h2 className="login-headline">
            {isRTL ? <>الفوترة <span>مُبسَّطة</span></> : <>Billing <span>Simplified</span></>}
          </h2>
          <p className="login-tagline">
            {isRTL
              ? 'أنشئ وأرسل الفواتير الاحترافية، وتتبع المدفوعات، وأدر عملاءك من مكان واحد.'
              : 'Create professional invoices, track payments, and manage clients — all in one place.'}
          </p>

          <ul className="login-features">
            {(isRTL ? FEATURES_AR : FEATURES_EN).map(f => (
              <li key={f}>
                <span className="login-feat-dot"><Check /></span>
                {f}
              </li>
            ))}
          </ul>

          <div className="login-stats">
            <div className="login-stat"><strong>2,400+</strong><span>{isRTL ? 'شركة نشطة' : 'Active businesses'}</span></div>
            <div className="login-stat"><strong>$4.2M</strong><span>{isRTL ? 'فواتير / شهر' : 'Invoiced / month'}</span></div>
            <div className="login-stat"><strong>4.9 ★</strong><span>{isRTL ? 'تقييم' : 'Rating'}</span></div>
          </div>
        </div>
      </div>

      <div className="login-right">
        <div className="login-card">
          {/* The left panel (and its logo) is hidden on mobile, so carry the
              mark into the card above the language switcher. */}
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

          <h1 className="login-title">{t('auth.login')}</h1>
          <p className="login-subtitle">{isRTL ? 'مرحباً بعودتك! أدخل بياناتك للمتابعة.' : 'Welcome back! Enter your credentials to continue.'}</p>

          {justVerified && !error && (
            <div className="alert alert-success">{t('auth.email_verified')}</div>
          )}
          {error && (
            <div className="alert alert-error">{error}</div>
          )}
          {needsVerify && !resent && (
            <div className="alert alert-warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span>{isRTL ? 'لم يتم تأكيد بريدك بعد.' : 'Your email isn’t verified yet.'}</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={resendVerification} disabled={resending}>
                {resending ? <span className="spinner spinner-sm" /> : (isRTL ? 'إعادة إرسال الرابط' : 'Resend link')}
              </button>
            </div>
          )}
          {resent && (
            <div className="alert alert-success">
              {isRTL ? 'أرسلنا رابط تحقق جديد إلى بريدك.' : 'We’ve sent a fresh verification link to your email.'}
            </div>
          )}

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

            <div className="form-group">
              <label htmlFor="password">{t('auth.password')}</label>
              <div className="input-with-icon">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button type="button" className="input-icon-btn" onClick={() => setShowPw(s => !s)}>
                  {showPw ? <EyeClosed /> : <Eye />}
                </button>
              </div>
            </div>

            <div className="login-row">
              <Link to="/forgot-password" className="link-subtle">{t('auth.forgot_password')}</Link>
            </div>

            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? <span className="spinner spinner-sm" /> : t('auth.login')}
            </button>
          </form>

          <p className="login-switch">
            {t('auth.no_account')}{' '}
            <Link to="/signup">{t('auth.create_account')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
