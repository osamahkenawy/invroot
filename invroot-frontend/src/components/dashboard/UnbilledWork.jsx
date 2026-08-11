/**
 * Unbilled work — money already earned but not yet invoiced.
 *
 * Time tracking and expenses used to be dead ends: hours and rebillable costs
 * accumulated with no path to an invoice, so the only way to notice them was
 * to go looking client by client. This surfaces the total on the dashboard and
 * turns each row into a one-click draft invoice.
 *
 * It renders nothing when there is nothing waiting — an empty card teaching
 * you that a feature exists is noise on every other day of the year.
 */

import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock, Sparks } from 'iconoir-react';
import api from '../../lib/api.js';
import { useToastContext } from '../../context/ToastContext.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';
import { fmtCurrency } from '../../utils/currency.js';
import './UnbilledWork.css';

export default function UnbilledWork() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const { tenant } = useContext(AuthContext);
  /* A client with no currency of its own bills in the tenant's. */
  const baseCurrency = tenant?.currency || 'AED';
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () => api.get('/invoices/unbilled').then(r => { if (r.success) setData(r.data); });
  useEffect(() => { load(); }, []);

  /* Bill everything outstanding for one client. The server re-checks and
     claims the work atomically, so two people pressing this at once cannot
     produce two invoices for the same hours. */
  const billClient = async (client) => {
    setBusy(client.client_id);
    try {
      const detail = await api.get(`/invoices/unbilled/${client.client_id}`);
      if (!detail.success) { showToast(detail.message || t('common.action_failed'), 'error'); return; }

      const res = await api.post('/invoices/from-unbilled', {
        client_id: client.client_id,
        time_entry_ids: detail.data.time.map(e => e.id),
        expense_ids: detail.data.expenses.map(e => e.id),
      });

      if (res.success) {
        showToast(t('unbilled.created', { number: res.invoice_number }), 'success');
        // Straight into the draft, so it can be reviewed before it is sent.
        navigate(`/invoices?open=${res.id}`);
      } else {
        // Most likely someone else billed it first — reload so the list is honest.
        showToast(res.message || t('common.action_failed'), 'error');
        load();
      }
    } finally { setBusy(null); }
  };

  if (!data || !data.clients?.length) return null;

  return (
    <div className="uw-card">
      <div className="uw-head">
        <div className="uw-icon"><Clock /></div>
        <div className="uw-head-text">
          <div className="uw-title">{t('unbilled.title')}</div>
          <div className="uw-sub">
            {t('unbilled.subtitle', { count: data.client_count })}
          </div>
        </div>
        <div className="uw-total">{fmtCurrency(data.total_value, baseCurrency)}</div>
      </div>

      <ul className="uw-list">
        {data.clients.slice(0, 5).map(c => {
          const value = Number(c.time_amount) + Number(c.expense_amount);
          const bits = [];
          if (Number(c.time_count) > 0) bits.push(t('unbilled.hours', { count: Number(c.hours) }));
          if (Number(c.expense_count) > 0) bits.push(t('unbilled.expenses', { count: Number(c.expense_count) }));
          return (
            <li key={c.client_id} className="uw-row">
              <div className="uw-row-main">
                <button
                  type="button"
                  className="uw-client"
                  onClick={() => navigate(`/clients?open=${c.client_id}`)}
                >
                  {c.client_name}
                </button>
                <span className="uw-detail">{bits.join(' · ')}</span>
              </div>
              <span className="uw-value">{fmtCurrency(value, c.currency || baseCurrency)}</span>
              <button
                type="button"
                className="uw-bill"
                onClick={() => billClient(c)}
                disabled={busy === c.client_id}
              >
                {busy === c.client_id
                  ? <span className="spinner spinner-sm" />
                  : <><Sparks /> {t('unbilled.bill')}</>}
              </button>
            </li>
          );
        })}
      </ul>

      {data.clients.length > 5 && (
        <div className="uw-more">{t('unbilled.and_more', { count: data.clients.length - 5 })}</div>
      )}
    </div>
  );
}
