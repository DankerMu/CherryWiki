import type { DocmostPushBridgeClient } from './processors/docmost-push.processor.js';
import type { PermissionSyncBridgeClient } from './processors/permission-sync.processor.js';

export class BridgeClientHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BridgeClientHttpError';
  }
}

export function createBridgeClient(
  baseUrl: string,
  secret: string,
): DocmostPushBridgeClient & PermissionSyncBridgeClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const headers = secret.length > 0 ? { Authorization: `Bearer ${secret}` } : {};

  return {
    async importPage(pageId, markdown, opts) {
      const response = await fetch(
        `${normalizedBaseUrl}/api/internal/bridge/pages/${encodeURIComponent(pageId)}/import`,
        {
          method: 'PUT',
          headers: {
            ...headers,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            markdown,
            overwrite_policy: opts.overwritePolicy,
            ...(opts.expectedHash !== undefined ? { expected_hash: opts.expectedHash } : {}),
          }),
        },
      );

      if (!response.ok) {
        throw new BridgeClientHttpError(
          `Bridge import failed for page ${pageId}: HTTP ${response.status}`,
          response.status,
        );
      }

      const payload = readRecord(await response.json());
      const docmostPageId = readString(payload.docmostPageId) ?? readString(payload.docmost_page_id) ?? readString(payload.page_id);
      const contentHash = readString(payload.contentHash) ?? readString(payload.content_hash);
      if (docmostPageId === undefined || contentHash === undefined) {
        throw new Error(`Bridge import response for page ${pageId} did not include docmostPageId and contentHash`);
      }

      return { docmostPageId, contentHash };
    },

    async exportPage(pageId) {
      const response = await fetch(
        `${normalizedBaseUrl}/api/internal/bridge/pages/${encodeURIComponent(pageId)}/export?format=markdown`,
        { headers },
      );

      if (!response.ok) {
        throw new BridgeClientHttpError(
          `Bridge export failed for page ${pageId}: HTTP ${response.status}`,
          response.status,
        );
      }

      const payload = readRecord(await response.json());
      const markdown = readString(payload.markdown) ?? readString(payload.content);
      if (markdown === undefined) {
        throw new Error(`Bridge export response for page ${pageId} did not include markdown content`);
      }

      return { markdown };
    },

    async pushPermissions(docmostSpaceId, members) {
      const response = await fetch(
        `${normalizedBaseUrl}/api/internal/bridge/spaces/${encodeURIComponent(docmostSpaceId)}/permissions`,
        {
          method: 'PUT',
          headers: {
            ...headers,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ members }),
        },
      );

      if (!response.ok) {
        throw new BridgeClientHttpError(
          `Bridge permissions push failed for space ${docmostSpaceId}: HTTP ${response.status}`,
          response.status,
        );
      }
    },

    async getPermissions(docmostSpaceId) {
      const response = await fetch(
        `${normalizedBaseUrl}/api/internal/bridge/spaces/${encodeURIComponent(docmostSpaceId)}/permissions`,
        { headers },
      );

      if (!response.ok) {
        throw new BridgeClientHttpError(
          `Bridge permissions fetch failed for space ${docmostSpaceId}: HTTP ${response.status}`,
          response.status,
        );
      }

      const payload = await response.json();
      const rawMembers = Array.isArray(payload) ? payload : readArray(readRecord(payload).members);
      return rawMembers.flatMap(readPermissionMember);
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readPermissionMember(value: unknown): Array<{ userId: string; email: string; role: 'admin' | 'writer' | 'reader' }> {
  const record = readRecord(value);
  const userId = readString(record.userId) ?? readString(record.user_id);
  const email = readString(record.email);
  const role = readPermissionRole(record.role);

  if (userId === undefined || email === undefined || role === undefined) {
    return [];
  }

  return [{ userId, email, role }];
}

function readPermissionRole(value: unknown): 'admin' | 'writer' | 'reader' | undefined {
  return value === 'admin' || value === 'writer' || value === 'reader' ? value : undefined;
}
