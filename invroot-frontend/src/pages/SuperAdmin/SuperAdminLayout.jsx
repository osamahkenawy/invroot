import { useState, useEffect } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import saApi from '../../lib/saApi.js';
import './SuperAdminLayout.css';

/* ── SVG Icons ── */
const Ico = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  ),
  tenants: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 22h18"/><path d="M5 22V7l7-4 7 4v15"/><path d="M9 22v-5h6v5"/>
    </svg>
  ),
  invoices: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  ),
  payments: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  coupons: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6z"/>
      <line x1="13" y1="9" x2="13" y2="15"/>
    </svg>
  ),
  brand: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6"/>
    </svg>
  ),
};

const NAV = [
  { path: '/admin',           label: 'Overview',  iconKey: 'overview'  },
  { path: '/admin/tenants',   label: 'Tenants',   iconKey: 'tenants'   },
  { path: '/admin/invoices',  label: 'Invoices',  iconKey: 'invoices'  },
  { path: '/admin/payments',  label: 'Payments',  iconKey: 'payments'  },
  { path: '/admin/users',     label: 'Users',     iconKey: 'users'     },
  { path: '/admin/analytics', label: 'Analytics', iconKey: 'analytics' },
  { path: '/admin/coupons',   label: 'Promo Codes', iconKey: 'coupons'   },
];

const PAGE_TITLES = {
  '/admin':            'Platform Overview',
  '/admin/tenants':    'Tenants',
  '/admin/invoices':   'Invoices',
  '/admin/payments':   'Payments',
  '/admin/users':      'Users',
  '/admin/analytics':  'Analytics',
};

function getPageTitle(pathname) {
  if (pathname.match(/^\/admin\/tenants\/\d+/)) return 'Tenant Detail';
  return PAGE_TITLES[pathname] || 'Admin Panel';
}

function getTodayStr() {
  return new Date().toLocaleDateString('en-US', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
}

export default function SuperAdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [me, setMe]             = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    saApi.get('/me').then(r => {
      if (!r.success) { localStorage.removeItem('sa_token'); navigate('/admin/login'); }
      else setMe(r.data);
    });
  }, [navigate]);

  const logout = () => { localStorage.removeItem('sa_token'); navigate('/admin/login'); };

  const isActive = (path) =>
    path === '/admin'
      ? location.pathname === '/admin'
      : location.pathname.startsWith(path);

  if (!me) return <div className="sa-loading">Authenticating…</div>;

  const pageTitle = getPageTitle(location.pathname);
  const initials  = (me.full_name || 'SA').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className={`sa-layout ${collapsed ? 'sa-collapsed' : ''}`}>
      {/* ── Sidebar ── */}
      <aside className="sa-sidebar">
        <div className="sa-sidebar-header">
          {!collapsed && (
            <div className="sa-brand">
              <div className="sa-brand-mark sa-brand-mark-logo">
                <img src="/logos/invroot-icon-white-2000-2000.png" alt="" />
              </div>
              <div>
                <div className="sa-brand-name">Invroot</div>
                <div className="sa-brand-operator">by Trasealla Solutions</div>
                <span className="sa-brand-pill">Super Admin</span>
              </div>
            </div>
          )}
          {collapsed && <div className="sa-brand-mark" style={{ margin: '0 auto' }}>{Ico.brand}</div>}
          <button className="sa-collapse-btn" onClick={() => setCollapsed(c => !c)}>
            {collapsed ? '›' : '‹'}
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
              <span className="sa-nav-icon">{Ico[item.iconKey]}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="sa-sidebar-footer">
          {!collapsed && (
            <div className="sa-user-card">
              <div className="sa-user-avatar">{initials}</div>
              <div>
                <div className="sa-user-name">{me.full_name || 'Super Admin'}</div>
                <div className="sa-user-email">{me.email}</div>
              </div>
            </div>
          )}
          <button className="sa-sidebar-btn danger" onClick={logout} title="Logout">
            <span className="sa-nav-icon">{Ico.logout}</span>
            {!collapsed && <span>Logout</span>}
          </button>
          <a href="/" className="sa-sidebar-btn" title="Back to App">
            <span className="sa-nav-icon">{Ico.back}</span>
            {!collapsed && <span>Back to App</span>}
          </a>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="sa-main-area">
        {/* Sticky topbar */}
        <header className="sa-topbar">
          <div className="sa-topbar-left">
            <span className="sa-topbar-page">{pageTitle}</span>
            <span className="sa-topbar-divider" />
            <span className="sa-topbar-breadcrumb">Platform Administration</span>
          </div>
          <div className="sa-topbar-right">
            <div className="sa-topbar-badge">
              <span className="sa-live-dot" />
              Live
            </div>
            <span className="sa-topbar-date">{getTodayStr()}</span>
            <div className="sa-topbar-user">
              <div className="sa-topbar-avatar">{initials}</div>
              <span style={{ fontWeight: 600, color: '#0D1B2A' }}>{me.full_name?.split(' ')[0]}</span>
            </div>
          </div>
        </header>

        <main className="sa-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
