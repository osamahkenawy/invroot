import { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, Check, Page } from 'iconoir-react';
import { AuthContext } from '../context/AuthContext.jsx';
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

  const [email,    setEmail]    = useState('test@acme.com');
  const [password, setPassword] = useState('Test1234!');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const isRTL = i18n.language === 'ar';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(email, password);
      if (res.success) {
        if (res.user?.is_super_admin) {
          localStorage.setItem('sa_token', res.token);
          navigate('/admin');
        } else {
          navigate('/dashboard');
        }
      } else {
        setError(res.message || 'Login failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`login-root ${isRTL ? 'rtl' : ''}`}>
      <div className="login-left">
        <div className="login-branding">
          <div className="login-brand-row">
            <Page className="login-brand-icon" />
            <span className="login-logo">INVROOT</span>
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

          {error && (
            <div className="alert alert-error">{error}</div>
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
