import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
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
import { getErrorMessage, parseIdList } from '../../components/adminUi';
import { type AdminModel, type ModelConnectivityResult } from '../../lib/adminTypes';

type ModelForm = {
  id?: string;
  provider: string;
  model_id: string;
  model_type: 'chat' | 'embedding' | 'rerank';
  display_name: string;
  base_url: string;
  encrypted_api_key_ref: string;
  embedding_dim: string;
  max_tokens: string;
  rate_limit_rpm: string;
  enabled: boolean;
  visible_group_ids: string;
};

type ModelRequest = {
  provider: string;
  model_id: string;
  model_type: 'chat' | 'embedding' | 'rerank';
  enabled: boolean;
  visible_group_ids: string[];
  display_name?: string;
  base_url?: string;
  encrypted_api_key_ref?: string;
  embedding_dim?: number;
  max_tokens?: number;
  rate_limit_rpm?: number;
};

const EMPTY_MODEL_FORM: ModelForm = {
  provider: '',
  model_id: '',
  model_type: 'chat',
  display_name: '',
  base_url: '',
  encrypted_api_key_ref: '',
  embedding_dim: '',
  max_tokens: '',
  rate_limit_rpm: '',
  enabled: true,
  visible_group_ids: '',
};

function statusColor(status: string): string {
  if (status === 'active') return 'green';
  if (status === 'disabled') return 'default';
  return 'orange';
}

function ModelsPage() {
  const { t } = useTranslation();
  const [models, setModels] = useState<AdminModel[]>([]);
  const [form, setForm] = useState<ModelForm | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ModelConnectivityResult>>({});
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [antForm] = Form.useForm();

  const loadModels = useCallback(async () => {
    setIsLoading(true);

    try {
      const data = await api.get<AdminModel[]>('/admin/models', { per_page: 100, sort: 'provider' });
      setModels(data);
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  async function submitModel(): Promise<void> {
    if (form === null) return;

    setIsSaving(true);
    
    try {
      const body = toModelRequest(form);
      if (form.id === undefined) {
        await api.post<AdminModel>('/admin/models', body);
      } else {
        await api.patch<AdminModel>(`/admin/models/${form.id}`, body);
      }
      setForm(null);
      
      await loadModels();
    } catch (err) {
      
      void message.error(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleModel(model: AdminModel): Promise<void> {
    try {
      await api.patch<AdminModel>(`/admin/models/${model.id}`, {
        enabled: model.status !== 'active',
      });
      await loadModels();
    } catch (err) {
      void message.error(getErrorMessage(err));
    }
  }

  async function testModel(model: AdminModel): Promise<void> {
    setTestingModelId(model.id);
    try {
      const result = await api.post<ModelConnectivityResult>(`/admin/models/${model.id}/test`, {
        test_prompt: 'Admin console connectivity test',
      });
      setTestResults((current) => ({ ...current, [model.id]: result }));
      if (result.reachable) {
        void message.success(`${t('admin.models.reachable')} (${result.latency_ms} ms)`);
      } else {
        void message.warning(result.error ?? t('common.status.failed'));
      }
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setTestingModelId(null);
    }
  }

  function openEditForm(model: AdminModel): void {
    
    const editData: ModelForm = {
      id: model.id,
      provider: model.provider,
      model_id: model.model_id,
      model_type: normalizeModelType(model.model_type),
      display_name: model.name ?? '',
      base_url: model.config.base_url ?? '',
      encrypted_api_key_ref: '',
      embedding_dim: model.config.embedding_dim?.toString() ?? '',
      max_tokens: model.config.max_tokens?.toString() ?? '',
      rate_limit_rpm: model.config.rate_limit_rpm?.toString() ?? '',
      enabled: model.status === 'active',
      visible_group_ids: model.visible_group_ids.join(', '),
    };
    setForm(editData);
    antForm.setFieldsValue(editData);
  }

  function updateFormField(field: string, value: string | boolean): void {
    setForm((current) => current === null ? current : { ...current, [field]: value });
  }

  const columns: ColumnsType<AdminModel> = [
    {
      title: t('admin.models.columns.name'),
      key: 'name',
      sorter: (a, b) => (a.name ?? a.model_id).localeCompare(b.name ?? b.model_id),
      render: (_: unknown, model: AdminModel) => (
        <div>
          <Typography.Text strong>{model.name ?? model.model_id}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{model.model_id}</Typography.Text>
        </div>
      ),
    },
    {
      title: t('admin.models.columns.provider'),
      dataIndex: 'provider',
      key: 'provider',
    },
    {
      title: t('admin.models.columns.type'),
      dataIndex: 'model_type',
      key: 'model_type',
      render: (val: string) => <Tag>{val}</Tag>,
    },
    {
      title: t('admin.models.columns.status'),
      dataIndex: 'status',
      key: 'status',
      render: (val: string) => <Tag color={statusColor(val)}>{t(`common.status.${val}`, val)}</Tag>,
    },
    {
      title: t('admin.models.columns.config'),
      key: 'config',
      render: (_: unknown, model: AdminModel) => (
        <Typography.Text type="secondary">
          {model.config.base_url ?? t('admin.models.defaultEndpoint')}
          {model.config.max_tokens !== null ? `; ${model.config.max_tokens} ${t('admin.models.form.maxTokens').toLowerCase()}` : ''}
        </Typography.Text>
      ),
    },
    {
      title: t('admin.models.columns.test'),
      key: 'test',
      render: (_: unknown, model: AdminModel) => {
        const testResult = testResults[model.id];
        if (testResult === undefined) {
          return <Typography.Text type="secondary">{t('common.state.notTested')}</Typography.Text>;
        }
        return (
          <Tag color={testResult.reachable ? 'green' : 'red'}>
            {testResult.reachable ? t('admin.models.reachable') : (testResult.error ?? t('common.status.failed'))} ({testResult.latency_ms} ms)
          </Tag>
        );
      },
    },
    {
      title: t('admin.models.columns.actions'),
      key: 'actions',
      render: (_: unknown, model: AdminModel) => (
        <Space>
          <Button size="small" onClick={() => openEditForm(model)}>
            {t('common.action.edit')}
          </Button>
          <Button
            size="small"
            loading={testingModelId === model.id}
            onClick={() => { void testModel(model); }}
          >
            {t('common.action.test')}
          </Button>
          <Popconfirm
            title={model.status === 'active' ? t('admin.models.confirmDisable') : t('admin.models.confirmEnable')}
            onConfirm={() => { void toggleModel(model); }}
            okText={t('common.action.confirm')}
            cancelText={t('common.action.cancel')}
          >
            <Switch
              checked={model.status === 'active'}
              checkedChildren={t('common.action.enable')}
              unCheckedChildren={t('common.action.disable')}
              size="small"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('admin.models.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('admin.models.description')}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { void loadModels(); }}>
            {t('common.action.refresh')}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              
              const newForm = { ...EMPTY_MODEL_FORM };
              setForm(newForm);
              antForm.setFieldsValue(newForm);
            }}
          >
            {t('admin.models.addButton')}
          </Button>
        </Space>
      </div>

      <Table<AdminModel>
        columns={columns}
        dataSource={models}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        locale={{ emptyText: t('admin.models.emptyList') }}
        size="middle"
      />

      <Modal
        title={form?.id === undefined ? t('admin.models.addTitle') : t('admin.models.editTitle')}
        open={form !== null}
        onCancel={() => { setForm(null); }}
        onOk={() => { void submitModel(); }}
        confirmLoading={isSaving}
        okText={isSaving ? t('admin.models.saving') : t('admin.models.saveModel')}
        cancelText={t('common.action.cancel')}
        width={640}
      >
        {form !== null ? (
          <Form form={antForm} layout="vertical">
            <Form.Item name="provider" label={t('admin.models.form.provider')} rules={[{ required: true, message: t('admin.models.form.providerRequired') }]}>
              <Input onChange={(e) => updateFormField('provider', e.target.value)} />
            </Form.Item>
            <Form.Item name="model_id" label={t('admin.models.form.modelId')} rules={[{ required: true, message: t('admin.models.form.modelIdRequired') }]}>
              <Input onChange={(e) => updateFormField('model_id', e.target.value)} />
            </Form.Item>
            <Form.Item name="model_type" label={t('admin.models.form.type')}>
              <Select onChange={(val: string) => updateFormField('model_type', val)}>
                <Select.Option value="chat">chat</Select.Option>
                <Select.Option value="embedding">embedding</Select.Option>
                <Select.Option value="rerank">rerank</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="display_name" label={t('admin.models.form.displayName')}>
              <Input onChange={(e) => updateFormField('display_name', e.target.value)} />
            </Form.Item>
            <Form.Item name="base_url" label={t('admin.models.form.baseUrl')}>
              <Input onChange={(e) => updateFormField('base_url', e.target.value)} />
            </Form.Item>
            <Form.Item name="encrypted_api_key_ref" label={t('admin.models.form.apiKeyRef')}>
              <Input.Password
                placeholder={t('admin.models.form.apiKeyRefPlaceholder')}
                onChange={(e) => updateFormField('encrypted_api_key_ref', e.target.value)}
              />
            </Form.Item>
            <Form.Item name="visible_group_ids" label={t('admin.models.form.visibleGroupIds')}>
              <Input
                placeholder={t('admin.models.form.visibleGroupIdsPlaceholder')}
                onChange={(e) => updateFormField('visible_group_ids', e.target.value)}
              />
            </Form.Item>
            <Space style={{ width: '100%' }}>
              <Form.Item name="embedding_dim" label={t('admin.models.form.embeddingDim')}>
                <Input type="number" min={1} onChange={(e) => updateFormField('embedding_dim', e.target.value)} />
              </Form.Item>
              <Form.Item name="max_tokens" label={t('admin.models.form.maxTokens')}>
                <Input type="number" min={1} onChange={(e) => updateFormField('max_tokens', e.target.value)} />
              </Form.Item>
              <Form.Item name="rate_limit_rpm" label={t('admin.models.form.rateLimitRpm')}>
                <Input type="number" min={1} onChange={(e) => updateFormField('rate_limit_rpm', e.target.value)} />
              </Form.Item>
            </Space>
            <Form.Item name="enabled" valuePropName="checked">
              <Checkbox onChange={(e) => updateFormField('enabled', e.target.checked)}>
                {t('admin.models.form.enabled')}
              </Checkbox>
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </>
  );
}

export default requireAdminPage(ModelsPage);

function toModelRequest(form: ModelForm): ModelRequest {
  const body: ModelRequest = {
    provider: form.provider,
    model_id: form.model_id,
    model_type: form.model_type,
    enabled: form.enabled,
    visible_group_ids: parseIdList(form.visible_group_ids),
  };

  addOptionalString(body, 'display_name', form.display_name);
  addOptionalString(body, 'base_url', form.base_url);
  addOptionalString(body, 'encrypted_api_key_ref', form.encrypted_api_key_ref);
  addOptionalNumber(body, 'embedding_dim', form.embedding_dim);
  addOptionalNumber(body, 'max_tokens', form.max_tokens);
  addOptionalNumber(body, 'rate_limit_rpm', form.rate_limit_rpm);

  return body;
}

function addOptionalString<T extends Record<string, unknown>>(target: T, key: keyof T, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    target[key] = trimmed as T[keyof T];
  }
}

function addOptionalNumber<T extends Record<string, unknown>>(target: T, key: keyof T, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    target[key] = Number(trimmed) as T[keyof T];
  }
}

function normalizeModelType(value: string): ModelForm['model_type'] {
  if (value === 'embedding' || value === 'rerank') return value;
  return 'chat';
}
