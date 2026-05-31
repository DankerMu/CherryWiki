import Redis from 'ioredis';

let redis: Redis | undefined;

export function getRedis(): Redis {
  if (redis) return redis;
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = undefined;
  }
}
