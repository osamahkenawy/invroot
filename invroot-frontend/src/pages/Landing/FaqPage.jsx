import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHead from './PageHead.jsx';
import ClosingCta from './ClosingCta.jsx';
import usePageSeo from './usePageSeo.js';

export default function FaqPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(0);

  const items = t('landing.faq.items', { returnObjects: true });
  usePageSeo('faq', { faqs: items });

  return (
    <>
      <PageHead kicker={t('landing.faq.kicker')}
                title={t('landing.faq.title')}
                lead={t('landing.faq.lead')} />

      <section className="lp-section lp-faq-sec">
        <div className="lp-wrap lp-faq-wrap">
          <div className="lp-faqs">
            {items.map((f, i) => (
              <div className={`lp-faq${open === i ? ' is-open' : ''}`} key={i}>
                <h2 className="lp-faq-h">
                  <button className="lp-faq-q" aria-expanded={open === i} aria-controls={`faq-a-${i}`}
                          onClick={() => setOpen(open === i ? -1 : i)}>
                    <span>{f.q}</span><i aria-hidden="true" />
                  </button>
                </h2>
                {/* Rendered whether or not it is open: collapsing an answer is
                    a reading affordance, and an answer that only exists in the
                    DOM after a click is an answer a crawler never reads. */}
                <div className="lp-faq-a" id={`faq-a-${i}`} role="region">{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ClosingCta />
    </>
  );
}
