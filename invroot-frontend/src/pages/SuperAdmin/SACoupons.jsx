import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';
import './SACoupons.css';

/**
 * Promotion codes.
 *
 * The API for these was complete — create, list, redemptions, pause, archive,
 * all mirrored into Stripe — but nothing ever called it. With no way to create
 * a code, the discount box at checkout rejected every string a customer typed,
 * which reads as a broken feature rather than an empty one.
 *
 * The list answers the question an operator actually has, which is never "what
 * codes exist" but "is this campaign working, and who took it up". So each row
 * carries its own take-up and expands in place to name the companies, rather
 * than making anyone open a code to find out whether it did anything.
 */

/* Stripe expresses duration as once / repeating(n months) / forever. Presented
   here as the question an operator asks — "how long does it run?" — with the
   common answers as one-click choices instead of a raw month count. */
const DURATIONS = [
  { key: 'once',    label: 'First payment only', hint: 'Applies to one payment' },
  { key: 'months',  label: 'For a set period',   hint: 'Repeats monthly, then stops' },
  { key: 'forever', label: 'Forever',            hint: 'Every payment while subscribed' },
];

const MONTH_PRESETS = [3, 6, 12];

const emptyForm = {
  code: '', discount_type: 'percent', percent_off: '', amount_off: '',
  currency: 'AED', durationMode: 'once', duration_in_months: 12,
  max_redemptions: '', expires_at: '', note: '',
};

const money = (v, cur = 'AED') =>
  `${cur} ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shortDate = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** "3 days ago" reads faster than a date when the question is "is this live?". */
function ago(d) {
  if (!d) return null;
  const days = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

export default function SACoupons() {
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showNew,  setShowNew]  = useState(false);
  const [form,     setForm]     = useState(emptyForm);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [notice,   setNotice]   = useState('');
  const [search,   setSearch]   = useState('');
  const [openId,   setOpenId]   = useState(null);
  const [redeems,  setRedeems]  = useState({});   // couponId -> rows | 'loading'
  const [copied,   setCopied]   = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const load = useCallback(() => {
    setLoading(true);
    saApi.get('/coupons').then(r => {
      if (r.success) setRows(r.data || []);
      setLoading(false);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  /* Fetched on expand, not up front: most codes are never opened, and the
     redemption list is the only part of this page that grows without bound. */
  const openRedemptions = async (id) => {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    if (redeems[id]) return;
    setRedeems(m => ({ ...m, [id]: 'loading' }));
    const r = await saApi.get(`/coupons/${id}/redemptions`);
    setRedeems(m => ({ ...m, [id]: r.success ? (r.data || []) : [] }));
  };

  const copy = async (code) => {
    try { await navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(''), 1600); }
    catch { /* clipboard blocked — the code is on screen to read anyway */ }
  };

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
       only mode carrying a count; sending one with `once` or `forever` would be
       ignored by Stripe and misleading in our own table. */
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
    setNotice(`${code} created and live at checkout.`);
    setForm(emptyForm);
    setShowNew(false);
    load();
  };

  const toggle = async (row) => { await saApi.patch(`/coupons/${row.id}`, { active: row.active ? 0 : 1 }); load(); };

  const archive = async (row) => {
    if (!window.confirm(`Archive ${row.code}?\n\nIt stops working for new checkouts. Anyone already on the discount keeps it — Stripe honours existing subscriptions.`)) return;
    await saApi.delete(`/coupons/${row.id}`);
    load();
  };

  const describe = (c) => {
    const off = c.discount_type === 'percent'
      ? `${Number(c.percent_off)}% off`
      : `${money(c.amount_off, c.currency)} off`;
    const when = c.duration === 'forever' ? 'forever'
      : c.duration === 'repeating' ? `for ${c.duration_in_months} months`
      : 'first payment';
    return { off, when };
  };

  const expired = (c) => c.expires_at && new Date(c.expires_at) < new Date();
  const exhausted = (c) => c.max_redemptions && c.redemptions >= c.max_redemptions;

  const statusOf = (c) =>
    c.archived_at ? { label: 'Archived', tone: 'off' }
    : expired(c)  ? { label: 'Expired',  tone: 'off' }
    : exhausted(c) ? { label: 'Used up', tone: 'warn' }
    : c.active    ? { label: 'Live',     tone: 'on'  }
    : { label: 'Paused', tone: 'warn' };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(c => `${c.code} ${c.note || ''}`.toLowerCase().includes(q));
  }, [rows, search]);

  /* Campaign totals. Aggregated server-side so every row on screen comes from
     one snapshot rather than a request per code. */
  const stats = useMemo(() => rows.reduce((a, c) => ({
    live:        a.live + (statusOf(c).label === 'Live' ? 1 : 0),
    redemptions: a.redemptions + Number(c.redemptions || 0),
    discounted:  a.discounted + Number(c.total_discount || 0),
  }), { live: 0, redemptions: 0, discounted: 0 }), [rows]);

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">Promotion Codes</h1>
          <p className="sa-page-sub">Discounts customers enter at checkout</p>
        </div>
        <button className="sa-btn-primary" onClick={() => { setShowNew(v => !v); setError(''); }}>
          {showNew ? 'Cancel' : '+ New code'}
        </button>
      </div>

      {notice && <div className="sa-alert sa-alert-ok">{notice}</div>}

      {/* What the codes are doing, before what they are. */}
      <div className="cp-stats">
        <div className="cp-stat"><span>{rows.length}</span><small>Total codes</small></div>
        <div className="cp-stat"><span>{stats.live}</span><small>Live now</small></div>
        <div className="cp-stat"><span>{stats.redemptions}</span><small>Times redeemed</small></div>
        <div className="cp-stat cp-stat-money">
          <span>{money(stats.discounted)}</span><small>Discount given</small>
        </div>
      </div>

      {showNew && (
        <div className="sa-card cp-form-card">
          <form onSubmit={submit}>
            {error && <div className="sa-alert sa-alert-err">{error}</div>}

            <div className="cp-row">
              <label className="cp-field cp-grow">
                <span>Code</span>
                <input value={form.code}
                       onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                       placeholder="LAUNCH50" autoFocus />
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
                  <button type="button" key={d.key}
                    className={`cp-choice${form.durationMode === d.key ? ' on' : ''}`}
                    onClick={() => setForm(f => ({ ...f, durationMode: d.key }))}>
                    <strong>{d.label}</strong><small>{d.hint}</small>
                  </button>
                ))}
              </div>

              {form.durationMode === 'months' && (
                <div className="cp-months">
                  {MONTH_PRESETS.map(m => (
                    <button type="button" key={m}
                      className={`cp-pill${Number(form.duration_in_months) === m ? ' on' : ''}`}
                      onClick={() => setForm(f => ({ ...f, duration_in_months: m }))}>
                      {m === 12 ? '12 months (1 year)' : `${m} months`}
                    </button>
                  ))}
                  <input type="number" min="1" max="36" className="cp-months-input"
                         value={form.duration_in_months} onChange={set('duration_in_months')} />
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
                <small>Optional — stops working after this</small>
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
        {rows.length > 0 && (
          <div className="cp-toolbar">
            <input className="cp-search" value={search} onChange={e => setSearch(e.target.value)}
                   placeholder="Search code or note…" />
          </div>
        )}

        {loading ? (
          <div className="cp-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="cp-empty">
            <strong>No promotion codes yet</strong>
            <p>Until one exists, every code a customer enters at checkout is rejected.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="cp-empty"><p>Nothing matches that search.</p></div>
        ) : (
          <table className="sa-table cp-table">
            <thead>
              <tr>
                <th>Code</th><th>Discount</th><th>Take-up</th>
                <th>Discount given</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {visible.map(c => {
                const d = describe(c);
                const st = statusOf(c);
                const isOpen = openId === c.id;
                const list = redeems[c.id];
                return (
                  <Fragment key={c.id}>
                    <tr className={isOpen ? 'cp-tr-open' : ''}>
                      <td>
                        <button className="cp-code" onClick={() => copy(c.code)}
                                title="Click to copy">
                          {c.code}
                          <span className="cp-copy">{copied === c.code ? 'copied' : 'copy'}</span>
                        </button>
                        {c.note && <div className="cp-note">{c.note}</div>}
                      </td>
                      <td>
                        <div className="cp-off">{d.off}</div>
                        <div className="cp-when">{d.when}</div>
                      </td>
                      <td>
                        <button className="cp-takeup" onClick={() => openRedemptions(c.id)}
                                disabled={!Number(c.redemptions)}>
                          <strong>{c.redemptions}</strong>
                          {c.max_redemptions ? <span className="cp-cap"> / {c.max_redemptions}</span> : null}
                          {Number(c.redemptions) > 0 && <span className="cp-chev">{isOpen ? '▾' : '▸'}</span>}
                        </button>
                        {c.last_redeemed_at && <div className="cp-when">last {ago(c.last_redeemed_at)}</div>}
                      </td>
                      <td>
                        {Number(c.total_discount) > 0
                          ? money(c.total_discount, c.redeemed_currency || 'AED')
                          : <span className="cp-muted">—</span>}
                      </td>
                      <td><span className={`cp-tag ${st.tone}`}>{st.label}</span></td>
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

                    {isOpen && (
                      <tr className="cp-detail-row">
                        <td colSpan={6}>
                          {list === 'loading' ? (
                            <div className="cp-detail-empty">Loading redemptions…</div>
                          ) : !list || list.length === 0 ? (
                            <div className="cp-detail-empty">Nobody has used this code yet.</div>
                          ) : (
                            <div className="cp-detail">
                              <div className="cp-detail-head">Used by {list.length} {list.length === 1 ? 'company' : 'companies'}</div>
                              <table className="cp-detail-table">
                                <thead>
                                  <tr><th>Company</th><th>Plan</th><th>Discount</th><th>When</th></tr>
                                </thead>
                                <tbody>
                                  {list.map(r => (
                                    <tr key={r.id}>
                                      <td>
                                        {r.tenant_id
                                          ? <Link className="cp-tenant" to={`/admin/tenants/${r.tenant_id}`}>
                                              {r.company_name || `Tenant #${r.tenant_id}`}
                                            </Link>
                                          : (r.company_name || '—')}
                                      </td>
                                      <td className="cp-plan">{r.plan || '—'}</td>
                                      <td>{r.discount_amount != null ? money(r.discount_amount, r.currency) : '—'}</td>
                                      <td>
                                        {shortDate(r.redeemed_at)}
                                        <span className="cp-when"> · {ago(r.redeemed_at)}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
