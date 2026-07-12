import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useContext } from 'react';
import { AuthProvider, AuthContext } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';

// Auth pages
import LoginPage    from './pages/LoginPage.jsx';
import SignupPage   from './pages/SignupPage.jsx';

// Main pages
import Dashboard    from './pages/Dashboard.jsx';
import Clients      from './pages/Clients.jsx';
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

function ProtectedRoute({ children }) {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <div className="full-page-loader"><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user } = useContext(AuthContext);
  if (user) return <Navigate to="/dashboard" replace />;
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
          <Route path="/portal/*"       element={<ClientPortal />} />

          {/* Protected */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/"              element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"     element={<Dashboard />} />
            <Route path="/clients"       element={<Clients />} />
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
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
