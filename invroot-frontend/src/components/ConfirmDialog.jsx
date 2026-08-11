import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningTriangle, Xmark } from 'iconoir-react';
import './ConfirmDialog.css';

/**
 * Replacement for window.confirm() — keyboard accessible, themeable,
 * and able to show a busy state while the action runs.
 *
 * <ConfirmDialog
 *   open={x} title="Void this invoice?" message="…"
 *   confirmLabel="Void invoice" tone="danger" busy={busy}
 *   onConfirm={fn} onCancel={fn}
 * />
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = 'Confirm',
  cancelLabel  = 'Cancel',
  tone = 'danger',        // 'danger' | 'primary'
  busy = false,
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation();
  const confirmRef = useRef();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel?.(); }
      if (e.key === 'Enter'  && !busy) { e.preventDefault();  onConfirm?.(); }
    };
    document.addEventListener('keydown', onKey);
    // Focus the primary action so Enter/Space works straight away.
    const id = setTimeout(() => confirmRef.current?.focus(), 40);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(id); };
  }, [open, busy, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="cd-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel?.(); }}
    >
      <div className="cd-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <button type="button" className="cd-close" onClick={onCancel} disabled={busy} aria-label={t('common.close')}>
          <Xmark />
        </button>

        <div className={`cd-icon cd-icon--${tone}`}>
          <WarningTriangle />
        </div>

        <h3 className="cd-title">{title}</h3>
        {message && <p className="cd-message">{message}</p>}
        {detail && <div className="cd-detail">{detail}</div>}

        <div className="cd-actions">
          <button type="button" className="btn cd-btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn cd-btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <><span className="spinner spinner-sm" /> Working…</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
