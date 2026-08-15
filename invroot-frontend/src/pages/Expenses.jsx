import { useState, useEffect, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Coins, Plus, Search, EditPencil, Trash, Check,
  FilterList, MoreHoriz, Clock, WarningTriangle, ArrowUp
} from 'iconoir-react';
import api from '../lib/api';
import { useToastContext } from '../context/ToastContext.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import './Expenses.css';
import { CURRENCIES } from '../data/currencies.js';

const CATEGORIES = ['Rent','Utilities','Salaries','Marketing','Travel','Supplies','Software','Maintenance','Other'];
const STATUS_TABS = ['all','unpaid','paid','overdue','draft'];

/* Number(v), not v: MySQL returns SUM()/DECIMAL columns as STRINGS, and a
   string reaching a numeric formatter is the same class of bug that crashed
   this page with "toFixed is not a function". */
const fmtAmt = (v, cur = 'SAR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 })
    .format(Number(v) || 0);

// Module-level helper: hooks are unavailable, so the caller passes `t`.
const statusBadge = (s, t) => {
  const cls = { paid: 'badge-paid', unpaid: 'badge-unpaid', overdue: 'badge-overdue', draft: 'badge-draft' }[s] || 'badge-draft';
  return <span className={`exp-badge ${cls}`}>{t(`expenses.${s}`, { defaultValue: s })}</span>;
};

const emptyForm = { vendor_name: '', reference: '', category: '', amount: '', currency: 'SAR', expense_date: '', due_date: '', status: 'unpaid', payment_method: '', notes: '' };

export default function Expenses() {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const { tenant } = useContext(AuthContext);
  const [expenses, setExpenses]   = useState([]);
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
      if (search)                  params.set('search', search);
      if (activeTab !== 'all')     params.set('status', activeTab);
      const [res, sumRes] = await Promise.all([
        api.get(`/expenses?${params}`),
        api.get('/expenses/summary'),
      ]);
      /* The api client already returns the parsed body — the extra `.data`
         hop is an axios-ism that resolved to undefined, so this list rendered
         empty however many expenses existed. */
      setExpenses(res.data || []);
      setTotal(res.total || 0);
      setSummary(sumRes.data || {});
    } finally { setLoading(false); }
  }, [page, search, activeTab]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditItem(null); setForm({ ...emptyForm, currency: tenant?.currency || 'SAR' }); setShowModal(true); };
  const openEdit   = (e) => { setEditItem(e); setForm({ ...e }); setShowModal(true); };

  const saveExpense = async () => {
    if (!form.amount) return;
    setSaving(true);
    try {
      const res = editItem
        ? await api.put(`/expenses/${editItem.id}`, form)
        : await api.post('/expenses', form);
      if (res?.success === false) { showToast(res.message || t('common.save_failed'), 'error'); return; }
      showToast(t(editItem ? 'common.updated_success' : 'common.created_success'));
      setShowModal(false);
      load();
    } finally { setSaving(false); }
  };

  const deleteExpense = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    const res = await api.delete(`/expenses/${id}`);
    if (res?.success === false) return showToast(res.message || t('common.delete_failed'), 'error');
    showToast(t('common.deleted_success'));
    load();
  };

  const markPaid = async (id) => {
    const res = await api.post(`/expenses/${id}/mark-paid`, { payment_method: 'cash' });
    if (res?.success === false) return showToast(res.message || t('common.action_failed'), 'error');
    showToast(t('common.updated_success'));
    load();
  };

  return (
    <div className="expenses-page">
      {/* Stats */}
      <div className="exp-stats">
        <div className="exp-stat-card">
          <div className="exp-stat-icon purple"><Coins /></div>
          <div><div className="exp-stat-label">{t('expenses.total')}</div><div className="exp-stat-value">{fmtAmt(summary.total, tenant?.currency)}</div></div>
        </div>
        <div className="exp-stat-card">
          <div className="exp-stat-icon orange"><Clock /></div>
          <div><div className="exp-stat-label">{t('expenses.unpaid')}</div><div className="exp-stat-value">{fmtAmt(summary.unpaid, tenant?.currency)}</div></div>
        </div>
        <div className="exp-stat-card">
          <div className="exp-stat-icon green"><Check /></div>
          <div><div className="exp-stat-label">{t('expenses.paid')}</div><div className="exp-stat-value">{fmtAmt(summary.paid, tenant?.currency)}</div></div>
        </div>
        <div className="exp-stat-card">
          <div className="exp-stat-icon red"><WarningTriangle /></div>
          <div><div className="exp-stat-label">{t('expenses.overdue')}</div><div className="exp-stat-value">{fmtAmt(summary.overdue, tenant?.currency)}</div></div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="exp-toolbar">
        <div className="exp-tabs">
          {STATUS_TABS.map(tab => (
            <button key={tab} className={`exp-tab${activeTab === tab ? ' active' : ''}`} onClick={() => { setActiveTab(tab); setPage(1); }}>
              {t(`expenses.${tab}`, { defaultValue: tab })}
            </button>
          ))}
        </div>
        <div className="exp-toolbar-right">
          <div className="exp-search-box">
            <Search width={15} height={15} />
            <input placeholder={t('expenses.search_placeholder')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <button className="exp-add-btn" onClick={openCreate}><Plus /> {t('expenses.new')}</button>
        </div>
      </div>

      {/* Table */}
      <div className="exp-table-wrap">
        {loading ? (
          <div className="exp-loading"><div className="exp-spinner" /></div>
        ) : expenses.length === 0 ? (
          <div className="exp-empty"><Coins width={48} height={48} /><p>{t('expenses.none_found')}</p><button onClick={openCreate}>{t('expenses.add_first')}</button></div>
        ) : (
          <table className="exp-table">
            <thead>
              <tr>
                <th>{t('expenses.vendor')}</th><th>{t('expenses.category')}</th><th>{t('common.date')}</th><th>{t('expenses.due_date')}</th>
                <th>{t('common.amount')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(exp => (
                <tr key={exp.id}>
                  <td>
                    <div className="exp-vendor">{exp.vendor_name || '—'}</div>
                    {exp.reference && <div className="exp-ref">#{exp.reference}</div>}
                  </td>
                  <td><span className="exp-cat-pill">{exp.category || '—'}</span></td>
                  <td className="exp-date">{exp.expense_date ? new Date(exp.expense_date).toLocaleDateString() : '—'}</td>
                  <td className="exp-date">{exp.due_date ? new Date(exp.due_date).toLocaleDateString() : '—'}</td>
                  <td className="exp-amount">{fmtAmt(exp.amount, exp.currency)}</td>
                  <td>{statusBadge(exp.status, t)}</td>
                  <td>
                    <div className="exp-actions">
                      {exp.status !== 'paid' && (
                        <button className="exp-act-btn green" title={t('expenses.mark_paid')} onClick={() => markPaid(exp.id)}><Check /></button>
                      )}
                      <button className="exp-act-btn" title={t('common.edit')} onClick={() => openEdit(exp)}><EditPencil /></button>
                      <button className="exp-act-btn red" title={t('common.delete')} onClick={() => deleteExpense(exp.id)}><Trash /></button>
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
        <div className="exp-pager">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span>Page {page} of {Math.ceil(total / LIMIT)}</span>
          <button disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="exp-modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="exp-modal">
            <div className="exp-modal-header">
              <h2>{t(editItem ? 'expenses.edit' : 'expenses.new')}</h2>
              <button className="exp-modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="exp-modal-body">
              <div className="exp-form-grid">
                <div className="exp-form-group span2">
                  <label>{t('expenses.vendor_name')}</label>
                  <input value={form.vendor_name || ''} onChange={e => setForm(f => ({...f, vendor_name: e.target.value}))} placeholder={t('expenses.vendor_placeholder')} />
                </div>
                <div className="exp-form-group">
                  <label>Reference #</label>
                  <input value={form.reference || ''} onChange={e => setForm(f => ({...f, reference: e.target.value}))} placeholder={t('expenses.reference')} />
                </div>
                <div className="exp-form-group">
                  <label>{t('expenses.category')}</label>
                  <select value={form.category || ''} onChange={e => setForm(f => ({...f, category: e.target.value}))}>
                    <option value="">{t('expenses.select_category')}</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="exp-form-group">
                  <label>{t('common.amount')} *</label>
                  <input type="number" min="0" step="0.01" value={form.amount || ''} onChange={e => setForm(f => ({...f, amount: e.target.value}))} placeholder="0.00" />
                </div>
                <div className="exp-form-group">
                  <label>{t('common.currency')}</label>
                  <select value={form.currency || 'SAR'} onChange={e => setForm(f => ({...f, currency: e.target.value}))}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="exp-form-group">
                  <label>{t('expenses.expense_date')}</label>
                  <input type="date" value={form.expense_date || ''} onChange={e => setForm(f => ({...f, expense_date: e.target.value}))} />
                </div>
                <div className="exp-form-group">
                  <label>{t('expenses.due_date')}</label>
                  <input type="date" value={form.due_date || ''} onChange={e => setForm(f => ({...f, due_date: e.target.value}))} />
                </div>
                <div className="exp-form-group">
                  <label>{t('common.status')}</label>
                  <select value={form.status || 'unpaid'} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                    <option value="draft">{t('expenses.draft')}</option>
                    <option value="unpaid">{t('expenses.unpaid')}</option>
                    <option value="paid">{t('expenses.paid')}</option>
                    <option value="overdue">{t('expenses.overdue')}</option>
                  </select>
                </div>
                <div className="exp-form-group">
                  <label>{t('expenses.payment_method')}</label>
                  <select value={form.payment_method || ''} onChange={e => setForm(f => ({...f, payment_method: e.target.value}))}>
                    <option value="">—</option>
                    {['cash','bank_transfer','credit_card','cheque','online'].map(m => <option key={m} value={m}>{t(`expenses.m_${m}`, { defaultValue: m.replace('_',' ') })}</option>)}
                  </select>
                </div>
                <div className="exp-form-group span2">
                  <label>{t('common.notes')}</label>
                  <textarea rows={3} value={form.notes || ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder={t('expenses.notes_placeholder')} />
                </div>
              </div>
            </div>
            <div className="exp-modal-footer">
              <button className="exp-btn-cancel" onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
              <button className="exp-btn-save" onClick={saveExpense} disabled={saving || !form.amount}>
                {saving ? 'Saving…' : editItem ? 'Save Changes' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
