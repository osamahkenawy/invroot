import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeClosed, Check, Building, Mail, Lock, NavArrowRight, NavArrowLeft } from 'iconoir-react';
import api from '../lib/api.js';
import PhoneInput, { stripDialOnly, parsePhone } from '../components/PhoneInput.jsx';
import { COUNTRIES, flag } from '../data/countries.js';
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

/* Plans are fetched from GET /api/public/plans rather than declared here.
   The list that used to live in this file had drifted from reality: it offered
   "Starter — forever free, up to 10 invoices / month" when that plan is
   AED 69/month, plus "Pro" and "Business" tiers the product has never had. The
   server derives them from the same config that enforces the limits, so the
   page cannot promise something the product won't honour. */

const LEFT_PANELS = {
  en: [
    { tag: 'Step 1 of 3', heading: 'Your business,\nyour brand.',
      body: 'Set up your workspace in minutes. INVROOT adapts to your language, currency, and workflow.',
      bullets: ['Arabic & English UI', 'Multi-currency support', 'VAT-ready invoices'] },
    { tag: 'Step 2 of 3', heading: 'Secure by\ndesign.',
      body: 'Your financial data is encrypted at rest and in transit. Role-based access keeps your team in check.',
      bullets: ['Bank-level encryption', 'Role-based permissions', 'Audit log on every action'] },
    { tag: 'Step 3 of 3', heading: 'Pick a plan\nthat fits.',
      body: 'Start free, upgrade when you are ready. No card needed to begin.',
      bullets: ['No card required to start', 'No hidden fees', 'Change or cancel any time'] },
  ],
  ar: [
    { tag: 'الخطوة ١ من ٣', heading: 'شركتك،\nوهويتك.',
      body: 'جهّز مساحة عملك في دقائق. إنفروت يتكيّف مع لغتك وعملتك وطريقة عملك.',
      bullets: ['واجهة بالعربية والإنجليزية', 'دعم عملات متعددة', 'فواتير جاهزة لضريبة القيمة المضافة'] },
    { tag: 'الخطوة ٢ من ٣', heading: 'الأمان\nمن الأساس.',
      body: 'بياناتك المالية مشفّرة أثناء التخزين والنقل، وصلاحيات الأدوار تُبقي فريقك تحت السيطرة.',
      bullets: ['تشفير بمستوى البنوك', 'صلاحيات حسب الدور', 'سجل تدقيق لكل إجراء'] },
    { tag: 'الخطوة ٣ من ٣', heading: 'اختر الخطة\nالمناسبة.',
      body: 'ابدأ مجاناً وترقّ عندما تكون جاهزاً. لا حاجة لبطاقة للبدء.',
      bullets: ['لا تحتاج بطاقة للبدء', 'بدون رسوم خفية', 'غيّر أو ألغِ في أي وقت'] },
  ],
};

/* Best guess at the visitor's country, used only to show an indicative local
   price. The server re-derives it from an edge geo header where one exists, and
   the dial code the person picks for their phone overrides this. */
function guessCountry() {
  try {
    const region = new Intl.Locale(navigator.language).region;
    if (region) return region;
  } catch { /* older browsers */ }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const TZ = { 'Asia/Dubai':'AE','Asia/Riyadh':'SA','Africa/Cairo':'EG','Asia/Kuwait':'KW',
               'Asia/Qatar':'QA','Asia/Bahrain':'BH','Asia/Muscat':'OM','Asia/Amman':'JO',
               'Asia/Beirut':'LB','Asia/Baghdad':'IQ','Asia/Karachi':'PK','Asia/Kolkata':'IN' };
  return TZ[tz] || null;
}

export default function SignupPage() {
  const { t, i18n } = useTranslation();
  const navigate    = useNavigate();
  const isRTL       = i18n.language === 'ar';

  const [step,    setStep]    = useState(0);           // 0 = biz, 1 = creds, 2 = plan
  const [form,    setForm]    = useState({ business_name: '', email: '', phone: '', password: '', confirm: '', plan: 'trial' });

  /* Plans come from the server so this page can't advertise a tier the product
     doesn't honour. `country` only affects the indicative local price shown
     beside the real one — the charge is always in the plan's own currency. */
  const [plans,      setPlans]      = useState([]);
  const [plansState, setPlansState] = useState('loading');   // loading | ready | error
  const [pricing,    setPricing]    = useState({ country: null, local_currency: null });
  const [country,    setCountry]    = useState(() => guessCountry());
  const [showPw,  setShowPw]  = useState(false);
  const [showCPw, setShowCPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);
  const [pendingPlan, setPendingPlan] = useState('');   // paid choice, not yet paid

  const set = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setError(''); };

  /* The dial code someone picks for their phone is a better signal than the
     browser locale — an expat in Dubai often has an en-GB browser. */
  useEffect(() => {
    const parsed = parsePhone(form.phone);
    if (parsed?.country?.code && parsed.country.code !== country) setCountry(parsed.country.code);
  }, [form.phone]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setPlansState('loading');
    const qs = new URLSearchParams({ lang: i18n.language === 'ar' ? 'ar' : 'en' });
    if (country) qs.set('country', country);
    api.get(`/public/plans?${qs}`)
      .then(res => {
        if (cancelled) return;
        if (res?.success) {
          setPlans(res.data.plans || []);
          setPricing({ country: res.data.country, local_currency: res.data.local_currency });
          setPlansState('ready');
          // Keep the selection valid if the list changed under us.
          setForm(f => (res.data.selectable?.includes(f.plan) ? f : { ...f, plan: 'trial' }));
        } else setPlansState('error');
      })
      .catch(() => { if (!cancelled) setPlansState('error'); });
    return () => { cancelled = true; };
  }, [country, i18n.language]);

  const strength = useMemo(() => pwStrength(form.password), [form.password]);

  /* Country names in the reader's language. Intl.DisplayNames does this from
     data the browser already ships, which beats maintaining 189 translations
     by hand and getting them subtly wrong. Falls back to the English name. */
  const countryOptions = useMemo(() => {
    let display = null;
    try { display = new Intl.DisplayNames([isRTL ? 'ar' : 'en'], { type: 'region' }); } catch { /* older browsers */ }
    return COUNTRIES
      .map(c => ({ code: c.code, name: (display?.of(c.code)) || c.name }))
      .sort((a, b) => a.name.localeCompare(b.name, isRTL ? 'ar' : 'en'));
  }, [isRTL]);

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
        phone: stripDialOnly(form.phone),
        password: form.password,
        lang: i18n.language,
        plan: form.plan,
        country,          // sets the new workspace's currency

      });
      /* The server decides this, not the form: a paid choice is recorded as an
         intent and grants nothing, so it reports back whether money is still
         owed. Trusting `form.plan` here would let the success screen promise a
         plan the server declined to give. */
      if (res.success) { setPendingPlan(res.data?.pending_plan || ''); setSuccess(true); }
      else { setError(res.message || 'Registration failed'); }
    } catch { setError(t('auth.network_error')); }
    finally { setLoading(false); }
  };

  /* ── success screen ──────────────────────────────────── */
  if (success) {
    return (
      <div className="su-root su-done-root">
        <div className="su-done-card">
          <img src="/logos/invroot-600_200-colored-logo.png" alt="INVROOT" className="su-done-logo" />

          <div className="su-done-badge">
            <span className="su-done-ring" />
            <span className="su-done-ring su-done-ring--2" />
            <Check strokeWidth={3} />
          </div>

          <h2 className="su-done-title">
            {t(pendingPlan ? 'auth.created_pay_title' : 'auth.created_title')}
          </h2>
          <p className="su-done-lead">
            {t(pendingPlan ? 'auth.created_pay_lead' : 'auth.created_lead')}
          </p>
          <div className="su-done-email">{form.email}</div>

          {/* "Send your first invoice" is the wrong third step when a paid plan
              was chosen and not yet paid for — it skips straight past the card
              and told people they were all set on a plan they don't have. */}
          <ol className="su-done-steps">
            {[
              ['created_step_verify',  'created_step_verify_sub'],
              ['created_step_signin',  'created_step_signin_sub'],
              pendingPlan
                ? ['created_step_pay',     'created_step_pay_sub']
                : ['created_step_invoice', 'created_step_invoice_sub'],
            ].map(([title, sub], i) => (
              <li key={title} className="su-done-step">
                <span className="su-done-step-num">{i + 1}</span>
                <div>
                  <div className="su-done-step-title">{t(`auth.${title}`)}</div>
                  <div className="su-done-step-sub">{t(`auth.${sub}`)}</div>
                </div>
              </li>
            ))}
          </ol>

          <Link to="/login" className="su-done-cta">{t('auth.login')}</Link>
          <p className="su-done-spam">{t('auth.created_spam')}</p>
        </div>
      </div>
    );
  }

  const panel = (LEFT_PANELS[isRTL ? 'ar' : 'en'] || LEFT_PANELS.en)[step];

  return (
    <div className={`su-root ${isRTL ? 'rtl' : ''}`}>
      {/* ── Left decorative panel ────────────────────── */}
      <div className="su-left">
        {/* One layer per step, cross-faded. Rendering all three keeps them
            decoded and warm so advancing a step never flashes. */}
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className={`su-left-art${i === step ? ' is-active' : ''}`}
            style={{ backgroundImage: `url(/signup/register-bg-0${i + 1}.webp)` }}
            aria-hidden="true"
          />
        ))}
        <div className="su-left-scrim" aria-hidden="true" />

        <div className="su-left-inner">
          <div className="su-brand">
            <img src="/logos/invroot-sidebar-logo-600-200-white-logo.png" alt="INVROOT" className="su-brand-logo" />
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
                <PhoneInput
                  value={form.phone}
                  onChange={val => setForm(f => ({ ...f, phone: val }))}
                  defaultCountry={isRTL ? 'SA' : 'US'}
                  placeholder="5x xxx xxxx"
                />
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
                    placeholder={t('common.min_8_chars')}
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
                    placeholder={t('common.repeat_password')}
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

              {plansState === 'loading' && (
                <div className="su-plans-loading">{isRTL ? 'جارٍ تحميل الخطط…' : 'Loading plans…'}</div>
              )}

              {plansState === 'error' && (
                <div className="alert alert-error">
                  {isRTL
                    ? 'تعذّر تحميل الخطط. تحقق من اتصالك وحاول مرة أخرى.'
                    : "Couldn't load the plans. Check your connection and try again."}
                </div>
              )}

              {plansState === 'ready' && (
                <>
                  {/* Where prices are shown for. Auto-detected, but the guess is
                      only ever a guess — a browser set to en-GB in Cairo would
                      otherwise be quoted in pounds with no way to correct it.
                      This does not change what is charged, only what is shown. */}
                  <div className="su-currency-row">
                    <label htmlFor="su-country">{isRTL ? 'عرض الأسعار لـ' : 'Show prices for'}</label>
                    <select
                      id="su-country"
                      value={country || ''}
                      onChange={(e) => setCountry(e.target.value || null)}
                    >
                      {!country && <option value="">{isRTL ? 'اختر الدولة' : 'Select country'}</option>}
                      {countryOptions.map(c => (
                        <option key={c.code} value={c.code}>{flag(c.code)} {c.name}</option>
                      ))}
                    </select>
                    {pricing.local_currency && (
                      <span className="su-currency-tag">{pricing.local_currency}</span>
                    )}
                  </div>

                  <div className="su-plans">
                    {plans.map(plan => {
                      const selected = form.plan === plan.id;
                      /* Sales-led tiers have no price and nothing to select —
                         picking one here would create a workspace on a plan
                         nobody has agreed terms for. */
                      const selectable = !plan.sales_led;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={`su-plan-card ${selected ? 'selected' : ''} ${plan.recommended ? 'popular' : ''} ${selectable ? '' : 'su-plan-card--contact'}`}
                          onClick={() => selectable && setForm(f => ({ ...f, plan: plan.id }))}
                          aria-pressed={selectable ? selected : undefined}
                        >
                          {plan.recommended && (
                            <span className="su-popular-tag">{isRTL ? 'الأكثر طلباً' : 'Most popular'}</span>
                          )}
                          <div className="su-plan-top">
                            <div>
                              <div className="su-plan-name">{plan.name}</div>
                              <div className="su-plan-sub">{plan.tagline}</div>
                            </div>
                            <div className="su-plan-price-wrap">
                              <div className="su-plan-price">{plan.display}</div>
                              {!plan.free && !plan.sales_led && (
                                <div className="su-plan-per">{isRTL ? 'شهرياً' : 'per month'}</div>
                              )}
                              {/* Indicative only — the charge is in billed_currency. */}
                              {plan.local && (
                                <div className="su-plan-local" title={isRTL
                                  ? `سعر تقريبي محوّل من ${plan.billed_currency}`
                                  : `Approximate, converted from ${plan.billed_currency}`}>
                                  ≈ {plan.local.display}
                                </div>
                              )}
                            </div>
                          </div>
                          <ul className="su-plan-features">
                            {plan.features.map(f => (
                              <li key={f}><Check className="su-feat-check" />{f}</li>
                            ))}
                          </ul>
                          {plan.sales_led && (
                            <div className="su-plan-contact">
                              {isRTL ? 'تواصل معنا: ' : 'Talk to us: '}
                              <a href={`mailto:${plan.contact}`} onClick={e => e.stopPropagation()}>{plan.contact}</a>
                            </div>
                          )}
                          {selected && <span className="su-plan-selected-ring" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Say plainly what will be charged and in which currency, so
                      the converted figure above can't be mistaken for the bill. */}
                  {plans.some(p => p.local) && (
                    <p className="su-price-note">
                      {isRTL
                        ? `المبالغ المحلية تقريبية للاسترشاد فقط. الفوترة تتم بالدرهم الإماراتي (AED)، وقد يطبّق مصرفك سعر صرف مختلفاً.`
                        : `Local amounts are approximate, for guidance only. Billing is in AED — your bank may apply a different rate.`}
                    </p>
                  )}
                </>
              )}

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
