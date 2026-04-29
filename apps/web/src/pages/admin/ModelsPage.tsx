import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
  getErrorMessage,
  parseIdList,
} from '../../components/adminUi';
import { api } from '../../lib/api';
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

export default function ModelsPage() {
  const [models, setModels] = useState<AdminModel[]>([]);
  const [form, setForm] = useState<ModelForm | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ModelConnectivityResult>>({});
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await api.get<AdminModel[]>('/admin/models', { per_page: 100, sort: 'provider' });
      setModels(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  async function submitModel(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form === null) {
      return;
    }

    setIsSaving(true);
    setError(null);
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
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleModel(model: AdminModel): Promise<void> {
    setError(null);
    try {
      await api.patch<AdminModel>(`/admin/models/${model.id}`, {
        enabled: model.status !== 'active',
      });
      await loadModels();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function testModel(model: AdminModel): Promise<void> {
    setTestingModelId(model.id);
    setError(null);
    try {
      const result = await api.post<ModelConnectivityResult>(`/admin/models/${model.id}/test`, {
        test_prompt: 'Admin console connectivity test',
      });
      setTestResults((current) => ({ ...current, [model.id]: result }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setTestingModelId(null);
    }
  }

  function openEditForm(model: AdminModel): void {
    setForm({
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
    });
  }

  return (
    <>
      <PageHeader
        title="Models"
        description="Manage model providers, visibility, limits, and connectivity."
        actions={
          <button className="button button-primary" type="button" onClick={() => setForm({ ...EMPTY_MODEL_FORM })}>
            Add Model
          </button>
        }
      />
      <ErrorBanner error={error} />

      {isLoading ? (
        <LoadingState />
      ) : models.length === 0 ? (
        <EmptyState label="No models have been configured." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Provider</th>
                <th>Type</th>
                <th>Status</th>
                <th>Config</th>
                <th>Test</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const testResult = testResults[model.id];
                return (
                  <tr key={model.id}>
                    <td>
                      <strong>{model.name ?? model.model_id}</strong>
                      <span className="subtle-id">{model.model_id}</span>
                    </td>
                    <td>{model.provider}</td>
                    <td>{model.model_type}</td>
                    <td>
                      <StatusBadge status={model.status} />
                    </td>
                    <td>
                      {model.config.base_url ?? 'Default endpoint'}
                      {model.config.max_tokens !== null ? `; ${model.config.max_tokens} max tokens` : ''}
                    </td>
                    <td>
                      {testResult === undefined ? (
                        <span className="muted-copy">Not tested</span>
                      ) : (
                        <span className={testResult.reachable ? 'test-ok' : 'test-fail'}>
                          {testResult.reachable ? 'Reachable' : testResult.error ?? 'Failed'} ({testResult.latency_ms} ms)
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="button button-secondary" type="button" onClick={() => openEditForm(model)}>
                          Edit
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={testingModelId === model.id}
                          onClick={() => {
                            void testModel(model);
                          }}
                        >
                          {testingModelId === model.id ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          className="button button-danger"
                          type="button"
                          onClick={() => {
                            void toggleModel(model);
                          }}
                        >
                          {model.status === 'active' ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form !== null ? (
        <Modal title={form.id === undefined ? 'Add Model' : 'Edit Model'} onClose={() => setForm(null)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              void submitModel(event);
            }}
          >
            <label>
              Provider *
              <input
                required
                type="text"
                value={form.provider}
                onChange={(event) => setForm((current) => (current === null ? current : { ...current, provider: event.target.value }))}
              />
            </label>
            <label>
              Model ID *
              <input
                required
                type="text"
                value={form.model_id}
                onChange={(event) => setForm((current) => (current === null ? current : { ...current, model_id: event.target.value }))}
              />
            </label>
            <label>
              Type *
              <select
                value={form.model_type}
                onChange={(event) =>
                  setForm((current) =>
                    current === null
                      ? current
                      : { ...current, model_type: event.target.value as ModelForm['model_type'] },
                  )
                }
              >
                <option value="chat">chat</option>
                <option value="embedding">embedding</option>
                <option value="rerank">rerank</option>
              </select>
            </label>
            <label>
              Display name
              <input
                type="text"
                value={form.display_name}
                onChange={(event) => setForm((current) => (current === null ? current : { ...current, display_name: event.target.value }))}
              />
            </label>
            <label className="span-2">
              Base URL
              <input
                type="url"
                value={form.base_url}
                onChange={(event) => setForm((current) => (current === null ? current : { ...current, base_url: event.target.value }))}
              />
            </label>
            <label>
              API key ref
              <input
                type="text"
                value={form.encrypted_api_key_ref}
                onChange={(event) =>
                  setForm((current) => (current === null ? current : { ...current, encrypted_api_key_ref: event.target.value }))
                }
              />
            </label>
            <label>
              Visible group IDs
              <input
                type="text"
                value={form.visible_group_ids}
                onChange={(event) =>
                  setForm((current) => (current === null ? current : { ...current, visible_group_ids: event.target.value }))
                }
                placeholder="Comma-separated group IDs"
              />
            </label>
            <label>
              Embedding dim
              <input
                type="number"
                min="1"
                value={form.embedding_dim}
                onChange={(event) => setForm((current) => (current === null ? current : { ...current, embedding_dim: event.target.value }))}
              />
            </label>
            <label>
              Max tokens
              <input
                type="number"
                min="1"
                value={form.max_tokens}
                onChange={(event) => setForm((current) => (current === null ? current : { ...current, max_tokens: event.target.value }))}
              />
            </label>
            <label>
              Rate limit rpm
              <input
                type="number"
                min="1"
                value={form.rate_limit_rpm}
                onChange={(event) => setForm((current) => (current === null ? current : { ...current, rate_limit_rpm: event.target.value }))}
              />
            </label>
            <label className="checkbox-row model-enabled">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm((current) => (current === null ? current : { ...current, enabled: event.target.checked }))}
              />
              Enabled
            </label>
            <div className="form-actions span-2">
              <button className="button button-secondary" type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="button button-primary" type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Model'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

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
  if (value === 'embedding' || value === 'rerank') {
    return value;
  }

  return 'chat';
}
