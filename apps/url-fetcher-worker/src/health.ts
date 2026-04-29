import { createServer, type Server } from 'node:http';

export type WorkerHealthPayload = {
  status: 'healthy';
  worker: string;
  uptime: number;
};

export function createHealthServer(workerName: string, startedAt = Date.now()): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      const payload: WorkerHealthPayload = {
        status: 'healthy',
        worker: workerName,
        uptime: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
      };

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });
}

export function startHealthServer(workerName: string, port: number): Promise<Server> {
  const server = createHealthServer(workerName);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

export function closeHealthServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}
