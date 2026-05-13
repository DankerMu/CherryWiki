import { createServer, type Server } from 'node:http';

export type PendingQueue = {
  getWaitingCount: () => Promise<number>;
};

export type WikiSyncHealthQueues = {
  'page-sync': PendingQueue;
  'permission-sync': PendingQueue;
  'attachment-sync': PendingQueue;
  'docmost-push': PendingQueue;
  reindex: PendingQueue;
  'space-provision': PendingQueue;
  'user-sync': PendingQueue;
};

export type WikiSyncHealthPayload = {
  status: 'ok';
  queues: {
    'page-sync': number;
    'permission-sync': number;
    'attachment-sync': number;
    'docmost-push': number;
    reindex: number;
    'space-provision': number;
    'user-sync': number;
  };
};

export function createHealthServer(queues: WikiSyncHealthQueues): Server {
  return createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    void buildHealthPayload(queues)
      .then((payload) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      })
      .catch((error: unknown) => {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'error', error: String(error) }));
      });
  });
}

export async function buildHealthPayload(queues: WikiSyncHealthQueues): Promise<WikiSyncHealthPayload> {
  const [pageSync, permissionSync, attachmentSync, docmostPush, reindex, spaceProvision, userSync] = await Promise.all([
    queues['page-sync'].getWaitingCount(),
    queues['permission-sync'].getWaitingCount(),
    queues['attachment-sync'].getWaitingCount(),
    queues['docmost-push'].getWaitingCount(),
    queues.reindex.getWaitingCount(),
    queues['space-provision'].getWaitingCount(),
    queues['user-sync'].getWaitingCount(),
  ]);

  return {
    status: 'ok',
    queues: {
      'page-sync': pageSync,
      'permission-sync': permissionSync,
      'attachment-sync': attachmentSync,
      'docmost-push': docmostPush,
      reindex,
      'space-provision': spaceProvision,
      'user-sync': userSync,
    },
  };
}

export function startHealthServer(queues: WikiSyncHealthQueues, port: number): Promise<Server> {
  const server = createHealthServer(queues);

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
