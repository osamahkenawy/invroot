import { useState, useEffect } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

const NAV = [
  { path: '/admin',            label: 'Overview',   icon: '📊' },
  { path: '/admin/tenants',    label: 'Tenants',    icon: '🏢' },
  { path: '/admin/invoices',   label: 'Invoices',   icon: '📄' },
  { path: '/admin/payments',   label: 'Payments',   icon: '💳' },
  { path: '/admin/users',      label: 'Users',      icon: '👥' },
  { path: '/admin/analytics',  label: 'Analytics',  icon: '📈' },
];

export default function SuperAdminLayout() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const [me, setMe] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    saApi.get('/me').then(r => {
      if (!r.success) { localStorage.removeItem('sa_token'); navigate('/admin/login'); }
      else setMe(r.data);
    });
  }, [navigate]);

  const logout = () => { localStorage.removeItem('sa_token'); navigate('/admin/login'); };

  const isActive = (path) =>
    path === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(path);

  if (!me) return <div className="sa-loading">Loading...</div>;

  return (
    <div className={`sa-layout ${collapsed ? 'sa-collapsed' : ''}`}>
      {/* ── Sidebar ── */}
      <aside className="sa-sidebar">
        <div className="sa-sidebar-header">
          {!collapsed && (
            <div className="sa-brand">
              <span className="sa-brand-icon">⚡</span>
              <div>
                <div className="sa-brand-name">Invroot</div>
                <div className="sa-brand-role">Super Admin</div>
              </div>
            </div>
          )}
          <button className="sa-collapse-btn" onClick={() => setCollapsed(c => !c)}>
            {collapsed ? '→' : '←'}
          </button>
        </div>

        <nav className="sa-nav">
          {NAV.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`sa-nav-item ${isActive(item.path) ? 'active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="sa-nav-icon">{item.icon}</span>
              {!collapsed && <span className="sa-nav-label">{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="sa-sidebar-footer">
          {!collapsed && (
            <div className="sa-user-info">
              <div className="sa-user-avatar">{(me.full_name || 'SA')[0].toUpperCase()}</div>
              <div>
                <div className="sa-user-name">{me.full_name || 'Super Admin'}</div>
                <div className="sa-user-email">{me.email}</div>
              </div>
            </div>
          )}
          <button className="sa-logout-btn" onClick={logout} title="Logout">
            <span>🚪</span>
            {!collapsed && <span>Logout</span>}
          </button>
          <a href="/" className="sa-back-app" title="Back to App">
            <span>↩</span>
            {!collapsed && <span>Back to App</span>}
          </a>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="sa-main">
        <Outlet />
      </main>
    </div>
  );
}
