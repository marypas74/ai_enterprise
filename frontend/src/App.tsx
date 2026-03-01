import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { useAuthStore } from './hooks/useAuthStore';
import { useIdleTimeout } from './hooks/useIdleTimeout';

// Lazy-loaded pages — only loaded when the route is visited
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const AutoClaudePage = lazy(() => import('./pages/AutoClaudePage'));
const ParlantPage = lazy(() => import('./pages/ParlantPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PublicMonitorPage = lazy(() => import('./pages/PublicMonitorPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage'));
const AITransparencyPage = lazy(() => import('./pages/AITransparencyPage'));

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
    </div>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (user?.role !== 'admin') return <Navigate to="/" />;
  return <>{children}</>;
}

export default function App() {
  // Auto-logout after 20 minutes of inactivity
  useIdleTimeout();

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/metrics" element={<PublicMonitorPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsOfServicePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <ChatPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/projects"
            element={
              <PrivateRoute>
                <ProjectsPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/auto-claude"
            element={
              <PrivateRoute>
                <AutoClaudePage />
              </PrivateRoute>
            }
          />
          <Route
            path="/parlant"
            element={
              <PrivateRoute>
                <ParlantPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <PrivateRoute>
                <SettingsPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/transparency"
            element={
              <PrivateRoute>
                <AITransparencyPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/admin/*"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
    </div>
  );
}
