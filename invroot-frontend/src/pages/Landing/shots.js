/**
 * Which picture goes with which block of copy.
 *
 * Kept out of the components so the copy can live entirely in the locale files
 * — the text is translated, the screenshots are not, and mixing the two would
 * mean maintaining image paths in two JSON files.
 */

export const HERO       = { id: 'H1', w: 2048, h: 1365, src: '/landing/hero-desktop.png' };
/* The transparent "payment successful" handset that sits beside the dashboard
   in the hero. Different from MOBILE below, which is the app-dashboard screen
   used in the standalone mobile band further down the page. */
export const HERO_PHONE = { id: 'HP', w: 600, h: 1200, src: '/landing/hero-phone.png' };
export const MOBILE     = { id: 'M1', w: 1200, h: 2400, src: '/landing/m1-iphone.webp' };

/* Index-matched to landing.features.items. */
export const FEATURE_SHOTS = [
  { id: 'F1', w: 1600, h: 1200, src: '/landing/f1-invoice-builder.webp' },
  { id: 'F2', w: 1200, h: 1600, src: '/landing/f2-pdf.webp', portrait: true },
  /* The bilingual row shows the language you are NOT reading in: an English
     visitor is being shown that Arabic works, and an Arabic visitor the
     reverse. Showing someone their own language proves nothing. */
  { id: 'F4', w: 1600, h: 913, src: '/landing/f4-arabic.webp', altSrc: '/landing/f4-english.webp' },
  { id: 'F3', w: 1600, h: 1200, src: '/landing/f3-dashboard.webp' },
  { id: 'F5', w: 1600, h: 1200, src: '/landing/f5-reconcile.webp' },
];

export function featureShot(i, lang) {
  const shot = FEATURE_SHOTS[i];
  if (shot.altSrc && lang === 'ar') return { ...shot, src: shot.altSrc };
  return shot;
}
