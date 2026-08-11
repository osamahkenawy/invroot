import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Xmark, Check } from 'iconoir-react';
import './BrandAssetModal.css';

/* What each asset needs — endpoint, response field, and the copy around it. */
const ASSETS = {
  logo: {
    title:    'Add Company Logo',
    subtitle: 'Appears in the header of every invoice and quote you send.',
    endpoint: '/api/company/logo',
    field:    'logo_url',
    formKey:  'logo',
    hint:     'PNG, JPG or WEBP — max 5 MB. A transparent PNG looks best.',
    maxBytes: 5 * 1024 * 1024,
  },
  stamp: {
    title:    'Add Company Stamp',
    subtitle: 'Your official stamp is placed on the invoice PDF.',
    endpoint: '/api/company/stamp',
    field:    'stamp_url',
    formKey:  'stamp',
    hint:     'PNG, JPG or WEBP — max 2 MB. Transparent background recommended.',
    maxBytes: 2 * 1024 * 1024,
  },
};

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export default function BrandAssetModal({ asset, currentUrl, onClose, onUploaded }) {
  const { t } = useTranslation();
  const cfg = ASSETS[asset];
  const [file, setFile]         = useState(null);
  const [preview, setPreview]   = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]       = useState('');
  const inputRef = useRef();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !uploading) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, uploading]);

  // Release the object URL so repeated picks don't leak blobs.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const accept = (f) => {
    if (!f) return;
    setError('');
    if (!ACCEPT.split(',').includes(f.type)) {
      setError(t('settings.picture_not_image'));
      return;
    }
    if (f.size > cfg.maxBytes) {
      setError(`That file is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is ${cfg.maxBytes / 1024 / 1024} MB.`);
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append(cfg.formKey, file);
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
        credentials: 'include',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        onUploaded(cfg.field, data[cfg.field]);
        onClose();
      } else {
        setError(data.message || 'Upload failed. Please try again.');
      }
    } catch {
      setError(t('settings.upload_failed'));
    } finally {
      setUploading(false);
    }
  };

  // currentUrl arrives ready to render — it may be a signed S3 URL.
  const shown = preview || currentUrl || null;

  return (
    <div className="ba-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !uploading) onClose(); }}>
      <div className="ba-modal" role="dialog" aria-modal="true" aria-label={cfg.title}>
        <div className="ba-header">
          <div>
            <h3>{cfg.title}</h3>
            <p>{cfg.subtitle}</p>
          </div>
          <button type="button" className="ba-close" onClick={onClose} disabled={uploading} aria-label={t('common.close')}>
            <Xmark />
          </button>
        </div>

        <div className="ba-body">
          {error && <div className="ba-error">{error}</div>}

          <button
            type="button"
            className={`ba-drop${dragging ? ' dragging' : ''}${shown ? ' has-image' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files?.[0]); }}
          >
            {shown ? (
              <>
                <img src={shown} alt={`${asset} preview`} className="ba-preview" />
                <span className="ba-replace">{t('common.click_to_replace')}</span>
              </>
            ) : (
              <>
                <Upload className="ba-drop-icon" />
                <span className="ba-drop-title">{t('common.click_to_choose')}</span>
                <span className="ba-drop-hint">{cfg.hint}</span>
              </>
            )}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={e => accept(e.target.files?.[0])}
          />
        </div>

        <div className="ba-footer">
          <button type="button" className="btn" onClick={onClose} disabled={uploading}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={upload} disabled={!file || uploading}>
            {uploading
              ? <><span className="spinner spinner-sm" /> Uploading…</>
              : <><Check style={{ width: 15, height: 15 }} /> Save {asset}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
