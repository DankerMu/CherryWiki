import { Global, Inject, Injectable, Module, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Redis, type Redis as RedisClient } from 'ioredis';

import { getApiLogger } from '../logger/logger.module.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type OptionalRedisClient = RedisClient | undefined;

@Injectable()
class RedisShutdown implements OnModuleDestroy {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis?: OptionalRedisClient) {}

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: createRedisClient,
    },
    RedisShutdown,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}

function createRedisClient(): OptionalRedisClient {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl === undefined || redisUrl.length === 0) {
    if (process.env.NODE_ENV !== 'test') {
      getApiLogger().warn({ redis_url_present: false }, 'Redis disabled because REDIS_URL is not configured');
    }

    return undefined;
  }

  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  client.on('error', (err: Error) => {
    getApiLogger().warn({ err }, 'Redis connection error');
  });

  void client.connect().catch((err: unknown) => {
    getApiLogger().warn({ err }, 'Redis initial connection failed');
  });

  return client;
}
