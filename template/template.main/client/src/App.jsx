import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './app/AuthContext';
import { ThemeConfig } from './theme/ThemeConfig';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MainLayout } from './layouts/MainLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Users } from './pages/Users';
import { AuditLogs } from './pages/AuditLogs';
import { Profile } from './pages/Profile';
import { Authors } from './pages/Authors';
import { Products } from './pages/Products';
import { Categories } from './pages/Categories';
import { Outlets } from './pages/Outlets';
import { OutletTypes } from './pages/OutletTypes';
import { Invoices } from './pages/Invoices';
import { Payments } from './pages/Payments';
import { Inventory } from './pages/Inventory';
import { Shipments } from './pages/Shipments';
import { Reports } from './pages/Reports';
import { Exports } from './pages/Exports';
import { Finance } from './pages/Finance';
import { Returns } from './pages/Returns';
import { Notifications } from './pages/Notifications';
import { Backups } from './pages/Backups';
import { Box, Typography, Paper, Button } from '@mui/material';
import { LoadingState } from './components/LoadingState';
import './styles/App.css';

// Guard for routes that require authentication
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <Box className="route-loading">
        <LoadingState type="skeleton" />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

const AccessDenied = () => (
  <Paper sx={{ p: 5, mx: 'auto', mt: 6, maxWidth: 620, textAlign: 'center' }}>
    <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'error.main', mb: 2 }}>
      غير مسموح بالوصول
    </Typography>
    <Typography variant="body1" sx={{ color: 'text.secondary', mb: 3 }}>
      لا يملك حسابك الصلاحية المطلوبة لعرض هذه الصفحة.
    </Typography>
    <Button component="a" href="/" variant="contained">
      العودة إلى لوحة التحكم
    </Button>
  </Paper>
);

// Route-level permission checks complement the API authorization and protect
// direct links/deep-links that are not rendered in the navigation menu.
const PermissionRoute = ({ permission, anyOf, children }) => {
  const { hasPermission } = useAuth();
  const permissions = anyOf || (permission ? [permission] : []);

  if (permissions.length > 0 && !permissions.some(hasPermission)) {
    return <AccessDenied />;
  }

  return children;
};

// Guard for guest-only pages (e.g. Login)
const GuestRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <Box className="route-loading">
        <LoadingState type="spinner" />
      </Box>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
};

// Simple placeholder page for routes implemented in future steps
const PlaceholderPage = ({ title }) => (
  <Paper sx={{ p: 4, textAlign: 'center' }}>
    <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 2, color: 'primary.main' }}>
      {title}
    </Typography>
    <Typography variant="body1" sx={{ color: 'text.secondary' }}>
      هذه الصفحة قيد التطوير وسيتم تفعيلها في خطوة العمل القادمة.
    </Typography>
  </Paper>
);

export function App() {
  return (
    <ErrorBoundary>
      <ThemeConfig>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Guest Route */}
              <Route
                path="/login"
                element={
                  <GuestRoute>
                    <Login />
                  </GuestRoute>
                }
              />

              {/* Protected Routes */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <MainLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Dashboard />} />
                <Route path="profile" element={<Profile />} />
                <Route path="users" element={<PermissionRoute permission="users.view"><Users /></PermissionRoute>} />
                <Route path="outlet-types" element={<PermissionRoute permission="outlet_types.view"><OutletTypes /></PermissionRoute>} />
                <Route path="outlets" element={<PermissionRoute permission="outlets.view"><Outlets /></PermissionRoute>} />
                <Route path="authors" element={<PermissionRoute permission="authors.view"><Authors /></PermissionRoute>} />
                <Route path="products" element={<PermissionRoute permission="products.view"><Products /></PermissionRoute>} />
                <Route path="categories" element={<PermissionRoute permission="categories.view"><Categories /></PermissionRoute>} />
                <Route path="inventory" element={<PermissionRoute permission="inventory.view"><Inventory /></PermissionRoute>} />
                <Route path="invoices" element={<PermissionRoute permission="invoices.view"><Invoices /></PermissionRoute>} />
                <Route path="returns" element={<PermissionRoute permission="returns.view"><Returns /></PermissionRoute>} />
                <Route path="payments" element={<PermissionRoute permission="payments.view"><Payments /></PermissionRoute>} />
                <Route path="finance" element={<PermissionRoute permission="finance.view"><Finance /></PermissionRoute>} />
                <Route path="shipments" element={<PermissionRoute permission="shipments.view"><Shipments /></PermissionRoute>} />
                <Route path="reports" element={<PermissionRoute permission="reports.view"><Reports /></PermissionRoute>} />
                <Route path="exports" element={<PermissionRoute permission="exports.run"><Exports /></PermissionRoute>} />
                <Route path="backups" element={<PermissionRoute anyOf={['backup.view', 'backup.create']}><Backups /></PermissionRoute>} />
                <Route path="audit" element={<PermissionRoute permission="audit.view"><AuditLogs /></PermissionRoute>} />
                <Route path="notifications" element={<PermissionRoute permission="notifications.view"><Notifications /></PermissionRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeConfig>
    </ErrorBoundary>
  );
}

export default App;
