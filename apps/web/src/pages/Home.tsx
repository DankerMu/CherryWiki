import { Navigate } from 'react-router';
import { useAuth } from '../lib/auth';

export default function Home() {
  const { isAuthenticated, isAdmin } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return <Navigate to="/chat" replace />;
}
