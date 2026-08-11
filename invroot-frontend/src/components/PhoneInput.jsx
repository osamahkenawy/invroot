import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { NavArrowDown, Search, Check } from 'iconoir-react';
import { COUNTRIES, flag } from '../data/countries.js';
import './PhoneInput.css';

/* Longest dial code first, so +1268 (Antigua) wins over +1 (US/Canada). */
const BY_DIAL_LENGTH = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/** Split "+971 50 123 4567" into its country and the national part. */
export function parsePhone(value) {
  const raw = (value || '').trim();
  if (!raw.startsWith('+')) return null;
  const rest = raw.slice(1);
  const digits = rest.replace(/\D/g, '');
  const country = BY_DIAL_LENGTH.find(c => digits.startsWith(c.dial));
  if (!country) return null;
  return { country, national: rest.slice(country.dial.length).trim() };
}

/** A bare "+971" is a dial code, not a phone number — don't persist it. */
export function stripDialOnly(value) {
  return /^\+\d{1,4}$/.test((value || '').trim()) ? '' : (value || '');
}

/** Re-prefix a number with a country's dial code, keeping whatever was typed. */
export function withDialCode(value, countryCode) {
  const country = COUNTRIES.find(c => c.code === countryCode);
  if (!country) return value;
  const national = parsePhone(value)?.national ?? (value || '').replace(/^\+/, '').trim();
  return national ? `+${country.dial} ${national}` : `+${country.dial}`;
}

export default function PhoneInput({
  value, onChange, defaultCountry = 'SA', placeholder, autoFocus, disabled,
}) {
  const { t } = useTranslation();
  const parsed = parsePhone(value);
  const [fallback, setFallback] = useState(
    () => COUNTRIES.find(c => c.code === defaultCountry) || COUNTRIES.find(c => c.code === 'US')
  );
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef   = useRef();
  const searchRef = useRef();
  const listRef   = useRef();

  // The dial code always comes from `value` when it has one, so the parent can
  // swap countries (e.g. after picking a country) and this stays in sync.
  const country  = parsed?.country || fallback;
  const national = parsed ? parsed.national : (value || '');

  useEffect(() => {
    if (parsed && parsed.country.code !== fallback.code) setFallback(parsed.country);
  }, [parsed?.country.code]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setTimeout(() => {
      searchRef.current?.focus();
      listRef.current?.querySelector('.ph-option.active')?.scrollIntoView({ block: 'center' });
    }, 40);
  }, [open]);

  const emit = (c, num) => {
    const trimmed = (num || '').trim();
    onChange(trimmed ? `+${c.dial} ${trimmed}` : `+${c.dial}`);
  };

  const pickCountry = (c) => {
    setFallback(c);
    setOpen(false);
    emit(c, national);
  };

  const q = search.trim().toLowerCase();
  const filtered = !q ? COUNTRIES : COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(q) || c.dial.includes(q.replace(/^\+/, '')) || c.code.toLowerCase() === q
  );

  return (
    <div
      className="ph-wrap"
      ref={wrapRef}
      onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
    >
      <button
        type="button"
        className={`ph-country-btn${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country code: ${country.name} +${country.dial}`}
      >
        <span className="ph-flag">{flag(country.code)}</span>
        <span className="ph-dial">+{country.dial}</span>
        <NavArrowDown className="ph-arrow" />
      </button>

      <input
        type="tel"
        className="ph-number-input"
        value={national}
        onChange={e => emit(country, e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
      />

      {open && (
        <div className="ph-dropdown" role="listbox">
          <div className="ph-search-row">
            <Search width={14} height={14} />
            <input
              ref={searchRef}
              className="ph-search"
              placeholder={t('common.search_country')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="ph-list" ref={listRef}>
            {filtered.length === 0 ? (
              <div className="ph-empty">{t('common.no_matching_country')}</div>
            ) : filtered.map(c => {
              const active = country.code === c.code;
              return (
                <div
                  key={c.code}
                  role="option"
                  aria-selected={active}
                  className={`ph-option${active ? ' active' : ''}`}
                  onMouseDown={() => pickCountry(c)}
                >
                  <span className="ph-flag">{flag(c.code)}</span>
                  <span className="ph-oname">{c.name}</span>
                  <span className="ph-odial">+{c.dial}</span>
                  {active && <Check className="ph-check" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
