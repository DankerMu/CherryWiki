import { get } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { closeHealthServer, startHealthServer } from '../health.js';

describe('ingestion-worker health server', () => {
  it('returns the expected health response', async () => {
    const server = await startHealthServer('ingestion-worker', 0);

    try {
      const address = server.address();
      if (!isAddressInfo(address)) {
        throw new Error('Expected the test server to bind a TCP port');
      }

      const response = await requestJson(address.port);
      expect(response.statusCode).toBe(200);
      expect(response.body).toMatchObject({
        status: 'healthy',
        worker: 'ingestion-worker',
      });
      expect(typeof response.body.uptime).toBe('number');
    } finally {
      await closeHealthServer(server);
    }
  });
});

type HealthResponse = {
  statusCode: number;
  body: {
    status?: unknown;
    worker?: unknown;
    uptime?: unknown;
  };
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
        const parsed = JSON.parse(data) as HealthResponse['body'];
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
