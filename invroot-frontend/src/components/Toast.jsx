import { useTranslation } from 'react-i18next';
import { CheckCircle, WarningTriangle, InfoCircle, Xmark } from 'iconoir-react';
import './Toast.css';

const ICONS = {
  success: CheckCircle,
  error:   WarningTriangle,
  warning: WarningTriangle,
  info:    InfoCircle,
};

/**
 * Toast container. Render once near the app root.
 * @param {{ toasts: Array, onDismiss: Function }} props
 */
export default function Toast({ toasts = [], onDismiss }) {
  const { t } = useTranslation();
  if (!toasts.length) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {/* Deliberately NOT `t` — that is the translation function from above, and
          shadowing it here made `t('common.dismiss')` call the toast object,
          crashing the whole app the moment any dismissible toast appeared. */}
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type] || InfoCircle;
        return (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <Icon className="toast-icon" />
            <span className="toast-message">{toast.message}</span>
            {onDismiss && (
              <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label={t('common.dismiss')}>
                <Xmark />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
