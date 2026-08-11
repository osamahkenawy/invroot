import { useMemo } from 'react';
import './PasswordStrength.css';

/**
 * Lightweight password-strength meter. Scores 0–4 from length + character
 * variety and renders 4 segment bars plus a label. Purely presentational —
 * the backend still enforces the 8-char minimum.
 */
export function scorePassword(pw = '') {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  // Cap to 4 (four bars). Very short passwords never exceed "weak".
  return Math.min(4, pw.length < 8 ? Math.min(score, 1) : score);
}

const LEVELS = {
  en: ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'],
  ar: ['ضعيفة جداً', 'ضعيفة', 'مقبولة', 'جيدة', 'قوية'],
};

export default function PasswordStrength({ password = '', isRTL = false }) {
  const score = useMemo(() => scorePassword(password), [password]);
  if (!password) return null;
  const label = (isRTL ? LEVELS.ar : LEVELS.en)[score];
  return (
    <div className="pw-strength" aria-live="polite">
      <div className="pw-strength-bars">
        {[0, 1, 2, 3].map(i => (
          <span key={i} className={`pw-bar ${i < score ? `filled s${score}` : ''}`} />
        ))}
      </div>
      <span className={`pw-strength-label s${score}`}>{label}</span>
    </div>
  );
}
