import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import {
  Plus, Search, EditPencil, Trash, User, Mail, Phone,
  ViewGrid, List, Building, Coins, MultiplePages,
} from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import './Clients.css';

const AVATAR_COLORS = [
  ['#244066','#fff'], ['#7c3aed','#fff'], ['#059669','#fff'],
  ['#d97706','#fff'], ['#dc2626','#fff'], ['#0891b2','#fff'],
  ['#db2777','#fff'], ['#65a30d','#fff'],
];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function balanceClass(val) {
  const n = parseFloat(val) || 0;
  if (n <= 0) return 'zero';
  if (n < 1000) return 'low';
  return 'high';
}

const CURRENCIES = ['SAR','USD','EUR','GBP','AED','KWD','QAR'];

export default function Clients() {
  const { t } = useTranslation();
  const [clients, setClients] = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);
  const [drawer,  setDrawer]  = useState(null); // null | 'new' | client obj
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [statusFilter, setStatusFilter] = useState('');

  const fetchClients = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 24 });
      if (search)       params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      const res = await api.get(`/clients?${params}`);
      if (res.success) { setClients(res.data || []); setTotal(res.total || 0); }
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchClients(); }, [page, search, statusFilter]);

  const handleDelete = async (id) => {
    if (!confirm(t('common.confirm_delete', { defaultValue: 'Are you sure?' }))) return;
    await api.delete(`/clients/${id}`);
    fetchClients();
  };

  const activeCount   = clients.filter(c => c.status === 'active').length;
  const totalOutstanding = clients.reduce((s, c) => s + (parseFloat(c.outstanding_balance) || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('clients.title', { defaultValue: 'Clients' })}</h1>
          <p style={{ color:'var(--text-muted)', fontSize:13, margin:'2px 0 0' }}>
            {total} {total === 1 ? 'client' : 'clients'} in your account
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setDrawer('new')}>
          <Plus /> Add Client
        </button>
      </div>

      {/* Stats */}
      <div className="clients-stats">
        <div className="clients-stat-card">
          <div className="csc-icon blue"><MultiplePages /></div>
          <div className="csc-body">
            <div className="csc-val">{total}</div>
            <div className="csc-lbl">Total Clients</div>
          </div>
        </div>
        <div className="clients-stat-card">
          <div className="csc-icon green"><User /></div>
          <div className="csc-body">
            <div className="csc-val">{activeCount}</div>
            <div className="csc-lbl">Active</div>
          </div>
        </div>
        <div className="clients-stat-card">
          <div className="csc-icon orange"><Coins /></div>
          <div className="csc-body">
            <div className="csc-val">{fmtCurrency(totalOutstanding, 'SAR')}</div>
            <div className="csc-lbl">Outstanding (this page)</div>
          </div>
        </div>
        <div className="clients-stat-card">
          <div className="csc-icon red"><Building /></div>
          <div className="csc-body">
            <div className="csc-val">{clients.filter(c => c.company_name).length}</div>
            <div className="csc-lbl">With Company</div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="clients-toolbar">
        <div className="search-box">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search by name, email, phone…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="filter-tabs">
          {[['', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([val, label]) => (
            <button
              key={val}
              className={`filter-tab ${statusFilter === val ? 'active' : ''}`}
              onClick={() => { setStatusFilter(val); setPage(1); }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="view-toggle">
          <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="Grid view">
            <ViewGrid style={{ width:16, height:16 }} />
          </button>
          <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="List view">
            <List style={{ width:16, height:16 }} />
          </button>
        </div>
      </div>

      {loading ? <Loader fullPage /> : clients.length === 0 ? (
        <div className="clients-empty">
          <div className="clients-empty-icon"><User /></div>
          <h3>No clients yet</h3>
          <p>{search ? 'No results for your search' : 'Start by adding your first client'}</p>
          {!search && (
            <button className="btn btn-primary" onClick={() => setDrawer('new')}>
              <Plus /> Add your first client
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="clients-grid">
          {clients.map(c => <ClientCard key={c.id} client={c} onEdit={() => setDrawer(c)} onDelete={() => handleDelete(c.id)} />)}
        </div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div className="clients-table-wrap">
            <table className="clients-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>Outstanding</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(c => {
                  const [bg, fg] = avatarColor(c.name);
                  return (
                    <tr key={c.id}>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{ width:36, height:36, borderRadius:10, background:bg, color:fg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, flexShrink:0 }}>
                            {(c.name||'?').slice(0,2).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight:600, fontSize:14 }}>{c.name}</div>
                            {c.company_name && <div style={{ fontSize:12, color:'var(--text-muted)' }}>{c.company_name}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize:13, color:'var(--text-muted)' }}>
                        <div>{c.email || '—'}</div>
                        <div>{c.phone || '—'}</div>
                      </td>
                      <td>
                        <span style={{ fontWeight:700, color: (parseFloat(c.outstanding_balance)||0) > 0 ? '#dc2626' : 'var(--text-muted)' }}>
                          {fmtCurrency(c.outstanding_balance || 0, c.currency || 'SAR')}
                        </span>
                      </td>
                      <td><span className={`status-badge status-${c.status}`}>{c.status}</span></td>
                      <td>
                        <div style={{ display:'flex', gap:6 }}>
                          <button className="icon-btn" onClick={() => setDrawer(c)} title="Edit"><EditPencil /></button>
                          <button className="icon-btn danger" onClick={() => handleDelete(c.id)} title="Delete"><Trash /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="clients-pager">
          <span>Showing {clients.length} of {total} clients</span>
          <div className="clients-pager-btns">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span style={{ padding:'0 8px', lineHeight:'32px', fontWeight:600 }}>{page}</span>
            <button disabled={clients.length < 24} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        </div>
      )}

      {/* FAB on mobile */}
      <button className="fab" onClick={() => setDrawer('new')} title="Add Client">
        <Plus />
      </button>

      {drawer && (
        <ClientDrawer
          client={drawer === 'new' ? null : drawer}
          onClose={() => setDrawer(null)}
          onSave={() => { setDrawer(null); fetchClients(); }}
        />
      )}
    </div>
  );
}

/* ── Client Card ─────────────────────────────────────── */
function ClientCard({ client: c, onEdit, onDelete }) {
  const [bg, fg] = avatarColor(c.name);
  const balCls = balanceClass(c.outstanding_balance);
  return (
    <div className="client-card">
      <div className="cc-top">
        <div className="cc-avatar" style={{ background: bg, color: fg }}>
          {(c.name || '?').slice(0, 2).toUpperCase()}
        </div>
        <div className="cc-meta">
          <div className="cc-name">{c.name}</div>
          {c.company_name
            ? <div className="cc-company"><Building style={{ width:11, height:11, marginRight:3 }} />{c.company_name}</div>
            : <div className="cc-company" style={{ color:'transparent' }}>—</div>
          }
        </div>
        <div className="cc-badge">
          <span className={`status-badge status-${c.status}`}>{c.status}</span>
        </div>
      </div>

      <div className="cc-contact">
        {c.email && (
          <div className="cc-row"><Mail /><span>{c.email}</span></div>
        )}
        {c.phone && (
          <div className="cc-row"><Phone /><span>{c.phone}</span></div>
        )}
        {!c.email && !c.phone && (
          <div className="cc-row" style={{ color:'var(--text-muted)', fontStyle:'italic' }}>No contact info</div>
        )}
      </div>

      <div className="cc-balance-row">
        <div>
          <div className="cc-bal-label">Outstanding Balance</div>
          <div className={`cc-bal-val ${balCls}`}>
            {fmtCurrency(c.outstanding_balance || 0, c.currency || 'SAR')}
          </div>
        </div>
        {c.invoice_count > 0 && (
          <div className="cc-bal-invoices">{c.invoice_count} invoice{c.invoice_count !== 1 ? 's' : ''}</div>
        )}
      </div>

      <div className="cc-actions">
        <button className="cc-btn primary" onClick={onEdit}>
          <EditPencil /> Edit
        </button>
        <button className="cc-btn danger" onClick={onDelete}>
          <Trash /> Delete
        </button>
      </div>
    </div>
  );
}

/* ── Client Drawer (Create / Edit) ───────────────────── */
function ClientDrawer({ client, onClose, onSave }) {
  const [form, setForm] = useState({
    name:               client?.name               || '',
    email:              client?.email              || '',
    phone:              client?.phone              || '',
    company_name:       client?.company_name       || '',
    billing_address:    client?.billing_address    || '',
    shipping_address:   client?.shipping_address   || '',
    currency:           client?.currency           || '',
    payment_terms:      client?.payment_terms      ?? 30,
    credit_limit:       client?.credit_limit       || '',
    preferred_language: client?.preferred_language || 'en',
    notes:              client?.notes              || '',
    status:             client?.status             || 'active',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const [bg, fg] = avatarColor(form.name || 'N');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = client
        ? await api.put(`/clients/${client.id}`, form)
        : await api.post('/clients', form);
      if (res.success) onSave();
      else setError(res.message || 'Failed to save client');
    } finally { setSaving(false); }
  };

  return (
    <div className="client-drawer-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="client-drawer">
        <div className="drawer-header">
          <div>
            <h2>{client ? 'Edit Client' : 'New Client'}</h2>
            <div className="drawer-header-sub">{client ? `Updating ${client.name}` : 'Fill in the details below'}</div>
          </div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
          <div className="drawer-body">

            {/* Avatar preview */}
            <div className="drawer-avatar-preview">
              <div className="drawer-avatar" style={{ background: bg, color: fg }}>
                {(form.name || 'N').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="drawer-avatar-name">{form.name || 'New Client'}</div>
                <div className="drawer-avatar-sub">{form.company_name || 'No company'}</div>
              </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {/* Basic info */}
            <div className="drawer-section-title">Basic Information</div>
            <div className="form-row">
              <div className="form-group">
                <label>Full Name *</label>
                <input value={form.name} onChange={set('name')} required placeholder="e.g. John Smith" />
              </div>
              <div className="form-group">
                <label>Company Name</label>
                <input value={form.company_name} onChange={set('company_name')} placeholder="e.g. Acme Corp" />
              </div>
            </div>

            {/* Contact */}
            <div className="drawer-section-title">Contact Details</div>
            <div className="form-row">
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={form.email} onChange={set('email')} placeholder="client@example.com" />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input value={form.phone} onChange={set('phone')} placeholder="+966 5X XXX XXXX" />
              </div>
            </div>

            {/* Address */}
            <div className="drawer-section-title">Address</div>
            <div className="form-group">
              <label>Billing Address</label>
              <textarea value={form.billing_address} onChange={set('billing_address')} rows={2} placeholder="Street, City, Country" />
            </div>
            <div className="form-group">
              <label>Shipping Address <span style={{ color:'var(--text-muted)', fontWeight:400 }}>(optional)</span></label>
              <textarea value={form.shipping_address} onChange={set('shipping_address')} rows={2} placeholder="Leave blank if same as billing" />
            </div>

            {/* Billing Preferences */}
            <div className="drawer-section-title">Billing Preferences</div>
            <div className="form-row">
              <div className="form-group">
                <label>Currency</label>
                <select value={form.currency} onChange={set('currency')}>
                  <option value="">Default</option>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Payment Terms (days)</label>
                <input type="number" value={form.payment_terms} onChange={set('payment_terms')} min={0} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Credit Limit</label>
                <input type="number" value={form.credit_limit} onChange={set('credit_limit')} min={0} placeholder="0 = no limit" />
              </div>
              <div className="form-group">
                <label>Preferred Language</label>
                <select value={form.preferred_language} onChange={set('preferred_language')}>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
            </div>

            {/* Status & Notes */}
            <div className="drawer-section-title">Status &amp; Notes</div>
            <div className="form-group">
              <label>Status</label>
              <select value={form.status} onChange={set('status')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="form-group">
              <label>Internal Notes</label>
              <textarea value={form.notes} onChange={set('notes')} rows={3} placeholder="Any internal notes about this client…" />
            </div>

          </div>

          <div className="drawer-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner spinner-sm" /> : (client ? 'Save Changes' : 'Create Client')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
