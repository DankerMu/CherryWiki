import { Navigate } from 'react-router';
import { useAuth } from '../lib/auth';

export default function Home() {
  const { isAuthenticated, isAdmin, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  const firstSpace = user?.spaces?.[0];
  if (firstSpace !== undefined) {
    return <Navigate to={`/spaces/${encodeURIComponent(firstSpace.id)}/chat`} replace />;
  }

  return <h1>No spaces available</h1>;
}
