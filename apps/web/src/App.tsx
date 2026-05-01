import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import AdminGuard from './components/AdminGuard';
import AdminLayout from './components/AdminLayout';
import { AuthProvider } from './lib/auth';
import AuditPage from './pages/admin/AuditPage';
import GroupsPage from './pages/admin/GroupsPage';
import HealthPage from './pages/admin/HealthPage';
import JobDetailPage from './pages/admin/JobDetailPage';
import JobsPage from './pages/admin/JobsPage';
import ModelsPage from './pages/admin/ModelsPage';
import SpacesPage from './pages/admin/SpacesPage';
import UsersPage from './pages/admin/UsersPage';
import Chat from './pages/Chat';
import Home from './pages/Home';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Wiki from './pages/Wiki';
import UploadCenter from './pages/uploads/UploadCenter';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/chat/:id" element={<Chat />} />
      <Route path="/wiki/:spaceId" element={<Wiki />} />
      <Route path="/wiki/:spaceId/:pageId" element={<Wiki />} />
      <Route path="/spaces/:spaceId/uploads" element={<UploadCenter />} />
      <Route
        path="/admin"
        element={
          <AdminGuard>
            <AdminLayout />
          </AdminGuard>
        }
      >
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="spaces" element={<SpacesPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="jobs/:jobId" element={<JobDetailPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
