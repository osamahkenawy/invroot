import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Plus, EditPencil, Trash, Check, Coins, Search } from 'iconoir-react';
import api from '../lib/api';
import './TimeTracking.css';

const fmtAmt = (v, cur = 'SAR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(v || 0);

const STATUS_TABS = ['all', 'unbilled', 'billed', 'void'];
const emptyForm = { client_id: '', project: '', description: '', hours: '', hourly_rate: '', entry_date: '', status: 'unbilled' };

const statusBadge = (s) => {
  const map = { unbilled: ['tt-badge orange', 'Unbilled'], billed: ['tt-badge green', 'Billed'], void: ['tt-badge gray', 'Void'] };
  const [cls, lbl] = map[s] || ['tt-badge gray', s];
  return <span className={cls}>{lbl}</span>;
};

export default function TimeTracking() {
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
      setEntries(res.data.data || []);
      setTotal(res.data.total || 0);
      setSummary(sumRes.data.data || {});
      setClients(cRes.data.data || cRes.data || []);
    } finally { setLoading(false); }
  }, [page, search, activeTab]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditItem(null); setForm({ ...emptyForm, entry_date: new Date().toISOString().slice(0,10) }); setShowModal(true); };
  const openEdit   = (e) => { setEditItem(e); setForm({ ...e }); setShowModal(true); };

  const saveEntry = async () => {
    if (!form.hours) return;
    setSaving(true);
    try {
      if (editItem) await api.put(`/time-tracking/${editItem.id}`, form);
      else          await api.post('/time-tracking', form);
      setShowModal(false);
      load();
    } finally { setSaving(false); }
  };

  const deleteEntry = async (id) => {
    if (!window.confirm('Delete this entry?')) return;
    await api.delete(`/time-tracking/${id}`);
    load();
  };

  const markBilled = async (id) => {
    await api.post(`/time-tracking/${id}/mark-billed`, {});
    load();
  };

  return (
    <div className="tt-page">
      {/* Stats */}
      <div className="tt-stats">
        <div className="tt-stat-card">
          <div className="tt-stat-icon blue"><Clock /></div>
          <div><div className="tt-stat-label">Total Hours</div><div className="tt-stat-value">{(summary.total_hours || 0).toFixed(1)}h</div></div>
        </div>
        <div className="tt-stat-card">
          <div className="tt-stat-icon orange"><Clock /></div>
          <div><div className="tt-stat-label">Unbilled Hours</div><div className="tt-stat-value">{(summary.unbilled_hours || 0).toFixed(1)}h</div></div>
        </div>
        <div className="tt-stat-card">
          <div className="tt-stat-icon green"><Coins /></div>
          <div><div className="tt-stat-label">Unbilled Value</div><div className="tt-stat-value">{fmtAmt(summary.unbilled_value)}</div></div>
        </div>
        <div className="tt-stat-card">
          <div className="tt-stat-icon purple"><Check /></div>
          <div><div className="tt-stat-label">Total Entries</div><div className="tt-stat-value">{summary.total_entries || 0}</div></div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="tt-toolbar">
        <div className="tt-tabs">
          {STATUS_TABS.map(tab => (
            <button key={tab} className={`tt-tab${activeTab === tab ? ' active' : ''}`} onClick={() => { setActiveTab(tab); setPage(1); }}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="tt-toolbar-right">
          <div className="tt-search-box">
            <Search width={15} height={15} />
            <input placeholder="Search project…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <button className="tt-add-btn" onClick={openCreate}><Plus /> Log Time</button>
        </div>
      </div>

      {/* Table */}
      <div className="tt-table-wrap">
        {loading ? (
          <div className="tt-loading"><div className="tt-spinner" /></div>
        ) : entries.length === 0 ? (
          <div className="tt-empty"><Clock width={48} height={48} /><p>No time entries found</p><button onClick={openCreate}>Log your first entry</button></div>
        ) : (
          <table className="tt-table">
            <thead>
              <tr><th>Date</th><th>Client</th><th>Project</th><th>Description</th><th>Hours</th><th>Rate</th><th>Amount</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  <td className="tt-date">{e.entry_date ? new Date(e.entry_date).toLocaleDateString() : '—'}</td>
                  <td className="tt-client">{e.client_name || '—'}</td>
                  <td><span className="tt-project">{e.project || '—'}</span></td>
                  <td className="tt-desc">{e.description || '—'}</td>
                  <td className="tt-hours">{parseFloat(e.hours || 0).toFixed(1)}h</td>
                  <td className="tt-rate">{e.hourly_rate ? fmtAmt(e.hourly_rate) + '/h' : '—'}</td>
                  <td className="tt-amount">{e.hourly_rate ? fmtAmt(e.hours * e.hourly_rate) : '—'}</td>
                  <td>{statusBadge(e.status)}</td>
                  <td>
                    <div className="tt-actions">
                      {e.status === 'unbilled' && (
                        <button className="tt-act-btn green" title="Mark Billed" onClick={() => markBilled(e.id)}><Check /></button>
                      )}
                      <button className="tt-act-btn" title="Edit" onClick={() => openEdit(e)}><EditPencil /></button>
                      <button className="tt-act-btn red" title="Delete" onClick={() => deleteEntry(e.id)}><Trash /></button>
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
                  <label>Client</label>
                  <select value={form.client_id || ''} onChange={e => setForm(f => ({...f, client_id: e.target.value}))}>
                    <option value="">— No client —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="tt-form-group">
                  <label>Project</label>
                  <input value={form.project || ''} onChange={e => setForm(f => ({...f, project: e.target.value}))} placeholder="Project name" />
                </div>
                <div className="tt-form-group span2">
                  <label>Description</label>
                  <input value={form.description || ''} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="What did you work on?" />
                </div>
                <div className="tt-form-group">
                  <label>Hours *</label>
                  <input type="number" min="0" step="0.25" value={form.hours || ''} onChange={e => setForm(f => ({...f, hours: e.target.value}))} placeholder="e.g. 2.5" />
                </div>
                <div className="tt-form-group">
                  <label>Hourly Rate</label>
                  <input type="number" min="0" step="0.01" value={form.hourly_rate || ''} onChange={e => setForm(f => ({...f, hourly_rate: e.target.value}))} placeholder="0.00" />
                </div>
                <div className="tt-form-group">
                  <label>Date</label>
                  <input type="date" value={form.entry_date || ''} onChange={e => setForm(f => ({...f, entry_date: e.target.value}))} />
                </div>
                <div className="tt-form-group">
                  <label>Status</label>
                  <select value={form.status || 'unbilled'} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                    <option value="unbilled">Unbilled</option>
                    <option value="billed">Billed</option>
                    <option value="void">Void</option>
                  </select>
                </div>
              </div>
              {form.hours && form.hourly_rate && (
                <div className="tt-total-preview">
                  Total: <strong>{fmtAmt(form.hours * form.hourly_rate)}</strong>
                </div>
              )}
            </div>
            <div className="tt-modal-footer">
              <button className="tt-btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
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
