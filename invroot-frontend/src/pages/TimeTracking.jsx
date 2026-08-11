import { useState, useEffect, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Plus, EditPencil, Trash, Check, Coins, Search } from 'iconoir-react';
import api from '../lib/api';
import { useToastContext } from '../context/ToastContext.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import './TimeTracking.css';

/* Number(v), not v: MySQL returns SUM()/DECIMAL columns as STRINGS, and a
   string reaching a numeric formatter is the same class of bug that crashed
   this page with "toFixed is not a function". */
const fmtAmt = (v, cur = 'SAR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 })
    .format(Number(v) || 0);

const STATUS_TABS = ['all', 'unbilled', 'billed', 'void'];
const emptyForm = { client_id: '', project: '', description: '', hours: '', hourly_rate: '', entry_date: '', status: 'unbilled' };

// Module-level helper: hooks are unavailable, so the caller passes `t`.
const statusBadge = (s, t) => {
  const cls = { unbilled: 'tt-badge orange', billed: 'tt-badge green', void: 'tt-badge gray' }[s] || 'tt-badge gray';
  const key = s === 'void' ? 'invoices.status.void' : `time_tracking.${s}`;
  return <span className={cls}>{t(key, { defaultValue: s })}</span>;
};

export default function TimeTracking() {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const { tenant } = useContext(AuthContext);
  const [entries, setEntries]     = useState([]);
  const [clients, setClients]     = useState([]);
  const [summary, setSummary]     = useState({});
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem]   = useState(null);
  const [form, setForm]           = useState(emptyForm);
  const [saving, setSaving]       = useState(false);
  const [page, setPage]           = useState(1);
  const [total, setTotal]         = useState(0);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT });
      if (search)              params.set('search', search);
      if (activeTab !== 'all') params.set('status', activeTab);
      const [res, sumRes, cRes] = await Promise.all([
        api.get(`/time-tracking?${params}`),
        api.get('/time-tracking/summary'),
        api.get('/clients'),
      ]);
      /* Same axios-ism as Expenses: `res.data.data` is undefined here, so the
         entries list could never show anything. */
      setEntries(res.data || []);
      setTotal(res.total || 0);
      setSummary(sumRes.data || {});
      setClients(cRes.data || []);
    } finally { setLoading(false); }
  }, [page, search, activeTab]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditItem(null); setForm({ ...emptyForm, entry_date: new Date().toISOString().slice(0,10) }); setShowModal(true); };
  const openEdit   = (e) => { setEditItem(e); setForm({ ...e }); setShowModal(true); };

  const saveEntry = async () => {
    if (!form.hours) return;
    setSaving(true);
    try {
      const res = editItem
        ? await api.put(`/time-tracking/${editItem.id}`, form)
        : await api.post('/time-tracking', form);
      if (res?.success === false) { showToast(res.message || t('common.save_failed'), 'error'); return; }
      showToast(t(editItem ? 'common.updated_success' : 'common.created_success'));
      setShowModal(false);
      load();
    } finally { setSaving(false); }
  };

  const deleteEntry = async (id) => {
    if (!window.confirm('Delete this entry?')) return;
    const res = await api.delete(`/time-tracking/${id}`);
    if (res?.success === false) return showToast(res.message || t('common.delete_failed'), 'error');
    showToast(t('common.deleted_success'));
    load();
  };

  const markBilled = async (id) => {
    const res = await api.post(`/time-tracking/${id}/mark-billed`, {});
    if (res?.success === false) return showToast(res.message || t('common.action_failed'), 'error');
    showToast(t('common.updated_success'));
    load();
  };

  return (
    <div className="tt-page">
      {/* Stats */}
      <div className="tt-stats">
        <div className="tt-stat-card">
          <div className="tt-stat-icon blue"><Clock /></div>
          <div><div className="tt-stat-label">{t('time_tracking.total_hours')}</div><div className="tt-stat-value">{Number(summary.total_hours || 0).toFixed(1)}h</div></div>
        </div>
        <div className="tt-stat-card">
          <div className="tt-stat-icon orange"><Clock /></div>
          <div><div className="tt-stat-label">{t('time_tracking.unbilled_hours')}</div><div className="tt-stat-value">{Number(summary.unbilled_hours || 0).toFixed(1)}h</div></div>
        </div>
        <div className="tt-stat-card">
          <div className="tt-stat-icon green"><Coins /></div>
          <div><div className="tt-stat-label">{t('time_tracking.unbilled_value')}</div><div className="tt-stat-value">{fmtAmt(summary.unbilled_value, tenant?.currency)}</div></div>
        </div>
        <div className="tt-stat-card">
          <div className="tt-stat-icon purple"><Check /></div>
          <div><div className="tt-stat-label">{t('time_tracking.total_entries')}</div><div className="tt-stat-value">{summary.total_entries || 0}</div></div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="tt-toolbar">
        <div className="tt-tabs">
          {STATUS_TABS.map(tab => (
            <button key={tab} className={`tt-tab${activeTab === tab ? ' active' : ''}`} onClick={() => { setActiveTab(tab); setPage(1); }}>
              {t(`time_tracking.${tab}`, { defaultValue: tab })}
            </button>
          ))}
        </div>
        <div className="tt-toolbar-right">
          <div className="tt-search-box">
            <Search width={15} height={15} />
            <input placeholder={t('time_tracking.ph_search')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <button className="tt-add-btn" onClick={openCreate}><Plus /> {t('time_tracking.log_time')}</button>
        </div>
      </div>

      {/* Table */}
      <div className="tt-table-wrap">
        {loading ? (
          <div className="tt-loading"><div className="tt-spinner" /></div>
        ) : entries.length === 0 ? (
          <div className="tt-empty"><Clock width={48} height={48} /><p>{t('time_tracking.none_found')}</p><button onClick={openCreate}>{t('time_tracking.log_first')}</button></div>
        ) : (
          <table className="tt-table">
            <thead>
              <tr><th>{t('common.date')}</th><th>{t('invoices.client')}</th><th>{t('time_tracking.project')}</th><th>{t('banking.description')}</th><th>{t('time_tracking.hours')}</th><th>{t('time_tracking.rate')}</th><th>{t('common.amount')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td className="tt-date">{e.entry_date ? new Date(e.entry_date).toLocaleDateString() : '—'}</td>
                  <td className="tt-client">{e.client_name || '—'}</td>
                  <td><span className="tt-project">{e.project || '—'}</span></td>
                  <td className="tt-desc">{e.description || '—'}</td>
                  <td className="tt-hours">{parseFloat(e.hours || 0).toFixed(1)}h</td>
                  <td className="tt-rate">{e.hourly_rate ? fmtAmt(e.hourly_rate, tenant?.currency) + '/h' : '—'}</td>
                  <td className="tt-amount">{e.hourly_rate ? fmtAmt(e.hours * e.hourly_rate, tenant?.currency) : '—'}</td>
                  <td>{statusBadge(e.status, t)}</td>
                  <td>
                    <div className="tt-actions">
                      {e.status === 'unbilled' && (
                        <button className="tt-act-btn green" title={t('time_tracking.mark_billed')} onClick={() => markBilled(e.id)}><Check /></button>
                      )}
                      <button className="tt-act-btn" title={t('common.edit')} onClick={() => openEdit(e)}><EditPencil /></button>
                      <button className="tt-act-btn red" title={t('common.delete')} onClick={() => deleteEntry(e.id)}><Trash /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="tt-pager">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span>Page {page} of {Math.ceil(total / LIMIT)}</span>
          <button disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="tt-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="tt-modal">
            <div className="tt-modal-header">
              <h2>{editItem ? 'Edit Time Entry' : 'Log Time'}</h2>
              <button onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="tt-modal-body">
              <div className="tt-form-grid">
                <div className="tt-form-group">
                  <label>{t('invoices.client')}</label>
                  <select value={form.client_id || ''} onChange={e => setForm(f => ({...f, client_id: e.target.value}))}>
                    <option value="">— No client —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="tt-form-group">
                  <label>{t('time_tracking.project')}</label>
                  <input value={form.project || ''} onChange={e => setForm(f => ({...f, project: e.target.value}))} placeholder={t('time_tracking.ph_project')} />
                </div>
                <div className="tt-form-group span2">
                  <label>{t('banking.description')}</label>
                  <input value={form.description || ''} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder={t('time_tracking.ph_desc')} />
                </div>
                <div className="tt-form-group">
                  <label>{t('time_tracking.hours')} *</label>
                  <input type="number" min="0" step="0.25" value={form.hours || ''} onChange={e => setForm(f => ({...f, hours: e.target.value}))} placeholder={t('time_tracking.ph_hours')} />
                </div>
                <div className="tt-form-group">
                  <label>{t('time_tracking.hourly_rate')}</label>
                  <input type="number" min="0" step="0.01" value={form.hourly_rate || ''} onChange={e => setForm(f => ({...f, hourly_rate: e.target.value}))} placeholder="0.00" />
                </div>
                <div className="tt-form-group">
                  <label>{t('common.date')}</label>
                  <input type="date" value={form.entry_date || ''} onChange={e => setForm(f => ({...f, entry_date: e.target.value}))} />
                </div>
                <div className="tt-form-group">
                  <label>{t('common.status')}</label>
                  <select value={form.status || 'unbilled'} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                    <option value="unbilled">{t('time_tracking.unbilled')}</option>
                    <option value="billed">{t('time_tracking.billed')}</option>
                    <option value="void">{t('invoices.status.void')}</option>
                  </select>
                </div>
              </div>
              {form.hours && form.hourly_rate && (
                <div className="tt-total-preview">
                  Total: <strong>{fmtAmt(form.hours * form.hourly_rate, tenant?.currency)}</strong>
                </div>
              )}
            </div>
            <div className="tt-modal-footer">
              <button className="tt-btn-cancel" onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
              <button className="tt-btn-save" onClick={saveEntry} disabled={saving || !form.hours}>
                {saving ? 'Saving…' : editItem ? 'Save Changes' : 'Log Time'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
