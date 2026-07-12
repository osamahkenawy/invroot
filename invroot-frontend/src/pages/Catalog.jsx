import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { Plus, Edit, Trash, Xmark, Archive, Check } from 'iconoir-react';
import { fmtCurrency } from '../utils/currency.js';

export default function Catalog() {
  const { t } = useTranslation();
  const [items,    setItems]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [editing,  setEditing]  = useState(null);  // null | 'new' | item object
  const [category, setCategory] = useState('');

  const fetchItems = () => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: 200 });
    if (search)   qs.set('search', search);
    if (category) qs.set('category', category);
    api.get(`/catalog?${qs}`).then(res => { if (res.success) setItems(res.data); setLoading(false); });
  };

  useEffect(() => { fetchItems(); }, [search, category]);

  const deleteItem = async (id) => {
    if (!confirm(t('common.confirm_delete'))) return;
    await api.delete(`/catalog/${id}`);
    fetchItems();
  };

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('catalog.title')}</h1>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus /> {t('catalog.new_item')}
        </button>
      </div>

      <div className="card">
        <div className="card-toolbar">
          <input
            className="search-input"
            placeholder={t('common.search') + '...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex:1, minWidth:160, maxWidth:280 }}
          />
          <select className="toolbar-select" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">{t('catalog.all_categories')}</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {loading ? <Loader fullPage /> : items.length === 0 ? (
          <div className="empty-state">
            <Archive className="empty-state-icon" />
            <div className="empty-state-title">{t('catalog.empty_title')}</div>
            <div className="empty-state-sub">{t('catalog.empty_sub')}</div>
            <button className="btn btn-primary" style={{ marginTop:8 }} onClick={() => setEditing('new')}>
              <Plus /> {t('catalog.new_item')}
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrapper mobile-hide-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('common.name')}</th>
                    <th className="hide-mobile">{t('catalog.sku')}</th>
                    <th className="hide-mobile">{t('catalog.category')}</th>
                    <th>{t('catalog.unit_price')}</th>
                    <th>{t('catalog.tax_rate')}</th>
                    <th>{t('catalog.is_service')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className="row-clickable" onClick={() => setEditing(item)}>
                      <td><strong>{item.name}</strong>{item.description && <div style={{ fontSize:12, color:'var(--text-muted)' }}>{item.description}</div>}</td>
                      <td className="td-mono hide-mobile">{item.sku || '—'}</td>
                      <td className="hide-mobile">{item.category || '—'}</td>
                      <td className="td-amount">{fmtCurrency(item.unit_price)}</td>
                      <td>{item.tax_rate || 0}%</td>
                      <td>{item.is_service ? <Check style={{ color:'var(--success)' }} /> : '—'}</td>
                      <td className="td-actions" onClick={e => e.stopPropagation()}>
                        <button className="icon-btn" onClick={() => setEditing(item)} title={t('common.edit')}><Edit /></button>
                        <button className="icon-btn danger" onClick={() => deleteItem(item.id)} title={t('common.delete')}><Trash /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-card-list">
              {items.map(item => (
                <div key={item.id} className="m-card" onClick={() => setEditing(item)}>
                  <div className="m-card-header">
                    <div>
                      <div className="m-card-title">{item.name}</div>
                      <div className="m-card-sub">{item.category || (item.is_service ? t('catalog.service') : t('catalog.product'))}</div>
                    </div>
                    <span className="td-amount" style={{ fontSize:16, fontWeight:800 }}>{fmtCurrency(item.unit_price)}</span>
                  </div>
                  {item.description && <div className="m-card-row"><span className="m-card-label">{item.description}</span></div>}
                  <div className="m-card-row">
                    <span className="m-card-label">SKU</span>
                    <span className="m-card-val">{item.sku || '—'}</span>
                  </div>
                  <div className="m-card-row">
                    <span className="m-card-label">{t('catalog.tax_rate')}</span>
                    <span className="m-card-val">{item.tax_rate || 0}%</span>
                  </div>
                  <div className="m-card-actions" onClick={e => e.stopPropagation()}>
                    <button className="btn btn-sm" onClick={() => setEditing(item)}><Edit /> {t('common.edit')}</button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteItem(item.id)}><Trash /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pagination"><span>{items.length} {t('catalog.items')}</span></div>
          </>
        )}
      </div>

      {editing !== null && (
        <CatalogItemModal
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchItems(); }}
        />
      )}
      <button className="fab" onClick={() => setEditing('new')}><Plus /></button>
    </div>
  );
}

/* ── Catalog Item Modal ────────────────────────── */
function CatalogItemModal({ item, onClose, onSaved }) {
  const { t } = useTranslation();
  const isNew = !item;
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [form, setForm] = useState({
    name:        item?.name        || '',
    description: item?.description || '',
    sku:         item?.sku         || '',
    category:    item?.category    || '',
    unit_price:  item?.unit_price  || 0,
    tax_rate:    item?.tax_rate    || 15,
    is_service:  item?.is_service  ?? false,
    unit:        item?.unit        || 'pcs',
  });

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const toggleService = () => setForm(f => ({ ...f, is_service: !f.is_service }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError(t('catalog.error_name')); return; }
    setSaving(true); setError('');
    const payload = { ...form, is_service: form.is_service ? 1 : 0 };
    const res = isNew
      ? await api.post('/catalog', payload)
      : await api.put(`/catalog/${item.id}`, payload);
    setSaving(false);
    if (res.success) onSaved(); else setError(res.message || 'Error');
  };

  const UNITS = ['pcs','hr','kg','m','l','box','set','month','day'];

  return (
    <div className="modal-overlay" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth:520 }}>
        <div className="modal-header">
          <h2>{isNew ? t('catalog.new_item') : t('catalog.edit_item')}</h2>
          <button className="modal-close" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body" style={{ overflowY:'auto', maxHeight:'calc(90vh - 140px)' }}>
          {error && <div className="form-error" style={{ marginBottom:12 }}>{error}</div>}

          <div className="form-group">
            <label>{t('common.name')} *</label>
            <input value={form.name} onChange={setF('name')} placeholder={t('catalog.name_placeholder')} />
          </div>
          <div className="form-group">
            <label>{t('catalog.description')}</label>
            <textarea rows={2} value={form.description} onChange={setF('description')} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>SKU</label>
              <input value={form.sku} onChange={setF('sku')} placeholder="ABC-001" />
            </div>
            <div className="form-group">
              <label>{t('catalog.category')}</label>
              <input value={form.category} onChange={setF('category')} placeholder={t('catalog.category_placeholder')} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t('catalog.unit_price')}</label>
              <input type="number" min="0" step="0.01" value={form.unit_price} onChange={setF('unit_price')} />
            </div>
            <div className="form-group">
              <label>{t('catalog.tax_rate')} %</label>
              <input type="number" min="0" max="100" step="0.5" value={form.tax_rate} onChange={setF('tax_rate')} />
            </div>
            <div className="form-group">
              <label>{t('catalog.unit')}</label>
              <select value={form.unit} onChange={setF('unit')}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="toggle-label" style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
              <div className={`toggle-switch ${form.is_service ? 'on' : ''}`} onClick={toggleService}>
                <div className="toggle-knob" />
              </div>
              {t('catalog.is_service')} — {form.is_service ? t('catalog.service') : t('catalog.product')}
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
