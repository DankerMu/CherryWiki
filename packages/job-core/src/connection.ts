import { Redis as IORedis } from 'ioredis';

export function createBullMQConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}
