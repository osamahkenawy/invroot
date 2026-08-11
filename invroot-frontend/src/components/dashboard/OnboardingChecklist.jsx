import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Rocket, Xmark, NavArrowRight } from 'iconoir-react';
import api from '../../lib/api.js';
import './OnboardingChecklist.css';

/**
 * Getting-started checklist for a fresh workspace. Completion comes from real
 * data (see GET /company/onboarding), so ticks appear as the tenant actually
 * uses the app. Hides itself once every step is done or the tenant dismisses it.
 */
export default function OnboardingChecklist() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [hidden, setHidden]   = useState(false);

  const load = useCallback(() => {
    api.get('/company/onboarding').then(r => { if (r.success) setData(r.data); });
  }, []);
  useEffect(load, [load]);

  const dismiss = async () => {
    setHidden(true);                       // optimistic — no spinner for a dismiss
    await api.post('/company/onboarding/dismiss', {});
  };

  if (!data || hidden || data.dismissed || data.all_done) return null;

  const pct = Math.round((data.completed / data.total) * 100);
  const next = data.steps.find(s => !s.done);

  return (
    <div className={`onb-card ${isRTL ? 'rtl' : ''}`}>
      <div className="onb-head">
        <div className="onb-icon"><Rocket /></div>
        <div className="onb-head-text">
          <h3>{t('onboarding.title')}</h3>
          <p>{t('onboarding.subtitle')}</p>
        </div>
        <button className="onb-dismiss" onClick={dismiss} aria-label={t('onboarding.dismiss')} title={t('onboarding.dismiss')}>
          <Xmark />
        </button>
      </div>

      <div className="onb-progress-row">
        <div className="onb-progress-track">
          <div className="onb-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="onb-progress-label">
          {t('onboarding.progress', { done: data.completed, total: data.total })}
        </span>
      </div>

      <div className="onb-steps">
        {data.steps.map(s => (
          <button
            key={s.key}
            className={`onb-step ${s.done ? 'done' : ''} ${s === next ? 'next' : ''}`}
            onClick={() => !s.done && navigate(s.link)}
            disabled={s.done}
          >
            <span className="onb-check">{s.done ? <Check strokeWidth={3} /> : <span className="onb-dot" />}</span>
            <span className="onb-step-text">
              <span className="onb-step-title">{t(`onboarding.step_${s.key}_title`, { defaultValue: s.title })}</span>
              {!s.done && (
                <span className="onb-step-body">{t(`onboarding.step_${s.key}_body`, { defaultValue: s.body })}</span>
              )}
            </span>
            {!s.done && (
              <span className="onb-step-cta">
                {t(`onboarding.step_${s.key}_cta`, { defaultValue: s.cta })}
                <NavArrowRight />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
