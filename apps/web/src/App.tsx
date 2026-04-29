import { BrowserRouter, Route, Routes } from 'react-router';
import Admin from './pages/Admin';
import Chat from './pages/Chat';
import Home from './pages/Home';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Wiki from './pages/Wiki';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/chat/:id" element={<Chat />} />
      <Route path="/wiki/:spaceId" element={<Wiki />} />
      <Route path="/wiki/:spaceId/:pageId" element={<Wiki />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/admin/users" element={<Admin />} />
      <Route path="/admin/spaces" element={<Admin />} />
      <Route path="/admin/models" element={<Admin />} />
      <Route path="/admin/jobs" element={<Admin />} />
      <Route path="/admin/audit" element={<Admin />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
