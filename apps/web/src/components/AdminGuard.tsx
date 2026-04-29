import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';

export default function AdminGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, isAdmin, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!isAdmin) {
    return (
      <main className="forbidden-page">
        <section className="forbidden-panel">
          <p className="eyebrow">403</p>
          <h1>Access denied</h1>
          <p>
            {user?.email ?? 'This user'} does not have the Admin or Owner role required to use the
            admin console.
          </p>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
