import { useState } from 'react';
import saApi from '../../lib/saApi.js';

const CURRENCIES = ['AED','SAR','USD','EUR','GBP','EGP','KWD','QAR','BHD','OMR','JOD'];
const PLANS      = ['starter','professional','enterprise'];

/**
 * Provision a new tenant company plus its owner account. The owner is emailed a
 * temporary password and must change it on first sign-in.
 */
export default function CreateTenantModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    company_name: '', owner_name: '', email: '', phone: '',
    plan: 'starter', currency: 'AED', lang: 'en', status: 'trialing',
    password: '', send_email: true,
  });
  const [autoPassword, setAutoPassword] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [result, setResult] = useState(null);   // success payload
  const [copied, setCopied] = useState(false);

  const set = (k) => (e) => setForm(f => ({
    ...f,
    [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.company_name.trim() || !form.email.trim()) {
      setError('Company name and email are required.');
      return;
    }
    if (!autoPassword && form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSaving(true);
    const payload = { ...form };
    if (autoPassword) delete payload.password;   // let the server generate one
    const res = await saApi.post('/tenants', payload);
    setSaving(false);

    if (res.success) { setResult(res.data); onCreated?.(); }
    else setError(res.message || 'Could not create the tenant.');
  };

  const copyCreds = async () => {
    const text = `Invroot sign-in\nEmail: ${result.email}\nTemporary password: ${result.temp_password}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard blocked — the values are on screen anyway */ }
  };

  /* ── Success state ── */
  if (result) {
    return (
      <div className="sa-modal-backdrop" onClick={onClose}>
        <div className="sa-modal" onClick={e => e.stopPropagation()}>
          <div className="sa-modal-header">
            <h3>Tenant created</h3>
            <button className="sa-modal-x" onClick={onClose}>×</button>
          </div>

          <div className="sa-modal-body">
            <div className={`sa-alert ${result.emailed ? 'ok' : 'warn'}`}>
              {result.emailed
                ? <>✅ Credentials emailed to <strong>{result.email}</strong>.</>
                : <>⚠️ The account was created, but the email could not be sent
                    {result.email_error ? ` (${result.email_error})` : ''}. Share the
                    credentials below manually.</>}
            </div>

            <div className="sa-cred-box">
              <div className="sa-cred-row">
                <span className="sa-cred-k">Email</span>
                <span className="sa-cred-v">{result.email}</span>
              </div>
              <div className="sa-cred-row">
                <span className="sa-cred-k">Temporary password</span>
                <span className="sa-cred-v mono">{result.temp_password}</span>
              </div>
            </div>

            <p className="sa-modal-note">
              This password is shown once and is not recoverable afterwards. The owner
              must choose their own password the first time they sign in.
            </p>
          </div>

          <div className="sa-modal-footer">
            <button className="sa-btn sa-btn-ghost" onClick={copyCreds}>
              {copied ? 'Copied ✓' : 'Copy credentials'}
            </button>
            <button className="sa-btn sa-btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Form state ── */
  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <div className="sa-modal" onClick={e => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h3>New tenant</h3>
          <button className="sa-modal-x" onClick={onClose}>×</button>
        </div>

        <form onSubmit={submit}>
          <div className="sa-modal-body">
            {error && <div className="sa-alert err">{error}</div>}

            <div className="sa-field">
              <label>Company name *</label>
              <input value={form.company_name} onChange={set('company_name')} placeholder="Acme Trading LLC" autoFocus />
            </div>

            <div className="sa-field-row">
              <div className="sa-field">
                <label>Owner name</label>
                <input value={form.owner_name} onChange={set('owner_name')} placeholder="Full name" />
              </div>
              <div className="sa-field">
                <label>Owner email *</label>
                <input type="email" value={form.email} onChange={set('email')} placeholder="owner@company.com" />
              </div>
            </div>

            <div className="sa-field-row">
              <div className="sa-field">
                <label>Phone</label>
                <input value={form.phone} onChange={set('phone')} placeholder="+971 50 123 4567" />
              </div>
              <div className="sa-field">
                <label>Plan</label>
                <select value={form.plan} onChange={set('plan')}>
                  {PLANS.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
            </div>

            <div className="sa-field-row">
              <div className="sa-field">
                <label>Currency</label>
                <select value={form.currency} onChange={set('currency')}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="sa-field">
                <label>Language</label>
                <select value={form.lang} onChange={set('lang')}>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
              <div className="sa-field">
                <label>Status</label>
                <select value={form.status} onChange={set('status')}>
                  <option value="trialing">Trialing</option>
                  <option value="active">Active</option>
                </select>
              </div>
            </div>

            <div className="sa-divider-label">Temporary password</div>

            <label className="sa-check">
              <input type="checkbox" checked={autoPassword} onChange={e => setAutoPassword(e.target.checked)} />
              <span>Generate a secure password automatically (recommended)</span>
            </label>

            {!autoPassword && (
              <div className="sa-field">
                <label>Set password manually</label>
                <input type="text" value={form.password} onChange={set('password')}
                       placeholder="At least 8 characters" autoComplete="off" />
              </div>
            )}

            <label className="sa-check">
              <input type="checkbox" checked={form.send_email} onChange={set('send_email')} />
              <span>Email the credentials to the owner</span>
            </label>

            <p className="sa-modal-note">
              The owner signs in with this temporary password and is required to
              replace it before reaching the app.
            </p>
          </div>

          <div className="sa-modal-footer">
            <button type="button" className="sa-btn sa-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="sa-btn sa-btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
