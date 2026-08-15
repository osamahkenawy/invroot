/**
 * After `vite build`, emit one static HTML file per marketing route with that
 * route's real <head> baked in.
 *
 * The crawlers that matter here split cleanly in two. Google renders
 * JavaScript and will see whatever useSeo writes at runtime. WhatsApp, Slack,
 * LinkedIn, X and every other link-preview fetcher read the raw HTML and stop
 * — without this step they would show index.html's generic title and
 * description for all ten URLs, which is exactly the sort of thing nobody
 * notices until a shared /pricing link previews as the home page.
 *
 * The output is still the same SPA: identical script and stylesheet tags, so
 * hydration is unaffected and there is no second bundle to keep in step. Only
 * the <head> differs.
 *
 * Serving: with the usual `try_files $uri $uri/ /index.html;` these are picked
 * up automatically — a request for /pricing finds dist/pricing/index.html
 * before reaching the SPA fallback. A config that omits the `$uri/` term will
 * silently serve the generic index.html instead.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PAGES, LANGS, absUrl, SITE_URL } from '../src/pages/Landing/pages.js';
import { jsonLdFor } from '../src/pages/Landing/structured-data.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');

const messages = Object.fromEntries(LANGS.map(l => [
  l, JSON.parse(readFileSync(join(root, 'src/i18n/locales', `${l}.json`), 'utf8')).landing,
]));

const OG_IMAGE = { en: '/landing/og-invroot-en.jpg', ar: '/landing/og-invroot-ar.jpg' };
const NAV_KEY = { features: 'features', pricing: 'pricing', 'how-it-works': 'how', faq: 'faq' };

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* index.html carries generic versions of all of these. Strip them rather than
   append, or every page ships two titles and two og:descriptions and the
   crawler picks whichever it likes. */
function stripGeneric(html) {
  return html
    .replace(/\s*<title>[\s\S]*?<\/title>/i, '')
    .replace(/\s*<meta\s+name="description"[^>]*>/gi, '')
    .replace(/\s*<meta\s+property="og:[^"]*"[^>]*>/gi, '')
    .replace(/\s*<meta\s+name="twitter:[^"]*"[^>]*>/gi, '');
}

function headFor(lang, page) {
  const m = messages[lang];
  const seo = m.seo[page.key];
  const url = absUrl(lang, page.path);
  const image = SITE_URL + OG_IMAGE[lang];

  const jsonLd = jsonLdFor({
    key: page.key,
    lang,
    page,
    title: NAV_KEY[page.key] ? m.nav[NAV_KEY[page.key]] : 'Invroot',
    homeLabel: 'Invroot',
    faqs: page.key === 'faq' ? m.faq.items : undefined,
    // No price at build time: the offers come from /public/plans, and a price
    // frozen into static HTML is a price that goes stale silently. useSeo
    // replaces this block with the priced version once the fetch lands.
  });

  const alts = [
    ...LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${absUrl(l, page.path)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${absUrl('en', page.path)}" />`,
  ];

  return [
    `<title>${esc(seo.title)}</title>`,
    `<meta name="description" content="${esc(seo.description)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />`,
    `<link rel="canonical" href="${url}" />`,
    ...alts,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Invroot" />`,
    `<meta property="og:title" content="${esc(seo.title)}" />`,
    `<meta property="og:description" content="${esc(seo.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:locale" content="${lang === 'ar' ? 'ar_AR' : 'en_US'}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(seo.title)}" />`,
    `<meta name="twitter:description" content="${esc(seo.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<script type="application/ld+json" data-seo-static>${JSON.stringify(jsonLd)}</script>`,
  ].map(l => '    ' + l).join('\n');
}

const template = stripGeneric(readFileSync(join(dist, 'index.html'), 'utf8'));

for (const lang of LANGS) {
  for (const page of PAGES) {
    const html = template
      .replace(/<html[^>]*>/i, `<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`)
      .replace('</head>', `${headFor(lang, page)}\n  </head>`);

    // '/' → dist/index.html, '/ar/pricing/' → dist/ar/pricing/index.html
    const rel = absUrl(lang, page.path).slice(SITE_URL.length).replace(/^\/|\/$/g, '');
    const dir = rel ? join(dist, rel) : dist;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), html);
    console.log('  ' + (rel ? '/' + rel : '/'));
  }
}
console.log(`prerendered ${LANGS.length * PAGES.length} routes`);
