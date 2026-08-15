import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Shot from './Shot.jsx';
import PageHead from './PageHead.jsx';
import ClosingCta from './ClosingCta.jsx';
import { FEATURE_SHOTS } from './shots.js';
import { urlFor } from './pages.js';
import usePageSeo from './usePageSeo.js';

/* The invoice builder is the screen step 2 describes, so it is the one shown. */
const BUILDER = FEATURE_SHOTS[0];

export default function HowItWorksPage() {
  const { t } = useTranslation();
  const { lang } = useOutletContext();
  usePageSeo('how-it-works');

  const steps = t('landing.steps.items', { returnObjects: true });

  return (
    <>
      <PageHead kicker={t('landing.steps.kicker')}
                title={t('landing.steps.title')}
                lead={t('landing.steps.lead')} />

      <section className="lp-section">
        <div className="lp-wrap lp-flow">
          {steps.map((s, i) => (
            <div className="lp-flow-step" key={i}>
              <div className="lp-flow-rail" aria-hidden="true">
                <span className="lp-flow-n">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="lp-flow-body">
                <h2>{s.t}</h2>
                <p className="lp-flow-lead">{s.d}</p>
                <p>{s.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="lp-wrap lp-flow-shot">
          <Shot {...BUILDER} alt={steps[1]?.t} />
        </div>

        <div className="lp-wrap lp-sec-cta">
          <Link to={urlFor(lang, 'features')} className="lp-btn lp-btn-outline">
            {t('landing.features.cta')}
          </Link>
        </div>
      </section>

      <ClosingCta />
    </>
  );
}
