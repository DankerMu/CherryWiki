import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import { formatDate, getErrorMessage, parseIdList } from '../../components/adminUi';
import { ROLE_OPTIONS, type AdminUser } from '../../lib/adminTypes';
import { useAuth } from '../../lib/auth';

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

function statusColor(status: string): string {
  if (status === 'active') return 'green';
  if (status === 'disabled') return 'default';
  return 'orange';
}

function UsersPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [isLoading, setIsLoading] = useState(true);
  const [createForm, setCreateForm] = useState<CreateUserForm>(EMPTY_CREATE_FORM);
  const [editForm, setEditForm] = useState<EditUserForm | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createFormInstance] = Form.useForm<CreateUserForm>();
  const [editFormInstance] = Form.useForm<EditUserForm>();

  const loadUsers = useCallback(async () => {
    setIsLoading(true);

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
      void message.error(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [deferredSearch, role, status]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const visibleUsers = useMemo(() => users, [users]);

  async function submitCreateUser(): Promise<void> {
    setIsCreating(true);

    try {
      const values = await createFormInstance.validateFields();
      await api.post<AdminUser>('/admin/users', {
        email: values.email,
        name: values.name,
        password: values.password,
        role: values.role,
        groups: parseIdList(values.groups ?? ''),
      });
      setShowCreateModal(false);
      setCreateForm(EMPTY_CREATE_FORM);
      createFormInstance.resetFields();
      await loadUsers();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      void message.error(getErrorMessage(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function submitEditUser(): Promise<void> {
    if (editForm === null) return;

    try {
      const values = await editFormInstance.validateFields();
      await api.patch<AdminUser>(`/admin/users/${editForm.id}`, {
        display_name: values.display_name,
        role: values.role,
      });
      setEditForm(null);
      await loadUsers();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      void message.error(getErrorMessage(err));
    }
  }

  async function toggleStatus(user: AdminUser): Promise<void> {
    try {
      await api.patch<AdminUser>(`/admin/users/${user.id}`, {
        status: user.status === 'disabled' ? 'active' : 'disabled',
      });
      await loadUsers();
    } catch (err) {
      void message.error(getErrorMessage(err));
    }
  }

  async function deleteUser(user: AdminUser): Promise<void> {
    try {
      await api.delete(`/admin/users/${user.id}`);
      void message.success(t('admin.users.deleteSuccess'));
      await loadUsers();
    } catch (err) {
      void message.error(getErrorMessage(err));
    }
  }

  const columns: ColumnsType<AdminUser> = [
    {
      title: t('admin.users.columns.email'),
      dataIndex: 'email',
      key: 'email',
      sorter: (a, b) => a.email.localeCompare(b.email),
      render: (email: string) => <Typography.Text code>{email}</Typography.Text>,
    },
    {
      title: t('admin.users.columns.name'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t('admin.users.columns.role'),
      dataIndex: 'role',
      key: 'role',
      render: (val: string) => <Tag>{val}</Tag>,
    },
    {
      title: t('admin.users.columns.status'),
      dataIndex: 'status',
      key: 'status',
      render: (val: string) => <Tag color={statusColor(val)}>{t(`common.status.${val}`, val)}</Tag>,
    },
    {
      title: t('admin.users.columns.groups'),
      dataIndex: 'groups',
      key: 'groups',
      render: (groups: string[]) =>
        groups.length > 0
          ? groups.map((g) => <Tag key={g}>{g}</Tag>)
          : <Typography.Text type="secondary">{t('common.state.none')}</Typography.Text>,
    },
    {
      title: t('admin.users.columns.lastLogin'),
      dataIndex: 'last_login_at',
      key: 'last_login_at',
      render: (val: string | null) => formatDate(val) === 'Never' ? t('common.state.never') : formatDate(val),
    },
    {
      title: t('admin.users.columns.actions'),
      key: 'actions',
      render: (_: unknown, user: AdminUser) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              const form: EditUserForm = { id: user.id, display_name: user.name, role: user.role };
              setEditForm(form);
              editFormInstance.setFieldsValue(form);
            }}
          >
            {t('common.action.edit')}
          </Button>
          <Popconfirm
            title={user.status === 'disabled' ? t('admin.users.confirmEnable') : t('admin.users.confirmDisable')}
            onConfirm={() => { void toggleStatus(user); }}
            okText={t('common.action.confirm')}
            cancelText={t('common.action.cancel')}
          >
            <Switch
              checked={user.status !== 'disabled'}
              checkedChildren={t('common.action.enable')}
              unCheckedChildren={t('common.action.disable')}
              size="small"
            />
          </Popconfirm>
          {user.id !== currentUser?.id && user.role !== 'owner' ? (
            <Popconfirm
              title={t('admin.users.confirmDelete')}
              onConfirm={() => { void deleteUser(user); }}
              okText={t('common.action.confirm')}
              cancelText={t('common.action.cancel')}
            >
              <Button size="small" danger>{t('common.action.delete')}</Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('admin.users.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('admin.users.description')}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { void loadUsers(); }}>
            {t('common.action.refresh')}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setCreateForm({ ...EMPTY_CREATE_FORM });
              createFormInstance.resetFields();
              setShowCreateModal(true);
            }}
          >
            {t('admin.users.createButton')}
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder={t('admin.users.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={setSearch}
          allowClear
          style={{ width: 240 }}
        />
        <Select
          value={role || undefined}
          onChange={(val) => setRole(val ?? '')}
          placeholder={t('admin.users.filter.allRoles')}
          allowClear
          style={{ width: 160 }}
        >
          {ROLE_OPTIONS.map((r) => (
            <Select.Option key={r} value={r}>{r}</Select.Option>
          ))}
        </Select>
        <Select
          value={status || undefined}
          onChange={(val) => setStatus(val ?? '')}
          placeholder={t('admin.users.filter.allStatuses')}
          allowClear
          style={{ width: 160 }}
        >
          <Select.Option value="active">{t('common.status.active')}</Select.Option>
          <Select.Option value="disabled">{t('common.status.disabled')}</Select.Option>
        </Select>
      </Space>

      <Table<AdminUser>
        columns={columns}
        dataSource={visibleUsers}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `${total}` }}
        locale={{ emptyText: t('admin.users.emptyFilter') }}
        size="middle"
      />

      <Modal
        title={t('admin.users.createTitle')}
        open={showCreateModal}
        onCancel={() => { setShowCreateModal(false); createFormInstance.resetFields(); }}
        onOk={() => { void submitCreateUser(); }}
        confirmLoading={isCreating}
        okText={isCreating ? t('admin.users.creating') : t('admin.users.createButton')}
        cancelText={t('common.action.cancel')}
      >
        <Form
          form={createFormInstance}
          layout="vertical"
          initialValues={createForm}
        >
          <Form.Item name="email" label={t('admin.users.form.email')} rules={[{ required: true, message: t('admin.users.form.emailRequired') }, { type: 'email', message: t('login.form.emailInvalid') }]}>
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item name="name" label={t('admin.users.form.name')} rules={[{ required: true, message: t('admin.users.form.nameRequired') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label={t('admin.users.form.password')} rules={[{ required: true, message: t('admin.users.form.passwordRequired') }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label={t('admin.users.form.role')} rules={[{ required: true, message: t('admin.users.form.roleRequired') }]}>
            <Select>
              {ROLE_OPTIONS.map((r) => (
                <Select.Option key={r} value={r}>{r}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="groups" label={t('admin.users.form.groups')}>
            <Input placeholder={t('admin.users.form.groupsPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('admin.users.editTitle')}
        open={editForm !== null}
        onCancel={() => setEditForm(null)}
        onOk={() => { void submitEditUser(); }}
        okText={t('common.action.save')}
        cancelText={t('common.action.cancel')}
      >
        <Form
          form={editFormInstance}
          layout="vertical"
        >
          <Form.Item name="display_name" label={t('admin.users.form.displayName')} rules={[{ required: true, message: t('admin.users.form.displayNameRequired') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label={t('admin.users.form.role')} rules={[{ required: true, message: t('admin.users.form.roleRequired') }]}>
            <Select>
              {ROLE_OPTIONS.map((r) => (
                <Select.Option key={r} value={r}>{r}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default requireAdminPage(UsersPage);
