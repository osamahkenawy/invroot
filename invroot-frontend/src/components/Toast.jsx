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
  if (!toasts.length) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.type] || InfoCircle;
        return (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <Icon className="toast-icon" />
            <span className="toast-message">{t.message}</span>
            {onDismiss && (
              <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
                <Xmark />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
