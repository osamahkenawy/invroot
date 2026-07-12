import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { Plus, Trash } from 'iconoir-react';

export default function Integrations() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('webhooks');
  const [webhooks, setWebhooks] = useState([]);
  const [apiKeys,  setApiKeys]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [newKey, setNewKey]     = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([api.get('/integrations/webhooks'), api.get('/integrations/api-keys')]).then(([w, k]) => {
      if (w.success) setWebhooks(w.data);
      if (k.success) setApiKeys(k.data);
      setLoading(false);
    });
  }, []);

  const createKey = async () => {
    const name = prompt('API Key name:');
    if (!name) return;
    const res = await api.post('/integrations/api-keys', { name, scope: ['read', 'write'] });
    if (res.success) { setNewKey(res.key); setApiKeys(k => [...k, { id: res.id, name }]); }
  };

  const deleteKey = async (id) => {
    if (confirm(t('common.confirm'))) { await api.delete(`/integrations/api-keys/${id}`); setApiKeys(k => k.filter(x => x.id !== id)); }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('integrations.title')}</h1>
      </div>
      <div className="tabs">
        {['webhooks', 'api-keys'].map(t_ => (
          <button key={t_} className={`tab-btn ${tab === t_ ? 'active' : ''}`} onClick={() => setTab(t_)}>
            {t_ === 'webhooks' ? t('integrations.webhooks') : t('integrations.api_keys')}
          </button>
        ))}
      </div>

      {loading ? <Loader fullPage /> : (
        <div className="card" style={{ marginTop: 16 }}>
          {tab === 'api-keys' && (
            <>
              <div className="card-toolbar">
                <button className="btn btn-primary" onClick={createKey}><Plus /> {t('common.add')}</button>
              </div>
              {newKey && <div className="alert alert-success" style={{ wordBreak: 'break-all' }}>{t('integrations.key_generated')}<br /><strong>{newKey}</strong></div>}
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>Name</th><th>Created</th><th>Last Used</th><th></th></tr></thead>
                  <tbody>
                    {apiKeys.length === 0 && <tr><td colSpan={4} className="empty-row">{t('common.no_data')}</td></tr>}
                    {apiKeys.map(k => (
                      <tr key={k.id}>
                        <td>{k.name}</td>
                        <td>{k.created_at}</td>
                        <td>{k.last_used_at || '—'}</td>
                        <td><button className="icon-btn danger" onClick={() => deleteKey(k.id)}><Trash /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'webhooks' && (
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>URL</th><th>Events</th><th>Status</th></tr></thead>
                <tbody>
                  {webhooks.length === 0 && <tr><td colSpan={3} className="empty-row">{t('common.no_data')}</td></tr>}
                  {webhooks.map(w => (
                    <tr key={w.id}>
                      <td className="td-mono" style={{ wordBreak:'break-all' }}>{w.url}</td>
                      <td style={{ fontSize: 12 }}>{(Array.isArray(w.events) ? w.events : JSON.parse(w.events || '[]')).join(', ')}</td>
                      <td><span className={`status-badge status-${w.is_active ? 'active' : 'inactive'}`}>{w.is_active ? 'Active' : 'Inactive'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
