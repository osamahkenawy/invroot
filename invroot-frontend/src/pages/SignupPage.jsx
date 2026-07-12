import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, Check, Building, Mail, Lock, Phone, NavArrowRight, NavArrowLeft, Page } from 'iconoir-react';
import api from '../lib/api.js';
import './LoginPage.css';
import './SignupPage.css';

/* ── password strength ─────────────────────────────────── */
function pwStrength(pw) {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score; // 0-5
}
const STRENGTH_LABELS = ['', 'Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
const STRENGTH_COLORS = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'];

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 'Free',
    sub: 'Forever free',
    features: ['Up to 10 invoices / month', '1 user', 'PDF download', 'Email support'],
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19',
    sub: 'per month',
    features: ['Unlimited invoices', '5 users', 'Custom branding', 'Receipts & payments', 'Priority support'],
    highlight: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: '$49',
    sub: 'per month',
    features: ['Everything in Pro', 'Unlimited users', 'API access', 'Webhooks', 'Dedicated support'],
    highlight: false,
  },
];

const LEFT_PANELS = [
  {
    tag: 'Step 1 of 3',
    heading: 'Your business,\nyour brand.',
    body: 'Set up your workspace in minutes. INVROOT adapts to your language, currency, and workflow.',
    bullets: ['Arabic & English UI', 'Multi-currency support', 'VAT-ready invoices'],
  },
  {
    tag: 'Step 2 of 3',
    heading: 'Secure by\ndesign.',
    body: 'Your financial data is encrypted at rest and in transit. Role-based access keeps your team in check.',
    bullets: ['Bank-level encryption', 'Role-based permissions', 'Audit log on every action'],
  },
  {
    tag: 'Step 3 of 3',
    heading: 'Pick a plan\nthat fits.',
    body: 'Start free, scale when ready. No credit card required. Cancel any time.',
    bullets: ['14-day free trial on paid plans', 'No hidden fees', 'Switch plans any time'],
  },
];

export default function SignupPage() {
  const { t, i18n } = useTranslation();
  const navigate    = useNavigate();
  const isRTL       = i18n.language === 'ar';

  const [step,    setStep]    = useState(0);           // 0 = biz, 1 = creds, 2 = plan
  const [form,    setForm]    = useState({ business_name: '', email: '', phone: '', password: '', confirm: '', plan: 'starter' });
  const [showPw,  setShowPw]  = useState(false);
  const [showCPw, setShowCPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  const set = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setError(''); };

  const strength = useMemo(() => pwStrength(form.password), [form.password]);

  /* ── step validators ─────────────────────────────────── */
  const canNext0 = form.business_name.trim().length >= 2;
  const canNext1 = form.email.includes('@') && form.password.length >= 8 && form.password === form.confirm;

  const next = () => { setError(''); setStep(s => s + 1); };
  const back = () => { setError(''); setStep(s => s - 1); };

  /* ── submit ──────────────────────────────────────────── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        business_name: form.business_name,
        email: form.email,
        phone: form.phone,
        password: form.password,
        lang: i18n.language,
        plan: form.plan,
      });
      if (res.success) { setSuccess(true); }
      else { setError(res.message || 'Registration failed'); }
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  /* ── success screen ──────────────────────────────────── */
  if (success) {
    return (
      <div className="su-root">
        <div className="su-success">
          <div className="su-success-icon">
            <Check strokeWidth={3} />
          </div>
          <h2>{isRTL ? 'تم إنشاء حسابك!' : 'Account created!'}</h2>
          <p>{t('auth.verify_email_sent')}</p>
          <Link to="/login" className="btn btn-primary btn-full">{t('auth.login')}</Link>
        </div>
      </div>
    );
  }

  const panel = LEFT_PANELS[step];

  return (
    <div className={`su-root ${isRTL ? 'rtl' : ''}`}>
      {/* ── Left decorative panel ────────────────────── */}
      <div className="su-left">
        <div className="su-left-inner">
          <div className="su-brand">
            <Page className="su-brand-icon" />
            <span>INVROOT</span>
          </div>

          <div className="su-panel-text">
            <span className="su-panel-tag">{panel.tag}</span>
            <h2 className="su-panel-heading">{panel.heading}</h2>
            <p className="su-panel-body">{panel.body}</p>
            <ul className="su-panel-bullets">
              {panel.bullets.map(b => (
                <li key={b}><span className="su-bullet-dot"><Check /></span>{b}</li>
              ))}
            </ul>
          </div>

          {/* ── Step dots ─────────────────────────── */}
          <div className="su-step-dots">
            {[0,1,2].map(i => (
              <span key={i} className={`su-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
            ))}
          </div>

          <div className="su-left-stats">
            <div className="su-stat"><strong>2,400+</strong><span>{isRTL ? 'شركة نشطة' : 'Active businesses'}</span></div>
            <div className="su-stat"><strong>$4.2M</strong><span>{isRTL ? 'فواتير هذا الشهر' : 'Invoiced this month'}</span></div>
            <div className="su-stat"><strong>4.9 ★</strong><span>{isRTL ? 'تقييم المستخدمين' : 'User rating'}</span></div>
          </div>
        </div>
      </div>

      {/* ── Right form panel ─────────────────────────── */}
      <div className="su-right">
        <div className="su-form-wrap">
          {/* lang switcher */}
          <div className="login-lang-row" style={{ justifyContent: 'flex-end' }}>
            {['en','ar'].map(code => (
              <button key={code} className={`lang-chip ${i18n.language === code ? 'active' : ''}`}
                onClick={() => i18n.changeLanguage(code)}>
                {code === 'en' ? 'English' : 'العربية'}
              </button>
            ))}
          </div>

          {/* progress bar */}
          <div className="su-progress">
            <div className="su-progress-bar" style={{ width: `${((step + 1) / 3) * 100}%` }} />
          </div>

          {/* ── Step 0 — Business info ──────────────── */}
          {step === 0 && (
            <div className="su-step-pane">
              <div className="su-step-header">
                <h1>{isRTL ? 'مرحباً!' : 'Welcome aboard 👋'}</h1>
                <p>{isRTL ? 'أخبرنا عن شركتك' : "Tell us about your business"}</p>
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <div className="su-field">
                <label>{t('auth.business_name')}</label>
                <div className="su-input-wrap">
                  <Building className="su-input-icon" />
                  <input
                    type="text"
                    value={form.business_name}
                    onChange={set('business_name')}
                    placeholder={isRTL ? 'اسم شركتك' : 'Acme Co.'}
                    autoFocus
                  />
                </div>
              </div>

              <div className="su-field">
                <label>{isRTL ? 'رقم الهاتف' : 'Phone number'} <span className="su-optional">({isRTL ? 'اختياري' : 'optional'})</span></label>
                <div className="su-input-wrap">
                  <Phone className="su-input-icon" />
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={set('phone')}
                    placeholder="+966 5x xxx xxxx"
                  />
                </div>
              </div>

              <div className="su-plan-mini">
                <span className="su-badge">{isRTL ? 'تجربة مجانية' : 'Free trial'}</span>
                {isRTL ? 'لا يلزم إدخال بيانات بطاقة الائتمان.' : 'No credit card required. Cancel any time.'}
              </div>

              <button className="btn btn-primary btn-full su-next-btn" onClick={next} disabled={!canNext0}>
                {isRTL ? 'التالي' : 'Continue'} <NavArrowRight className="su-btn-icon" />
              </button>
            </div>
          )}

          {/* ── Step 1 — Credentials ───────────────── */}
          {step === 1 && (
            <div className="su-step-pane">
              <div className="su-step-header">
                <h1>{isRTL ? 'أمان حسابك' : 'Secure your account'}</h1>
                <p>{isRTL ? 'أنشئ بيانات الدخول الخاصة بك' : 'Create your login credentials'}</p>
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <div className="su-field">
                <label>{t('auth.email')}</label>
                <div className="su-input-wrap">
                  <Mail className="su-input-icon" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    placeholder="you@company.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="su-field">
                <label>{t('auth.password')}</label>
                <div className="su-input-wrap">
                  <Lock className="su-input-icon" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={form.password}
                    onChange={set('password')}
                    placeholder="Min. 8 characters"
                    autoComplete="new-password"
                  />
                  <button type="button" className="su-eye-btn" onClick={() => setShowPw(v => !v)}>
                    {showPw ? <EyeClosed /> : <Eye />}
                  </button>
                </div>
                {form.password.length > 0 && (
                  <div className="su-strength">
                    <div className="su-strength-bar">
                      {[1,2,3,4,5].map(n => (
                        <span key={n} className="su-strength-seg" style={{ background: n <= strength ? STRENGTH_COLORS[strength] : '#e5e7eb' }} />
                      ))}
                    </div>
                    <span className="su-strength-label" style={{ color: STRENGTH_COLORS[strength] }}>
                      {STRENGTH_LABELS[strength]}
                    </span>
                  </div>
                )}
              </div>

              <div className="su-field">
                <label>{t('auth.confirm_password')}</label>
                <div className="su-input-wrap">
                  <Lock className="su-input-icon" />
                  <input
                    type={showCPw ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={set('confirm')}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                  />
                  <button type="button" className="su-eye-btn" onClick={() => setShowCPw(v => !v)}>
                    {showCPw ? <EyeClosed /> : <Eye />}
                  </button>
                  {form.confirm.length > 0 && (
                    <span className={`su-match-dot ${form.password === form.confirm ? 'ok' : 'no'}`}>
                      {form.password === form.confirm ? '✓' : '✗'}
                    </span>
                  )}
                </div>
              </div>

              <div className="su-row-btns">
                <button className="btn btn-ghost su-back-btn" onClick={back}>
                  <NavArrowLeft className="su-btn-icon" /> {isRTL ? 'رجوع' : 'Back'}
                </button>
                <button className="btn btn-primary su-next-btn" onClick={next} disabled={!canNext1}>
                  {isRTL ? 'التالي' : 'Continue'} <NavArrowRight className="su-btn-icon" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2 — Pick plan ─────────────────── */}
          {step === 2 && (
            <form onSubmit={handleSubmit} className="su-step-pane">
              <div className="su-step-header">
                <h1>{isRTL ? 'اختر خطتك' : 'Choose your plan'}</h1>
                <p>{isRTL ? 'يمكنك التغيير في أي وقت' : 'You can change this any time'}</p>
              </div>

              {error && <div className="alert alert-error">{error}</div>}

              <div className="su-plans">
                {PLANS.map(plan => (
                  <button
                    key={plan.id}
                    type="button"
                    className={`su-plan-card ${form.plan === plan.id ? 'selected' : ''} ${plan.highlight ? 'popular' : ''}`}
                    onClick={() => setForm(f => ({ ...f, plan: plan.id }))}
                  >
                    {plan.highlight && <span className="su-popular-tag">{isRTL ? 'الأكثر طلباً' : 'Most popular'}</span>}
                    <div className="su-plan-top">
                      <div>
                        <div className="su-plan-name">{plan.name}</div>
                        <div className="su-plan-sub">{plan.sub}</div>
                      </div>
                      <div className="su-plan-price">{plan.price}</div>
                    </div>
                    <ul className="su-plan-features">
                      {plan.features.map(f => (
                        <li key={f}><Check className="su-feat-check" />{f}</li>
                      ))}
                    </ul>
                    {form.plan === plan.id && <span className="su-plan-selected-ring" />}
                  </button>
                ))}
              </div>

              <p className="su-terms">
                {isRTL
                  ? 'بالمتابعة، أنت توافق على '
                  : 'By creating an account, you agree to our '}
                <a href="#" onClick={e => e.preventDefault()}>{isRTL ? 'شروط الخدمة' : 'Terms of Service'}</a>
                {' & '}
                <a href="#" onClick={e => e.preventDefault()}>{isRTL ? 'سياسة الخصوصية' : 'Privacy Policy'}</a>.
              </p>

              <div className="su-row-btns">
                <button type="button" className="btn btn-ghost su-back-btn" onClick={back}>
                  <NavArrowLeft className="su-btn-icon" /> {isRTL ? 'رجوع' : 'Back'}
                </button>
                <button type="submit" className="btn btn-secondary su-next-btn" disabled={loading}>
                  {loading ? <span className="spinner spinner-sm" /> : (isRTL ? 'إنشاء الحساب' : 'Create account')}
                  {!loading && <NavArrowRight className="su-btn-icon" />}
                </button>
              </div>
            </form>
          )}

          <p className="login-switch" style={{ marginTop: 20 }}>
            {t('auth.have_account')}{' '}<Link to="/login">{t('auth.login')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
