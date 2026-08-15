import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHead from './PageHead.jsx';
import ClosingCta from './ClosingCta.jsx';
import usePageSeo from './usePageSeo.js';

/* A geo-targeted landing page for UAE VAT invoicing. The product is global,
   so this page reframes the same capabilities in local terms (TRN, 5% VAT,
   AED, Arabic tax invoices) to earn UAE search traffic honestly. */
export default function InvoicingUaePage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(0);

  const intro    = t('landing.uae.intro', { returnObjects: true });
  const features = t('landing.uae.features', { returnObjects: true });
  const faq      = t('landing.uae.faq', { returnObjects: true });

  usePageSeo('invoicing-uae', { faqs: faq.items });

  return (
    <>
      <PageHead kicker={t('landing.uae.kicker')}
                title={t('landing.uae.title')}
                lead={t('landing.uae.lead')} />

      <section className="lp-section">
        <div className="lp-wrap">
          <div className="lp-uae-intro">
            <h2>{intro.title}</h2>
            <p>{intro.body}</p>
          </div>

          <div className="lp-uae-grid">
            {features.items.map((f, i) => (
              <article className="lp-uae-card" key={i}>
                <span className="lp-tag">{f.tag}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-faq-sec">
        <div className="lp-wrap lp-faq-wrap">
          <h2 className="lp-uae-faq-title">{faq.title}</h2>
          <div className="lp-faqs">
            {faq.items.map((f, i) => (
              <div className={`lp-faq${open === i ? ' is-open' : ''}`} key={i}>
                <h3 className="lp-faq-h">
                  <button className="lp-faq-q" aria-expanded={open === i} aria-controls={`uae-faq-a-${i}`}
                          onClick={() => setOpen(open === i ? -1 : i)}>
                    <span>{f.q}</span><i aria-hidden="true" />
                  </button>
                </h3>
                <div className="lp-faq-a" id={`uae-faq-a-${i}`} role="region">{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ClosingCta />
    </>
  );
}
