import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Shot from './Shot.jsx';
import PageHead from './PageHead.jsx';
import ClosingCta from './ClosingCta.jsx';
import { featureShot } from './shots.js';
import usePageSeo from './usePageSeo.js';

export default function FeaturesPage() {
  const { t } = useTranslation();
  const { lang } = useOutletContext();
  usePageSeo('features');

  const items = t('landing.features.items', { returnObjects: true });

  return (
    <>
      <PageHead kicker={t('landing.features.kicker')}
                title={t('landing.features.title')}
                lead={t('landing.features.lead')} />

      <section className="lp-section">
        <div className="lp-wrap">
          {items.map((f, i) => {
            const shot = featureShot(i, lang);
            return (
              /* Alternating sides stop five identical rows reading as a list. */
              <div className={`lp-feature${i % 2 ? ' lp-feature-flip' : ''}`} key={i}>
                <div className="lp-feature-copy">
                  <span className="lp-tag">{f.tag}</span>
                  <h2>{f.title}</h2>
                  <p>{f.body}</p>
                  <ul className="lp-ticks">
                    {f.points.map(p => <li key={p}>{p}</li>)}
                  </ul>
                </div>
                <div className={`lp-feature-shot${shot.portrait ? ' is-portrait' : ''}`}>
                  <Shot {...shot} alt={f.title} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <ClosingCta />
    </>
  );
}
