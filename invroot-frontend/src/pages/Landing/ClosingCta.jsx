import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/** Every page ends somewhere; this is where it ends. */
export default function ClosingCta() {
  const { t } = useTranslation();
  return (
    <section className="lp-cta">
      <div className="lp-wrap lp-cta-inner">
        <h2>{t('landing.cta.title')}</h2>
        <p>{t('landing.cta.body')}</p>
        <Link to="/signup" className="lp-btn lp-btn-gold lp-btn-lg">{t('landing.cta.button')}</Link>
      </div>
    </section>
  );
}
