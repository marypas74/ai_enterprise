import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './hooks/useAuthStore';
import LoginPage from './pages/LoginPage';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import ProjectsPage from './pages/ProjectsPage';
import AutoClaudePage from './pages/AutoClaudePage';
import ParlantPage from './pages/ParlantPage';

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
  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Routes>
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
          path="/admin/*"
          element={
            <AdminRoute>
              <AdminPage />
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </div>
  );
}
