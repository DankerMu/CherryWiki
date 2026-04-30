import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';
import { formatLabel } from './adminUi';

const NAV_ITEMS = [
  { label: 'Users', to: '/admin/users' },
  { label: 'Groups', to: '/admin/groups' },
  { label: 'Spaces', to: '/admin/spaces' },
  { label: 'Models', to: '/admin/models' },
  { label: 'Audit Logs', to: '/admin/audit' },
  { label: 'Task Center', to: '/admin/jobs' },
  { label: 'System Health', to: '/admin/health' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-brand">
          <span className="admin-brand-mark">C</span>
          <div>
            <strong>CherryWiki</strong>
            <span>Admin Console</span>
          </div>
        </div>
        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'admin-nav-link active' : 'admin-nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">Workspace Operations</span>
            <strong>Administrative control plane</strong>
          </div>
          <div className="admin-user-block">
            <div>
              <strong>{user?.name ?? user?.email}</strong>
              <span>{formatLabel(user?.role ?? 'unknown')}</span>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                void logout();
              }}
            >
              Logout
            </button>
          </div>
        </header>
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
