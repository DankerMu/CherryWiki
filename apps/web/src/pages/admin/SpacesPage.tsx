import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  getErrorMessage,
} from '../../components/adminUi';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import {
  SPACE_PERMISSION_OPTIONS,
  type AdminGroup,
  type AdminSpace,
  type AdminSpaceDetail,
  type SpacePermissionGroup,
} from '../../lib/adminTypes';

type CreateSpaceForm = {
  name: string;
  slug: string;
  description: string;
};

const EMPTY_SPACE_FORM: CreateSpaceForm = {
  name: '',
  slug: '',
  description: '',
};

function SpacesPage() {
  const [spaces, setSpaces] = useState<AdminSpace[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<AdminSpaceDetail | null>(null);
  const [permissionsByGroup, setPermissionsByGroup] = useState<Record<string, string[]>>({});
  const [createForm, setCreateForm] = useState<CreateSpaceForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSpaces = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [nextSpaces, nextGroups] = await Promise.all([
        api.get<AdminSpace[]>('/spaces', { per_page: 100, sort: 'name' }),
        api.get<AdminGroup[]>('/admin/groups', { per_page: 100, sort: 'name' }),
      ]);
      setSpaces(nextSpaces);
      setGroups(nextGroups);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  async function submitCreateSpace(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (createForm === null) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await api.post<AdminSpaceDetail>('/spaces', {
        name: createForm.name,
        slug: createForm.slug,
        description: createForm.description,
      });
      setCreateForm(null);
      await loadSpaces();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function openDetails(space: AdminSpace): Promise<void> {
    setIsDetailLoading(true);
    setError(null);

    try {
      const [detail, permissions] = await Promise.all([
        api.get<AdminSpaceDetail>(`/spaces/${space.id}`),
        api.get<SpacePermissionGroup[]>(`/spaces/${space.id}/permissions`),
      ]);
      setSelectedSpace(detail);
      setPermissionsByGroup(Object.fromEntries(permissions.map((item) => [item.group_id, item.permissions])));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function saveStrictMode(strictKnowledgeOnly: boolean): Promise<void> {
    if (selectedSpace === null) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const updated = await api.patch<AdminSpaceDetail>(`/spaces/${selectedSpace.id}`, {
        strict_knowledge_only: strictKnowledgeOnly,
      });
      setSelectedSpace(updated);
      await loadSpaces();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function savePermissions(): Promise<void> {
    if (selectedSpace === null) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const permissions = Object.entries(permissionsByGroup)
        .map(([group_id, groupPermissions]) => ({ group_id, permissions: groupPermissions }))
        .filter((item) => item.permissions.length > 0);
      const updated = await api.put<SpacePermissionGroup[]>(`/spaces/${selectedSpace.id}/permissions`, { permissions });
      setPermissionsByGroup(Object.fromEntries(updated.map((item) => [item.group_id, item.permissions])));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  function updatePermission(groupId: string, permission: string, checked: boolean): void {
    setPermissionsByGroup((current) => {
      const currentPermissions = current[groupId] ?? [];
      const nextPermissions = checked
        ? [...new Set([...currentPermissions, permission])]
        : currentPermissions.filter((item) => item !== permission);

      return {
        ...current,
        [groupId]: nextPermissions,
      };
    });
  }

  return (
    <>
      <PageHeader
        title="Spaces"
        description="Create knowledge spaces and manage their access controls."
        actions={
          <button className="button button-primary" type="button" onClick={() => setCreateForm({ ...EMPTY_SPACE_FORM })}>
            Create Space
          </button>
        }
      />
      <ErrorBanner error={error} />

      {isLoading ? (
        <LoadingState />
      ) : spaces.length === 0 ? (
        <EmptyState label="No spaces are available to administer." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Pages</th>
                <th>Sources</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((space) => (
                <tr key={space.id}>
                  <td>
                    <strong>{space.name}</strong>
                    <span className="subtle-id">{space.id}</span>
                  </td>
                  <td>
                    <code>{space.slug}</code>
                  </td>
                  <td>
                    <StatusBadge status={space.status} />
                  </td>
                  <td>{space.stats.page_count}</td>
                  <td>{space.stats.source_count}</td>
                  <td>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => {
                        void openDetails(space);
                      }}
                    >
                      Configure
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isDetailLoading ? <LoadingState label="Loading space details..." /> : null}

      {selectedSpace !== null ? (
        <section className="detail-panel" aria-label="Space configuration">
          <div className="detail-panel-header">
            <div>
              <h2>{selectedSpace.name}</h2>
              <p>{selectedSpace.description ?? 'No description'}</p>
            </div>
            <button className="button button-secondary" type="button" onClick={() => setSelectedSpace(null)}>
              Close
            </button>
          </div>

          <div className="settings-grid">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={selectedSpace.strict_knowledge_only}
                disabled={isSaving}
                onChange={(event) => {
                  void saveStrictMode(event.target.checked);
                }}
              />
              <span>
                <strong>Strict knowledge only</strong>
                <small>Restrict answers to indexed space knowledge.</small>
              </span>
            </label>
            <div>
              <span className="eyebrow">Repository path</span>
              <code>{selectedSpace.wiki_repo_path}</code>
            </div>
            <div>
              <span className="eyebrow">Index status</span>
              <StatusBadge status={selectedSpace.index_consistency_status} />
            </div>
          </div>

          <div className="permission-editor">
            <div className="section-heading-row">
              <h3>Group permissions</h3>
              <button
                className="button button-primary"
                type="button"
                disabled={isSaving}
                onClick={() => {
                  void savePermissions();
                }}
              >
                Save Permissions
              </button>
            </div>
            {groups.length === 0 ? (
              <p className="muted-copy">Create a group before assigning permissions.</p>
            ) : (
              groups.map((group) => (
                <fieldset key={group.id}>
                  <legend>{group.name}</legend>
                  {SPACE_PERMISSION_OPTIONS.map((permission) => (
                    <label key={permission} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={(permissionsByGroup[group.id] ?? []).includes(permission)}
                        onChange={(event) => updatePermission(group.id, permission, event.target.checked)}
                      />
                      {permission}
                    </label>
                  ))}
                </fieldset>
              ))
            )}
          </div>
        </section>
      ) : null}

      {createForm !== null ? (
        <Modal title="Create Space" onClose={() => setCreateForm(null)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              void submitCreateSpace(event);
            }}
          >
            <label>
              Name *
              <input
                required
                type="text"
                value={createForm.name}
                onChange={(event) => setCreateForm((current) => (current === null ? current : { ...current, name: event.target.value }))}
              />
            </label>
            <label>
              Slug *
              <input
                required
                type="text"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={createForm.slug}
                onChange={(event) => setCreateForm((current) => (current === null ? current : { ...current, slug: event.target.value }))}
              />
            </label>
            <label className="span-2">
              Description
              <textarea
                rows={4}
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((current) => (current === null ? current : { ...current, description: event.target.value }))
                }
              />
            </label>
            <div className="form-actions span-2">
              <button className="button button-secondary" type="button" onClick={() => setCreateForm(null)}>
                Cancel
              </button>
              <button className="button button-primary" type="submit" disabled={isSaving}>
                {isSaving ? 'Creating...' : 'Create Space'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export default requireAdminPage(SpacesPage);
