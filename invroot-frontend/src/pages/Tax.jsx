import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import { useToastContext } from '../context/ToastContext.jsx';
import Loader from '../components/Loader.jsx';
import { Plus, Edit, Trash } from 'iconoir-react';

export default function Tax() {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const [rates, setRates]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null);

  const fetch = () => {
    setLoading(true);
    api.get('/tax').then(res => { if (res.success) setRates(res.data); setLoading(false); });
  };
  useEffect(() => { fetch(); }, []);

  const handleDelete = async (id) => {
    if (!confirm(t('common.confirm'))) return;
    const res = await api.delete(`/tax/${id}`);
    if (res.success) { showToast(t('common.deleted_success')); fetch(); }
    else showToast(res.message || t('common.delete_failed'), 'error');
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('tax.title')}</h1>
        <button className="btn btn-primary" onClick={() => setModal({})}><Plus /> {t('tax.new')}</button>
      </div>
      <div className="card">
        {loading ? <Loader fullPage /> : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('tax.type')}</th>
                  <th>{t('tax.rate')}</th>
                  <th>{t('tax.inclusive')}</th>
                  <th>{t('tax.compound')}</th>
                  <th>{t('tax.default')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rates.length === 0 && <tr><td colSpan={7} className="empty-row">{t('common.no_data')}</td></tr>}
                {rates.map(r => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.type}</td>
                    <td>{r.rate}%</td>
                    <td>{r.is_inclusive ? '✓' : '—'}</td>
                    <td>{r.is_compound ? '✓' : '—'}</td>
                    <td>{r.is_default ? '✓' : '—'}</td>
                    <td className="td-actions">
                      <button className="icon-btn" onClick={() => setModal(r)}><Edit /></button>
                      <button className="icon-btn danger" onClick={() => handleDelete(r.id)}><Trash /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && <TaxModal rate={modal.id ? modal : null} onClose={() => setModal(null)} onSave={(wasNew) => {
        setModal(null);
        showToast(t(wasNew ? 'common.created_success' : 'common.updated_success'));
        fetch();
      }} />}
    </div>
  );
}

function TaxModal({ rate, onClose, onSave }) {
  const { showToast } = useToastContext();
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: rate?.name || '', rate: rate?.rate || '', type: rate?.type || 'VAT', is_inclusive: rate?.is_inclusive || false, is_default: rate?.is_default || false });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: k.startsWith('is_') ? e.target.checked : e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    const res = rate ? await api.put(`/tax/${rate.id}`, form) : await api.post('/tax', form);
    setSaving(false);
    if (res.success) onSave(!rate);
    else showToast(res.message || t('common.save_failed'), 'error');
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header"><h2>{rate ? t('common.edit') : t('tax.new')}</h2><button className="modal-close" onClick={onClose}>×</button></div>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <div className="form-group"><label>{t('common.name')} *</label><input value={form.name} onChange={set('name')} required /></div>
            <div className="form-group"><label>{t('tax.type')}</label><select value={form.type} onChange={set('type')}><option>VAT</option><option>GST</option><option>Sales Tax</option></select></div>
          </div>
          <div className="form-group"><label>{t('tax.rate')} *</label><input type="number" step="0.01" value={form.rate} onChange={set('rate')} required /></div>
          <div className="form-row" style={{ gap: 16 }}>
            <label className="checkbox-label"><input type="checkbox" checked={form.is_inclusive} onChange={set('is_inclusive')} /> {t('tax.inclusive')}</label>
            <label className="checkbox-label"><input type="checkbox" checked={form.is_default} onChange={set('is_default')} /> {t('tax.default')}</label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <span className="spinner spinner-sm" /> : t('common.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
