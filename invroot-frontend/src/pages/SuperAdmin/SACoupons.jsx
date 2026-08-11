import { useState, useEffect, useCallback } from 'react';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';
import './SACoupons.css';

/**
 * Promotion codes.
 *
 * The API for these was complete — create, list, redemptions, activate,
 * archive, all mirrored into Stripe — but nothing ever called it. With no way
 * to create a code, the discount box on the billing page rejected every string
 * a customer typed, which reads as a broken feature rather than an empty one.
 *
 * Stripe owns the discount itself; this page writes to our table and Stripe in
 * one step, so a code can never exist in one and not the other.
 */

/* Stripe expresses duration as once / repeating(n months) / forever. Presented
   here as the question an operator actually asks — "how long does this run?" —
   with the common answers as one-click choices instead of a raw month count. */
const DURATIONS = [
  { key: 'once',      label: 'First month only',  hint: 'Discount applies to one payment' },
  { key: 'months',    label: 'For a set period',  hint: 'Repeats each month, then stops' },
  { key: 'forever',   label: 'Forever',           hint: 'Every payment, for as long as they subscribe' },
];

const MONTH_PRESETS = [3, 6, 12];

const emptyForm = {
  code: '',
  discount_type: 'percent',
  percent_off: '',
  amount_off: '',
  currency: 'AED',
  durationMode: 'once',
  duration_in_months: 12,
  max_redemptions: '',
  expires_at: '',
  note: '',
};

export default function SACoupons() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form,    setForm]    = useState(emptyForm);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [notice,  setNotice]  = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const load = useCallback(() => {
    setLoading(true);
    saApi.get('/coupons').then(r => {
      if (r.success) setRows(r.data || []);
      setLoading(false);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    const code = form.code.trim().toUpperCase();
    if (code.length < 3) return setError('Give the code at least 3 characters.');
    if (!/^[A-Z0-9_-]+$/.test(code)) return setError('Use letters, numbers, hyphens and underscores only.');

    if (form.discount_type === 'percent') {
      const pct = Number(form.percent_off);
      if (!(pct > 0 && pct <= 100)) return setError('Percentage must be between 1 and 100.');
    } else if (!(Number(form.amount_off) > 0)) {
      return setError('Amount must be greater than zero.');
    }

    /* The UI's three-way choice maps onto Stripe's two fields. `months` is the
       only mode that carries a count; sending one with `once` or `forever`
       would be silently ignored by Stripe and misleading in our own table. */
    const duration = form.durationMode === 'months' ? 'repeating' : form.durationMode;
    if (duration === 'repeating' && !(Number(form.duration_in_months) > 0)) {
      return setError('Choose how many months the discount runs for.');
    }

    setSaving(true);
    const res = await saApi.post('/coupons', {
      code,
      discount_type: form.discount_type,
      percent_off: form.discount_type === 'percent' ? Number(form.percent_off) : undefined,
      amount_off:  form.discount_type === 'amount'  ? Number(form.amount_off)  : undefined,
      currency: form.currency,
      duration,
      duration_in_months: duration === 'repeating' ? Number(form.duration_in_months) : undefined,
      max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : undefined,
      expires_at: form.expires_at || undefined,
      note: form.note || undefined,
    });
    setSaving(false);

    if (!res.success) return setError(res.message || 'Could not create the code.');
    setNotice(`${code} created.`);
    setForm(emptyForm);
    setShowNew(false);
    load();
  };

  const toggle = async (row) => {
    await saApi.patch(`/coupons/${row.id}`, { active: row.active ? 0 : 1 });
    load();
  };

  const archive = async (row) => {
    if (!window.confirm(`Archive ${row.code}? Existing subscriptions keep their discount.`)) return;
    await saApi.delete(`/coupons/${row.id}`);
    load();
  };

  /* What the customer actually gets, in one phrase. The row carries the pieces
     separately, and reading four columns to work it out is exactly the sort of
     thing that leads to issuing the wrong code. */
  const describe = (c) => {
    const off = c.discount_type === 'percent'
      ? `${Number(c.percent_off)}% off`
      : `${Number(c.amount_off).toFixed(2)} ${c.currency} off`;
    const when = c.duration === 'forever' ? 'forever'
      : c.duration === 'repeating' ? `for ${c.duration_in_months} months`
      : 'first payment';
    return `${off} · ${when}`;
  };

  const usage = (c) =>
    c.max_redemptions ? `${c.times_redeemed} / ${c.max_redemptions}` : `${c.times_redeemed}`;

  const expired = (c) => c.expires_at && new Date(c.expires_at) < new Date();

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">Promotion Codes</h1>
          <p className="sa-page-sub">
            {rows.length} code{rows.length === 1 ? '' : 's'} · customers enter these at checkout
          </p>
        </div>
        <button className="sa-btn-primary" onClick={() => { setShowNew(v => !v); setError(''); }}>
          {showNew ? 'Cancel' : '+ New code'}
        </button>
      </div>

      {notice && <div className="sa-alert sa-alert-ok" onAnimationEnd={() => setNotice('')}>{notice}</div>}

      {showNew && (
        <div className="sa-card cp-form-card">
          <form onSubmit={submit}>
            {error && <div className="sa-alert sa-alert-err">{error}</div>}

            <div className="cp-row">
              <label className="cp-field cp-grow">
                <span>Code</span>
                <input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="LAUNCH50"
                  autoFocus
                />
                <small>What the customer types. Letters, numbers, - and _</small>
              </label>

              <label className="cp-field">
                <span>Discount</span>
                <select value={form.discount_type} onChange={set('discount_type')}>
                  <option value="percent">Percentage</option>
                  <option value="amount">Fixed amount</option>
                </select>
              </label>

              {form.discount_type === 'percent' ? (
                <label className="cp-field">
                  <span>Percent off</span>
                  <div className="cp-suffix">
                    <input type="number" min="1" max="100" step="1"
                           value={form.percent_off} onChange={set('percent_off')} placeholder="50" />
                    <em>%</em>
                  </div>
                  <small>1 – 100</small>
                </label>
              ) : (
                <label className="cp-field">
                  <span>Amount off</span>
                  <div className="cp-suffix">
                    <input type="number" min="0" step="0.01"
                           value={form.amount_off} onChange={set('amount_off')} placeholder="20.00" />
                    <em>{form.currency}</em>
                  </div>
                </label>
              )}
            </div>

            <div className="cp-block">
              <span className="cp-block-label">How long does it run?</span>
              <div className="cp-choices">
                {DURATIONS.map(d => (
                  <button
                    type="button"
                    key={d.key}
                    className={`cp-choice${form.durationMode === d.key ? ' on' : ''}`}
                    onClick={() => setForm(f => ({ ...f, durationMode: d.key }))}
                  >
                    <strong>{d.label}</strong>
                    <small>{d.hint}</small>
                  </button>
                ))}
              </div>

              {form.durationMode === 'months' && (
                <div className="cp-months">
                  {MONTH_PRESETS.map(m => (
                    <button
                      type="button"
                      key={m}
                      className={`cp-pill${Number(form.duration_in_months) === m ? ' on' : ''}`}
                      onClick={() => setForm(f => ({ ...f, duration_in_months: m }))}
                    >
                      {m === 12 ? '12 months (1 year)' : `${m} months`}
                    </button>
                  ))}
                  <input
                    type="number" min="1" max="36"
                    className="cp-months-input"
                    value={form.duration_in_months}
                    onChange={set('duration_in_months')}
                  />
                </div>
              )}
            </div>

            <div className="cp-row">
              <label className="cp-field">
                <span>Max redemptions</span>
                <input type="number" min="1" value={form.max_redemptions}
                       onChange={set('max_redemptions')} placeholder="Unlimited" />
                <small>Total uses across all customers</small>
              </label>
              <label className="cp-field">
                <span>Expires</span>
                <input type="date" value={form.expires_at} onChange={set('expires_at')} />
                <small>Optional — code stops working after this</small>
              </label>
              <label className="cp-field cp-grow">
                <span>Note</span>
                <input value={form.note} onChange={set('note')} placeholder="Ramadan campaign" />
                <small>Internal only — never shown to customers</small>
              </label>
            </div>

            <div className="cp-actions">
              <button type="submit" className="sa-btn-primary" disabled={saving}>
                {saving ? 'Creating…' : 'Create code'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="sa-card">
        {loading ? (
          <div className="cp-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="cp-empty">
            <strong>No promotion codes yet</strong>
            <p>Until one exists, every code a customer enters at checkout is rejected.</p>
          </div>
        ) : (
          <table className="sa-table cp-table">
            <thead>
              <tr>
                <th>Code</th><th>Discount</th><th>Used</th>
                <th>Expires</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td>
                    <span className="cp-code">{c.code}</span>
                    {c.note && <div className="cp-note">{c.note}</div>}
                  </td>
                  <td>{describe(c)}</td>
                  <td>{usage(c)}</td>
                  <td>{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}</td>
                  <td>
                    {c.archived_at ? <span className="cp-tag off">Archived</span>
                      : expired(c) ? <span className="cp-tag off">Expired</span>
                      : c.active ? <span className="cp-tag on">Active</span>
                      : <span className="cp-tag off">Paused</span>}
                  </td>
                  <td className="cp-row-actions">
                    {!c.archived_at && (
                      <>
                        <button className="cp-link" onClick={() => toggle(c)}>
                          {c.active ? 'Pause' : 'Resume'}
                        </button>
                        <button className="cp-link danger" onClick={() => archive(c)}>Archive</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
