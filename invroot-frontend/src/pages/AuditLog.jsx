import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';

export default function AuditLog() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    api.get(`/audit?page=${page}&limit=50`).then(res => {
      if (res.success) setLogs(res.data);
      setLoading(false);
    });
  }, [page]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('audit.title')}</h1>
      </div>
      <div className="card">
        {loading ? <Loader fullPage /> : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('audit.when')}</th>
                  <th>{t('audit.user')}</th>
                  <th>{t('audit.action')}</th>
                  <th>{t('audit.entity')}</th>
                  <th>{t('audit.ip')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && <tr><td colSpan={5} className="empty-row">{t('common.no_data')}</td></tr>}
                {logs.map(log => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{log.created_at}</td>
                    <td>{log.user_name || log.user_email || '—'}</td>
                    <td><span className="action-badge">{log.action}</span></td>
                    <td>{log.entity}{log.entity_id ? ` #${log.entity_id}` : ''}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{log.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <div className="pagination-btns">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn btn-sm">‹</button>
            <span>{t('common.page')} {page}</span>
            <button disabled={logs.length < 50} onClick={() => setPage(p => p + 1)} className="btn btn-sm">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}
