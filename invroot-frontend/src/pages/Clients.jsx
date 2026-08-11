import { useState, useEffect, useContext, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ClientAvatar from '../components/clients/ClientAvatar.jsx';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../lib/api.js';
import { useToastContext } from '../context/ToastContext.jsx';
import Loader from '../components/Loader.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import {
  Plus, Search, EditPencil, Trash, User, Mail, Phone,
  ViewGrid, List, Building, Coins, MultiplePages, Reports as ReportsIcon, Camera,
} from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import './Clients.css';

function balanceClass(val) {
  const n = parseFloat(val) || 0;
  if (n <= 0) return 'zero';
  if (n < 1000) return 'low';
  return 'high';
}

const CURRENCIES = ['SAR','USD','EUR','GBP','AED','KWD','QAR'];

export default function Clients() {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const { tenant } = useContext(AuthContext);
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

  /* Deep link: /clients?open=42 opens that client's drawer — the dashboard's
     unbilled-work card links here by client.

     Deliberately does NOT rely on the client being in the loaded page. The list
     shows 24 at a time, so matching against it would silently do nothing for
     anyone further down — the exact case a deep link exists to solve. Falls
     back to fetching the one record. The param is consumed either way so Back
     doesn't reopen the drawer. */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const open = Number(searchParams.get('open'));
    if (!open) return;

    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });

    const known = clients.find(c => c.id === open);
    if (known) { setDrawer(known); return; }
    api.get(`/clients/${open}`).then(res => {
      if (res.success && res.data) setDrawer(res.data);
      else showToast(t('clients.not_found'), 'error');
    });
  }, [searchParams, setSearchParams]);

  const handleDelete = async (id) => {
    if (!confirm(t('common.confirm_delete', { defaultValue: 'Are you sure?' }))) return;
    const res = await api.delete(`/clients/${id}`);
    if (res.success) { showToast(t('common.deleted_success')); fetchClients(); }
    else showToast(res.message || t('common.delete_failed'), 'error');
  };

  const activeCount   = clients.filter(c => c.status === 'active').length;
  const totalOutstanding = clients.reduce((s, c) => s + (parseFloat(c.outstanding_balance) || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('clients.title', { defaultValue: 'Clients' })}</h1>
          <p style={{ color:'var(--text-muted)', fontSize:13, margin:'2px 0 0' }}>
            {t('clients.count_in_account', { count: total })}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setDrawer('new')}>
          <Plus /> {t('clients.add_client')}
        </button>
      </div>

      {/* Stats */}
      <div className="clients-stats">
        <div className="clients-stat-card">
          <div className="csc-icon blue"><MultiplePages /></div>
          <div className="csc-body">
            <div className="csc-val">{total}</div>
            <div className="csc-lbl">{t('clients.total_clients')}</div>
          </div>
        </div>
        <div className="clients-stat-card">
          <div className="csc-icon green"><User /></div>
          <div className="csc-body">
            <div className="csc-val">{activeCount}</div>
            <div className="csc-lbl">{t('clients.active')}</div>
          </div>
        </div>
        <div className="clients-stat-card">
          <div className="csc-icon orange"><Coins /></div>
          <div className="csc-body">
            <div className="csc-val">{fmtCurrency(totalOutstanding, tenant?.currency || 'SAR')}</div>
            <div className="csc-lbl">{t('clients.outstanding_this_page')}</div>
          </div>
        </div>
        <div className="clients-stat-card">
          <div className="csc-icon red"><Building /></div>
          <div className="csc-body">
            <div className="csc-val">{clients.filter(c => c.company_name).length}</div>
            <div className="csc-lbl">{t('clients.with_company')}</div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="clients-toolbar">
        <div className="search-box">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder={t('clients.search_placeholder')}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="filter-tabs">
          {[['', 'common.all'], ['active', 'clients.active'], ['inactive', 'clients.inactive']].map(([val, label]) => (
            <button
              key={val}
              className={`filter-tab ${statusFilter === val ? 'active' : ''}`}
              onClick={() => { setStatusFilter(val); setPage(1); }}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <div className="view-toggle">
          <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title={t('clients.grid_view')}>
            <ViewGrid style={{ width:16, height:16 }} />
          </button>
          <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title={t('clients.list_view')}>
            <List style={{ width:16, height:16 }} />
          </button>
        </div>
      </div>

      {loading ? <Loader fullPage /> : clients.length === 0 ? (
        <div className="clients-empty">
          <div className="clients-empty-icon"><User /></div>
          <h3>{t('clients.none_yet')}</h3>
          <p>{search ? t('clients.no_results') : t('clients.start_adding')}</p>
          {!search && (
            <button className="btn btn-primary" onClick={() => setDrawer('new')}>
              <Plus /> {t('clients.add_first')}
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
                  <th>{t('clients.col_client')}</th>
                  <th>{t('clients.col_contact')}</th>
                  <th>{t('clients.col_outstanding')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(c => {
                  return (
                    <tr key={c.id}>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <ClientAvatar name={c.name} url={c.avatar_url} size={36} radius={10} fontSize={13} />
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
                          {fmtCurrency(c.outstanding_balance || 0, c.currency || tenant?.currency || 'SAR')}
                        </span>
                      </td>
                      <td><span className={`status-badge status-${c.status}`}>{t(`clients.${c.status}`, { defaultValue: c.status })}</span></td>
                      <td>
                        <div style={{ display:'flex', gap:6 }}>
                          <Link className="icon-btn" to={`/clients/${c.id}/statement`} title={t('statement.title')}><ReportsIcon /></Link>
                          <button className="icon-btn" onClick={() => setDrawer(c)} title={t('common.edit')}><EditPencil /></button>
                          <button className="icon-btn danger" onClick={() => handleDelete(c.id)} title={t('common.delete')}><Trash /></button>
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
          <span>{t('clients.showing_of', { shown: clients.length, total })}</span>
          <div className="clients-pager-btns">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span style={{ padding:'0 8px', lineHeight:'32px', fontWeight:600 }}>{page}</span>
            <button disabled={clients.length < 24} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        </div>
      )}

      {/* FAB on mobile */}
      <button className="fab" onClick={() => setDrawer('new')} title={t('clients.add_client')}>
        <Plus />
      </button>

      {drawer && (
        <ClientDrawer
          client={drawer === 'new' ? null : drawer}
          onClose={() => setDrawer(null)}
          onSave={(wasNew) => {
            setDrawer(null);
            showToast(t(wasNew ? 'common.created_success' : 'common.updated_success'));
            fetchClients();
          }}
        />
      )}
    </div>
  );
}

/* ── Client Card ─────────────────────────────────────── */
function ClientCard({ client: c, onEdit, onDelete }) {
  const { t } = useTranslation();
  const { tenant } = useContext(AuthContext);
  const balCls = balanceClass(c.outstanding_balance);
  return (
    <div className="client-card">
      <div className="cc-top">
        <ClientAvatar className="cc-avatar" name={c.name} url={c.avatar_url} size={44} radius={12} />
        <div className="cc-meta">
          <div className="cc-name">{c.name}</div>
          {c.company_name
            ? <div className="cc-company"><Building style={{ width:11, height:11, marginRight:3 }} />{c.company_name}</div>
            : <div className="cc-company" style={{ color:'transparent' }}>—</div>
          }
        </div>
        <div className="cc-badge">
          <span className={`status-badge status-${c.status}`}>{t(`clients.${c.status}`, { defaultValue: c.status })}</span>
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
          <div className="cc-row" style={{ color:'var(--text-muted)', fontStyle:'italic' }}>{t('clients.no_contact')}</div>
        )}
      </div>

      <div className="cc-balance-row">
        <div>
          <div className="cc-bal-label">{t('clients.outstanding_balance')}</div>
          <div className={`cc-bal-val ${balCls}`}>
            {fmtCurrency(c.outstanding_balance || 0, c.currency || tenant?.currency || 'SAR')}
          </div>
        </div>
        {c.invoice_count > 0 && (
          <div className="cc-bal-invoices">{c.invoice_count} invoice{c.invoice_count !== 1 ? 's' : ''}</div>
        )}
      </div>

      <div className="cc-actions">
        <Link className="cc-btn" to={`/clients/${c.id}/statement`}>
          <ReportsIcon /> {t('statement.short')}
        </Link>
        <button className="cc-btn primary" onClick={onEdit}>
          <EditPencil /> {t('common.edit')}
        </button>
        <button className="cc-btn danger" onClick={onDelete}>
          <Trash /> {t('common.delete')}
        </button>
      </div>
    </div>
  );
}

/* ── Client Drawer (Create / Edit) ───────────────────── */
function ClientDrawer({ client, onClose, onSave }) {
  const { t } = useTranslation();
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

  /* Profile picture. Uploading needs a client id, so for a brand-new client the
     file is held here and sent once the record exists — otherwise the picture
     would have nothing to attach to. */
  const [avatarUrl, setAvatarUrl]   = useState(client?.avatar_url || null);
  const [pendingPic, setPendingPic] = useState(null);
  const [picBusy, setPicBusy]       = useState(false);
  const picInput = useRef(null);

  // A local blob preview must be released, or picking repeatedly leaks it.
  useEffect(() => {
    if (!pendingPic) return;
    const blob = URL.createObjectURL(pendingPic);
    setAvatarUrl(blob);
    return () => URL.revokeObjectURL(blob);
  }, [pendingPic]);

  const MAX_PIC = 5 * 1024 * 1024;

  const choosePic = (file) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      setError(t('clients.picture_not_image'));
      return;
    }
    if (file.size > MAX_PIC) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB.`);
      return;
    }
    setPendingPic(file);
  };

  const uploadPic = async (clientId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/clients/${clientId}/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
      credentials: 'include',
      body: fd,
    });
    return res.json();
  };

  const removePic = async () => {
    setPendingPic(null);
    setAvatarUrl(null);
    if (!client?.id) return;
    setPicBusy(true);
    try {
      await fetch(`/api/clients/${client.id}/avatar`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
        credentials: 'include',
      });
    } finally { setPicBusy(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = client
        ? await api.put(`/clients/${client.id}`, form)
        : await api.post('/clients', form);
      if (!res.success) { setError(res.message || 'Failed to save client'); return; }

      /* The client saved. A picture failing after that is not a reason to
         report the save as failed — say so and carry on. */
      if (pendingPic) {
        const id = client?.id || res.id;
        const pic = await uploadPic(id, pendingPic);
        if (!pic.success) {
          setError(pic.message || 'The client was saved, but the picture could not be uploaded.');
          return;
        }
      }
      onSave(!client);
    } finally { setSaving(false); }
  };

  return (
    <div className="client-drawer-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="client-drawer">
        <div className="drawer-header">
          <div>
            <h2>{t(client ? 'clients.edit_client' : 'clients.new_client')}</h2>
            <div className="drawer-header-sub">{client ? `Updating ${client.name}` : 'Fill in the details below'}</div>
          </div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
          <div className="drawer-body">

            {/* Avatar preview */}
            <div className="drawer-avatar-preview">
              <button
                type="button"
                className="drawer-avatar-btn"
                onClick={() => picInput.current?.click()}
                disabled={picBusy}
                title={avatarUrl ? 'Change profile picture' : 'Add a profile picture'}
              >
                <ClientAvatar name={form.name || 'N'} url={avatarUrl} size={56} radius={14} />
                <span className="drawer-avatar-edit"><Camera /></span>
              </button>
              <input
                ref={picInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => { choosePic(e.target.files?.[0]); e.target.value = ''; }}
              />
              <div>
                <div className="drawer-avatar-name">{form.name || 'New Client'}</div>
                <div className="drawer-avatar-sub">{form.company_name || 'No company'}</div>
                <div className="drawer-avatar-actions">
                  <button type="button" onClick={() => picInput.current?.click()} disabled={picBusy}>
                    {avatarUrl ? 'Change photo' : 'Add photo'}
                  </button>
                  {avatarUrl && (
                    <button type="button" className="danger" onClick={removePic} disabled={picBusy}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {/* Basic info */}
            <div className="drawer-section-title">{t('clients.sec_basic')}</div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('clients.full_name')} *</label>
                <input value={form.name} onChange={set('name')} required placeholder={t('common.ph_person')} />
              </div>
              <div className="form-group">
                <label>{t('clients.company_name')}</label>
                <input value={form.company_name} onChange={set('company_name')} placeholder={t('common.ph_company')} />
              </div>
            </div>

            {/* Contact */}
            <div className="drawer-section-title">{t('clients.sec_contact')}</div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('common.email')}</label>
                <input type="email" value={form.email} onChange={set('email')} placeholder="client@example.com" />
              </div>
              <div className="form-group">
                <label>{t('common.phone')}</label>
                <input value={form.phone} onChange={set('phone')} placeholder="+966 5X XXX XXXX" />
              </div>
            </div>

            {/* Address */}
            <div className="drawer-section-title">{t('clients.sec_address')}</div>
            <div className="form-group">
              <label>{t('clients.billing_address')}</label>
              <textarea value={form.billing_address} onChange={set('billing_address')} rows={2} placeholder={t('invoices.ph_address')} />
            </div>
            <div className="form-group">
              <label>{t('clients.shipping_address')} <span style={{ color:'var(--text-muted)', fontWeight:400 }}>{t('clients.optional')}</span></label>
              <textarea value={form.shipping_address} onChange={set('shipping_address')} rows={2} placeholder={t('common.ph_same_as_billing')} />
            </div>

            {/* Billing Preferences */}
            <div className="drawer-section-title">{t('clients.sec_billing')}</div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('common.currency')}</label>
                <select value={form.currency} onChange={set('currency')}>
                  <option value="">{t('clients.default')}</option>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>{t('clients.payment_terms_days')}</label>
                <input type="number" value={form.payment_terms} onChange={set('payment_terms')} min={0} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('clients.credit_limit')}</label>
                <input type="number" value={form.credit_limit} onChange={set('credit_limit')} min={0} placeholder={t('common.no_limit_hint')} />
              </div>
              <div className="form-group">
                <label>{t('clients.preferred_lang')}</label>
                <select value={form.preferred_language} onChange={set('preferred_language')}>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
            </div>

            {/* Status & Notes */}
            <div className="drawer-section-title">{t('clients.sec_status_notes')}</div>
            <div className="form-group">
              <label>{t('common.status')}</label>
              <select value={form.status} onChange={set('status')}>
                <option value="active">{t('clients.active')}</option>
                <option value="inactive">{t('clients.inactive')}</option>
                <option value="archived">{t('clients.archived')}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t('clients.internal_notes')}</label>
              <textarea value={form.notes} onChange={set('notes')} rows={3} placeholder={t('common.ph_notes_client')} />
            </div>

          </div>

          <div className="drawer-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner spinner-sm" /> : t(client ? 'clients.save_changes' : 'clients.create_client')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
