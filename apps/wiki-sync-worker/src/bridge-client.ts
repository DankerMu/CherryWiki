import { createHash, createHmac, randomUUID } from 'node:crypto';

import type { DocmostPushBridgeClient } from './processors/docmost-push.processor.js';
import type { PermissionSyncBridgeClient } from './processors/permission-sync.processor.js';
import type { SpaceProvisionBridgeClient } from './processors/space-provision.processor.js';
import type { UserSyncBridgeClient } from './processors/user-sync.processor.js';

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
): DocmostPushBridgeClient & PermissionSyncBridgeClient & SpaceProvisionBridgeClient & UserSyncBridgeClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  return {
    async syncUser(input) {
      const path = '/api/internal/bridge/users';
      const body = JSON.stringify({
        email: input.email,
        name: input.name,
        cherry_user_id: input.cherry_user_id,
      });
      const response = await fetch(`${normalizedBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          ...createBridgeHeaders(secret, 'POST', path, body),
          'content-type': 'application/json',
        },
        body,
      });

      if (!response.ok) {
        throw new BridgeClientHttpError(
          `Bridge user sync failed for Cherry user ${input.cherry_user_id}: HTTP ${response.status}`,
          response.status,
        );
      }

      const payload = readRecord(await response.json());
      const docmostUserId = readString(payload.docmost_user_id);
      if (docmostUserId === undefined) {
        throw new Error('Bridge user sync response did not include docmost_user_id');
      }

      return { docmost_user_id: docmostUserId };
    },

    async provisionSpace(input) {
      const path = '/api/internal/bridge/spaces';
      const body = JSON.stringify({
        name: input.name,
        slug: input.slug,
        cherry_space_id: input.cherry_space_id,
      });
      const response = await fetch(`${normalizedBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          ...createBridgeHeaders(secret, 'POST', path, body),
          'content-type': 'application/json',
        },
        body,
      });

      if (!response.ok) {
        throw new BridgeClientHttpError(
          `Bridge space provision failed for Cherry space ${input.cherry_space_id}: HTTP ${response.status}`,
          response.status,
        );
      }

      const payload = readRecord(await response.json());
      const docmostSpaceId = readString(payload.docmost_space_id);
      if (docmostSpaceId === undefined) {
        throw new Error('Bridge space provision response did not include docmost_space_id');
      }

      return { docmost_space_id: docmostSpaceId };
    },

    async importPage(pageId, markdown, opts) {
      const path = `/api/internal/bridge/pages/${encodeURIComponent(pageId)}/import`;
      const body = JSON.stringify({
        markdown,
        overwrite_policy: opts.overwritePolicy,
        ...(opts.expectedHash !== undefined ? { expected_hash: opts.expectedHash } : {}),
      });
      const response = await fetch(
        `${normalizedBaseUrl}${path}`,
        {
          method: 'PUT',
          headers: {
            ...createBridgeHeaders(secret, 'PUT', path, body),
            'content-type': 'application/json',
          },
          body,
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
      const path = `/api/internal/bridge/pages/${encodeURIComponent(pageId)}/export?format=markdown`;
      const response = await fetch(
        `${normalizedBaseUrl}${path}`,
        { headers: createBridgeHeaders(secret, 'GET', path, '') },
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

    async pushPermissions(docmostSpaceId, members, opts) {
      const path = `/api/internal/bridge/spaces/${encodeURIComponent(docmostSpaceId)}/permissions`;
      const body = JSON.stringify({
        groups: members.map((member) => ({
          group_id: member.userId,
          permissions: [docmostRoleToPermission(member.role)],
        })),
        version: opts?.version ?? Date.now(),
        source: opts?.source ?? 'cherry_api',
      });
      const response = await fetch(
        `${normalizedBaseUrl}${path}`,
        {
          method: 'PUT',
          headers: {
            ...createBridgeHeaders(secret, 'PUT', path, body),
            'content-type': 'application/json',
          },
          body,
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
      const path = `/api/internal/bridge/spaces/${encodeURIComponent(docmostSpaceId)}/permissions`;
      const response = await fetch(
        `${normalizedBaseUrl}${path}`,
        { headers: createBridgeHeaders(secret, 'GET', path, '') },
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

function createBridgeHeaders(
  secret: string,
  method: string,
  path: string,
  body: string,
): Record<string, string> {
  if (secret.length === 0) {
    return {};
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const payload = [timestamp, nonce, method.toUpperCase(), path, bodyHash].join('\n');
  const signature = createHmac('sha256', secret).update(payload).digest('hex');

  return {
    Authorization: `Bearer ${secret}`,
    'X-Bridge-Timestamp': timestamp,
    'X-Bridge-Nonce': nonce,
    'X-Bridge-Signature': `sha256=${signature}`,
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

function docmostRoleToPermission(role: 'admin' | 'writer' | 'reader'): 'admin' | 'edit' | 'view' {
  if (role === 'admin') {
    return 'admin';
  }
  if (role === 'writer') {
    return 'edit';
  }
  return 'view';
}
