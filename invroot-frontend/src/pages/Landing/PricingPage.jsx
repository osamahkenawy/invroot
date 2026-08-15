import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHead from './PageHead.jsx';
import ClosingCta from './ClosingCta.jsx';
import { urlFor } from './pages.js';
import usePlans from './usePlans.js';
import usePageSeo from './usePageSeo.js';

export default function PricingPage() {
  const { t } = useTranslation();
  const { lang } = useOutletContext();
  const { starter, price, currency, limits } = usePlans(lang);

  usePageSeo('pricing', { price, currency });

  const free = t('landing.pricing.free', { returnObjects: true });
  const paid = t('landing.pricing.starter', { returnObjects: true });
  const ent  = t('landing.pricing.enterprise', { returnObjects: true });

  return (
    <>
      <PageHead kicker={t('landing.pricing.kicker')}
                title={t('landing.pricing.title')}
                lead={t('landing.pricing.lead')} />

      <section className="lp-section">
        <div className="lp-wrap">
          <div className="lp-plans">
            <div className="lp-plan">
              <h2>{free.name}</h2>
              <div className="lp-price"><span className="lp-price-amt">{free.price}</span></div>
              <p className="lp-plan-sub">{free.sub}</p>
              <ul className="lp-ticks">{free.points.map(p => <li key={p}>{p}</li>)}</ul>
              <Link to="/signup" className="lp-btn lp-btn-outline lp-btn-full">{free.cta}</Link>
            </div>

            <div className="lp-plan lp-plan-feature">
              <span className="lp-plan-badge">{t('landing.pricing.popular')}</span>
              {/* The plan's own display name from the API, so renaming a plan
                  does not need a second edit in the locale files. */}
              <h2>{starter?.name ?? paid.name}</h2>
              <div className="lp-price">
                <span className="lp-price-cur">{currency ?? 'AED'}</span>
                <span className="lp-price-amt">{price ?? '—'}</span>
                <span className="lp-price-per">{t('landing.pricing.month')}</span>
              </div>
              <p className="lp-plan-sub">{paid.sub}</p>
              <ul className="lp-ticks">
                <li>{t('landing.pricing.starter.limits', {
                  clients: limits?.clients ?? 200, users: limits?.users ?? 5,
                })}</li>
                {paid.points.map(p => <li key={p}>{p}</li>)}
              </ul>
              <Link to="/signup" className="lp-btn lp-btn-gold lp-btn-full">{paid.cta}</Link>
            </div>

            <div className="lp-plan">
              <h2>{ent.name}</h2>
              <div className="lp-price"><span className="lp-price-amt">{ent.price}</span></div>
              <p className="lp-plan-sub">{ent.sub}</p>
              <ul className="lp-ticks">{ent.points.map(p => <li key={p}>{p}</li>)}</ul>
              <a href="mailto:support@invroot.com?subject=Invroot%20Enterprise%20enquiry"
                 className="lp-btn lp-btn-outline lp-btn-full">{ent.cta}</a>
            </div>
          </div>

          <p className="lp-vat-note">{t('landing.pricing.note')}</p>
          <p className="lp-sec-cta">
            <Link to={urlFor(lang, 'faq')} className="lp-btn lp-btn-outline">
              {t('landing.faq.cta')}
            </Link>
          </p>
        </div>
      </section>

      <ClosingCta />
    </>
  );
}
