import { useState, useEffect, useRef, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, NavLink } from 'react-router-dom';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import {
  Building, Group, NumberedListLeft, User,
  Palette, PenTablet, Upload, Check, Xmark, NavArrowDown, Search
} from 'iconoir-react';
import './Settings.css';

/* ── Country data ────────────────────────────────────── */
const flag = (code) =>
  [...(code || '').toUpperCase()].map(c =>
    String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');

const COUNTRIES = [
  {code:'AF',name:'Afghanistan'},{code:'AL',name:'Albania'},{code:'DZ',name:'Algeria'},
  {code:'AD',name:'Andorra'},{code:'AO',name:'Angola'},{code:'AG',name:'Antigua & Barbuda'},
  {code:'AR',name:'Argentina'},{code:'AM',name:'Armenia'},{code:'AU',name:'Australia'},
  {code:'AT',name:'Austria'},{code:'AZ',name:'Azerbaijan'},{code:'BS',name:'Bahamas'},
  {code:'BH',name:'Bahrain'},{code:'BD',name:'Bangladesh'},{code:'BB',name:'Barbados'},
  {code:'BY',name:'Belarus'},{code:'BE',name:'Belgium'},{code:'BZ',name:'Belize'},
  {code:'BJ',name:'Benin'},{code:'BT',name:'Bhutan'},{code:'BO',name:'Bolivia'},
  {code:'BA',name:'Bosnia & Herzegovina'},{code:'BW',name:'Botswana'},{code:'BR',name:'Brazil'},
  {code:'BN',name:'Brunei'},{code:'BG',name:'Bulgaria'},{code:'BF',name:'Burkina Faso'},
  {code:'BI',name:'Burundi'},{code:'KH',name:'Cambodia'},{code:'CM',name:'Cameroon'},
  {code:'CA',name:'Canada'},{code:'CV',name:'Cape Verde'},{code:'CF',name:'Central African Rep.'},
  {code:'TD',name:'Chad'},{code:'CL',name:'Chile'},{code:'CN',name:'China'},
  {code:'CO',name:'Colombia'},{code:'KM',name:'Comoros'},{code:'CG',name:'Congo'},
  {code:'CR',name:'Costa Rica'},{code:'HR',name:'Croatia'},{code:'CU',name:'Cuba'},
  {code:'CY',name:'Cyprus'},{code:'CZ',name:'Czech Republic'},{code:'DK',name:'Denmark'},
  {code:'DJ',name:'Djibouti'},{code:'DM',name:'Dominica'},{code:'DO',name:'Dominican Rep.'},
  {code:'EC',name:'Ecuador'},{code:'EG',name:'Egypt'},{code:'SV',name:'El Salvador'},
  {code:'GQ',name:'Equatorial Guinea'},{code:'ER',name:'Eritrea'},{code:'EE',name:'Estonia'},
  {code:'ET',name:'Ethiopia'},{code:'FJ',name:'Fiji'},{code:'FI',name:'Finland'},
  {code:'FR',name:'France'},{code:'GA',name:'Gabon'},{code:'GM',name:'Gambia'},
  {code:'GE',name:'Georgia'},{code:'DE',name:'Germany'},{code:'GH',name:'Ghana'},
  {code:'GR',name:'Greece'},{code:'GD',name:'Grenada'},{code:'GT',name:'Guatemala'},
  {code:'GN',name:'Guinea'},{code:'GW',name:'Guinea-Bissau'},{code:'GY',name:'Guyana'},
  {code:'HT',name:'Haiti'},{code:'HN',name:'Honduras'},{code:'HU',name:'Hungary'},
  {code:'IS',name:'Iceland'},{code:'IN',name:'India'},{code:'ID',name:'Indonesia'},
  {code:'IR',name:'Iran'},{code:'IQ',name:'Iraq'},{code:'IE',name:'Ireland'},
  {code:'IL',name:'Israel'},{code:'IT',name:'Italy'},{code:'JM',name:'Jamaica'},
  {code:'JP',name:'Japan'},{code:'JO',name:'Jordan'},{code:'KZ',name:'Kazakhstan'},
  {code:'KE',name:'Kenya'},{code:'KI',name:'Kiribati'},{code:'KW',name:'Kuwait'},
  {code:'KG',name:'Kyrgyzstan'},{code:'LA',name:'Laos'},{code:'LV',name:'Latvia'},
  {code:'LB',name:'Lebanon'},{code:'LS',name:'Lesotho'},{code:'LR',name:'Liberia'},
  {code:'LY',name:'Libya'},{code:'LI',name:'Liechtenstein'},{code:'LT',name:'Lithuania'},
  {code:'LU',name:'Luxembourg'},{code:'MG',name:'Madagascar'},{code:'MW',name:'Malawi'},
  {code:'MY',name:'Malaysia'},{code:'MV',name:'Maldives'},{code:'ML',name:'Mali'},
  {code:'MT',name:'Malta'},{code:'MH',name:'Marshall Islands'},{code:'MR',name:'Mauritania'},
  {code:'MU',name:'Mauritius'},{code:'MX',name:'Mexico'},{code:'FM',name:'Micronesia'},
  {code:'MD',name:'Moldova'},{code:'MC',name:'Monaco'},{code:'MN',name:'Mongolia'},
  {code:'ME',name:'Montenegro'},{code:'MA',name:'Morocco'},{code:'MZ',name:'Mozambique'},
  {code:'MM',name:'Myanmar'},{code:'NA',name:'Namibia'},{code:'NR',name:'Nauru'},
  {code:'NP',name:'Nepal'},{code:'NL',name:'Netherlands'},{code:'NZ',name:'New Zealand'},
  {code:'NI',name:'Nicaragua'},{code:'NE',name:'Niger'},{code:'NG',name:'Nigeria'},
  {code:'NO',name:'Norway'},{code:'OM',name:'Oman'},{code:'PK',name:'Pakistan'},
  {code:'PW',name:'Palau'},{code:'PA',name:'Panama'},{code:'PG',name:'Papua New Guinea'},
  {code:'PY',name:'Paraguay'},{code:'PE',name:'Peru'},{code:'PH',name:'Philippines'},
  {code:'PL',name:'Poland'},{code:'PT',name:'Portugal'},{code:'QA',name:'Qatar'},
  {code:'RO',name:'Romania'},{code:'RU',name:'Russia'},{code:'RW',name:'Rwanda'},
  {code:'KN',name:'Saint Kitts & Nevis'},{code:'LC',name:'Saint Lucia'},
  {code:'VC',name:'Saint Vincent'},{code:'WS',name:'Samoa'},{code:'SM',name:'San Marino'},
  {code:'ST',name:'São Tomé & Príncipe'},{code:'SA',name:'Saudi Arabia'},
  {code:'SN',name:'Senegal'},{code:'RS',name:'Serbia'},{code:'SC',name:'Seychelles'},
  {code:'SL',name:'Sierra Leone'},{code:'SG',name:'Singapore'},{code:'SK',name:'Slovakia'},
  {code:'SI',name:'Slovenia'},{code:'SB',name:'Solomon Islands'},{code:'SO',name:'Somalia'},
  {code:'ZA',name:'South Africa'},{code:'SS',name:'South Sudan'},{code:'ES',name:'Spain'},
  {code:'LK',name:'Sri Lanka'},{code:'SD',name:'Sudan'},{code:'SR',name:'Suriname'},
  {code:'SZ',name:'Eswatini'},{code:'SE',name:'Sweden'},{code:'CH',name:'Switzerland'},
  {code:'SY',name:'Syria'},{code:'TW',name:'Taiwan'},{code:'TJ',name:'Tajikistan'},
  {code:'TZ',name:'Tanzania'},{code:'TH',name:'Thailand'},{code:'TL',name:'Timor-Leste'},
  {code:'TG',name:'Togo'},{code:'TO',name:'Tonga'},{code:'TT',name:'Trinidad & Tobago'},
  {code:'TN',name:'Tunisia'},{code:'TR',name:'Turkey'},{code:'TM',name:'Turkmenistan'},
  {code:'TV',name:'Tuvalu'},{code:'UG',name:'Uganda'},{code:'UA',name:'Ukraine'},
  {code:'AE',name:'United Arab Emirates'},{code:'GB',name:'United Kingdom'},
  {code:'US',name:'United States'},{code:'UY',name:'Uruguay'},{code:'UZ',name:'Uzbekistan'},
  {code:'VU',name:'Vanuatu'},{code:'VE',name:'Venezuela'},{code:'VN',name:'Vietnam'},
  {code:'YE',name:'Yemen'},{code:'ZM',name:'Zambia'},{code:'ZW',name:'Zimbabwe'},
];

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

const ALL_CURRENCIES = [
  'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AZN','BAM','BBD','BDT','BGN',
  'BHD','BIF','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CHF','CLP',
  'CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB',
  'EUR','FJD','GBP','GEL','GHS','GMD','GNF','GTQ','GYD','HNL','HTG','HUF','IDR',
  'ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KWD',
  'KYD','KZT','LAK','LBP','LKR','LRD','LYD','MAD','MDL','MGA','MKD','MMK','MNT',
  'MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD',
  'OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF',
  'SAR','SBD','SCR','SDG','SEK','SGD','SLL','SOS','SRD','SSP','STN','SYP','SZL',
  'THB','TJS','TMT','TND','TOP','TRY','TTD','TZS','UAH','UGX','USD','UYU','UZS',
  'VES','VND','VUV','WST','XAF','XCD','XOF','YER','ZAR','ZMW',
];

/* ── CountrySelect component ─────────────────────────── */
function CountrySelect({ value, onChange }) {
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
          <span className="cs-placeholder">Select country…</span>
        )}
        <NavArrowDown className="cs-arrow" />
      </button>
      {open && (
        <div className="cs-dropdown">
          <div className="cs-search-row">
            <Search width={14} height={14} />
            <input ref={searchRef} className="cs-search" placeholder="Search…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="cs-list" ref={listRef}>
            {filtered.length === 0
              ? <div className="cs-empty">No results</div>
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

const TABS = [
  { path: '',           labelKey: 'settings.company',    icon: Building },
  { path: 'branding',  labelKey: 'settings.branding',   icon: Palette },
  { path: 'stamp',     labelKey: 'settings.stamp_sig',  icon: PenTablet },
  { path: 'team',      labelKey: 'settings.team',       icon: Group },
  { path: 'numbering', labelKey: 'settings.numbering',  icon: NumberedListLeft },
  { path: 'profile',   labelKey: 'settings.profile',    icon: User },
];

export default function Settings() {
  const { t } = useTranslation();
  return (
    <div className="settings-layout">
      <div className="settings-sidebar">
        <h2 className="settings-title">{t('settings.title')}</h2>
        <nav className="settings-nav">
          {TABS.map(tab => {
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
          <Route index element={<CompanySettings />} />
          <Route path="branding" element={<BrandingSettings />} />
          <Route path="stamp" element={<StampSettings />} />
          <Route path="team" element={<TeamSettings />} />
          <Route path="numbering" element={<NumberingSettings />} />
          <Route path="profile" element={<ProfileSettings />} />
        </Routes>
      </div>
    </div>
  );
}

/* ── Reusable save feedback ─────────────────────────── */
function SaveMsg({ msg }) {
  if (!msg) return null;
  const ok = msg === 'Saved!' || msg === 'تم الحفظ!';
  return <div className={`alert ${ok ? 'alert-success' : 'alert-error'}`}>{msg}</div>;
}

/* ── Upload zone ────────────────────────────────────── */
function UploadZone({ label, hint, preview, onFile, accept = 'image/*' }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <div
      className={`upload-zone ${drag ? 'drag' : ''}`}
      onClick={() => ref.current.click()}
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
  const { t } = useTranslation();
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
        if (data.logo_url) setLogoPreview(`/uploads/logos/${data.logo_url}`);
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

  const handleLogoFile = (file) => {
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const uploadLogo = async () => {
    if (!logoFile) return;
    setUploadingLogo(true);
    const fd = new FormData();
    fd.append('logo', logoFile);
    try {
      const res = await fetch('/api/company/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: fd,
      });
      const data = await res.json();
      if (data.success) { setMsg('Logo uploaded!'); setLogoFile(null); }
      else setMsg(data.message);
    } finally { setUploadingLogo(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setMsg('');
    const res = await api.put('/company', form);
    setMsg(res.success ? 'Saved!' : res.message);
    setSaving(false);
  };

  if (loading) return <Loader fullPage />;

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <Building className="ss-icon" />
        <div>
          <h3>{t('settings.company')}</h3>
          <p>Manage your business identity and default document settings</p>
        </div>
      </div>
      <SaveMsg msg={msg} />

      {/* Logo */}
      <div className="settings-card">
        <div className="settings-card-title">Company Logo</div>
        <div className="logo-upload-row">
          <UploadZone
            label="Click or drag to upload logo"
            hint="PNG, JPG — max 2 MB"
            preview={logoPreview}
            onFile={handleLogoFile}
          />
          {logoFile && (
            <button className="btn btn-primary btn-sm" onClick={uploadLogo} disabled={uploadingLogo}>
              {uploadingLogo ? <span className="spinner spinner-sm" /> : <><Upload style={{ width:14,height:14 }} /> Upload</>}
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="settings-form">
        <div className="settings-card">
          <div className="settings-card-title">Business Identity</div>
          <div className="form-row">
            <div className="form-group"><label>Legal Name *</label><input value={form.company_name || ''} onChange={set('company_name')} required /></div>
            <div className="form-group"><label>Trading Name</label><input value={form.trading_name || ''} onChange={set('trading_name')} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Tax ID / VAT Number</label><input value={form.tax_id || ''} onChange={set('tax_id')} /></div>
            <div className="form-group"><label>Registration ID / CR</label><input value={form.registration_id || ''} onChange={set('registration_id')} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Website</label><input value={form.website || ''} onChange={set('website')} placeholder="https://..." /></div>
            <div className="form-group"><label>Phone</label><input value={form.phone || ''} onChange={set('phone')} /></div>
          </div>
          <div className="form-group"><label>Address</label><textarea value={form.address || ''} onChange={set('address')} rows={2} /></div>
          <div className="form-row">
            <div className="form-group"><label>City</label><input value={form.city || ''} onChange={set('city')} /></div>
            <div className="form-group"><label>Country</label>
              <CountrySelect value={form.country || ''} onChange={code => setForm(f => ({
                ...f,
                country: code,
                currency: COUNTRY_CURRENCY[code] || f.currency,
              }))} />
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-title">Document Defaults</div>
          <div className="form-row">
            <div className="form-group"><label>Default Currency</label>
              <select value={form.currency || 'SAR'} onChange={set('currency')}>
                {ALL_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Default Language</label>
              <select value={form.lang || 'en'} onChange={set('lang')}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </div>
            <div className="form-group"><label>Payment Terms (days)</label>
              <input type="number" value={form.payment_terms || 30} onChange={set('payment_terms')} />
            </div>
          </div>
          <div className="form-group"><label>Invoice Footer Text</label><textarea value={form.footer_text || ''} onChange={set('footer_text')} rows={2} placeholder="e.g. Thank you for your business!" /></div>
          <div className="form-group"><label>Invoice Terms & Conditions</label><textarea value={form.invoice_terms || ''} onChange={set('invoice_terms')} rows={3} placeholder="Payment is due within..." /></div>
        </div>

        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner spinner-sm" /> : <><Check style={{ width:16,height:16 }} /> Save Changes</>}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ══ Branding Settings ═══════════════════════════════════ */
function BrandingSettings() {
  const [form, setForm] = useState({ primary_color: '#0D1B2A', accent_color: '#d63a17', invoice_template: 'classic' });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setMsg('');
    const res = await api.put('/company', form);
    setMsg(res.success ? 'Saved!' : res.message);
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
          <h3>Branding & Appearance</h3>
          <p>Customize how your invoices and documents look to clients</p>
        </div>
      </div>
      <SaveMsg msg={msg} />

      <form onSubmit={handleSubmit} className="settings-form">
        <div className="settings-card">
          <div className="settings-card-title">Brand Colors</div>
          <div className="brand-colors-grid">
            <div className="brand-color-item">
              <label>Primary Color</label>
              <div className="color-picker-row">
                <input type="color" value={form.primary_color} onChange={set('primary_color')} className="color-swatch" />
                <input type="text" value={form.primary_color} onChange={set('primary_color')} className="color-hex" maxLength={7} />
              </div>
              <span className="color-hint">Used in headers, buttons, and accents</span>
            </div>
            <div className="brand-color-item">
              <label>Accent Color</label>
              <div className="color-picker-row">
                <input type="color" value={form.accent_color} onChange={set('accent_color')} className="color-swatch" />
                <input type="text" value={form.accent_color} onChange={set('accent_color')} className="color-hex" maxLength={7} />
              </div>
              <span className="color-hint">Used in totals, highlights, and badges</span>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-title">Invoice Template</div>
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
            {saving ? <span className="spinner spinner-sm" /> : <><Check style={{ width:16,height:16 }} /> Save Branding</>}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ══ Stamp & Signature ═══════════════════════════════════ */
function StampSettings() {
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
        if (cRes.data?.stamp_url) setStampPreview(`/uploads/stamps/${cRes.data.stamp_url}`);
      }
      if (sRes.success) {
        setSignatories(sRes.data || []);
        const def = (sRes.data || []).find(s => s.is_default);
        if (def?.signature_url) { setSigPreview(`/uploads/signatures/${def.signature_url}`); setSigName(def.name || ''); setSigTitle(def.title || ''); }
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
      if (data.success) { setMsg(`Saved! ${endpoint === 'stamp' ? 'Stamp' : 'Signature'} will appear on all new PDFs.`); reload(); }
      else setMsg(data.message || 'Upload failed');
    } catch { setMsg('Upload failed — check network'); }
    finally { setUploading(''); }
  };

  if (loading) return <Loader fullPage />;

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <PenTablet className="ss-icon" />
        <div>
          <h3>Company Stamp & Signature</h3>
          <p>These are embedded automatically on every finalized invoice PDF</p>
        </div>
      </div>
      <SaveMsg msg={msg} />

      <div className="stamp-grid">
        {/* Stamp */}
        <div className="settings-card">
          <div className="settings-card-title">Official Stamp / Seal</div>
          <p className="stamp-hint">Upload a PNG with transparent background for best results. The stamp will appear in the bottom section of your invoices.</p>
          <UploadZone
            label="Upload company stamp"
            hint="PNG with transparency recommended — max 2 MB"
            preview={stampPreview}
            onFile={(f) => { setStampFile(f); setStampPreview(URL.createObjectURL(f)); }}
          />
          {stampFile && (
            <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }}
              onClick={() => uploadFile('stamp', 'stamp', stampFile).then(() => setStampFile(null))}
              disabled={uploading === 'stamp'}>
              {uploading === 'stamp' ? <span className="spinner spinner-sm" /> : <><Upload style={{width:14,height:14}} /> Save Stamp</>}
            </button>
          )}
        </div>

        {/* Signature */}
        <div className="settings-card">
          <div className="settings-card-title">Authorized Signature</div>
          <p className="stamp-hint">Upload a scanned or digital signature. Will appear next to the stamp on finalized documents.</p>
          <UploadZone
            label="Upload signature"
            hint="PNG or JPG — max 2 MB"
            preview={sigPreview}
            onFile={(f) => { setSigFile(f); setSigPreview(URL.createObjectURL(f)); }}
          />
          <div className="form-row" style={{ marginTop: 12 }}>
            <div className="form-group">
              <label>Signatory Name</label>
              <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder="e.g. Ahmed Al-Rashid" />
            </div>
            <div className="form-group">
              <label>Title / Position</label>
              <input value={sigTitle} onChange={e => setSigTitle(e.target.value)} placeholder="e.g. Finance Manager" />
            </div>
          </div>
          {sigFile && (
            <button className="btn btn-primary btn-sm" style={{ marginTop: 4 }}
              onClick={() => uploadFile('signature', 'signature', sigFile, { signatory_name: sigName, signatory_title: sigTitle, is_default: '1' }).then(() => setSigFile(null))}
              disabled={uploading === 'signature'}>
              {uploading === 'signature' ? <span className="spinner spinner-sm" /> : <><Upload style={{width:14,height:14}} /> Save Signature</>}
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
          Both will appear automatically on all invoice & receipt PDFs
        </div>
      </div>

      {/* Signatory list */}
      {signatories.length > 0 && (
        <div className="settings-card">
          <div className="settings-card-title">Saved Signatories</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {signatories.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <img src={`/uploads/signatures/${s.signature_url}`} alt={s.name} style={{ height: 40, maxWidth: 120, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6, padding: 4, background: '#fff' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.title || ''}</div>
                </div>
                {s.is_default ? <span className="role-badge role-admin">Default</span> : null}
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
    if (res.success) { setMsg(`Invited! Temp password: ${res.temp_password}`); fetchTeam(); setInviting(false); setForm({ email: '', full_name: '', role: 'accountant' }); }
    else setMsg(res.message);
  };

  if (loading) return <Loader fullPage />;

  const ROLES = ['admin', 'accountant', 'sales', 'viewer'];

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <Group className="ss-icon" />
        <div>
          <h3>{t('settings.team')}</h3>
          <p>Manage team members and their access levels</p>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginInlineStart: 'auto' }} onClick={() => setInviting(v => !v)}>
          + Invite Member
        </button>
      </div>
      <SaveMsg msg={msg} />

      {inviting && (
        <div className="settings-card">
          <div className="settings-card-title">Invite New Member</div>
          <form onSubmit={sendInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-row">
              <div className="form-group"><label>Full Name</label><input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} /></div>
              <div className="form-group"><label>Email *</label><input type="email" value={form.email} required onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div className="form-group"><label>Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm">Send Invite</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInviting(false)}>Cancel</button>
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
                  {m.is_owner && <span className="badge-owner">Owner</span>}
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
        <div><h3>{t('settings.numbering')}</h3><p>Control prefixes and starting numbers for every document type</p></div>
      </div>
      <SaveMsg msg={msg} />
      <form onSubmit={handleSubmit} className="settings-form">

        {/* Format selector */}
        <div className="settings-card">
          <div className="settings-card-title">Number Format</div>
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
                <label>Prefix</label>
                <input
                  value={form[seq.prefix] ?? seq.defaultPfx}
                  onChange={set(seq.prefix)}
                  placeholder={seq.defaultPfx}
                />
              </div>
              <div className="form-group">
                <label>Starting Number</label>
                <input type="number" min="1" value={form[seq.start] ?? 1} onChange={set(seq.start)} />
              </div>
              <div className="form-group">
                <label>Live Preview</label>
                <div className="numbering-preview">
                  {previewNumber(form[seq.prefix] ?? seq.defaultPfx, form[seq.start] ?? 1)}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div className="settings-card">
          <div className="settings-card-title">Reset Rule</div>
          <div className="form-group">
            <label>Reset sequence counter</label>
            <select value={form.reset_frequency || 'never'} onChange={set('reset_frequency')}>
              <option value="never">Never reset</option>
              <option value="yearly">Reset yearly</option>
              <option value="monthly">Reset monthly</option>
            </select>
          </div>
        </div>
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary"><Check style={{ width:16,height:16 }} /> Save Numbering</button>
        </div>
      </form>
    </div>
  );
}

/* ══ Profile Settings ════════════════════════════════════ */
function ProfileSettings() {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const [form, setForm] = useState({ full_name: '', phone: '', lang_preference: 'en' });
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const setPw = (k) => (e) => setPwForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (user) setForm({ full_name: user.full_name || '', phone: user.phone || '', lang_preference: user.lang_preference || 'en' });
  }, [user]);

  const saveProfile = async (e) => {
    e.preventDefault(); setMsg('');
    const res = await api.put('/settings/profile', form);
    setMsg(res.success ? 'Saved!' : res.message);
  };

  const changePassword = async (e) => {
    e.preventDefault(); setPwMsg('');
    if (pwForm.new_password !== pwForm.confirm) { setPwMsg('Passwords do not match'); return; }
    if (pwForm.new_password.length < 8) { setPwMsg('Password must be at least 8 characters'); return; }
    const res = await api.post('/auth/change-password', { current_password: pwForm.current_password, new_password: pwForm.new_password });
    setPwMsg(res.success ? 'Password changed!' : res.message);
    if (res.success) setPwForm({ current_password: '', new_password: '', confirm: '' });
  };

  const initials = (user?.full_name || user?.email || '?').slice(0, 2).toUpperCase();

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <User className="ss-icon" />
        <div><h3>{t('settings.profile')}</h3><p>Your personal account details and preferences</p></div>
      </div>

      <div className="profile-avatar-section">
        <div className="profile-avatar-circle">{initials}</div>
        <div>
          <div className="profile-name">{user?.full_name || user?.email}</div>
          <div className="profile-email">{user?.email}</div>
          <span className={`role-badge role-${user?.role}`}>{user?.role}</span>
        </div>
      </div>

      <form onSubmit={saveProfile} className="settings-form">
        <div className="settings-card">
          <div className="settings-card-title">Personal Information</div>
          <SaveMsg msg={msg} />
          <div className="form-row">
            <div className="form-group"><label>Full Name</label><input value={form.full_name} onChange={set('full_name')} /></div>
            <div className="form-group"><label>Phone</label><input value={form.phone} onChange={set('phone')} /></div>
          </div>
          <div className="form-group"><label>Preferred Language</label>
            <select value={form.lang_preference} onChange={set('lang_preference')}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </div>
        </div>
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary btn-sm"><Check style={{ width:16,height:16 }} /> Save Profile</button>
        </div>
      </form>

      <form onSubmit={changePassword} className="settings-form" style={{ marginTop: 16 }}>
        <div className="settings-card">
          <div className="settings-card-title">Change Password</div>
          <SaveMsg msg={pwMsg} />
          <div className="form-group"><label>Current Password</label><input type="password" value={pwForm.current_password} onChange={setPw('current_password')} /></div>
          <div className="form-row">
            <div className="form-group"><label>New Password</label><input type="password" value={pwForm.new_password} onChange={setPw('new_password')} /></div>
            <div className="form-group"><label>Confirm New Password</label><input type="password" value={pwForm.confirm} onChange={setPw('confirm')} /></div>
          </div>
        </div>
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary btn-sm">Update Password</button>
        </div>
      </form>
    </div>
  );
}

