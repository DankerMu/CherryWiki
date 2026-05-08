import type { ComponentType } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../lib/auth';

export function requireAdminPage<TProps extends object>(Page: ComponentType<TProps>): ComponentType<TProps> {
  function AdminPageWithRoleCheck(props: TProps) {
    const { isAdmin } = useAuth();

    if (!isAdmin) {
      return <Navigate to="/" replace />;
    }

    return <Page {...props} />;
  }

  AdminPageWithRoleCheck.displayName = `RequireAdmin(${Page.displayName ?? Page.name ?? 'Page'})`;

  return AdminPageWithRoleCheck;
}
