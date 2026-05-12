import { get } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { closeHealthServer, startHealthServer, type WikiSyncHealthPayload } from '../health.js';

describe('wiki-sync-worker health server', () => {
  it('returns queue pending counts', async () => {
    const server = await startHealthServer(
      {
        'page-sync': { getWaitingCount: vi.fn(() => Promise.resolve(2)) },
        'permission-sync': { getWaitingCount: vi.fn(() => Promise.resolve(1)) },
        'attachment-sync': { getWaitingCount: vi.fn(() => Promise.resolve(4)) },
        'docmost-push': { getWaitingCount: vi.fn(() => Promise.resolve(3)) },
        'space-provision': { getWaitingCount: vi.fn(() => Promise.resolve(5)) },
      },
      0,
    );

    try {
      const address = server.address();
      if (!isAddressInfo(address)) {
        throw new Error('Expected the test server to bind a TCP port');
      }

      const response = await requestJson(address.port);
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        queues: {
          'page-sync': 2,
          'permission-sync': 1,
          'attachment-sync': 4,
          'docmost-push': 3,
          'space-provision': 5,
        },
      });
    } finally {
      await closeHealthServer(server);
    }
  });
});

type HealthResponse = {
  statusCode: number;
  body: WikiSyncHealthPayload;
};

function requestJson(port: number): Promise<HealthResponse> {
  return new Promise((resolve, reject) => {
    const request = get({ host: '127.0.0.1', port, path: '/health' }, (response) => {
      response.setEncoding('utf8');
      let data = '';

      response.on('data', (chunk: string) => {
        data += chunk;
      });

      response.on('end', () => {
        const parsed = JSON.parse(data) as WikiSyncHealthPayload;
        resolve({ statusCode: response.statusCode ?? 0, body: parsed });
      });
    });

    request.on('error', reject);
  });
}

function isAddressInfo(address: ReturnType<ServerAddress>): address is AddressInfo {
  return typeof address === 'object' && address !== null;
}

type ServerAddress = typeof import('node:http').Server.prototype.address;
