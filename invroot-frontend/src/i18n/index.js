import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import ar from './locales/ar.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'ar'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

/**
 * Keep <html lang> and <html dir> in step with the active language.
 *
 * This used to be only an event listener, registered after init(). But init()
 * fires `languageChanged` synchronously while the detector resolves the
 * language, so the FIRST one was always missed: on every fresh page load in
 * Arabic the document stayed lang="en" dir="ltr" while rendering Arabic text.
 *
 * That is not cosmetic. Every `[dir='rtl']` rule in the stylesheets is keyed
 * off this attribute, so the whole layout ran left-to-right; and utils/date.js
 * and utils/currency.js read documentElement.lang to pick a locale, so dates
 * and numbers were formatted in English too. It only came right if you happened
 * to switch language during the session.
 *
 * So: apply it now, and again on every change.
 */
function applyDirection(lng) {
  const lang = lng || i18n.resolvedLanguage || i18n.language || 'en';
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', lang.startsWith('ar') ? 'rtl' : 'ltr');
}

applyDirection();
i18n.on('languageChanged', applyDirection);

export default i18n;
