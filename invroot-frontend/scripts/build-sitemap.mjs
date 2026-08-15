/**
 * Writes public/sitemap.xml from the router's own page table.
 *
 * Generated rather than hand-kept, because the two ways a sitemap goes wrong
 * both come from it being a second, parallel list: it advertises a URL the app
 * does not serve (a soft 404 in Search Console), or it misses one it does.
 * Reading src/pages/Landing/pages.js makes that impossible by construction.
 *
 * Runs before `vite build` so the file is in place for the copy into dist/,
 * and is committed so the dev server serves it too.
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PAGES, LANGS, absUrl } from '../src/pages/Landing/pages.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'sitemap.xml');

const urls = LANGS.flatMap(lang => PAGES.map(page => {
  // Every URL carries the full alternate set, including itself — the
  // reciprocity Google requires before it will honour an hreflang pair.
  const alts = [
    ...LANGS.map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${absUrl(l, page.path)}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${absUrl('en', page.path)}"/>`,
  ].join('\n');
  return [
    '  <url>',
    `    <loc>${absUrl(lang, page.path)}</loc>`,
    alts,
    `    <changefreq>${page.changefreq}</changefreq>`,
    `    <priority>${page.priority}</priority>`,
    '  </url>',
  ].join('\n');
}));

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;

writeFileSync(out, xml);
console.log(`sitemap.xml  ${LANGS.length * PAGES.length} URLs`);
