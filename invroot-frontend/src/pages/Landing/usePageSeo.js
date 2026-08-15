import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PAGES, langFromPath } from './pages.js';
import { jsonLdFor } from './structured-data.js';
import useSeo from './useSeo.js';

/** Breadcrumb labels reuse the nav wording, so the crumb a searcher sees in
 *  the result matches the link they land next to on the page. */
const NAV_KEY = { features: 'features', pricing: 'pricing', 'how-it-works': 'how', faq: 'faq' };

/** Pages without a nav entry still need a breadcrumb label; map them here so
 *  the crumb reads as a place, not the fallback brand name. */
const CRUMB_KEY = { 'invoicing-uae': 'landing.uae.crumb' };

export default function usePageSeo(key, extra = {}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const lang = langFromPath(pathname);
  const page = PAGES.find(p => p.key === key);
  const title = t(`landing.seo.${key}.title`);
  const description = t(`landing.seo.${key}.description`);

  const crumb = NAV_KEY[key] ? t(`landing.nav.${NAV_KEY[key]}`)
              : CRUMB_KEY[key] ? t(CRUMB_KEY[key])
              : 'Invroot';

  useSeo({
    lang,
    path: page.path,
    title,
    description,
    jsonLd: jsonLdFor({
      key, lang, page,
      title: crumb,
      homeLabel: 'Invroot',
      ...extra,
    }),
  });
}
