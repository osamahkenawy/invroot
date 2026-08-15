import { useState, useEffect, useRef, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, NavLink, Navigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api.js';
import { useToastContext } from '../context/ToastContext.jsx';
import Loader from '../components/Loader.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import { COUNTRIES, flag } from '../data/countries.js';
import { citiesFor } from '../data/cities.js';
import PhoneInput, { stripDialOnly, withDialCode } from '../components/PhoneInput.jsx';
import {
  Building, Group, NumberedListLeft, User,
  Palette, PenTablet, Upload, Check, Xmark, NavArrowDown, Search, Rocket,
  Lock, Computer, SmartphoneDevice, LogOut, Clock, CreditCard,
  Camera, Trash, Calendar, Mail, BadgeCheck, Crown, Language, ShieldCheck
} from 'iconoir-react';
import UserAvatar from '../components/UserAvatar.jsx';
import BillingSettings from './settings/BillingSettings.jsx';
import './Settings.css';
import { CURRENCIES } from '../data/currencies.js';

/* ── Country → Currency mapping ────────────────────── */
const COUNTRY_CURRENCY = {
  AE:'AED',AF:'AFN',AL:'ALL',AM:'AMD',AO:'AOA',AR:'ARS',AT:'EUR',AU:'AUD',
  AZ:'AZN',BA:'BAM',BB:'BBD',BD:'BDT',BE:'EUR',BF:'XOF',BG:'BGN',BH:'BHD',
  BI:'BIF',BJ:'XOF',BN:'BND',BO:'BOB',BR:'BRL',BS:'BSD',BT:'BTN',BW:'BWP',
  BY:'BYN',BZ:'BZD',CA:'CAD',CF:'XAF',CG:'XAF',CH:'CHF',CL:'CLP',CM:'XAF',
  CN:'CNY',CO:'COP',CR:'CRC',CU:'CUP',CV:'CVE',CY:'EUR',CZ:'CZK',DE:'EUR',
  DJ:'DJF',DK:'DKK',DM:'XCD',DO:'DOP',DZ:'DZD',EC:'USD',EE:'EUR',EG:'EGP',
  ER:'ERN',ES:'EUR',ET:'ETB',FI:'EUR',FJ:'FJD',FR:'EUR',GA:'XAF',GB:'GBP',
  GD:'XCD',GE:'GEL',GH:'GHS',GM:'GMD',GN:'GNF',GQ:'XAF',GR:'EUR',GT:'GTQ',
  GW:'XOF',GY:'GYD',HN:'HNL',HR:'EUR',HT:'HTG',HU:'HUF',ID:'IDR',IE:'EUR',
  IL:'ILS',IN:'INR',IQ:'IQD',IR:'IRR',IS:'ISK',IT:'EUR',JM:'JMD',JO:'JOD',
  JP:'JPY',KE:'KES',KG:'KGS',KH:'KHR',KI:'AUD',KM:'KMF',KN:'XCD',KW:'KWD',
  KZ:'KZT',LA:'LAK',LB:'LBP',LC:'XCD',LI:'CHF',LK:'LKR',LR:'LRD',LS:'LSL',
  LT:'EUR',LU:'EUR',LV:'EUR',LY:'LYD',MA:'MAD',MC:'EUR',MD:'MDL',ME:'EUR',
  MG:'MGA',MH:'USD',MK:'MKD',ML:'XOF',MM:'MMK',MN:'MNT',MR:'MRU',MT:'EUR',
  MU:'MUR',MV:'MVR',MW:'MWK',MX:'MXN',MY:'MYR',MZ:'MZN',NA:'NAD',NE:'XOF',
  NG:'NGN',NI:'NIO',NL:'EUR',NO:'NOK',NP:'NPR',NR:'AUD',NZ:'NZD',OM:'OMR',
  PA:'PAB',PE:'PEN',PG:'PGK',PH:'PHP',PK:'PKR',PL:'PLN',PT:'EUR',PW:'USD',
  PY:'PYG',QA:'QAR',RO:'RON',RS:'RSD',RU:'RUB',RW:'RWF',SA:'SAR',SB:'SBD',
  SC:'SCR',SD:'SDG',SE:'SEK',SG:'SGD',SI:'EUR',SK:'EUR',SL:'SLL',SM:'EUR',
  SN:'XOF',SO:'SOS',SR:'SRD',SS:'SSP',ST:'STN',SV:'USD',SY:'SYP',SZ:'SZL',
  TD:'XAF',TG:'XOF',TH:'THB',TJ:'TJS',TL:'USD',TM:'TMT',TN:'TND',TO:'TOP',
  TR:'TRY',TT:'TTD',TV:'AUD',TW:'TWD',TZ:'TZS',UA:'UAH',UG:'UGX',US:'USD',
  UY:'UYU',UZ:'UZS',VC:'XCD',VE:'VES',VN:'VND',VU:'VUV',WS:'WST',YE:'YER',
  ZA:'ZAR',ZM:'ZMW',ZW:'ZWL',
};


/* ── CountrySelect component ─────────────────────────── */
function CountrySelect({ value, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const ref     = useRef();
  const listRef = useRef();
  const searchRef = useRef();

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (open) { setSearch(''); setTimeout(() => searchRef.current?.focus(), 40); }
  }, [open]);

  const selected = COUNTRIES.find(c => c.code === value);
  const filtered = COUNTRIES.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="cs-wrap" ref={ref}>
      <button type="button" className={`cs-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}>
        {selected ? (
          <><span className="cs-flag">{flag(selected.code)}</span>
            <span className="cs-name">{selected.name}</span></>
        ) : (
          <span className="cs-placeholder">{t('common.select_country')}</span>
        )}
        <NavArrowDown className="cs-arrow" />
      </button>
      {open && (
        <div className="cs-dropdown">
          <div className="cs-search-row">
            <Search width={14} height={14} />
            <input ref={searchRef} className="cs-search" placeholder={t('settings.search')}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="cs-list" ref={listRef}>
            {filtered.length === 0
              ? <div className="cs-empty">{t('settings.no_results')}</div>
              : filtered.map(c => (
              <div key={c.code}
                className={`cs-option${value === c.code ? ' active' : ''}`}
                onMouseDown={() => { onChange(c.code); setOpen(false); }}>
                <span className="cs-flag">{flag(c.code)}</span>
                <span className="cs-oname">{c.name}</span>
                <span className="cs-ocode">{c.code}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── CitySelect component ────────────────────────────── */
/**
 * City picker driven by the chosen country.
 *
 * City was a bare text box sitting next to a searchable country dropdown, so
 * the two halves of one address behaved nothing alike and the city was whatever
 * anyone happened to type — "Dubai", "dubai", "DXB" — on records that get
 * printed onto invoices.
 *
 * Two rules make this safe to use as a dropdown:
 *  · Nothing is bundled for every city on earth, so a typed value is always
 *    accepted. The search box IS the input; an unlisted city is offered back as
 *    "Use <what you typed>", and the field still works with no list at all.
 *  · With no country chosen there is nothing to filter by, so it degrades to a
 *    plain input rather than an empty dropdown that looks broken.
 */
function CitySelect({ country, value, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef();
  const searchRef = useRef();

  const options = citiesFor(country);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (open) { setSearch(''); setTimeout(() => searchRef.current?.focus(), 40); }
  }, [open]);

  /* No country, or a country we carry no list for: a picker here would be an
     empty menu, which reads as broken. Give back the plain field. */
  if (!options.length) {
    return <input value={value || ''} onChange={e => onChange(e.target.value)}
                  placeholder={country ? '' : t('settings.city_pick_country')} />;
  }

  const typed = search.trim();
  const filtered = options.filter(c => !typed || c.toLowerCase().includes(typed.toLowerCase()));
  const exact = options.some(c => c.toLowerCase() === typed.toLowerCase());

  const choose = (city) => { onChange(city); setOpen(false); };

  return (
    <div className="cs-wrap" ref={ref}>
      <button type="button" className={`cs-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}>
        {value
          ? <span className="cs-name">{value}</span>
          : <span className="cs-placeholder">{t('settings.select_city')}</span>}
        <NavArrowDown className="cs-arrow" />
      </button>
      {open && (
        <div className="cs-dropdown">
          <div className="cs-search-row">
            <Search width={14} height={14} />
            <input ref={searchRef} className="cs-search" placeholder={t('settings.search')}
              value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                /* Enter commits: the top match if there is one, otherwise the
                   raw text. Without this, typing a city we don't list and
                   hitting Enter would submit the whole settings form. */
                e.preventDefault();
                if (filtered.length) choose(filtered[0]);
                else if (typed) choose(typed);
              }} />
          </div>
          <div className="cs-list">
            {filtered.map(c => (
              <div key={c} className={`cs-option${value === c ? ' active' : ''}`}
                onMouseDown={() => choose(c)}>
                <span className="cs-oname">{c}</span>
              </div>
            ))}
            {/* The escape hatch. Any city not in the bundled list is reachable
                here, so the dropdown can never trap someone. */}
            {typed && !exact && (
              <div className="cs-option cs-option-custom" onMouseDown={() => choose(typed)}>
                <span className="cs-oname">{t('settings.city_use_custom', { city: typed })}</span>
              </div>
            )}
            {!filtered.length && !typed && <div className="cs-empty">{t('settings.no_results')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* Every /api/company route and the team invite/update endpoints are gated by
   `requireOwner`. Showing these to a non-owner meant filled-in forms that
   403'd on save, so they are hidden instead. My Profile is the one section
   any member can use. */
const TABS = [
  { path: '',          labelKey: 'settings.company',    icon: Building,          ownerOnly: true },
  { path: 'branding',  labelKey: 'settings.branding',   icon: Palette,           ownerOnly: true },
  { path: 'stamp',     labelKey: 'settings.stamp_sig',  icon: PenTablet,         ownerOnly: true },
  { path: 'team',      labelKey: 'settings.team',       icon: Group,             ownerOnly: true },
  { path: 'numbering', labelKey: 'settings.numbering',  icon: NumberedListLeft,  ownerOnly: true },
  { path: 'profile',   labelKey: 'settings.profile',    icon: User },
  { path: 'security',  labelKey: 'settings.security',   icon: Lock },
  { path: 'billing',   labelKey: 'settings.billing',    icon: CreditCard, ownerOnly: true },
];

export default function Settings() {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const isOwner = !!user?.is_owner;
  const visibleTabs = TABS.filter(tab => !tab.ownerOnly || isOwner);
  return (
    <div className="settings-layout">
      <div className="settings-sidebar">
        <h2 className="settings-title">{t('settings.title')}</h2>
        <nav className="settings-nav">
          {visibleTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.path}
                to={`/settings${tab.path ? '/' + tab.path : ''}`}
                end={!tab.path}
                className={({ isActive }) => `settings-nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon className="s-nav-icon" />
                {t(tab.labelKey)}
              </NavLink>
            );
          })}
        </nav>
      </div>
      <div className="settings-content">
        <Routes>
          {/* Hiding the nav link is not enough — a non-owner could still reach
              these by typing the URL, so the routes redirect to My Profile. */}
          <Route index          element={isOwner ? <CompanySettings />   : <Navigate to="/settings/profile" replace />} />
          <Route path="branding"  element={isOwner ? <BrandingSettings />  : <Navigate to="/settings/profile" replace />} />
          <Route path="stamp"     element={isOwner ? <StampSettings />     : <Navigate to="/settings/profile" replace />} />
          <Route path="team"      element={isOwner ? <TeamSettings />      : <Navigate to="/settings/profile" replace />} />
          <Route path="numbering" element={isOwner ? <NumberingSettings /> : <Navigate to="/settings/profile" replace />} />
          <Route path="profile"   element={<ProfileSettings />} />
          <Route path="security"  element={<SecuritySettings />} />
          <Route path="billing"   element={isOwner ? <BillingSettings /> : <Navigate to="/settings/profile" replace />} />
        </Routes>
      </div>
    </div>
  );
}

/* ── Reusable save feedback ─────────────────────────── */
/* `msg` may be a plain string (legacy callers, where only the exact word
   "Saved!" counted as success) or { text, ok }. The string form is why
   "Logo uploaded!" rendered in a red error box — any success phrased
   differently was misreported as a failure. New callers pass the outcome. */
function SaveMsg({ msg }) {
  if (!msg) return null;
  const text = typeof msg === 'string' ? msg : msg.text;
  if (!text) return null;
  const ok = typeof msg === 'string'
    ? (msg === 'Saved!' || msg === 'تم الحفظ!')
    : !!msg.ok;
  return <div className={`alert ${ok ? 'alert-success' : 'alert-error'}`}>{text}</div>;
}

/* ── Upload zone ────────────────────────────────────── */
function UploadZone({ label, hint, preview, onFile, accept = 'image/*', busy = false }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false);
    if (busy) return;                        // don't queue a second upload
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <div
      className={`upload-zone ${drag ? 'drag' : ''} ${busy ? 'is-busy' : ''}`}
      onClick={() => !busy && ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
    >
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); }} />
      {preview ? (
        <img src={preview} alt={label} className="upload-preview" />
      ) : (
        <div className="upload-placeholder">
          <Upload className="upload-icon" />
          <span className="upload-label">{label}</span>
          <span className="upload-hint">{hint}</span>
        </div>
      )}
    </div>
  );
}

/* ══ Company Settings ═══════════════════════════════════ */
function CompanySettings() {
  const { showToast } = useToastContext();
  const { t } = useTranslation();
  const { refreshUser } = useContext(AuthContext);
  const [searchParams] = useSearchParams();
  const onboarding = searchParams.get('onboarding') === '1';
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const detectedCountry = useRef('');

  useEffect(() => {
    // Detect country from IP (best-effort, silent fail)
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(d => { if (d?.country_code) detectedCountry.current = d.country_code; })
      .catch(() => {});

    api.get('/company').then(res => {
      if (res.success) {
        const data = res.data || {};
        // Auto-fill country from IP only if not already set
        if (!data.country && detectedCountry.current) data.country = detectedCountry.current;
        setForm(data);
        if (data.logo_url) setLogoPreview(data.logo_url);
      }
      setLoading(false);
    });
  }, []);

  // If IP resolved after company loaded and country is still empty, fill it
  useEffect(() => {
    const t = setTimeout(() => {
      if (detectedCountry.current) {
        setForm(f => f.country ? f : { ...f, country: detectedCountry.current });
      }
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  const MAX_LOGO = 2 * 1024 * 1024;

  /* Choosing the file IS the action — there was a separate "Upload" button, so
     picking an image appeared to do nothing and the logo was silently not
     saved unless you noticed the second step. Reject locally first so an
     oversized file gets an instant answer instead of a round trip. */
  const handleLogoFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      setMsg({ text: t('settings.picture_not_image'), ok: false });
      return;
    }
    if (file.size > MAX_LOGO) {
      setMsg({ text: t('settings.picture_too_large', { size: (file.size / 1024 / 1024).toFixed(1), max: 2 }), ok: false });
      return;
    }

    const previous = logoPreview;
    const blob = URL.createObjectURL(file);
    setLogoPreview(blob);              // show it immediately
    setMsg('');
    setUploadingLogo(true);

    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await fetch('/api/company/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
        credentials: 'include',
        body: fd,
      });
      const data = await res.json();
      if (data.success) {
        // Swap the local blob for the stored asset so the preview survives.
        if (data.logo_url) setLogoPreview(data.logo_url);
        setMsg({ text: t('settings.logo_uploaded'), ok: true });
        showToast(t('common.saved_success'), 'success');
      } else {
        setLogoPreview(previous);      // don't imply it saved
        setMsg({ text: data.message || 'Upload failed.', ok: false });
      }
    } catch {
      setLogoPreview(previous);
      setMsg({ text: t('settings.upload_failed'), ok: false });
    } finally {
      URL.revokeObjectURL(blob);
      setUploadingLogo(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setMsg('');
    // "+971" on its own is a dial code, not a phone number — don't persist it.
    const res = await api.put('/company', { ...form, phone: stripDialOnly(form.phone) });
    setMsg(res.success ? 'Saved!' : res.message);
    showToast(res.success ? t('common.saved_success') : (res.message || t('common.save_failed')),
              res.success ? 'success' : 'error');
    if (res.success) refreshUser();
    setSaving(false);
  };

  if (loading) return <Loader fullPage />;

  return (
    <div className="settings-section">
      {onboarding && (
        <div className="onboarding-banner">
          <div className="onboarding-banner-icon"><Rocket /></div>
          <div>
            <h4>{t('settings.welcome_title')}</h4>
            <p>{t('settings.welcome_body')}</p>
          </div>
        </div>
      )}
      <div className="settings-section-head">
        <Building className="ss-icon" />
        <div>
          <h3>{t('settings.company')}</h3>
          <p>{t('settings.business_identity_sub')}</p>
        </div>
      </div>
      <SaveMsg msg={msg} />

      {/* Logo */}
      <div className="settings-card">
        <div className="settings-card-title">{t('settings.company_logo')}</div>
        <div className="logo-upload-row">
          <UploadZone
            label={t('settings.logo_zone_label')}
            hint={t('settings.logo_zone_hint')}
            preview={logoPreview}
            onFile={handleLogoFile}
            busy={uploadingLogo}
          />
          {uploadingLogo && (
            <span className="upload-progress"><span className="spinner spinner-sm" /> {t('settings.uploading')}</span>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="settings-form">
        <div className="settings-card">
          <div className="settings-card-title">{t('settings.business_identity')}</div>
          <div className="form-row">
            <div className="form-group"><label>{t('settings.legal_name')} *</label><input value={form.company_name || ''} onChange={set('company_name')} required /></div>
            <div className="form-group"><label>{t('settings.trading_name')}</label><input value={form.trading_name || ''} onChange={set('trading_name')} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>{t('settings.tax_id')}</label><input value={form.tax_id || ''} onChange={set('tax_id')} /></div>
            <div className="form-group"><label>{t('settings.registration_id')}</label><input value={form.registration_id || ''} onChange={set('registration_id')} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>{t('settings.country')}</label>
              {/* Country drives both the default currency and the phone dial code. */}
              <CountrySelect value={form.country || ''} onChange={code => setForm(f => ({
                ...f,
                country:  code,
                currency: COUNTRY_CURRENCY[code] || f.currency,
                phone:    withDialCode(f.phone, code),
                /* Drop a city that doesn't belong to the new country. Keeping
                   it would leave "Dubai, France" on the invoice — and because
                   the field is free-text-capable, only an exact match against
                   the new country's list counts as still valid. */
                city:     citiesFor(code).includes(f.city) ? f.city : '',
              }))} />
            </div>
            <div className="form-group"><label>{t('settings.city')}</label>
              <CitySelect country={form.country} value={form.city || ''}
                          onChange={city => setForm(f => ({ ...f, city }))} />
            </div>
          </div>
          <div className="form-group"><label>{t('settings.address')}</label><textarea value={form.address || ''} onChange={set('address')} rows={2} /></div>
          <div className="form-row">
            <div className="form-group"><label>{t('common.phone')}</label>
              <PhoneInput
                value={form.phone || ''}
                onChange={v => setForm(f => ({ ...f, phone: v }))}
                defaultCountry={form.country || 'AE'}
                placeholder="50 123 4567"
              />
            </div>
            <div className="form-group"><label>{t('settings.website')}</label><input value={form.website || ''} onChange={set('website')} placeholder="https://..." /></div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-title">{t('settings.doc_defaults')}</div>
          <div className="form-row">
            <div className="form-group"><label>{t('settings.default_currency')}</label>
              <select value={form.currency || 'SAR'} onChange={set('currency')}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group"><label>{t('settings.default_language')}</label>
              <select value={form.lang || 'en'} onChange={set('lang')}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </div>
            <div className="form-group"><label>{t('settings.payment_terms_days')}</label>
              <input type="number" value={form.payment_terms || 30} onChange={set('payment_terms')} />
            </div>
          </div>
          <div className="form-group"><label>{t('settings.invoice_footer')}</label><textarea value={form.footer_text || ''} onChange={set('footer_text')} rows={2} placeholder={t('settings.ph_footer')} /></div>
          <div className="form-group"><label>{t('settings.invoice_terms')}</label><textarea value={form.invoice_terms || ''} onChange={set('invoice_terms')} rows={3} placeholder={t('settings.ph_terms')} /></div>
        </div>

        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner spinner-sm" /> : <><Check style={{ width:16,height:16 }} /> {t('settings.save_changes')}</>}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ══ Branding Settings ═══════════════════════════════════ */
function BrandingSettings() {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const [form, setForm] = useState({ primary_color: '#0D1B2A', accent_color: '#d63a17', invoice_template: 'classic' });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setMsg('');
    const res = await api.put('/company', form);
    setMsg(res.success ? 'Saved!' : res.message);
    showToast(res.success ? t('common.saved_success') : (res.message || t('common.save_failed')),
              res.success ? 'success' : 'error');
    setSaving(false);
  };

  const TEMPLATES = [
    { id: 'classic', name: 'Classic', desc: 'Clean professional layout' },
    { id: 'modern',  name: 'Modern',  desc: 'Bold header with accent bar' },
    { id: 'minimal', name: 'Minimal', desc: 'Simple and clean' },
  ];

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <Palette className="ss-icon" />
        <div>
          <h3>{t('settings.branding_title')}</h3>
          <p>{t('settings.branding_sub')}</p>
        </div>
      </div>
      <SaveMsg msg={msg} />

      <form onSubmit={handleSubmit} className="settings-form">
        <div className="settings-card">
          <div className="settings-card-title">{t('settings.brand_colors')}</div>
          <div className="brand-colors-grid">
            <div className="brand-color-item">
              <label>{t('settings.primary_color')}</label>
              <div className="color-picker-row">
                <input type="color" value={form.primary_color} onChange={set('primary_color')} className="color-swatch" />
                <input type="text" value={form.primary_color} onChange={set('primary_color')} className="color-hex" maxLength={7} />
              </div>
              <span className="color-hint">{t('settings.primary_hint')}</span>
            </div>
            <div className="brand-color-item">
              <label>{t('settings.accent_color')}</label>
              <div className="color-picker-row">
                <input type="color" value={form.accent_color} onChange={set('accent_color')} className="color-swatch" />
                <input type="text" value={form.accent_color} onChange={set('accent_color')} className="color-hex" maxLength={7} />
              </div>
              <span className="color-hint">{t('settings.accent_hint')}</span>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-title">{t('settings.invoice_template')}</div>
          <div className="template-grid">
            {TEMPLATES.map(tpl => (
              <label key={tpl.id} className={`template-option ${form.invoice_template === tpl.id ? 'selected' : ''}`}>
                <input type="radio" name="template" value={tpl.id}
                  checked={form.invoice_template === tpl.id}
                  onChange={() => setForm(f => ({ ...f, invoice_template: tpl.id }))} />
                <div className="template-preview" style={{ background: `linear-gradient(135deg, ${form.primary_color}22, ${form.accent_color}11)` }}>
                  <div className="tpl-header" style={{ background: form.primary_color }} />
                  <div className="tpl-lines">
                    <div /><div /><div className="short" />
                  </div>
                  <div className="tpl-total" style={{ background: form.accent_color }} />
                </div>
                <div className="template-label">
                  <strong>{tpl.name}</strong>
                  <span>{tpl.desc}</span>
                </div>
                {form.invoice_template === tpl.id && <span className="template-check"><Check /></span>}
              </label>
            ))}
          </div>
        </div>

        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner spinner-sm" /> : <><Check style={{ width:16,height:16 }} /> {t('settings.save_branding')}</>}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ══ Stamp & Signature ═══════════════════════════════════ */
function StampSettings() {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const [company, setCompany]         = useState({});
  const [signatories, setSignatories]  = useState([]);
  const [loading, setLoading]          = useState(true);
  const [stampFile, setStampFile]      = useState(null);
  const [stampPreview, setStampPreview] = useState(null);
  const [sigFile, setSigFile]          = useState(null);
  const [sigPreview, setSigPreview]    = useState(null);
  const [sigName, setSigName]          = useState('');
  const [sigTitle, setSigTitle]        = useState('');
  const [msg, setMsg]                  = useState('');
  const [uploading, setUploading]      = useState('');

  const reload = () => {
    Promise.all([
      api.get('/company'),
      api.get('/company/signatories'),
    ]).then(([cRes, sRes]) => {
      if (cRes.success) {
        setCompany(cRes.data || {});
        if (cRes.data?.stamp_url) setStampPreview(cRes.data.stamp_url);
      }
      if (sRes.success) {
        setSignatories(sRes.data || []);
        const def = (sRes.data || []).find(s => s.is_default);
        if (def?.signature_url) { setSigPreview(def.signature_url); setSigName(def.name || ''); setSigTitle(def.title || ''); }
      }
      setLoading(false);
    });
  };
  useEffect(reload, []);

  const uploadFile = async (endpoint, fieldName, file, extra = {}) => {
    setUploading(endpoint);
    const fd = new FormData();
    fd.append(fieldName, file);
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    try {
      const token = localStorage.getItem('auth_token') || '';
      const apiBase = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${apiBase}/company/${endpoint}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
        body: fd,
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ text: `${endpoint === 'stamp' ? 'Stamp' : 'Signature'} saved — it will appear on all new PDFs.`, ok: true });
        reload();
      } else setMsg({ text: data.message || 'Upload failed', ok: false });
    } catch { setMsg({ text: 'Upload failed — check your connection.', ok: false }); }
    finally { setUploading(''); }
  };

  if (loading) return <Loader fullPage />;

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <PenTablet className="ss-icon" />
        <div>
          <h3>{t('settings.stamp_title')}</h3>
          <p>{t('settings.embedded_hint')}</p>
        </div>
      </div>
      <SaveMsg msg={msg} />

      <div className="stamp-grid">
        {/* Stamp */}
        <div className="settings-card">
          <div className="settings-card-title">{t('settings.official_stamp')}</div>
          <p className="stamp-hint">{t('settings.stamp_hint')}</p>
          <UploadZone
            label={t('settings.stamp_zone_label')}
            hint={t('settings.stamp_zone_hint')}
            preview={stampPreview}
            busy={uploading === 'stamp'}
            onFile={(f) => {
              // Nothing accompanies a stamp, so picking it is the whole action.
              setStampPreview(URL.createObjectURL(f));
              uploadFile('stamp', 'stamp', f).then(() => setStampFile(null));
            }}
          />
          {uploading === 'stamp' && (
            <span className="upload-progress"><span className="spinner spinner-sm" /> {t('settings.uploading')}</span>
          )}
        </div>

        {/* Signature */}
        <div className="settings-card">
          <div className="settings-card-title">{t('settings.authorized_signature')}</div>
          <p className="stamp-hint">{t('settings.signature_hint')}</p>
          <UploadZone
            label={t('settings.signature_zone_label')}
            hint={t('settings.signature_zone_hint')}
            preview={sigPreview}
            busy={uploading === 'signature'}
            /* Not auto-uploaded, unlike the logo and stamp: the signatory's
               name and title are saved with the image, and uploading the
               moment a file is picked would store it with those blank. */
            onFile={(f) => { setSigFile(f); setSigPreview(URL.createObjectURL(f)); }}
          />
          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label>{t('settings.signatory_name')}</label>
              <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder={t('settings.ph_signatory')} />
            </div>
            <div className="form-group">
              <label>{t('settings.title_position')}</label>
              <input value={sigTitle} onChange={e => setSigTitle(e.target.value)} placeholder={t('settings.ph_position')} />
            </div>
          </div>
          {sigFile && (
            <button className="btn btn-primary btn-sm" style={{ marginTop: 4 }}
              onClick={() => uploadFile('signature', 'signature', sigFile, { signatory_name: sigName, signatory_title: sigTitle, is_default: '1' }).then(() => setSigFile(null))}
              disabled={uploading === 'signature'}>
              {uploading === 'signature' ? <span className="spinner spinner-sm" /> : <><Upload style={{width:14,height:14}} /> {t('settings.save_signature')}</>}
            </button>
          )}
        </div>
      </div>

      {/* Status row */}
      <div className="stamp-status">
        <div className={`stamp-status-item ${company.stamp_url ? 'ok' : ''}`}>
          {company.stamp_url ? <Check /> : <Xmark />}
          <span>Stamp {company.stamp_url ? 'uploaded ✓' : 'not set'}</span>
        </div>
        <div className={`stamp-status-item ${signatories.length > 0 ? 'ok' : ''}`}>
          {signatories.length > 0 ? <Check /> : <Xmark />}
          <span>Signature {signatories.length > 0 ? `uploaded ✓ (${signatories.length} signator${signatories.length > 1 ? 'ies' : 'y'})` : 'not set'}</span>
        </div>
        <div style={{ marginInlineStart: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {t('settings.stamp_sub')}
        </div>
      </div>

      {/* Signatory list */}
      {signatories.length > 0 && (
        <div className="settings-card">
          <div className="settings-card-title">{t('settings.saved_signatories')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {signatories.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <img src={s.signature_url} alt={s.name} style={{ height: 40, maxWidth: 120, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6, padding: 4, background: '#fff' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.title || ''}</div>
                </div>
                {s.is_default ? <span className="role-badge role-admin">{t('settings.default')}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══ Team Settings ═══════════════════════════════════════ */
function TeamSettings() {
  const { showToast } = useToastContext();
  const { t } = useTranslation();
  const [members, setMembers]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [inviting, setInviting] = useState(false);
  const [form, setForm]         = useState({ email: '', full_name: '', role: 'accountant' });
  const [msg, setMsg]           = useState('');

  const fetchTeam = () => {
    setLoading(true);
    api.get('/settings/team').then(res => { if (res.success) setMembers(res.data); setLoading(false); });
  };
  useEffect(fetchTeam, []);

  const sendInvite = async (e) => {
    e.preventDefault(); setMsg('');
    const res = await api.post('/settings/team/invite', form);
    if (res.success) {
      setMsg(`Invited! Temp password: ${res.temp_password}`);
      showToast(t('common.created_success'));
      fetchTeam(); setInviting(false); setForm({ email: '', full_name: '', role: 'accountant' });
    } else { setMsg(res.message); showToast(res.message || t('common.save_failed'), 'error'); }
  };

  if (loading) return <Loader fullPage />;

  const ROLES = ['admin', 'accountant', 'sales', 'viewer'];

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <Group className="ss-icon" />
        <div>
          <h3>{t('settings.team')}</h3>
          <p>{t('settings.team_sub')}</p>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginInlineStart: 'auto' }} onClick={() => setInviting(v => !v)}>
          + Invite Member
        </button>
      </div>
      <SaveMsg msg={msg} />

      {inviting && (
        <div className="settings-card">
          <div className="settings-card-title">{t('settings.invite_new')}</div>
          <form onSubmit={sendInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-row">
              <div className="form-group"><label>{t('settings.full_name')}</label><input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} /></div>
              <div className="form-group"><label>{t('common.email')} *</label><input type="email" value={form.email} required onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div className="form-group"><label>{t('settings.role')}</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r}>{t(`settings.role_${r}`, { defaultValue: r })}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm">{t('settings.send_invite')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInviting(false)}>{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      <div className="team-grid">
        {members.map(m => {
          const initials = (m.full_name || m.email || '?').slice(0,2).toUpperCase();
          return (
            <div key={m.id} className="team-card">
              <div className="team-avatar">{initials}</div>
              <div className="team-info">
                <div className="team-name">
                  {m.full_name || m.email}
                  {m.is_owner && <span className="badge-owner">{t('settings.owner')}</span>}
                </div>
                <div className="team-email">{m.email}</div>
              </div>
              <div className="team-right">
                <span className={`role-badge role-${m.role}`}>{m.role}</span>
                <span className={`status-badge status-${m.is_active ? 'active' : 'inactive'}`} style={{ marginTop: 4 }}>
                  {m.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══ Numbering Settings ══════════════════════════════════ */
function NumberingSettings() {
  const { showToast } = useToastContext();
  const { t } = useTranslation();
  const [form, setForm] = useState({ number_format: 'date' });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api.get('/company/numbering').then(res => { if (res.success) setForm(res.data || { number_format: 'date' }); setLoading(false); });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await api.put('/company/numbering', form);
    setMsg(res.success ? 'Saved!' : res.message || 'Error');
    showToast(res.success ? t('common.saved_success') : (res.message || t('common.save_failed')),
              res.success ? 'success' : 'error');
  };

  if (loading) return <Loader fullPage />;

  const format = form.number_format || 'date';
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();

  const previewNumber = (pfx, start) => {
    const p = (pfx || '').replace(/[-/]+$/, '');
    const n = parseInt(start) || 1;
    if (format === 'date') return `${p}/${mm}/${yyyy}/${n}`;
    return `${p}-${String(n).padStart(5, '0')}`;
  };

  const SEQUENCES = [
    { titleKey: 'Invoices',     prefix: 'invoice_prefix',     start: 'invoice_start',     defaultPfx: 'INV' },
    { titleKey: 'Quotes',       prefix: 'quote_prefix',        start: 'quote_start',        defaultPfx: 'QUO' },
    { titleKey: 'Credit Notes', prefix: 'credit_note_prefix',  start: 'credit_note_start',  defaultPfx: 'CN'  },
    { titleKey: 'Receipts',     prefix: 'receipt_prefix',      start: 'receipt_start',      defaultPfx: 'RCP' },
  ];

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <NumberedListLeft className="ss-icon" />
        <div><h3>{t('settings.numbering')}</h3><p>{t('settings.numbering_sub')}</p></div>
      </div>
      <SaveMsg msg={msg} />
      <form onSubmit={handleSubmit} className="settings-form">

        {/* Format selector */}
        <div className="settings-card">
          <div className="settings-card-title">{t('settings.number_format')}</div>
          <div className="num-format-grid">
            {[
              { key: 'date',    label: 'Date-based',  example: 'TS/06/2026/40',  desc: 'PREFIX/MM/YYYY/SEQ — recommended' },
              { key: 'classic', label: 'Classic',      example: 'INV-00040',      desc: 'PREFIX-NNNNN (zero-padded)' },
            ].map(opt => (
              <label key={opt.key} className={`num-format-option ${format === opt.key ? 'selected' : ''}`}>
                <input type="radio" name="number_format" value={opt.key}
                  checked={format === opt.key}
                  onChange={() => setForm(f => ({ ...f, number_format: opt.key }))} />
                <div className="num-format-example">{opt.example}</div>
                <div className="num-format-label">{opt.label}</div>
                <div className="num-format-desc">{opt.desc}</div>
                {format === opt.key && <span className="template-check"><Check /></span>}
              </label>
            ))}
          </div>
        </div>

        {SEQUENCES.map(seq => (
          <div key={seq.prefix} className="settings-card">
            <div className="settings-card-title">{seq.titleKey}</div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('settings.prefix')}</label>
                <input
                  value={form[seq.prefix] ?? seq.defaultPfx}
                  onChange={set(seq.prefix)}
                  placeholder={seq.defaultPfx}
                />
              </div>
              <div className="form-group">
                <label>{t('settings.starting_number')}</label>
                <input type="number" min="1" value={form[seq.start] ?? 1} onChange={set(seq.start)} />
              </div>
              <div className="form-group">
                <label>{t('settings.live_preview')}</label>
                <div className="numbering-preview">
                  {previewNumber(form[seq.prefix] ?? seq.defaultPfx, form[seq.start] ?? 1)}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div className="settings-card">
          <div className="settings-card-title">{t('settings.reset_rule')}</div>
          <div className="form-group">
            <label>{t('settings.reset_counter')}</label>
            <select value={form.reset_frequency || 'never'} onChange={set('reset_frequency')}>
              <option value="never">{t('settings.reset_never')}</option>
              <option value="yearly">{t('settings.reset_yearly')}</option>
              <option value="monthly">{t('settings.reset_monthly')}</option>
            </select>
          </div>
        </div>
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary"><Check style={{ width:16,height:16 }} /> {t('settings.save_numbering')}</button>
        </div>
      </form>
    </div>
  );
}

/* ══ Profile Settings ════════════════════════════════════ */
/* ── Password strength ──────────────────────────────────
   A deliberately simple, honest meter: it scores length and variety and says
   what is missing. It is guidance for the person choosing, not a gate — the
   server enforces the actual minimum. */
function scorePassword(pw) {
  if (!pw) return { score: 0, label: '', hint: '' };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const missing = [];
  if (pw.length < 12) missing.push('more characters');
  if (!(/[a-z]/.test(pw) && /[A-Z]/.test(pw))) missing.push('mixed case');
  if (!/\d/.test(pw)) missing.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push('a symbol');

  const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'][score];
  return { score, label, hint: missing.length ? `Try adding ${missing.slice(0, 2).join(' and ')}.` : '' };
}

function ProfileSettings() {
  const { showToast } = useToastContext();
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { user, refreshUser } = useContext(AuthContext);

  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ full_name: '', phone: '', lang_preference: 'en' });
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const setPw = (k) => (e) => setPwForm(f => ({ ...f, [k]: e.target.value }));

  /* Avatar */
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarErr, setAvatarErr] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const blobRef = useRef(null);

  const load = async () => {
    const res = await api.get('/settings/profile');
    if (!res.success) return;
    setProfile(res.data);
    setAvatarUrl(res.data.avatar_url || null);
    setForm({
      full_name: res.data.full_name || '',
      phone: res.data.phone || '',
      lang_preference: res.data.lang_preference || 'en',
    });
  };
  useEffect(() => { load(); }, []);

  // Release any object URL we created, so repeated picks don't leak blobs.
  useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

  const MAX_AVATAR = 5 * 1024 * 1024;

  const uploadAvatar = async (file) => {
    if (!file) return;
    setAvatarErr('');
    /* Reject before the round trip so the person gets an instant answer. The
       server re-checks; this is courtesy, not the control. */
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      setAvatarErr(t('settings.picture_not_image'));
      return;
    }
    if (file.size > MAX_AVATAR) {
      setAvatarErr(t('settings.picture_too_large', { size: (file.size / 1024 / 1024).toFixed(1), max: 5 }));
      return;
    }

    // Show it immediately; the upload can take a moment.
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = URL.createObjectURL(file);
    setAvatarUrl(blobRef.current);

    setAvatarBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/settings/profile/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
        credentials: 'include',
        body: fd,
      });
      const data = await res.json();
      if (!data.success) {
        setAvatarErr(data.message || 'Upload failed.');
        setAvatarUrl(profile?.avatar_url || null);   // put the old one back
        return;
      }
      setAvatarUrl(data.data.avatar_url);
      setProfile(p => ({ ...p, avatar_url: data.data.avatar_url }));
      showToast(t('settings.picture_updated'), 'success');
      refreshUser?.();       // header and menus follow along
    } catch {
      setAvatarErr('Upload failed. Check your connection and try again.');
      setAvatarUrl(profile?.avatar_url || null);
    } finally { setAvatarBusy(false); }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true); setAvatarErr('');
    try {
      const res = await api.delete('/settings/profile/avatar');
      if (res.success) {
        setAvatarUrl(null);
        setProfile(p => ({ ...p, avatar_url: null }));
        showToast(t('settings.picture_removed'), 'success');
        refreshUser?.();
      } else setAvatarErr(res.message || 'Could not remove the picture.');
    } finally { setAvatarBusy(false); }
  };

  const saveProfile = async (e) => {
    e.preventDefault(); setMsg(''); setSaving(true);
    try {
      const res = await api.put('/settings/profile', { ...form, phone: stripDialOnly(form.phone) });
      setMsg(res.success ? 'Saved!' : res.message);
      showToast(res.success ? t('common.saved_success') : (res.message || t('common.save_failed')),
                res.success ? 'success' : 'error');
      if (res.success) { refreshUser?.(); load(); }
    } finally { setSaving(false); }
  };

  const pwStrength = scorePassword(pwForm.new_password);

  const changePassword = async (e) => {
    e.preventDefault(); setPwMsg('');
    if (pwForm.new_password !== pwForm.confirm) { setPwMsg(t('common.passwords_no_match')); return; }
    if (pwForm.new_password.length < 8) { setPwMsg('Password must be at least 8 characters'); return; }
    const res = await api.post('/auth/change-password', {
      current_password: pwForm.current_password, new_password: pwForm.new_password,
    });
    setPwMsg(res.success ? 'Password changed!' : res.message);
    showToast(res.success ? t('common.saved_success') : (res.message || t('common.save_failed')),
              res.success ? 'success' : 'error');
    if (res.success) setPwForm({ current_password: '', new_password: '', confirm: '' });
  };

  const shown = profile || user || {};
  const fmtDate = (d) => d
    ? new Date(String(d).replace(' ', 'T') + 'Z').toLocaleDateString(isRTL ? 'ar' : 'en-GB',
        { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <User className="ss-icon" />
        <div><h3>{t('settings.profile')}</h3><p>{t('settings.profile_sub')}</p></div>
      </div>

      {/* ── Identity card ───────────────────────────── */}
      <div className="profile-hero">
        <div
          className={`profile-hero-avatar ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); uploadAvatar(e.dataTransfer.files?.[0]); }}
        >
          <button
            type="button"
            className="profile-avatar-btn"
            onClick={() => fileRef.current?.click()}
            disabled={avatarBusy}
            title={avatarUrl ? 'Change your picture' : 'Add a picture'}
            aria-label={avatarUrl ? 'Change your picture' : 'Add a picture'}
          >
            <UserAvatar user={shown} url={avatarUrl} size={96} />
            <span className="profile-avatar-badge">
              {avatarBusy ? <span className="profile-avatar-spinner" /> : <Camera />}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => { uploadAvatar(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>

        <div className="profile-hero-body">
          <div className="profile-hero-name">{shown.full_name || shown.email}</div>

          <div className="profile-hero-mail">
            <Mail />
            <span>{shown.email}</span>
            {shown.email_verified
              ? <span className="pill pill-ok"><BadgeCheck /> {t('settings.verified')}</span>
              : <span className="pill pill-warn">{t('settings.unverified')}</span>}
          </div>

          <div className="profile-hero-tags">
            <span className={`role-badge role-${shown.role}`}>{shown.role}</span>
            {shown.is_owner ? <span className="pill pill-owner"><Crown /> {t('settings.owner')}</span> : null}
            {shown.company_name
              ? <span className="pill pill-muted"><Building /> {shown.company_name}</span>
              : null}
          </div>

          <div className="profile-hero-actions">
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()} disabled={avatarBusy}>
              <Upload /> {avatarUrl ? t('settings.change_photo') : t('settings.upload_photo')}
            </button>
            {avatarUrl && (
              <button type="button" className="link-btn link-btn--danger" onClick={removeAvatar} disabled={avatarBusy}>
                <Trash /> {t('settings.remove_photo')}
              </button>
            )}
            <span className="profile-hero-hint">{t('settings.avatar_hint')}</span>
          </div>

          {avatarErr && <div className="alert alert-error profile-avatar-error">{avatarErr}</div>}
        </div>
      </div>

      {/* ── At a glance ─────────────────────────────── */}
      <div className="profile-facts">
        <div className="profile-fact">
          <Calendar />
          <div><span>{t('settings.member_since')}</span><strong>{fmtDate(shown.created_at)}</strong></div>
        </div>
        <div className="profile-fact">
          <Clock />
          <div>
            <span>{t('settings.last_sign_in')}</span>
            <strong>{shown.last_login_at ? timeAgo(shown.last_login_at, isRTL) : '—'}</strong>
          </div>
        </div>
        <div className="profile-fact">
          <Language />
          <div><span>{t('common.language')}</span><strong>{shown.lang_preference === 'ar' ? 'العربية' : 'English'}</strong></div>
        </div>
        <div className="profile-fact">
          <ShieldCheck />
          <div><span>{t('settings.account')}</span><strong>{shown.email_verified ? t('settings.verified') : t('settings.needs_verification')}</strong></div>
        </div>
      </div>

      {/* ── Personal info ───────────────────────────── */}
      <form onSubmit={saveProfile} className="settings-form">
        <div className="settings-card">
          <div className="settings-card-title">{t('settings.personal_info')}</div>
          <SaveMsg msg={msg} />
          <div className="form-row">
            <div className="form-group">
              <label>{t('settings.full_name')}</label>
              <input value={form.full_name} onChange={set('full_name')} placeholder={t('common.ph_person')} />
            </div>
            <div className="form-group">
              <label>{t('common.phone')}</label>
              <PhoneInput value={form.phone} onChange={(v) => setForm(f => ({ ...f, phone: v }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('common.email')}</label>
              {/* Read-only: the address is the login identity and changing it
                  needs a re-verification flow that doesn't exist yet. */}
              <input value={shown.email || ''} disabled title={t('settings.email_locked_hint')} />
            </div>
            <div className="form-group">
              <label>{t('settings.preferred_language')}</label>
              <select value={form.lang_preference} onChange={set('lang_preference')}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </div>
          </div>
        </div>
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            <Check style={{ width:16,height:16 }} /> {saving ? '…' : t('settings.save_profile')}
          </button>
        </div>
      </form>

      {/* ── Password ────────────────────────────────── */}
      <form onSubmit={changePassword} className="settings-form" style={{ marginTop: 16 }}>
        <div className="settings-card">
          <div className="settings-card-title"><Lock style={{ width:14,height:14 }} /> {t('settings.change_password')}</div>
          <SaveMsg msg={pwMsg} />
          <div className="form-group">
            <label>{t('settings.current_password')}</label>
            <input type="password" autoComplete="current-password" value={pwForm.current_password} onChange={setPw('current_password')} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('settings.new_password')}</label>
              <input type="password" autoComplete="new-password" value={pwForm.new_password} onChange={setPw('new_password')} />
              {pwForm.new_password && (
                <div className="pw-meter">
                  <div className="pw-meter-track">
                    <div className={`pw-meter-fill pw-s${pwStrength.score}`} style={{ width: `${(pwStrength.score / 5) * 100}%` }} />
                  </div>
                  <div className="pw-meter-text">
                    <strong>{pwStrength.label}</strong>
                    {pwStrength.hint && <span> {pwStrength.hint}</span>}
                  </div>
                </div>
              )}
            </div>
            <div className="form-group">
              <label>{t('settings.confirm_new_password')}</label>
              <input type="password" autoComplete="new-password" value={pwForm.confirm} onChange={setPw('confirm')} />
              {pwForm.confirm && pwForm.new_password !== pwForm.confirm && (
                <div className="pw-mismatch">{t('common.passwords_no_match')}</div>
              )}
            </div>
          </div>
        </div>
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary btn-sm">{t('settings.update_password')}</button>
        </div>
      </form>
    </div>
  );
}

/* ══ Security Settings ═══════════════════════════════════ */
/* Parse a coarse device label out of a user-agent string. */
function parseDevice(ua = '') {
  const u = ua.toLowerCase();
  const isMobile = /iphone|android|ipad|mobile/.test(u);
  let os = 'Unknown device';
  if (/iphone|ipad|ios/.test(u)) os = 'iOS';
  else if (/android/.test(u)) os = 'Android';
  else if (/mac os|macintosh/.test(u)) os = 'macOS';
  else if (/windows/.test(u)) os = 'Windows';
  else if (/linux/.test(u)) os = 'Linux';
  let browser = '';
  if (/edg\//.test(u)) browser = 'Edge';
  else if (/chrome|crios/.test(u)) browser = 'Chrome';
  else if (/firefox|fxios/.test(u)) browser = 'Firefox';
  else if (/safari/.test(u)) browser = 'Safari';
  else if (/curl/.test(u)) browser = 'API/CLI';
  return { label: browser ? `${browser} · ${os}` : os, isMobile };
}

function timeAgo(dateStr, isRTL) {
  if (!dateStr) return '';
  const then = new Date(dateStr.replace(' ', 'T') + 'Z');
  const secs = Math.max(0, (Date.now() - then.getTime()) / 1000);
  const units = [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]];
  for (const [u, s] of units) {
    const v = Math.floor(secs / s);
    if (v >= 1) return isRTL ? `منذ ${v}${u}` : `${v}${u} ago`;
  }
  return isRTL ? 'الآن' : 'just now';
}

function SecuritySettings() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { showToast } = useToastContext();
  const [sessions, setSessions] = useState([]);
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState('');

  const load = () => {
    Promise.all([api.get('/auth/sessions'), api.get('/auth/login-history')]).then(([s, h]) => {
      if (s.success) setSessions(s.data || []);
      if (h.success) setHistory(h.data || []);
      setLoading(false);
    });
  };
  useEffect(load, []);

  const revoke = async (id) => {
    setBusy(id);
    const res = await api.post(`/auth/sessions/${id}/revoke`);
    showToast(res.success ? t('settings.session_revoked') : (res.message || t('common.save_failed')), res.success ? 'success' : 'error');
    setBusy('');
    if (res.success) load();
  };

  const logoutAll = async () => {
    setBusy('all');
    const res = await api.post('/auth/logout-all');
    showToast(res.success ? t('settings.logged_out_others') : (res.message || t('common.save_failed')), res.success ? 'success' : 'error');
    setBusy('');
    if (res.success) load();
  };

  if (loading) return <Loader fullPage />;

  const others = sessions.filter(s => !s.current).length;

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <Lock className="ss-icon" />
        <div><h3>{t('settings.security')}</h3><p>{t('settings.security_sub')}</p></div>
        {others > 0 && (
          <button className="btn btn-outline btn-sm" style={{ marginInlineStart: 'auto' }}
            onClick={logoutAll} disabled={busy === 'all'}>
            {busy === 'all' ? <span className="spinner spinner-sm" /> : <><LogOut style={{ width: 14, height: 14 }} /> {t('settings.logout_all_others')}</>}
          </button>
        )}
      </div>

      {/* Active sessions */}
      <div className="settings-card">
        <div className="settings-card-title">{t('settings.active_sessions')}</div>
        <div className="sessions-list">
          {sessions.map(s => {
            const dev = parseDevice(s.user_agent);
            const DevIcon = dev.isMobile ? SmartphoneDevice : Computer;
            return (
              <div key={s.id} className="session-row">
                <div className="session-icon"><DevIcon /></div>
                <div className="session-info">
                  <div className="session-device">
                    {dev.label}
                    {s.current && <span className="session-current-badge">{t('settings.this_device')}</span>}
                  </div>
                  <div className="session-meta">
                    {s.ip || '—'} · {t('settings.last_active')} {timeAgo(s.last_seen_at, isRTL)}
                  </div>
                </div>
                {!s.current && (
                  <button className="btn btn-ghost btn-sm session-revoke" onClick={() => revoke(s.id)} disabled={busy === s.id}>
                    {busy === s.id ? <span className="spinner spinner-sm" /> : t('settings.revoke')}
                  </button>
                )}
              </div>
            );
          })}
          {sessions.length === 0 && <div className="empty-state">{t('settings.no_sessions')}</div>}
        </div>
      </div>

      {/* Login history */}
      <div className="settings-card">
        <div className="settings-card-title"><Clock style={{ width: 15, height: 15, verticalAlign: '-2px', marginInlineEnd: 6 }} />{t('settings.login_history')}</div>
        <table className="data-table login-history-table">
          <thead>
            <tr>
              <th>{t('settings.result')}</th>
              <th>{t('settings.device')}</th>
              <th>IP</th>
              <th>{t('settings.when')}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i}>
                <td>
                  <span className={`status-badge ${h.success ? 'status-active' : 'status-inactive'}`}>
                    {h.success ? t('settings.success') : t('settings.failed')}
                  </span>
                </td>
                <td>{parseDevice(h.user_agent).label}</td>
                <td className="td-mono">{h.ip || '—'}</td>
                <td>{timeAgo(h.created_at, isRTL)}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr><td colSpan={4} className="empty-state">{t('settings.no_login_history')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

