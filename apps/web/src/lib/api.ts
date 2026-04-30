export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
};

export type ApiMeta = {
  request_id?: string;
  pagination?: {
    page: number;
    per_page: number;
    total: number;
    has_next: boolean;
  };
};

export type ApiWrappedResponse<T> = {
  data: T;
  meta?: ApiMeta;
};

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(input: { status: number; code: string; message: string; details?: unknown }) {
    super(input.message);
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
  }
}

type RequestOptions = {
  body?: unknown;
  query?: QueryParams | undefined;
  headers?: HeadersInit | undefined;
};

type ApiClientConfig = {
  getAccessToken?: () => string | null;
  onUnauthorized?: () => void;
};

let accessTokenProvider: () => string | null = () => null;
let unauthorizedHandler: (() => void) | undefined;

export function configureApiClient(config: ApiClientConfig): void {
  accessTokenProvider = config.getAccessToken ?? (() => null);
  unauthorizedHandler = config.onUnauthorized;
}

export const api = {
  get<T>(path: string, query?: QueryParams): Promise<T> {
    return requestData<T>('GET', path, { query });
  },
  getWrapped<T>(path: string, query?: QueryParams): Promise<ApiWrappedResponse<T>> {
    return requestWrapped<T>('GET', path, { query });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return requestData<T>('POST', path, { body });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return requestData<T>('PUT', path, { body });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return requestData<T>('PATCH', path, { body });
  },
  delete<T>(path: string): Promise<T> {
    return requestData<T>('DELETE', path);
  },
};

async function requestData<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await requestWrapped<T>(method, path, options);
  return response.data;
}

async function requestWrapped<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiWrappedResponse<T>> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  const token = accessTokenProvider();
  if (token !== null && token.length > 0) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const init: RequestInit = {
    method,
    credentials: 'include',
    headers,
  };

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(buildApiUrl(path, options.query), init);
  const body = await readJson(response);

  if (!response.ok) {
    const error = createApiError(response.status, body);
    if (response.status === 401) {
      unauthorizedHandler?.();
    }
    throw error;
  }

  return wrapResponse<T>(body);
}

function buildApiUrl(path: string, query?: QueryParams): string {
  const basePath = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }

  const queryString = params.toString();
  return queryString.length > 0 ? `${basePath}?${queryString}` : basePath;
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function wrapResponse<T>(body: unknown): ApiWrappedResponse<T> {
  if (isRecord(body) && 'data' in body) {
    return {
      data: body.data as T,
      ...(isRecord(body.meta) ? { meta: normalizeMeta(body.meta) } : {}),
    };
  }

  return {
    data: body as T,
  };
}

function createApiError(status: number, body: unknown): ApiError {
  const normalized = normalizeErrorBody(body);
  return new ApiError({
    status,
    code: normalized.code,
    message: normalized.message,
    details: normalized.details,
  });
}

function normalizeErrorBody(body: unknown): { code: string; message: string; details?: unknown } {
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error)) {
      const code = typeof error.code === 'string' ? error.code : 'API_ERROR';
      const message = typeof error.message === 'string' ? error.message : 'Request failed';
      return { code, message, details: error.details };
    }

    if (typeof body.message === 'string') {
      return { code: 'API_ERROR', message: body.message };
    }
  }

  return { code: 'API_ERROR', message: 'Request failed' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeMeta(meta: Record<string, unknown>): ApiMeta {
  return {
    ...(typeof meta.request_id === 'string' ? { request_id: meta.request_id } : {}),
    ...(isPaginationMeta(meta.pagination) ? { pagination: meta.pagination } : {}),
  };
}

function isPaginationMeta(value: unknown): value is NonNullable<ApiMeta['pagination']> {
  return (
    isRecord(value) &&
    typeof value.page === 'number' &&
    typeof value.per_page === 'number' &&
    typeof value.total === 'number' &&
    typeof value.has_next === 'boolean'
  );
}
