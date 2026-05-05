import type { DocmostPushBridgeClient } from './processors/docmost-push.processor.js';

export class BridgeClientHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BridgeClientHttpError';
  }
}

export function createBridgeClient(baseUrl: string, secret: string): DocmostPushBridgeClient {
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
