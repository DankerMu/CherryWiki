import { createReadStream } from 'node:fs';
import { basename } from 'node:path';

const API_BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:8081';

type Headers = Record<string, string>;

let cachedToken: string | undefined;

async function request(method: string, path: string, opts?: {
  body?: unknown;
  headers?: Headers;
  token?: string;
  raw?: boolean;
}): Promise<Response> {
  const headers: Headers = { ...(opts?.headers ?? {}) };
  const token = opts?.token ?? cachedToken;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts?.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const url = `${API_BASE}/api/${path.replace(/^\/?(api\/)?/, '')}`;
  return fetch(url, {
    method,
    headers,
    body: opts?.body
      ? typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
      : undefined,
  });
}

export async function login(email: string, password: string): Promise<string> {
  const res = await request('POST', 'auth/login', {
    body: { email, password },
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  const data = await res.json() as { data: { access_token: string } };
  cachedToken = data.data.access_token;
  return cachedToken;
}

export function setToken(token: string): void {
  cachedToken = token;
}

export function clearToken(): void {
  cachedToken = undefined;
}

export async function get<T = unknown>(path: string): Promise<T> {
  const res = await request('GET', path);
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status}): ${await res.text()}`);
  const json = await res.json() as { data: T };
  return json.data;
}

export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await request('POST', path, { body });
  if (!res.ok) throw new Error(`POST ${path} failed (${res.status}): ${await res.text()}`);
  const json = await res.json() as { data: T };
  return json.data;
}

export async function patch<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await request('PATCH', path, { body });
  if (!res.ok) throw new Error(`PATCH ${path} failed (${res.status}): ${await res.text()}`);
  const json = await res.json() as { data: T };
  return json.data;
}

export async function del(path: string): Promise<void> {
  const res = await request('DELETE', path);
  if (!res.ok) throw new Error(`DELETE ${path} failed (${res.status}): ${await res.text()}`);
}

export async function uploadFile(spaceId: string, filePath: string): Promise<{
  id: string;
  source_document_id: string;
  status: string;
}> {
  const token = cachedToken;
  if (!token) throw new Error('Not logged in');

  const fileBuffer = await (await import('node:fs/promises')).readFile(filePath);
  const fileName = basename(filePath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), fileName);

  const url = `${API_BASE}/api/spaces/${spaceId}/uploads`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
  const json = await res.json() as { data: { id: string; source_document_id: string; status: string } };
  return json.data;
}

export type ChatSSEEvent = {
  type: string;
  [key: string]: unknown;
};

export async function chatStream(
  message: string,
  opts?: { spaceId?: string; spaceIds?: string[]; sessionId?: string; retrievalMode?: string },
): Promise<ChatSSEEvent[]> {
  const token = cachedToken;
  if (!token) throw new Error('Not logged in');

  const body: Record<string, unknown> = { message };
  if (opts?.spaceId) body.space_id = opts.spaceId;
  if (opts?.spaceIds) body.space_ids = opts.spaceIds;
  if (opts?.sessionId) body.session_id = opts.sessionId;
  if (opts?.retrievalMode) body.retrieval_mode = opts.retrievalMode;

  const url = `${API_BASE}/api/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Chat failed (${res.status}): ${await res.text()}`);
  if (!res.body) throw new Error('Chat response has no body');

  const events: ChatSSEEvent[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEventType = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (currentEventType && !parsed.type) {
            parsed.type = currentEventType;
          }
          events.push(parsed);
        } catch {
          // skip malformed
        }
        currentEventType = '';
      } else if (line.trim() === '') {
        currentEventType = '';
      }
    }
  }

  return events;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}
