/**
 * A person's avatar — the uploaded picture when there is one, initials
 * otherwise. Deliberately the same behaviour as ClientAvatar, including the
 * onError fallback: on the S3 driver `url` is a signed URL with a short expiry,
 * so a page left open long enough will hold a dead link, and a broken-image
 * icon where someone's face should be looks like a bug.
 */

import { useState, useEffect } from 'react';

/* Initials read better from the name; fall back to the email local part so a
   user who hasn't set a name doesn't get "?" forever. */
export function userInitials(user) {
  const source = (user?.full_name || '').trim() || (user?.email || '').split('@')[0] || '';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export default function UserAvatar({ user, url, size = 40, className = '', style }) {
  const src = url ?? user?.avatar_url ?? null;
  const [failed, setFailed] = useState(false);
  // A new URL deserves a fresh attempt, or re-uploading after one failure
  // would never render.
  useEffect(() => { setFailed(false); }, [src]);

  const base = {
    width: size, height: size, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden', ...style,
  };

  if (src && !failed) {
    return (
      <div className={`user-avatar ${className}`} style={base}>
        <img
          src={src}
          alt={user?.full_name || ''}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    );
  }

  return (
    <div
      className={`user-avatar user-avatar--initials ${className}`}
      style={{ ...base, fontSize: Math.round(size * 0.38), fontWeight: 700 }}
    >
      {userInitials(user)}
    </div>
  );
}
