import { useState, useEffect, useContext } from 'react';
import { Link, NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../../context/AuthContext.jsx';
import { LANGS, urlFor, langFromPath, pageFromPath } from './pages.js';
import './LandingPage.css';

/**
 * The chrome shared by every marketing page: nav, language switch, footer.
 *
 * The site is built inside this SPA rather than as a separate Next.js app on
 * its own port. The app already owns every path on this domain, and two things
 * here are same-origin dependencies rather than preferences: session cookies
 * are sameSite=lax, and /api/files/:id authenticates by cookie. Splitting the
 * marketing site onto its own origin would have meant either moving the API
 * with it or breaking both. Keeping it here also means /login is a route, and
 * there is no second deployment to keep in step.
 */

const NAV = [
  { path: 'features',     label: 'features' },
  { path: 'how-it-works', label: 'how' },
  { path: 'pricing',      label: 'pricing' },
  { path: 'faq',          label: 'faq' },
];

export default function LandingLayout() {
  const { t, i18n } = useTranslation();
  const { user, loading } = useContext(AuthContext);
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const lang = langFromPath(pathname);
  const page = pageFromPath(pathname);
  const other = LANGS.find(l => l !== lang);

  /**
   * On the marketing site the URL is the authority on language, not
   * localStorage — /ar/pricing has to render in Arabic for a first-time
   * visitor and for Googlebot alike, neither of whom has a stored preference.
   *
   * Gated on being signed out: a signed-in visitor is on their way to
   * /dashboard, and flipping the language of their workspace in passing is not
   * something a redirect should do.
   */
  useEffect(() => {
    if (loading || user) return;
    if ((i18n.resolvedLanguage || '').split('-')[0] !== lang) i18n.changeLanguage(lang);
  }, [lang, i18n, user, loading]);

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  // Someone already signed in has no use for the pitch.
  if (!loading && user) return <Navigate to="/dashboard" replace />;

  const navLink = ({ isActive }) => 'lp-nav-link' + (isActive ? ' is-active' : '');

  return (
    <div className="lp">
      <a href="#lp-main" className="lp-skip">{t('landing.nav.skip')}</a>

      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <Link to={urlFor(lang, '')} className="lp-brand">
            <img src="/logos/invroot-600_200-colored-logo.png" alt="Invroot" width="132" height="44" />
          </Link>

          <nav className="lp-nav-links" aria-label="Main">
            {NAV.map(n => (
              <NavLink key={n.path} to={urlFor(lang, n.path)} className={navLink}>
                {t(`landing.nav.${n.label}`)}
              </NavLink>
            ))}
          </nav>

          <div className="lp-nav-cta">
            {/* Not a toggle button: a real link to a real address, so the
                Arabic site can be shared, bookmarked and crawled. */}
            <Link to={urlFor(other, page?.path ?? '')} className="lp-lang" lang={other}
                  aria-label={t('landing.lang.label')} hrefLang={other}>
              {t('landing.lang.other')}
            </Link>
            <Link to="/login" className="lp-btn lp-btn-ghost lp-nav-signin">{t('landing.nav.signin')}</Link>
            <Link to="/signup" className="lp-btn lp-btn-gold">{t('landing.nav.start')}</Link>
            <button className="lp-burger" onClick={() => setMenuOpen(o => !o)}
                    aria-expanded={menuOpen} aria-controls="lp-menu"
                    aria-label={t(menuOpen ? 'landing.nav.close' : 'landing.nav.menu')}>
              <span /><span /><span />
            </button>
          </div>
        </div>

        {/* The nav links used to simply vanish below 900px. That was survivable
            when they were anchors to sections of one page; now they are the
            only route to four of them. */}
        {menuOpen && (
          <div className="lp-menu" id="lp-menu">
            <div className="lp-wrap">
              {NAV.map(n => (
                <NavLink key={n.path} to={urlFor(lang, n.path)} className={navLink}>
                  {t(`landing.nav.${n.label}`)}
                </NavLink>
              ))}
              <Link to="/login" className="lp-nav-link">{t('landing.nav.signin')}</Link>
            </div>
          </div>
        )}
      </header>

      <main id="lp-main"><Outlet context={{ lang }} /></main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <div className="lp-footer-brand">
            <img src="/logos/invroot-sidebar-logo-600-200-white-logo.png" alt="Invroot" width="126" height="42" />
            <p>{t('landing.footer.tagline')}</p>
          </div>
          <div className="lp-footer-cols">
            <div>
              <h5>{t('landing.footer.product')}</h5>
              <Link to={urlFor(lang, 'features')}>{t('landing.nav.features')}</Link>
              <Link to={urlFor(lang, 'how-it-works')}>{t('landing.nav.how')}</Link>
              <Link to={urlFor(lang, 'pricing')}>{t('landing.nav.pricing')}</Link>
              <Link to={urlFor(lang, 'faq')}>{t('landing.nav.faq')}</Link>
              <Link to={urlFor(lang, 'invoicing-uae')}>{t('landing.uae.crumb')}</Link>
            </div>
            <div>
              <h5>{t('landing.footer.company')}</h5>
              <a href="mailto:support@invroot.com">{t('landing.footer.contact')}</a>
              <a href="mailto:support@invroot.com?subject=Invroot%20Enterprise%20enquiry">
                {t('landing.footer.enterprise')}
              </a>
              <Link to="/login">{t('landing.nav.signin')}</Link>
            </div>
          </div>
        </div>
        <div className="lp-wrap lp-footer-base">
          <span>© {new Date().getFullYear()} Invroot. {t('landing.footer.rights')}</span>
          <a className="lp-byline" href="https://trasealla.com" target="_blank" rel="noopener">
            {t('landing.footer.byline')}
          </a>
        </div>
      </footer>
    </div>
  );
}
