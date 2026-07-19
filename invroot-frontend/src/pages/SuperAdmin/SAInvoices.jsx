import { useState, useEffect, useCallback } from 'react';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

const INV_STATUS = { paid:'sa-status-paid', overdue:'sa-status-overdue', draft:'sa-status-draft', sent:'sa-status-sent', partial:'sa-status-partial' };
function fmt(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }); }

export default function SAInvoices() {
  const [rows,      setRows]      = useState([]);
  const [total,     setTotal]     = useState(0);
  const [totalAmt,  setTotalAmt]  = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [status,    setStatus]    = useState('');
  const [dateFrom,  setDateFrom]  = useState('');
  const [dateTo,    setDateTo]    = useState('');
  const [tenantId,  setTenantId]  = useState('');
  const [tenants,   setTenants]   = useState([]);
  const [page,      setPage]      = useState(1);
  const LIMIT = 20;

  useEffect(() => {
    saApi.get('/tenants?limit=100').then(r => { if (r.success) setTenants(r.data || []); });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({
      ...(search   && { search }),
      ...(status   && { status }),
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo   && { date_to:   dateTo }),
      ...(tenantId && { tenant_id: tenantId }),
      page, limit: LIMIT,
    });
    saApi.get(`/invoices?${q}`).then(r => {
      if (r.success) { setRows(r.data || []); setTotal(r.total || 0); setTotalAmt(r.total_amount || 0); }
      setLoading(false);
    });
  }, [search, status, dateFrom, dateTo, tenantId, page]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.ceil(total / LIMIT);

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">All Invoices</h1>
          <p className="sa-page-sub">{total} invoices · {fmt(totalAmt)} total</p>
        </div>
      </div>

      <div className="sa-card">
        <div className="sa-toolbar">
          <div className="sa-search">
            🔍<input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search invoice # or client..."
            />
          </div>
          <select className="sa-select" value={tenantId} onChange={e => { setTenantId(e.target.value); setPage(1); }}>
            <option value="">All tenants</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.company_name}</option>)}
          </select>
          <select className="sa-select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {['draft','sent','paid','overdue','partial','cancelled'].map(s=><option key={s}>{s}</option>)}
          </select>
          <input className="sa-select" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} title="From date" />
          <input className="sa-select" type="date" value={dateTo}   onChange={e => { setDateTo(e.target.value); setPage(1); }}   title="To date" />
        </div>

        {loading
          ? <div className="sa-empty">Loading...</div>
          : (
          <table className="sa-table">
            <thead>
              <tr><th>Invoice #</th><th>Tenant</th><th>Client</th><th>Amount</th><th>Status</th><th>Issue Date</th><th>Due Date</th></tr>
            </thead>
            <tbody>
              {rows.map(inv => (
                <tr key={inv.id}>
                  <td className="td-mono">{inv.invoice_number}</td>
                  <td style={{ fontWeight:600, fontSize:12 }}>{inv.company_name}</td>
                  <td>{inv.client_name}</td>
                  <td className="td-amt">{fmt(inv.total_amount)}</td>
                  <td><span className={`sa-status-badge ${INV_STATUS[inv.status] || ''}`}>{inv.status}</span></td>
                  <td className="td-mono">{inv.issue_date?.slice(0,10)}</td>
                  <td className="td-mono">{inv.due_date?.slice(0,10)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="sa-empty">No invoices found</td></tr>}
            </tbody>
          </table>
        )}

        {pages > 1 && (
          <div className="sa-pagination">
            <span>Page {page} of {pages} · {total} invoices</span>
            <button className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setPage(p=>p-1)} disabled={page===1}>← Prev</button>
            <button className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setPage(p=>p+1)} disabled={page>=pages}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
