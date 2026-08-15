import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Shot from './Shot.jsx';
import { HERO, HERO_PHONE, MOBILE } from './shots.js';
import { urlFor } from './pages.js';
import usePlans from './usePlans.js';
import usePageSeo from './usePageSeo.js';

/**
 * The front door.
 *
 * It summarises; it does not repeat. The long feature rows live on /features,
 * the plan cards on /pricing and the answers on /faq, and each of those pages
 * is the only place its content appears. Two pages carrying the same
 * paragraphs would leave a search engine choosing between them — usually not
 * the one you wanted.
 */
export default function Home() {
  const { t } = useTranslation();
  const { lang } = useOutletContext();
  const { price, currency } = usePlans(lang);

  usePageSeo('home', { price, currency });

  const features = t('landing.features.items', { returnObjects: true });
  const steps = t('landing.steps.items', { returnObjects: true });

  return (
    <>
      <section className="lp-hero">
        <div className="lp-wrap lp-hero-inner">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">{t('landing.hero.eyebrow')}</span>
            <h1 className="lp-h1">
              {t('landing.hero.title1')}<br />
              <span className="lp-underline">{t('landing.hero.title2')}</span>
            </h1>
            <p className="lp-lead">{t('landing.hero.lead')}</p>
            <div className="lp-hero-actions">
              <Link to="/signup" className="lp-btn lp-btn-navy lp-btn-lg">
                {t('landing.hero.ctaPrimary')}
                <svg className="lp-btn-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
            <p className="lp-reassure">{t('landing.hero.reassure')}</p>
          </div>

          <div className="lp-hero-stage">
            <div className="lp-hero-shot">
              <Shot {...HERO} priority alt={t('landing.hero.shotAlt')} />
            </div>
            <div className="lp-hero-phone">
              <Shot {...HERO_PHONE} priority alt={t('landing.hero.phoneAlt')} />
            </div>

            <div className="lp-stat lp-stat-1">
              <span className="lp-stat-ico" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20" />
                </svg>
              </span>
              <span className="lp-stat-body">
                <strong>{t('landing.hero.stats.collectedValue')}</strong>
                <span>{t('landing.hero.stats.collectedLabel')}</span>
              </span>
            </div>

            <div className="lp-stat lp-stat-2">
              <span className="lp-stat-ico lp-stat-ico-ok" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" />
                </svg>
              </span>
              <span className="lp-stat-body">
                <strong>{t('landing.hero.stats.ontimeValue')}</strong>
                <span>{t('landing.hero.stats.ontimeLabel')}</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Five one-liners, not five essays — the essays are on /features. */}
      <section className="lp-section">
        <div className="lp-wrap">
          <header className="lp-sec-head">
            <span className="lp-kicker">{t('landing.features.kicker')}</span>
            <h2>{t('landing.features.title')}</h2>
            <p className="lp-sec-lead">{t('landing.features.lead')}</p>
          </header>
          <div className="lp-cards">
            {features.map((f, i) => (
              <article className="lp-card" key={i}>
                <span className="lp-tag">{f.tag}</span>
                <h3>{f.title}</h3>
                <p>{f.short}</p>
              </article>
            ))}
          </div>
          <p className="lp-sec-cta">
            <Link to={urlFor(lang, 'features')} className="lp-btn lp-btn-outline">
              {t('landing.features.cta')}
            </Link>
          </p>
        </div>
      </section>

      <section className="lp-section lp-steps-sec">
        <div className="lp-wrap">
          <header className="lp-sec-head">
            <span className="lp-kicker">{t('landing.steps.kicker')}</span>
            <h2>{t('landing.steps.title')}</h2>
          </header>
          <div className="lp-steps">
            {steps.map((s, i) => (
              <div className="lp-step" key={i}>
                <span className="lp-step-n">{String(i + 1).padStart(2, '0')}</span>
                <h4>{s.t}</h4>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
          <p className="lp-sec-cta">
            <Link to={urlFor(lang, 'how-it-works')} className="lp-btn lp-btn-outline">
              {t('landing.steps.cta')}
            </Link>
          </p>
        </div>
      </section>

      <section className="lp-mobile">
        <div className="lp-wrap lp-mobile-inner">
          {/* The copy carries its own weight here. With three lines against a
              580px phone this column was 436px of empty navy, and the fix for
              that is substance, not padding. */}
          <div className="lp-mobile-copy">
            <span className="lp-kicker lp-kicker-light">{t('landing.mobile.kicker')}</span>
            <h2>{t('landing.mobile.title')}</h2>
            <p>{t('landing.mobile.body')}</p>
            <ul className="lp-phone-list">
              {t('landing.mobile.points', { returnObjects: true }).map(p => (
                <li key={p}>
                  <span className="lp-phone-check" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7" />
                    </svg>
                  </span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="lp-mobile-actions">
              <Link to="/signup" className="lp-btn lp-btn-gold lp-btn-lg">{t('landing.hero.ctaPrimary')}</Link>
            </div>
          </div>
          <div className="lp-mobile-shot">
            <Shot {...MOBILE} alt={t('landing.mobile.shotAlt')} />
          </div>
        </div>
      </section>

      {/* A price, not a price table. The table is one click away and belongs
          to exactly one page. */}
      <section className="lp-section lp-price-strip-sec">
        <div className="lp-wrap lp-price-strip">
          <p>
            {price
              ? t('landing.pricing.strip', { price, currency })
              : t('landing.pricing.lead')}
          </p>
          <Link to={urlFor(lang, 'pricing')} className="lp-btn lp-btn-outline">
            {t('landing.pricing.cta')}
          </Link>
        </div>
      </section>

      <section className="lp-cta">
        <div className="lp-wrap lp-cta-inner">
          <h2>{t('landing.cta.title')}</h2>
          <p>{t('landing.cta.body')}</p>
          <Link to="/signup" className="lp-btn lp-btn-gold lp-btn-lg">{t('landing.cta.button')}</Link>
        </div>
      </section>
    </>
  );
}
