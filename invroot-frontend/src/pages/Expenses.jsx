import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Coins, Plus, Search, EditPencil, Trash, Check,
  FilterList, MoreHoriz, Clock, WarningTriangle, ArrowUp
} from 'iconoir-react';
import api from '../lib/api';
import './Expenses.css';

const CATEGORIES = ['Rent','Utilities','Salaries','Marketing','Travel','Supplies','Software','Maintenance','Other'];
const STATUS_TABS = ['all','unpaid','paid','overdue','draft'];

const fmtAmt = (v, cur = 'SAR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(v || 0);

const statusBadge = (s) => {
  const map = { paid: ['badge-paid','Paid'], unpaid: ['badge-unpaid','Unpaid'], overdue: ['badge-overdue','Overdue'], draft: ['badge-draft','Draft'] };
  const [cls, label] = map[s] || ['badge-draft', s];
  return <span className={`exp-badge ${cls}`}>{label}</span>;
};

const emptyForm = { vendor_name: '', reference: '', category: '', amount: '', currency: 'SAR', expense_date: '', due_date: '', status: 'unpaid', payment_method: '', notes: '' };

export default function Expenses() {
  const { t } = useTranslation();
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
      setExpenses(res.data.data || []);
      setTotal(res.data.total || 0);
      setSummary(sumRes.data.data || {});
    } finally { setLoading(false); }
  }, [page, search, activeTab]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditItem(null); setForm(emptyForm); setShowModal(true); };
  const openEdit   = (e) => { setEditItem(e); setForm({ ...e }); setShowModal(true); };

  const saveExpense = async () => {
    if (!form.amount) return;
    setSaving(true);
    try {
      if (editItem) await api.put(`/expenses/${editItem.id}`, form);
      else          await api.post('/expenses', form);
      setShowModal(false);
      load();
    } finally { setSaving(false); }
  };

  const deleteExpense = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    await api.delete(`/expenses/${id}`);
    load();
  };

  const markPaid = async (id) => {
    await api.post(`/expenses/${id}/mark-paid`, { payment_method: 'cash' });
    load();
  };

  return (
    <div className="expenses-page">
      {/* Stats */}
      <div className="exp-stats">
        <div className="exp-stat-card">
          <div className="exp-stat-icon purple"><Coins /></div>
          <div><div className="exp-stat-label">Total Expenses</div><div className="exp-stat-value">{fmtAmt(summary.total)}</div></div>
        </div>
        <div className="exp-stat-card">
          <div className="exp-stat-icon orange"><Clock /></div>
          <div><div className="exp-stat-label">Unpaid</div><div className="exp-stat-value">{fmtAmt(summary.unpaid)}</div></div>
        </div>
        <div className="exp-stat-card">
          <div className="exp-stat-icon green"><Check /></div>
          <div><div className="exp-stat-label">Paid</div><div className="exp-stat-value">{fmtAmt(summary.paid)}</div></div>
        </div>
        <div className="exp-stat-card">
          <div className="exp-stat-icon red"><WarningTriangle /></div>
          <div><div className="exp-stat-label">Overdue</div><div className="exp-stat-value">{fmtAmt(summary.overdue)}</div></div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="exp-toolbar">
        <div className="exp-tabs">
          {STATUS_TABS.map(tab => (
            <button key={tab} className={`exp-tab${activeTab === tab ? ' active' : ''}`} onClick={() => { setActiveTab(tab); setPage(1); }}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="exp-toolbar-right">
          <div className="exp-search-box">
            <Search width={15} height={15} />
            <input placeholder="Search vendor, ref…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <button className="exp-add-btn" onClick={openCreate}><Plus /> New Expense</button>
        </div>
      </div>

      {/* Table */}
      <div className="exp-table-wrap">
        {loading ? (
          <div className="exp-loading"><div className="exp-spinner" /></div>
        ) : expenses.length === 0 ? (
          <div className="exp-empty"><Coins width={48} height={48} /><p>No expenses found</p><button onClick={openCreate}>Add your first expense</button></div>
        ) : (
          <table className="exp-table">
            <thead>
              <tr>
                <th>Vendor</th><th>Category</th><th>Date</th><th>Due Date</th>
                <th>Amount</th><th>Status</th><th>Actions</th>
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
                  <td>{statusBadge(exp.status)}</td>
                  <td>
                    <div className="exp-actions">
                      {exp.status !== 'paid' && (
                        <button className="exp-act-btn green" title="Mark Paid" onClick={() => markPaid(exp.id)}><Check /></button>
                      )}
                      <button className="exp-act-btn" title="Edit" onClick={() => openEdit(exp)}><EditPencil /></button>
                      <button className="exp-act-btn red" title="Delete" onClick={() => deleteExpense(exp.id)}><Trash /></button>
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
              <h2>{editItem ? 'Edit Expense' : 'New Expense'}</h2>
              <button className="exp-modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="exp-modal-body">
              <div className="exp-form-grid">
                <div className="exp-form-group span2">
                  <label>Vendor Name</label>
                  <input value={form.vendor_name || ''} onChange={e => setForm(f => ({...f, vendor_name: e.target.value}))} placeholder="Vendor or supplier name" />
                </div>
                <div className="exp-form-group">
                  <label>Reference #</label>
                  <input value={form.reference || ''} onChange={e => setForm(f => ({...f, reference: e.target.value}))} placeholder="Invoice / bill ref" />
                </div>
                <div className="exp-form-group">
                  <label>Category</label>
                  <select value={form.category || ''} onChange={e => setForm(f => ({...f, category: e.target.value}))}>
                    <option value="">Select category</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="exp-form-group">
                  <label>Amount *</label>
                  <input type="number" min="0" step="0.01" value={form.amount || ''} onChange={e => setForm(f => ({...f, amount: e.target.value}))} placeholder="0.00" />
                </div>
                <div className="exp-form-group">
                  <label>Currency</label>
                  <select value={form.currency || 'SAR'} onChange={e => setForm(f => ({...f, currency: e.target.value}))}>
                    {['SAR','USD','EUR','GBP','AED'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="exp-form-group">
                  <label>Expense Date</label>
                  <input type="date" value={form.expense_date || ''} onChange={e => setForm(f => ({...f, expense_date: e.target.value}))} />
                </div>
                <div className="exp-form-group">
                  <label>Due Date</label>
                  <input type="date" value={form.due_date || ''} onChange={e => setForm(f => ({...f, due_date: e.target.value}))} />
                </div>
                <div className="exp-form-group">
                  <label>Status</label>
                  <select value={form.status || 'unpaid'} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                    <option value="draft">Draft</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                  </select>
                </div>
                <div className="exp-form-group">
                  <label>Payment Method</label>
                  <select value={form.payment_method || ''} onChange={e => setForm(f => ({...f, payment_method: e.target.value}))}>
                    <option value="">—</option>
                    {['cash','bank_transfer','credit_card','cheque','online'].map(m => <option key={m} value={m}>{m.replace('_',' ')}</option>)}
                  </select>
                </div>
                <div className="exp-form-group span2">
                  <label>Notes</label>
                  <textarea rows={3} value={form.notes || ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Optional notes…" />
                </div>
              </div>
            </div>
            <div className="exp-modal-footer">
              <button className="exp-btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
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
