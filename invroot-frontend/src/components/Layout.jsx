import { useState, useContext, useEffect } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import UserAvatar from './UserAvatar.jsx';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext.jsx';
import NotificationBell from './NotificationBell.jsx';
import {
  HomeSimple, User, Page, Dollar, DollarCircle, StatsUpSquare,
  Settings, Network, Bell, Menu, LogOut, RefreshDouble,
  Archive, Percentage, List, Book, WarningTriangle, ShieldCheck, PrintingPage,
  Coins, Bank, Clock
} from 'iconoir-react';
import './Layout.css';

const iconMap = {
  dashboard:    HomeSimple,
  clients:      User,
  catalog:      Archive,
  invoices:     Page,
  quotes:       Book,
  payments:     DollarCircle,
  receipts:     PrintingPage,
  'credit-notes': RefreshDouble,
  recurring:    RefreshDouble,
  tax:          Percentage,
  reports:      StatsUpSquare,
  settings:     Settings,
  integrations: Network,
  audit:        ShieldCheck,
  expenses:     Coins,
  banking:      Bank,
  'time-tracking': Clock,
  reminders:    Bell,
};

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { user, tenant, logout } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobilOpen, setMobileOpen] = useState(false);
  const isRTL = i18n.language === 'ar';

  const navSections = [
    {
      titleKey: 'nav_sections.main',
      items: [
        { path: '/dashboard', labelKey: 'nav.dashboard', iconKey: 'dashboard' },
      ],
    },
    {
      titleKey: 'nav_sections.billing',
      items: [
        { path: '/invoices',     labelKey: 'nav.invoices',     iconKey: 'invoices' },
        { path: '/quotes',       labelKey: 'nav.quotes',       iconKey: 'quotes' },
        { path: '/recurring',    labelKey: 'nav.recurring',    iconKey: 'recurring' },
        { path: '/credit-notes', labelKey: 'nav.credit_notes', iconKey: 'credit-notes' },
        { path: '/reminders',    labelKey: 'nav.reminders',    iconKey: 'reminders' },
      ],
    },
    {
      titleKey: 'nav_sections.finance',
      items: [
        { path: '/payments',       labelKey: 'nav.payments',       iconKey: 'payments' },
        { path: '/receipts',       labelKey: 'nav.receipts',       iconKey: 'receipts' },
        { path: '/expenses',       labelKey: 'nav.expenses',       iconKey: 'expenses' },
        { path: '/banking',        labelKey: 'nav.banking',        iconKey: 'banking' },
        { path: '/tax',            labelKey: 'nav.tax',            iconKey: 'tax' },
        { path: '/reports',        labelKey: 'nav.reports',        iconKey: 'reports' },
      ],
    },
    {
      titleKey: 'nav_sections.management',
      items: [
        { path: '/clients',       labelKey: 'nav.clients',       iconKey: 'clients' },
        { path: '/catalog',       labelKey: 'nav.catalog',       iconKey: 'catalog' },
        { path: '/time-tracking', labelKey: 'nav.time_tracking', iconKey: 'time-tracking' },
      ],
    },
    {
      titleKey: 'nav_sections.system',
      items: [
        { path: '/integrations', labelKey: 'nav.integrations', iconKey: 'integrations' },
        { path: '/settings',     labelKey: 'nav.settings',     iconKey: 'settings' },
        { path: '/audit',        labelKey: 'nav.audit',        iconKey: 'audit' },
      ],
    },
  ];

  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const changeLang = (lng) => {
    if (i18n.language !== lng) i18n.changeLanguage(lng);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isActive = (path) => location.pathname.startsWith(path);

  const allItems = navSections.flatMap(s => s.items);
  const currentItem = allItems.find(i => isActive(i.path));
  const pageTitle = currentItem ? t(currentItem.labelKey) : 'INVROOT';

  return (
    <div className={`layout-root ${isRTL ? 'rtl' : 'ltr'} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar */}
      <aside className={`sidebar ${mobilOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="brand">
            {/* Always the INVROOT mark — the sidebar is product chrome, not a
                white-label surface. A tenant's own logo appears on their
                invoices/quotes and PDFs, not here.
                Collapsed rail is only 76px wide, so show the icon alone. */}
            <img
              src={collapsed ? '/logos/invroot-icon-white-2000-2000.png' : '/logos/invroot-sidebar-logo-600-200-white-logo.png'}
              alt="INVROOT"
              className={collapsed ? 'brand-icon' : 'brand-logo'}
            />
          </div>
          <button className="collapse-btn" onClick={() => setCollapsed(c => !c)} aria-label={t('common.toggle_sidebar')}>
            <Menu />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navSections.map(section => (
            <div key={section.titleKey} className="nav-section">
              {!collapsed && <span className="nav-section-title">{t(section.titleKey)}</span>}
              {section.items.map(item => {
                const Icon = iconMap[item.iconKey] || HomeSimple;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon className="nav-icon" />
                    {!collapsed && <span className="nav-label">{t(item.labelKey)}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item logout-btn" onClick={handleLogout}>
            <LogOut className="nav-icon" />
            {!collapsed && <span>{t('nav.logout')}</span>}
          </button>
        </div>
      </aside>

      {mobilOpen && <div className="mobile-overlay" onClick={() => setMobileOpen(false)} />}

      {/* Main content */}
      <div className="layout-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-btn" onClick={() => setMobileOpen(o => !o)}>
              <Menu />
            </button>
            <div className="topbar-title">
              <h1>{pageTitle}</h1>
            </div>
          </div>

          <div className="topbar-right">
            <div className="lang-switch" role="group" aria-label={t('common.language')}>
              <button
                className={`lang-opt ${i18n.language === 'en' ? 'active' : ''}`}
                onClick={() => changeLang('en')}
              >EN</button>
              <button
                className={`lang-opt ${i18n.language === 'ar' ? 'active' : ''}`}
                onClick={() => changeLang('ar')}
              >ع</button>
            </div>

            <NotificationBell />

            <div className="topbar-divider" />

            <div className="user-menu">
              <button className="user-trigger" onClick={() => setUserMenuOpen(o => !o)}>
                <div className="user-info">
                  <span className="user-name">{user?.full_name || user?.email}</span>
                  <span className="user-role">{tenant?.name || user?.role}</span>
                </div>
                {/* avatar_url arrives ready to render — a signed S3 URL, or the
                    cookie-authed /api/files route. Prefixing /uploads/ onto it
                    (as this used to) produces a broken image. */}
                <UserAvatar user={user} size={42} style={{ borderRadius: 12 }} />
              </button>
              {userMenuOpen && (
                <>
                  <div className="user-menu-backdrop" onClick={() => setUserMenuOpen(false)} />
                  <div className="user-dropdown">
                    <div className="user-dropdown-head">
                      <UserAvatar user={user} size={48} style={{ borderRadius: 14 }} />
                      <div>
                        <div className="ud-name">{user?.full_name || user?.email}</div>
                        <div className="ud-email">{user?.email}</div>
                      </div>
                    </div>
                    <Link to="/settings" className="user-dropdown-item" onClick={() => setUserMenuOpen(false)}>
                      <Settings className="ud-icon" /> {t('nav.settings')}
                    </Link>
                    <button className="user-dropdown-item danger" onClick={handleLogout}>
                      <LogOut className="ud-icon" /> {t('nav.logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
