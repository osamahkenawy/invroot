import { useEffect } from 'react';
import { SITE_URL, LANGS, absUrl, DEFAULT_LANG } from './pages.js';

/**
 * Per-page <head> for the marketing site.
 *
 * The same tags are also baked into static HTML at build time (see
 * scripts/prerender-seo.mjs), because the crawlers that matter here split into
 * two groups: Google renders JavaScript and will see what this hook writes,
 * while WhatsApp, Slack, LinkedIn and X read the raw HTML and would otherwise
 * show whatever index.html happened to say for every page on the site. Doing
 * both is not belt-and-braces — neither one alone covers both groups.
 *
 * Anything this hook adds is tagged data-seo and removed on unmount, and the
 * handful of tags that ship in index.html are restored to their original
 * values, so navigating from the landing page into the app does not leave it
 * describing itself as a pricing page.
 */

const BASE_TITLE = 'Invroot – Billing Simplified';
/* Built at 1200×630, the ratio the platforms actually render. The site used to
   point og:image at the 2000×2000 square logo, so every card showed the middle
   letterbox slice of a logo on white. */
const OG_IMAGE = { en: '/landing/og-invroot-en.jpg', ar: '/landing/og-invroot-ar.jpg' };

/** Tags that exist in index.html: remember what they said before we touched them. */
const PRESET = ['meta[name="description"]', 'meta[property="og:title"]',
                'meta[property="og:description"]', 'meta[property="og:image"]'];
const original = new Map();

function remember(el) {
  if (el && !el.hasAttribute('data-seo') && !original.has(el)) {
    original.set(el, el.getAttribute('content'));
  }
}

function upsert(selector, build) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = build();
    el.setAttribute('data-seo', '');
    document.head.appendChild(el);
  }
  return el;
}

function setMeta(kind, key, content) {
  const el = upsert(`meta[${kind}="${key}"]`, () => {
    const m = document.createElement('meta');
    m.setAttribute(kind, key);
    return m;
  });
  remember(el);
  el.setAttribute('content', content);
}

function setLink(rel, href, hreflang) {
  const sel = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`;
  const el = upsert(sel, () => {
    const l = document.createElement('link');
    l.setAttribute('rel', rel);
    if (hreflang) l.setAttribute('hreflang', hreflang);
    return l;
  });
  el.setAttribute('href', href);
}

export default function useSeo({ lang, path, title, description, jsonLd }) {
  useEffect(() => {
    PRESET.forEach(sel => remember(document.head.querySelector(sel)));

    const url = absUrl(lang, path);
    const image = SITE_URL + (OG_IMAGE[lang] || OG_IMAGE[DEFAULT_LANG]);

    document.title = title;
    setMeta('name', 'description', description);
    setMeta('name', 'robots', 'index, follow, max-image-preview:large, max-snippet:-1');

    setLink('canonical', url);
    // Every page declares the full set, including itself — the reciprocity
    // Google requires for the pair to be honoured at all.
    LANGS.forEach(l => setLink('alternate', absUrl(l, path), l));
    setLink('alternate', absUrl(DEFAULT_LANG, path), 'x-default');

    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', 'Invroot');
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', image);
    setMeta('property', 'og:image:width', '1200');
    setMeta('property', 'og:image:height', '630');
    // Region-neutral: en_AE / ar_AE told every platform this was a UAE page.
    setMeta('property', 'og:locale', lang === 'ar' ? 'ar_AR' : 'en_US');

    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', image);

    // The prerendered block has no price in it, because there is no price at
    // build time. Now that /public/plans has answered, replace it rather than
    // leaving two ld+json graphs describing the same @id.
    document.head.querySelectorAll('script[data-seo-static]').forEach(el => el.remove());

    let script = null;
    if (jsonLd) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute('data-seo', '');
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    return () => {
      script?.remove();
    };
  }, [lang, path, title, description, JSON.stringify(jsonLd)]);

  // Leaving the marketing site entirely: strip what we added and put the
  // index.html tags back the way we found them.
  useEffect(() => () => {
    document.head.querySelectorAll('[data-seo]').forEach(el => el.remove());
    original.forEach((content, el) => {
      if (content != null && el.isConnected) el.setAttribute('content', content);
    });
    original.clear();
    document.title = BASE_TITLE;
  }, []);
}
