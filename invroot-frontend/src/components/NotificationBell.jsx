import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, DollarCircle, Page, CheckCircle, WarningTriangle, InfoCircle, Check } from 'iconoir-react';
import api from '../lib/api.js';
import './NotificationBell.css';

const TYPE_ICON = {
  payment: DollarCircle,
  invoice: Page,
  success: CheckCircle,
  warning: WarningTriangle,
  info:    InfoCircle,
};

function timeAgo(dateStr, isRTL) {
  if (!dateStr) return '';
  const then = new Date(dateStr.replace(' ', 'T') + 'Z');
  const secs = Math.max(0, (Date.now() - then.getTime()) / 1000);
  const units = [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]];
  for (const [u, s] of units) {
    const v = Math.floor(secs / s);
    if (v >= 1) return isRTL ? `منذ ${v}${u}` : `${v}${u}`;
  }
  return isRTL ? 'الآن' : 'now';
}

export default function NotificationBell() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const navigate = useNavigate();
  const [open, setOpen]     = useState(false);
  const [count, setCount]   = useState(0);
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef();

  const loadCount = useCallback(() => {
    api.get('/notifications/unread-count').then(r => { if (r.success) setCount(r.count); });
  }, []);

  // Poll the unread count while mounted.
  useEffect(() => {
    loadCount();
    const id = setInterval(loadCount, 30000);
    return () => clearInterval(id);
  }, [loadCount]);

  // Close on outside click.
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      api.get('/notifications').then(r => { if (r.success) setItems(r.data); setLoading(false); });
    }
  };

  const markAllRead = async () => {
    await api.post('/notifications/read-all');
    setItems(items.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setCount(0);
  };

  const openItem = async (n) => {
    if (!n.read_at) {
      api.post(`/notifications/${n.id}/read`);
      setCount(c => Math.max(0, c - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="topbar-icon-btn" aria-label={t('notifications.title')} onClick={toggle}>
        <Bell />
        {count > 0 && <span className="notif-badge">{count > 9 ? '9+' : count}</span>}
      </button>

      {open && (
        <div className={`notif-dropdown ${isRTL ? 'rtl' : ''}`}>
          <div className="notif-head">
            <span className="notif-title">{t('notifications.title')}</span>
            {count > 0 && (
              <button className="notif-markall" onClick={markAllRead}>
                <Check width={13} height={13} /> {t('notifications.mark_all_read')}
              </button>
            )}
          </div>

          <div className="notif-list">
            {loading ? (
              <div className="notif-empty"><span className="spinner spinner-sm" /></div>
            ) : items.length === 0 ? (
              <div className="notif-empty">
                <Bell width={26} height={26} />
                <span>{t('notifications.empty')}</span>
              </div>
            ) : items.map(n => {
              const Icon = TYPE_ICON[n.type] || InfoCircle;
              return (
                <button key={n.id} className={`notif-item ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)}>
                  <span className={`notif-item-icon type-${n.type}`}><Icon /></span>
                  <span className="notif-item-body">
                    <span className="notif-item-title">{n.title}</span>
                    {n.body && <span className="notif-item-text">{n.body}</span>}
                    <span className="notif-item-time">{timeAgo(n.created_at, isRTL)}</span>
                  </span>
                  {!n.read_at && <span className="notif-unread-dot" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
