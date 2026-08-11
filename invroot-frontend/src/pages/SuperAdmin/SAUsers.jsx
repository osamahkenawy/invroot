import { useState, useEffect, useCallback } from 'react';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

/* Referenced by the search box below; it was never defined here, which crashed
   the whole page with "SearchIcon is not defined". */
const SearchIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export default function SAUsers() {
  const [users,   setUsers]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [active,  setActive]  = useState('');
  const [tenantId,setTenantId]= useState('');
  const [tenants, setTenants] = useState([]);

  useEffect(() => {
    saApi.get('/tenants?limit=100').then(r => { if (r.success) setTenants(r.data || []); });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({
      ...(search   && { search }),
      ...(active !== '' && { is_active: active }),
      ...(tenantId && { tenant_id: tenantId }),
    });
    saApi.get(`/users?${q}`).then(r => {
      if (r.success) { setUsers(r.data || []); setTotal(r.total || 0); }
      setLoading(false);
    });
  }, [search, active, tenantId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id) => {
    await saApi.put(`/users/${id}/toggle`);
    load();
  };

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">Platform Users</h1>
          <p className="sa-page-sub">{total} users across all tenants</p>
        </div>
      </div>

      <div className="sa-card">
        <div className="sa-toolbar">
          <div className="sa-search">
            {SearchIcon}<input
              value={search}
              onChange={e => { setSearch(e.target.value); }}
              placeholder="Search by name or email..."
            />
          </div>
          <select className="sa-select" value={tenantId} onChange={e => setTenantId(e.target.value)}>
            <option value="">All tenants</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.company_name}</option>)}
          </select>
          <select className="sa-select" value={active} onChange={e => setActive(e.target.value)}>
            <option value="">All statuses</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </div>

        {loading
          ? <div className="sa-empty">Loading...</div>
          : (
          <table className="sa-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Tenant</th><th>Role</th><th>Status</th><th>Created</th><th>Action</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight:600 }}>{u.full_name}</td>
                  <td style={{ fontSize:12 }}>{u.email}</td>
                  <td style={{ fontSize:12, color:'#6b7280' }}>{u.tenant_name || '—'}</td>
                  <td>
                    <span className="sa-badge no-dot" style={{ background:'#f1f5f9', color:'#374151' }}>{u.role}</span>
                  </td>
                  <td>
                    <span className={`sa-badge ${u.is_active ? 'active' : 'cancelled'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="td-mono">{u.created_at?.slice(0,10)}</td>
                  <td>
                    <button
                      className={`sa-btn sa-btn-sm ${u.is_active ? 'sa-btn-danger' : 'sa-btn-success'}`}
                      onClick={() => toggle(u.id)}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={7} className="sa-empty">No users found</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
