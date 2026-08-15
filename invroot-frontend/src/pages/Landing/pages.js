/**
 * The marketing site's route table — the single source of truth for what pages
 * exist and where they live in each language.
 *
 * Deliberately free of imports (and of any React or Vite-specific syntax) so
 * the build-time prerender script can `import` this same file from Node and
 * emit exactly the routes the app serves. A sitemap that lists a page the
 * router does not have, or misses one it does, is worse than no sitemap.
 */

export const SITE_URL = 'https://invroot.com';

/** Arabic gets a URL prefix rather than a language toggle, because a language
 *  a crawler cannot reach at its own address is a language it cannot index. */
export const LANGS = ['en', 'ar'];
export const DEFAULT_LANG = 'en';

export const PAGES = [
  { key: 'home',         path: '',             priority: '1.0', changefreq: 'weekly'  },
  { key: 'features',     path: 'features',     priority: '0.9', changefreq: 'monthly' },
  { key: 'pricing',      path: 'pricing',      priority: '0.9', changefreq: 'monthly' },
  { key: 'how-it-works', path: 'how-it-works', priority: '0.8', changefreq: 'monthly' },
  { key: 'faq',          path: 'faq',          priority: '0.7', changefreq: 'monthly' },
  /* Geo-targeted landing page. The product is global (see structured-data),
     but a dedicated UAE page is the only honest way to rank for "UAE invoicing"
     and "VAT tax invoice" searches without claiming the whole site is regional. */
  { key: 'invoicing-uae', path: 'invoicing-uae', priority: '0.8', changefreq: 'monthly' },
];

/**
 * The canonical address of a page, e.g. ('ar','pricing') → '/ar/pricing/'.
 *
 * The trailing slash is not a style choice. Each page is served as a real file
 * at <path>/index.html, and nginx's index module answers a request for
 * /pricing with a 301 to /pricing/ — an external redirect, not an internal
 * rewrite. Publishing the slashless form as canonical would therefore point
 * every canonical tag and every sitemap entry at a URL that immediately
 * redirects. This is the address the server actually serves.
 */
export function urlFor(lang, path) {
  const base = lang === DEFAULT_LANG ? '' : `/${lang}`;
  const rest = path ? `/${path}` : '';
  return `${base}${rest}/`;
}

/**
 * The same page as a React Router path — no trailing slash.
 *
 * Router matching normalises the slash away, so this is mostly cosmetic in the
 * route table; keeping the two functions separate is what stops someone
 * "tidying up" the slash out of urlFor() later and quietly reintroducing the
 * redirect on every canonical URL.
 */
export function routeFor(lang, path) {
  return urlFor(lang, path).replace(/(.)\/$/, '$1');
}

export function absUrl(lang, path) {
  return SITE_URL + urlFor(lang, path);
}

/** Which page is this pathname? Returns the PAGES entry, or undefined. */
export function pageFromPath(pathname) {
  const stripped = pathname.replace(/^\/(ar)(?=\/|$)/, '').replace(/^\/|\/$/g, '');
  return PAGES.find(p => p.path === stripped);
}

export function langFromPath(pathname) {
  return /^\/ar(\/|$)/.test(pathname) ? 'ar' : DEFAULT_LANG;
}
