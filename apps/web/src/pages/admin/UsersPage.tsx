import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  formatDate,
  getErrorMessage,
  parseIdList,
} from '../../components/adminUi';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import { ROLE_OPTIONS, type AdminUser } from '../../lib/adminTypes';

type CreateUserForm = {
  email: string;
  name: string;
  password: string;
  role: string;
  groups: string;
};

type EditUserForm = {
  id: string;
  display_name: string;
  role: string;
};

const EMPTY_CREATE_FORM: CreateUserForm = {
  email: '',
  name: '',
  password: '',
  role: 'viewer',
  groups: '',
};

function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateUserForm>(EMPTY_CREATE_FORM);
  const [editForm, setEditForm] = useState<EditUserForm | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await api.get<AdminUser[]>('/admin/users', {
        search: deferredSearch,
        role,
        status,
        sort: 'email',
        per_page: 100,
      });
      setUsers(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [deferredSearch, role, status]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const visibleUsers = useMemo(() => users, [users]);

  async function submitCreateUser(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsCreating(true);
    setError(null);

    try {
      await api.post<AdminUser>('/admin/users', {
        email: createForm.email,
        name: createForm.name,
        password: createForm.password,
        role: createForm.role,
        groups: parseIdList(createForm.groups),
      });
      setCreateForm(EMPTY_CREATE_FORM);
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function submitEditUser(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editForm === null) {
      return;
    }

    setError(null);
    try {
      await api.patch<AdminUser>(`/admin/users/${editForm.id}`, {
        display_name: editForm.display_name,
        role: editForm.role,
      });
      setEditForm(null);
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function toggleStatus(user: AdminUser): Promise<void> {
    setError(null);
    try {
      await api.patch<AdminUser>(`/admin/users/${user.id}`, {
        status: user.status === 'disabled' ? 'active' : 'disabled',
      });
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage accounts, roles, group membership, and account status."
        actions={
          <button className="button button-primary" type="button" onClick={() => setCreateForm({ ...EMPTY_CREATE_FORM })}>
            Create User
          </button>
        }
      />

      <ErrorBanner error={error} />

      <section className="toolbar" aria-label="User filters">
        <label>
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Email or name"
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">All roles</option>
            {ROLE_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
      </section>

      {isLoading ? (
        <LoadingState />
      ) : visibleUsers.length === 0 ? (
        <EmptyState label="No users match the current filters." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Groups</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <code>{user.email}</code>
                  </td>
                  <td>{user.name}</td>
                  <td>{user.role}</td>
                  <td>
                    <StatusBadge status={user.status} />
                  </td>
                  <td>{user.groups.length > 0 ? user.groups.join(', ') : 'None'}</td>
                  <td>{formatDate(user.last_login_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() =>
                          setEditForm({
                            id: user.id,
                            display_name: user.name,
                            role: user.role,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="button button-danger"
                        type="button"
                        onClick={() => {
                          void toggleStatus(user);
                        }}
                      >
                        {user.status === 'disabled' ? 'Enable' : 'Disable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createForm !== EMPTY_CREATE_FORM || isCreating ? (
        <Modal title="Create User" onClose={() => setCreateForm(EMPTY_CREATE_FORM)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              void submitCreateUser(event);
            }}
          >
            <label>
              Email *
              <input
                required
                type="email"
                autoComplete="email"
                value={createForm.email}
                onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label>
              Name *
              <input
                required
                type="text"
                value={createForm.name}
                onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label>
              Password *
              <input
                required
                type="password"
                autoComplete="new-password"
                value={createForm.password}
                onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            <label>
              Role *
              <select
                required
                value={createForm.role}
                onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value }))}
              >
                {ROLE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Groups
              <input
                type="text"
                value={createForm.groups}
                onChange={(event) => setCreateForm((current) => ({ ...current, groups: event.target.value }))}
                placeholder="Comma-separated group IDs"
              />
            </label>
            <div className="form-actions span-2">
              <button className="button button-secondary" type="button" onClick={() => setCreateForm(EMPTY_CREATE_FORM)}>
                Cancel
              </button>
              <button className="button button-primary" type="submit" disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editForm !== null ? (
        <Modal title="Edit User" onClose={() => setEditForm(null)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              void submitEditUser(event);
            }}
          >
            <label>
              Display name *
              <input
                required
                type="text"
                value={editForm.display_name}
                onChange={(event) => setEditForm((current) => (current === null ? current : { ...current, display_name: event.target.value }))}
              />
            </label>
            <label>
              Role *
              <select
                required
                value={editForm.role}
                onChange={(event) => setEditForm((current) => (current === null ? current : { ...current, role: event.target.value }))}
              >
                {ROLE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions span-2">
              <button className="button button-secondary" type="button" onClick={() => setEditForm(null)}>
                Cancel
              </button>
              <button className="button button-primary" type="submit">
                Save Changes
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export default requireAdminPage(UsersPage);
