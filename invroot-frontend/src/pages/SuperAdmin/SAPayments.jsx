import { useState, useEffect, useCallback } from 'react';
import saApi from '../../lib/saApi.js';
import { fmtAmt } from './saFormat.js';
import './SuperAdminLayout.css';

/* Keys must match the payments.method enum:
   cash | bank_transfer | card | check | stripe | paypal | other */
const METHOD_COLORS = {
  cash:          { bg:'#dcfce7', color:'#16a34a' },
  bank_transfer: { bg:'#dbeafe', color:'#2563eb' },
  card:          { bg:'#f3e8ff', color:'#7c3aed' },
  stripe:        { bg:'#fce7f3', color:'#be185d' },
  check:         { bg:'#fef3c7', color:'#d97706' },
  paypal:        { bg:'#e0f2fe', color:'#0369a1' },
  other:         { bg:'#f1f5f9', color:'#475569' },
};

const fmt = (n, cur) => fmtAmt(n, cur, 2);

export default function SAPayments() {
  const [rows,     setRows]     = useState([]);
  const [total,    setTotal]    = useState(0);
  const [totalAmt, setTotalAmt] = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [method,   setMethod]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenants,  setTenants]  = useState([]);

  useEffect(() => {
    saApi.get('/tenants?limit=100').then(r => { if (r.success) setTenants(r.data || []); });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({
      ...(method   && { method }),
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo   && { date_to:   dateTo }),
      ...(tenantId && { tenant_id: tenantId }),
    });
    saApi.get(`/payments?${q}`).then(r => {
      if (r.success) { setRows(r.data || []); setTotal(r.total || 0); setTotalAmt(r.total_amount || 0); }
      setLoading(false);
    });
  }, [method, dateFrom, dateTo, tenantId]);

  useEffect(() => { load(); }, [load]);


  // The cross-tenant total only carries a currency label when every visible row
  // shares one; otherwise it would imply a conversion that never happened.
  const currencies = [...new Set(rows.map(r => r.currency).filter(Boolean))];
  const uniformCur = currencies.length === 1 ? currencies[0] : '';

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1 className="sa-page-title">All Payments</h1>
          <p className="sa-page-sub">{total} transactions · {fmt(totalAmt, uniformCur)} collected</p>
        </div>
      </div>

      <div className="sa-card">
        <div className="sa-toolbar">
          <select className="sa-select" value={tenantId} onChange={e => { setTenantId(e.target.value); }}>
            <option value="">All tenants</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.company_name}</option>)}
          </select>
          <select className="sa-select" value={method} onChange={e => setMethod(e.target.value)}>
            <option value="">All methods</option>
            {['cash','bank_transfer','credit_card','stripe','cheque'].map(m=>(
              <option key={m} value={m}>{m.replace('_',' ')}</option>
            ))}
          </select>
          <input className="sa-input-date" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" />
          <input className="sa-input-date" type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   title="To date" />
        </div>

        {loading
          ? <div className="sa-empty">Loading...</div>
          : (
          <table className="sa-table">
            <thead>
              <tr><th>Date</th><th>Tenant</th><th>Invoice #</th><th>Amount</th><th>Method</th><th>Reference</th></tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const mc = METHOD_COLORS[p.method] || { bg:'#f1f5f9', color:'#374151' };
                return (
                  <tr key={p.id}>
                    <td className="td-mono">{p.payment_date?.slice(0,10)}</td>
                    <td style={{ fontWeight:600, fontSize:12 }}>{p.tenant_name}</td>
                    <td className="td-mono">{p.invoice_number}</td>
                    <td className="td-amt">{fmt(p.amount, p.currency)}</td>
                    <td>
                      <span className="sa-status-badge" style={{ background:mc.bg, color:mc.color }}>
                        {p.method?.replace('_',' ')}
                      </span>
                    </td>
                    <td className="td-mono">{p.reference_number || '—'}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="sa-empty">No payments found</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
