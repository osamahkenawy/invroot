/**
 * Client avatar — the uploaded picture when there is one, coloured initials
 * otherwise. The initials fallback is deliberately deterministic (same name →
 * same colour) so a client keeps a stable identity across the list, the cards
 * and the drawer.
 *
 * Also handles the picture failing to load. That is a real case, not a
 * theoretical one: on the S3 driver `avatar_url` is a signed URL with a short
 * expiry, so a list left open on screen will eventually hold dead links. When
 * the image 404s we fall back to the initials rather than showing a broken
 * image icon.
 */

const AVATAR_COLORS = [
  ['#0D1B2A', '#fff'], ['#7c3aed', '#fff'], ['#059669', '#fff'],
  ['#d97706', '#fff'], ['#dc2626', '#fff'], ['#0891b2', '#fff'],
  ['#db2777', '#fff'], ['#65a30d', '#fff'],
];

export function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

import { useState, useEffect } from 'react';

export default function ClientAvatar({ name, url, size = 36, radius = 10, fontSize, className, style }) {
  const [failed, setFailed] = useState(false);
  // A new URL deserves a fresh attempt — otherwise re-uploading a picture after
  // one failure would never render.
  useEffect(() => { setFailed(false); }, [url]);

  const [bg, fg] = avatarColor(name);
  const base = {
    width: size, height: size, borderRadius: radius,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden',
    ...style,
  };

  if (url && !failed) {
    return (
      <div className={className} style={{ ...base, background: 'var(--surface-2, #f1f5f9)' }}>
        <img
          src={url}
          alt={name || ''}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        ...base,
        background: bg, color: fg,
        fontSize: fontSize ?? Math.round(size * 0.36),
        fontWeight: 700,
      }}
    >
      {initials(name)}
    </div>
  );
}
