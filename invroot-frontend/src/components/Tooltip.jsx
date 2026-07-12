import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoCircle } from 'iconoir-react';
import './Tooltip.css';

/**
 * Hover tooltip with optional i18n text.
 * @param {{ text?: string, tooltipKey?: string, position?: 'top'|'bottom', children?: any }} props
 */
export default function Tooltip({ text, tooltipKey, position = 'top', children }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const label = tooltipKey ? t(tooltipKey) : text;

  return (
    <span
      className="tooltip-wrap"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      tabIndex={0}
    >
      {children || <InfoCircle className="tooltip-trigger-icon" />}
      {show && label && <span className={`tooltip-bubble tooltip-${position}`}>{label}</span>}
    </span>
  );
}
