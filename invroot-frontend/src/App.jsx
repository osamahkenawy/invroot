import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useContext } from 'react';
import { AuthProvider, AuthContext } from './context/AuthContext.jsx';
import SessionGate from './components/SessionGate.jsx';
import Layout from './components/Layout.jsx';

// Auth pages
import LoginPage          from './pages/LoginPage.jsx';
import SignupPage         from './pages/SignupPage.jsx';
import VerifyEmailPage    from './pages/VerifyEmailPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage  from './pages/ResetPasswordPage.jsx';
import PayInvoicePage     from './pages/PayInvoicePage.jsx';
import ForcePasswordChangePage from './pages/ForcePasswordChangePage.jsx';

// Main pages
import Dashboard    from './pages/Dashboard.jsx';
import Clients      from './pages/Clients.jsx';
import ClientStatement from './pages/ClientStatement.jsx';
import Catalog      from './pages/Catalog.jsx';
import Invoices     from './pages/Invoices.jsx';
import Quotes       from './pages/Quotes.jsx';
import Payments     from './pages/Payments.jsx';
import Receipts     from './pages/Receipts.jsx';
import CreditNotes  from './pages/CreditNotes.jsx';
import Recurring    from './pages/Recurring.jsx';
import Tax          from './pages/Tax.jsx';
import Reports      from './pages/Reports.jsx';
import Settings     from './pages/Settings.jsx';
import Integrations from './pages/Integrations.jsx';
import AuditLog     from './pages/AuditLog.jsx';
import ClientPortal from './pages/ClientPortal/index.jsx';
import Expenses     from './pages/Expenses.jsx';
import Banking      from './pages/Banking.jsx';
import TimeTracking from './pages/TimeTracking.jsx';
import Reminders    from './pages/Reminders.jsx';

// Super Admin
import SuperAdminLogin  from './pages/SuperAdmin/SuperAdminLogin.jsx';
import SuperAdminLayout from './pages/SuperAdmin/SuperAdminLayout.jsx';
import SADashboard      from './pages/SuperAdmin/SADashboard.jsx';
import SATenants        from './pages/SuperAdmin/SATenants.jsx';
import SATenantDetail   from './pages/SuperAdmin/SATenantDetail.jsx';
import SAInvoices       from './pages/SuperAdmin/SAInvoices.jsx';
import SAPayments       from './pages/SuperAdmin/SAPayments.jsx';
import SAUsers          from './pages/SuperAdmin/SAUsers.jsx';
import SAAnalytics      from './pages/SuperAdmin/SAAnalytics.jsx';
import SACoupons       from './pages/SuperAdmin/SACoupons.jsx';

function SuperAdminRoute({ children }) {
  const token = localStorage.getItem('sa_token');
  if (!token) return <Navigate to="/admin/login" replace />;
  return children;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div className="full-page-loader"><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  // Accounts created by a platform admin start on a temporary password and
  // can't reach the app until they've chosen their own.
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user } = useContext(AuthContext);
  if (user?.must_change_password) return <Navigate to="/change-password" replace />;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

/* Only reachable while the temporary-password flag is set. */
function FirstLoginRoute({ children }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div className="full-page-loader"><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.must_change_password) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login"          element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/signup"         element={<PublicRoute><SignupPage /></PublicRoute>} />
          <Route path="/verify-email"   element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />
          <Route path="/pay/:token"      element={<PayInvoicePage />} />
          <Route path="/change-password" element={<FirstLoginRoute><ForcePasswordChangePage /></FirstLoginRoute>} />
          <Route path="/portal/*"       element={<ClientPortal />} />

          {/* Protected */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/"              element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"     element={<Dashboard />} />
            <Route path="/clients"       element={<Clients />} />
            <Route path="/clients/:id/statement" element={<ClientStatement />} />
            <Route path="/catalog"       element={<Catalog />} />
            <Route path="/invoices"      element={<Invoices />} />
            <Route path="/invoices/:id"  element={<Invoices />} />
            <Route path="/quotes"        element={<Quotes />} />
            <Route path="/payments"      element={<Payments />} />
            <Route path="/receipts"      element={<Receipts />} />
            <Route path="/credit-notes"  element={<CreditNotes />} />
            <Route path="/recurring"     element={<Recurring />} />
            <Route path="/tax"           element={<Tax />} />
            <Route path="/reports"       element={<Reports />} />
            <Route path="/settings/*"    element={<Settings />} />
            <Route path="/integrations"  element={<Integrations />} />
            <Route path="/audit"         element={<AuditLog />} />
            <Route path="/expenses"      element={<Expenses />} />
            <Route path="/banking"       element={<Banking />} />
            <Route path="/time-tracking" element={<TimeTracking />} />
            <Route path="/reminders"     element={<Reminders />} />
          </Route>

          {/* Super Admin */}
          <Route path="/admin/login" element={<SuperAdminLogin />} />
          <Route path="/admin" element={<SuperAdminRoute><SuperAdminLayout /></SuperAdminRoute>}>
            <Route index element={<SADashboard />} />
            <Route path="tenants"         element={<SATenants />} />
            <Route path="tenants/:id"     element={<SATenantDetail />} />
            <Route path="invoices"        element={<SAInvoices />} />
            <Route path="payments"        element={<SAPayments />} />
            <Route path="users"           element={<SAUsers />} />
            <Route path="analytics"       element={<SAAnalytics />} />
            <Route path="coupons"         element={<SACoupons />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        {/* Outside <Routes> on purpose: it overlays whatever is rendered
            rather than replacing it, so an expired session doesn't discard
            the page the person was working on. */}
        <SessionGate />
      </BrowserRouter>
    </AuthProvider>
  );
}
