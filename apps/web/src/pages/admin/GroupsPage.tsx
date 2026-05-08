import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  Modal,
  PageHeader,
  getErrorMessage,
} from '../../components/adminUi';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import {
  SPACE_PERMISSION_OPTIONS,
  type AdminGroup,
  type AdminSpace,
  type AdminUser,
} from '../../lib/adminTypes';

type GroupForm = {
  id?: string;
  name: string;
  description: string;
  memberIds: string[];
  permissionsBySpace: Record<string, string[]>;
};

function GroupsPage() {
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [spaces, setSpaces] = useState<AdminSpace[]>([]);
  const [form, setForm] = useState<GroupForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [nextGroups, nextUsers, nextSpaces] = await Promise.all([
        api.get<AdminGroup[]>('/admin/groups', { per_page: 100, sort: 'name' }),
        api.get<AdminUser[]>('/admin/users', { per_page: 100, sort: 'email' }),
        api.get<AdminSpace[]>('/spaces', { per_page: 100, sort: 'name' }),
      ]);
      setGroups(nextGroups);
      setUsers(nextUsers);
      setSpaces(nextSpaces);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const modalTitle = form?.id === undefined ? 'Create Group' : 'Edit Group';

  async function submitGroup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form === null) {
      return;
    }

    setIsSaving(true);
    setError(null);
    const body = {
      name: form.name,
      description: form.description,
      member_ids: form.memberIds,
      space_permissions: toSpacePermissions(form.permissionsBySpace),
    };

    try {
      if (form.id === undefined) {
        await api.post<AdminGroup>('/admin/groups', body);
      } else {
        await api.put<AdminGroup>(`/admin/groups/${form.id}`, body);
      }
      setForm(null);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  function openCreateForm(): void {
    setForm(createEmptyForm());
  }

  function openEditForm(group: AdminGroup): void {
    setForm({
      id: group.id,
      name: group.name,
      description: group.description ?? '',
      memberIds: users.filter((user) => user.groups.includes(group.id)).map((user) => user.id),
      permissionsBySpace: Object.fromEntries(group.spaces.map((space) => [space.space_id, space.permissions])),
    });
  }

  function updatePermission(spaceId: string, permission: string, checked: boolean): void {
    setForm((current) => {
      if (current === null) {
        return current;
      }

      const currentPermissions = current.permissionsBySpace[spaceId] ?? [];
      const nextPermissions = checked
        ? [...new Set([...currentPermissions, permission])]
        : currentPermissions.filter((item) => item !== permission);

      return {
        ...current,
        permissionsBySpace: {
          ...current.permissionsBySpace,
          [spaceId]: nextPermissions,
        },
      };
    });
  }

  const memberSummary = useMemo(
    () => new Map(groups.map((group) => [group.id, users.filter((user) => user.groups.includes(group.id)).length])),
    [groups, users],
  );

  return (
    <>
      <PageHeader
        title="Groups"
        description="Create groups, assign members, and bind space permissions."
        actions={
          <button className="button button-primary" type="button" onClick={openCreateForm}>
            Create Group
          </button>
        }
      />
      <ErrorBanner error={error} />

      {isLoading ? (
        <LoadingState />
      ) : groups.length === 0 ? (
        <EmptyState label="No groups have been created yet." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Members</th>
                <th>Spaces</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <td>
                    <strong>{group.name}</strong>
                    <span className="subtle-id">{group.id}</span>
                  </td>
                  <td>{group.description ?? 'No description'}</td>
                  <td>{memberSummary.get(group.id) ?? group.member_count}</td>
                  <td>
                    {group.spaces.length > 0
                      ? group.spaces.map((space) => `${space.space_id}: ${space.permissions.join(', ')}`).join('; ')
                      : 'No space permissions'}
                  </td>
                  <td>
                    <button className="button button-secondary" type="button" onClick={() => openEditForm(group)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form !== null ? (
        <Modal title={modalTitle} onClose={() => setForm(null)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              void submitGroup(event);
            }}
          >
            <label>
              Name *
              <input
                required
                type="text"
                value={form.name}
                onChange={(event) => setForm((current) => (current === null ? current : { ...current, name: event.target.value }))}
              />
            </label>
            <label>
              Description
              <input
                type="text"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => (current === null ? current : { ...current, description: event.target.value }))
                }
              />
            </label>
            <label className="span-2">
              Members
              <select
                multiple
                value={form.memberIds}
                onChange={(event) =>
                  setForm((current) =>
                    current === null
                      ? current
                      : {
                          ...current,
                          memberIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                        },
                  )
                }
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.email}
                  </option>
                ))}
              </select>
            </label>
            <div className="span-2 permission-editor">
              <h3>Space permissions</h3>
              {spaces.length === 0 ? (
                <p className="muted-copy">Create a space before assigning space permissions.</p>
              ) : (
                spaces.map((space) => (
                  <fieldset key={space.id}>
                    <legend>{space.name}</legend>
                    {SPACE_PERMISSION_OPTIONS.map((permission) => (
                      <label key={permission} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={(form.permissionsBySpace[space.id] ?? []).includes(permission)}
                          onChange={(event) => updatePermission(space.id, permission, event.target.checked)}
                        />
                        {permission}
                      </label>
                    ))}
                  </fieldset>
                ))
              )}
            </div>
            <div className="form-actions span-2">
              <button className="button button-secondary" type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="button button-primary" type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Group'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export default requireAdminPage(GroupsPage);

function createEmptyForm(): GroupForm {
  return {
    name: '',
    description: '',
    memberIds: [],
    permissionsBySpace: {},
  };
}

function toSpacePermissions(permissionsBySpace: Record<string, string[]>): Array<{ space_id: string; permissions: string[] }> {
  return Object.entries(permissionsBySpace)
    .map(([space_id, permissions]) => ({
      space_id,
      permissions,
    }))
    .filter((item) => item.permissions.length > 0);
}
