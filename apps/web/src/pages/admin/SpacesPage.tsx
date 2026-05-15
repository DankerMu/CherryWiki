import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Button,
  Checkbox,
  Collapse,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { getErrorMessage } from '../../components/adminUi';
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

const EMPTY_SPACE_FORM: CreateSpaceForm = { name: '', slug: '', description: '' };

function statusColor(status: string): string {
  if (status === 'active') return 'green';
  if (status === 'disabled') return 'default';
  return 'orange';
}

function SpacesPage() {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [spaces, setSpaces] = useState<AdminSpace[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<AdminSpaceDetail | null>(null);
  const [permissionsByGroup, setPermissionsByGroup] = useState<Record<string, string[]>>({});
  const [createForm, setCreateForm] = useState<CreateSpaceForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formInstance] = Form.useForm<CreateSpaceForm>();

  const loadSpaces = useCallback(async () => {
    setIsLoading(true);

    try {
      const [nextSpaces, nextGroups] = await Promise.all([
        api.get<AdminSpace[]>('/spaces', { per_page: 100, sort: 'name' }),
        api.get<AdminGroup[]>('/admin/groups', { per_page: 100, sort: 'name' }),
      ]);
      setSpaces(nextSpaces);
      setGroups(nextGroups);
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  async function submitCreateSpace(): Promise<void> {
    if (createForm === null) return;

    setIsSaving(true);
    try {
      const values = await formInstance.validateFields();
      await api.post<AdminSpaceDetail>('/spaces', {
        name: values.name,
        slug: values.slug,
        description: values.description,
      });
      setCreateForm(null);
      formInstance.resetFields();
      await loadSpaces();
      await refreshUser();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      void message.error(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function openDetails(space: AdminSpace): Promise<void> {
    setIsDetailLoading(true);

    try {
      const [detail, permissions] = await Promise.all([
        api.get<AdminSpaceDetail>(`/spaces/${space.id}`),
        api.get<SpacePermissionGroup[]>(`/spaces/${space.id}/permissions`),
      ]);
      setSelectedSpace(detail);
      setPermissionsByGroup(Object.fromEntries(permissions.map((item) => [item.group_id, item.permissions])));
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function saveStrictMode(strictKnowledgeOnly: boolean): Promise<void> {
    if (selectedSpace === null) return;

    setIsSaving(true);
    try {
      const updated = await api.patch<AdminSpaceDetail>(`/spaces/${selectedSpace.id}`, {
        strict_knowledge_only: strictKnowledgeOnly,
      });
      setSelectedSpace(updated);
      await loadSpaces();
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function savePermissions(): Promise<void> {
    if (selectedSpace === null) return;

    setIsSaving(true);
    try {
      const permissions = Object.entries(permissionsByGroup)
        .map(([group_id, groupPermissions]) => ({ group_id, permissions: groupPermissions }))
        .filter((item) => item.permissions.length > 0);
      const updated = await api.put<SpacePermissionGroup[]>(`/spaces/${selectedSpace.id}/permissions`, { permissions });
      setPermissionsByGroup(Object.fromEntries(updated.map((item) => [item.group_id, item.permissions])));
      void message.success(t('admin.spaces.detail.savePermissions'));
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveSpace(space: AdminSpace): Promise<void> {
    try {
      await api.delete(`/spaces/${space.id}`);
      void message.success(t('admin.spaces.archiveSuccess'));
      await loadSpaces();
      await refreshUser();
    } catch (err) {
      void message.error(getErrorMessage(err));
      throw err;
    }
  }

  const columns: ColumnsType<AdminSpace> = [
    {
      title: t('admin.spaces.columns.name'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, space: AdminSpace) => (
        <div>
          <Typography.Text strong>{name}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{space.id}</Typography.Text>
        </div>
      ),
    },
    {
      title: t('admin.spaces.columns.slug'),
      dataIndex: 'slug',
      key: 'slug',
      render: (slug: string) => <Typography.Text code>{slug}</Typography.Text>,
    },
    {
      title: t('admin.spaces.columns.status'),
      dataIndex: 'status',
      key: 'status',
      render: (val: string) => <Tag color={statusColor(val)}>{t(`common.status.${val}`, val)}</Tag>,
    },
    {
      title: t('admin.spaces.columns.pages'),
      key: 'pages',
      render: (_: unknown, space: AdminSpace) => space.stats.page_count,
    },
    {
      title: t('admin.spaces.columns.sources'),
      key: 'sources',
      render: (_: unknown, space: AdminSpace) => space.stats.source_count,
    },
    {
      title: t('admin.spaces.columns.actions'),
      key: 'actions',
      render: (_: unknown, space: AdminSpace) => (
        <Space>
          <Button size="small" loading={isDetailLoading} onClick={() => { void openDetails(space); }}>
            {t('common.action.configure')}
          </Button>
          <Popconfirm
            title={t('admin.spaces.archiveConfirm', { name: space.name })}
            description={t('admin.spaces.archiveWarning')}
            onConfirm={() => { void archiveSpace(space); }}
            okText={t('common.action.confirm')}
            cancelText={t('common.action.cancel')}
          >
            <Button icon={<DeleteOutlined />} size="small" danger>
              {t('admin.spaces.archiveButton')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('admin.spaces.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('admin.spaces.description')}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { void loadSpaces(); }}>
            {t('common.action.refresh')}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setCreateForm({ ...EMPTY_SPACE_FORM });
              formInstance.resetFields();
            }}
          >
            {t('admin.spaces.createButton')}
          </Button>
        </Space>
      </div>

      <Table<AdminSpace>
        columns={columns}
        dataSource={spaces}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        locale={{ emptyText: t('admin.spaces.emptyList') }}
        size="middle"
      />

      <Drawer
        title={selectedSpace?.name ?? t('admin.spaces.detail.title')}
        open={selectedSpace !== null}
        onClose={() => setSelectedSpace(null)}
        width={560}
      >
        {selectedSpace !== null ? (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t('admin.spaces.columns.name')}>{selectedSpace.name}</Descriptions.Item>
              <Descriptions.Item label={t('admin.spaces.form.description')}>
                {selectedSpace.description ?? t('admin.spaces.detail.noDescription')}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.spaces.detail.repoPath')}>
                <Typography.Text code>{selectedSpace.wiki_repo_path}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.spaces.detail.indexStatus')}>
                <Tag color={statusColor(selectedSpace.index_consistency_status)}>
                  {selectedSpace.index_consistency_status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.spaces.detail.strictKnowledge')}>
                <Space>
                  <Switch
                    checked={selectedSpace.strict_knowledge_only}
                    disabled={isSaving}
                    onChange={(checked) => { void saveStrictMode(checked); }}
                  />
                  <Typography.Text type="secondary">{t('admin.spaces.detail.strictKnowledgeHelp')}</Typography.Text>
                </Space>
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 24 }}>
              {t('admin.spaces.detail.groupPermissions')}
            </Typography.Title>

            {groups.length === 0 ? (
              <Empty description={t('admin.spaces.detail.noGroupHint')} />
            ) : (
              <>
                <Collapse>
                  {groups.map((group) => (
                    <Collapse.Panel key={group.id} header={group.name}>
                      <Space style={{ marginBottom: 8 }}>
                        <Button
                          size="small"
                          onClick={() => {
                            setPermissionsByGroup((current) => ({
                              ...current,
                              [group.id]: [...SPACE_PERMISSION_OPTIONS],
                            }));
                          }}
                        >
                          {t('admin.permissions.selectAll')}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            setPermissionsByGroup((current) => ({
                              ...current,
                              [group.id]: [],
                            }));
                          }}
                        >
                          {t('admin.permissions.deselectAll')}
                        </Button>
                      </Space>
                      <Checkbox.Group
                        value={permissionsByGroup[group.id] ?? []}
                        onChange={(checked) => {
                          setPermissionsByGroup((current) => ({
                            ...current,
                            [group.id]: checked,
                          }));
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
                <Button
                  type="primary"
                  loading={isSaving}
                  style={{ marginTop: 16 }}
                  onClick={() => { void savePermissions(); }}
                >
                  {t('admin.spaces.detail.savePermissions')}
                </Button>
              </>
            )}
          </>
        ) : null}
      </Drawer>

      <Modal
        title={t('admin.spaces.createTitle')}
        open={createForm !== null}
        onCancel={() => { setCreateForm(null); formInstance.resetFields(); }}
        onOk={() => { void submitCreateSpace(); }}
        confirmLoading={isSaving}
        okText={isSaving ? t('admin.spaces.creating') : t('admin.spaces.createButton')}
        cancelText={t('common.action.cancel')}
      >
        <Form form={formInstance} layout="vertical" initialValues={EMPTY_SPACE_FORM}>
          <Form.Item name="name" label={t('admin.spaces.form.name')} rules={[{ required: true, message: t('admin.spaces.form.nameRequired') }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="slug"
            label={t('admin.spaces.form.slug')}
            rules={[
              { required: true, message: t('admin.spaces.form.slugRequired') },
              { pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/, message: t('admin.spaces.form.slugPattern') },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('admin.spaces.form.description')}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default requireAdminPage(SpacesPage);
