import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { Plus, Search, Eye, Download } from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';
import { fmtDate } from '../utils/date.js';
import InvoiceFormModal from '../components/invoices/InvoiceFormModal.jsx';
import InvoiceDetailModal from '../components/invoices/InvoiceDetailModal.jsx';

const STATUS_COLORS = {
  draft: '#9ca3af', sent: '#2563eb', viewed: '#7c3aed',
  partial: '#d97706', paid: '#16a34a', overdue: '#dc2626', void: '#6b7280',
};

export default function Invoices() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(true);
  const [formModal, setFormModal] = useState(null); // null | 'new' | invoice object
  const [detailId,  setDetailId]  = useState(null);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/invoices?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      if (res.success) { setInvoices(res.data); setTotal(res.total); }
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchInvoices(); }, [page, statusFilter, search]);

  const handleDownloadPdf = (id, number) => api.download(`/invoices/${id}/pdf`, `invoice-${number}.pdf`);

  const statusBadge = (status) => (
    <span className="status-badge" style={{ background: STATUS_COLORS[status] + '20', color: STATUS_COLORS[status] }}>
      {t(`invoices.status.${status}`)}
    </span>
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('invoices.title')}</h1>
        <button className="btn btn-primary" onClick={() => setFormModal('new')}>
          <Plus /> {t('invoices.new')}
        </button>
      </div>

      <div className="card">
        <div className="card-toolbar">
          <div className="status-filter-tabs">
            {['', 'draft', 'sent', 'partial', 'paid', 'overdue'].map(s => (
              <button key={s} className={`filter-tab ${statusFilter === s ? 'active' : ''}`} onClick={() => { setStatusFilter(s); setPage(1); }}>
                {s ? t(`invoices.status.${s}`) : t('common.all')}
              </button>
            ))}
          </div>
          <div className="search-box">
            <Search className="search-icon" />
            <input
              type="text"
              placeholder={t('common.search') + '...'}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {loading ? <Loader fullPage /> : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('invoices.number')}</th>
                  <th>{t('invoices.client')}</th>
                  <th>{t('invoices.issue_date')}</th>
                  <th>{t('invoices.due_date')}</th>
                  <th>{t('common.total')}</th>
                  <th>{t('invoices.paid_amount')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 && (
                  <tr><td colSpan={8} className="empty-row">{t('common.no_data')}</td></tr>
                )}
                {invoices.map(inv => (
                  <tr key={inv.id} className="row-clickable" onClick={() => setDetailId(inv.id)}>
                    <td className="td-mono">{inv.invoice_number}</td>
                    <td>{inv.client_name}</td>
                    <td>{fmtDate(inv.issue_date)}</td>
                    <td>{fmtDate(inv.due_date)}</td>
                    <td className="td-amount">{fmtCurrency(inv.total_amount, inv.currency)}</td>
                    <td className="td-amount">{fmtCurrency(inv.paid_amount, inv.currency)}</td>
                    <td>{statusBadge(inv.status)}</td>
                    <td className="td-actions" onClick={e => e.stopPropagation()}>
                      <button className="icon-btn" onClick={() => setDetailId(inv.id)} title={t('common.view')}><Eye /></button>
                      <button className="icon-btn" onClick={() => handleDownloadPdf(inv.id, inv.invoice_number)} title={t('common.download')}><Download /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>{t('common.showing')} {invoices.length} {t('common.of')} {total}</span>
          <div className="pagination-btns">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn btn-sm">‹</button>
            <span>{t('common.page')} {page}</span>
            <button disabled={invoices.length < 20} onClick={() => setPage(p => p + 1)} className="btn btn-sm">›</button>
          </div>
        </div>
      </div>

      {formModal && (
        <InvoiceFormModal
          invoice={formModal === 'new' ? null : formModal}
          onClose={() => setFormModal(null)}
          onSave={() => { setFormModal(null); fetchInvoices(); }}
        />
      )}

      {detailId && (
        <InvoiceDetailModal
          invoiceId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={fetchInvoices}
        />
      )}
    </div>
  );
}
