import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { lazy, Suspense } from 'react';
import AppShell from './components/AppShell';
import { AuthProvider, useAuth } from './lib/auth';
import AuditPage from './pages/admin/AuditPage';
import GraphifyPage from './pages/admin/GraphifyPage';
import GroupsPage from './pages/admin/GroupsPage';
import HealthPage from './pages/admin/HealthPage';
import JobDetailPage from './pages/admin/JobDetailPage';
import JobsPage from './pages/admin/JobsPage';
import ModelsPage from './pages/admin/ModelsPage';
import SpacesPage from './pages/admin/SpacesPage';
import UsersPage from './pages/admin/UsersPage';
import Chat from './pages/Chat';
import GraphifyRunDetailPage from './pages/GraphifyRunDetailPage';
import GraphifyRunsPage from './pages/GraphifyRunsPage';
import Home from './pages/Home';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Wiki from './pages/Wiki';
import UploadCenter from './pages/uploads/UploadCenter';
import { ThemeProvider } from './theme/ThemeProvider';

const SpaceGraphExplorerPage = lazy(() => import('./pages/graph/SpaceGraphExplorerPage'));

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/spaces/:spaceId/chat" element={<Chat />} />
        <Route path="/spaces/:spaceId/wiki" element={<Wiki />} />
        <Route path="/spaces/:spaceId/wiki/:pageId" element={<Wiki />} />
        <Route path="/spaces/:spaceId/wiki/:pageId/history" element={<Wiki />} />
        <Route
          path="/spaces/:spaceId/graph"
          element={(
            <Suspense fallback={null}>
              <SpaceGraphExplorerPage />
            </Suspense>
          )}
        />
        <Route path="/spaces/:spaceId/graphify" element={<GraphifyRunsPage />} />
        <Route path="/spaces/:spaceId/graphify/:runId" element={<GraphifyRunDetailPage />} />
        <Route path="/spaces/:spaceId/uploads" element={<UploadCenter />} />
        <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/groups" element={<GroupsPage />} />
        <Route path="/admin/spaces" element={<SpacesPage />} />
        <Route path="/admin/models" element={<ModelsPage />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="/admin/health" element={<HealthPage />} />
        <Route path="/admin/jobs" element={<JobsPage />} />
        <Route path="/admin/jobs/:jobId" element={<JobDetailPage />} />
        <Route path="/admin/graphify" element={<GraphifyPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function ProtectedShell() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <AppShell />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <AppRoutes />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
