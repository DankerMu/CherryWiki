import { EditOutlined, PlusOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons';
import { Button, Card, Checkbox, Collapse, Empty, Form, Input, Modal, Select, Space, Spin, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../components/adminUi';
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
  const { t } = useTranslation();
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [spaces, setSpaces] = useState<AdminSpace[]>([]);
  const [form, setForm] = useState<GroupForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [antForm] = Form.useForm();

  const loadData = useCallback(async () => {
    setIsLoading(true);

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
      void message.error(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function submitGroup(): Promise<void> {
    if (form === null) return;

    setIsSaving(true);
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
      void message.error(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  function openCreateForm(): void {
    const newForm = createEmptyForm();
    setForm(newForm);
    antForm.setFieldsValue({ name: '', description: '', memberIds: [] });
  }

  function openEditForm(group: AdminGroup): void {
    const editData: GroupForm = {
      id: group.id,
      name: group.name,
      description: group.description ?? '',
      memberIds: users.filter((user) => user.groups.includes(group.id)).map((user) => user.id),
      permissionsBySpace: Object.fromEntries(group.spaces.map((space) => [space.space_id, space.permissions])),
    };
    setForm(editData);
    antForm.setFieldsValue({ name: editData.name, description: editData.description, memberIds: editData.memberIds });
  }

  const memberSummary = useMemo(
    () => new Map(groups.map((group) => [group.id, users.filter((user) => user.groups.includes(group.id)).length])),
    [groups, users],
  );

  const modalTitle = form?.id === undefined ? t('admin.groups.createTitle') : t('admin.groups.editTitle');

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('admin.groups.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('admin.groups.description')}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { void loadData(); }}>
            {t('common.action.refresh')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateForm}>
            {t('admin.groups.createButton')}
          </Button>
        </Space>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
      ) : groups.length === 0 ? (
        <Empty description={t('admin.groups.emptyList')} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {groups.map((group) => (
            <Card
              key={group.id}
              title={group.name}
              extra={
                <Button icon={<EditOutlined />} size="small" onClick={() => openEditForm(group)}>
                  {t('common.action.edit')}
                </Button>
              }
            >
              <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                {group.description ?? t('admin.groups.noDescription')}
              </Typography.Paragraph>
              <Space>
                <TeamOutlined />
                <Typography.Text>{memberSummary.get(group.id) ?? group.member_count} {t('admin.groups.columns.members')}</Typography.Text>
              </Space>
              <div style={{ marginTop: 8 }}>
                <Typography.Text type="secondary">
                  {group.spaces.length > 0
                    ? group.spaces.map((s) => `${s.space_id}: ${s.permissions.join(', ')}`).join('; ')
                    : t('admin.groups.noSpacePermissions')}
                </Typography.Text>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title={modalTitle}
        open={form !== null}
        onCancel={() => setForm(null)}
        onOk={() => { void submitGroup(); }}
        confirmLoading={isSaving}
        okText={isSaving ? t('admin.groups.saving') : t('admin.groups.saveGroup')}
        cancelText={t('common.action.cancel')}
        width={640}
      >
        {form !== null ? (
          <Form form={antForm} layout="vertical">
            <Form.Item name="name" label={t('admin.groups.form.name')} rules={[{ required: true, message: t('admin.groups.form.nameRequired') }]}>
              <Input
                value={form.name}
                onChange={(e) => setForm((c) => c === null ? c : { ...c, name: e.target.value })}
              />
            </Form.Item>
            <Form.Item name="description" label={t('admin.groups.form.description')}>
              <Input
                value={form.description}
                onChange={(e) => setForm((c) => c === null ? c : { ...c, description: e.target.value })}
              />
            </Form.Item>
            <Form.Item name="memberIds" label={t('admin.groups.form.members')}>
              <Select
                mode="multiple"
                value={form.memberIds}
                onChange={(val: string[]) => setForm((c) => c === null ? c : { ...c, memberIds: val })}
                placeholder={t('admin.groups.form.members')}
                optionFilterProp="label"
                options={users.map((u) => ({ label: u.email, value: u.id }))}
              />
            </Form.Item>
            <div>
              <Typography.Title level={5}>{t('admin.groups.form.spacePermissions')}</Typography.Title>
              {spaces.length === 0 ? (
                <Typography.Text type="secondary">{t('admin.groups.form.noSpaceHint')}</Typography.Text>
              ) : (
                <Collapse>
                  {spaces.map((space) => (
                    <Collapse.Panel key={space.id} header={space.name}>
                      <Space style={{ marginBottom: 8 }}>
                        <Button
                          size="small"
                          onClick={() => {
                            setForm((current) => {
                              if (current === null) return current;
                              return {
                                ...current,
                                permissionsBySpace: {
                                  ...current.permissionsBySpace,
                                  [space.id]: [...SPACE_PERMISSION_OPTIONS],
                                },
                              };
                            });
                          }}
                        >
                          {t('admin.permissions.selectAll')}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            setForm((current) => {
                              if (current === null) return current;
                              return {
                                ...current,
                                permissionsBySpace: { ...current.permissionsBySpace, [space.id]: [] },
                              };
                            });
                          }}
                        >
                          {t('admin.permissions.deselectAll')}
                        </Button>
                      </Space>
                      <Checkbox.Group
                        value={form.permissionsBySpace[space.id] ?? []}
                        onChange={(checked) => {
                          setForm((current) => {
                            if (current === null) return current;
                            return {
                              ...current,
                              permissionsBySpace: { ...current.permissionsBySpace, [space.id]: checked },
                            };
                          });
                        }}
                      >
                        <Space direction="vertical">
                          {SPACE_PERMISSION_OPTIONS.map((perm) => (
                            <Checkbox key={perm} value={perm}>{perm}</Checkbox>
                          ))}
                        </Space>
                      </Checkbox.Group>
                    </Collapse.Panel>
                  ))}
                </Collapse>
              )}
            </div>
          </Form>
        ) : null}
      </Modal>
    </>
  );
}

export default requireAdminPage(GroupsPage);

function createEmptyForm(): GroupForm {
  return { name: '', description: '', memberIds: [], permissionsBySpace: {} };
}

function toSpacePermissions(permissionsBySpace: Record<string, string[]>): Array<{ space_id: string; permissions: string[] }> {
  return Object.entries(permissionsBySpace)
    .map(([space_id, permissions]) => ({ space_id, permissions }))
    .filter((item) => item.permissions.length > 0);
}
