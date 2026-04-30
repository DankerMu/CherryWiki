export interface RedisJobLockClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<number | string | null>;
}

const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export class RedisJobLock {
  static acquire(
    redis: RedisJobLockClient,
    jobId: string,
    workerId: string,
    ttlSeconds = 600,
  ): Promise<boolean> {
    return this.setIf(redis, jobId, workerId, ttlSeconds, 'NX');
  }

  static async renew(
    redis: RedisJobLockClient,
    jobId: string,
    workerId: string,
    ttlSeconds = 600,
  ): Promise<boolean> {
    const key = this.key(jobId);
    if ((await redis.get(key)) !== workerId) {
      return false;
    }

    return this.setIf(redis, jobId, workerId, ttlSeconds, 'XX');
  }

  static async release(redis: RedisJobLockClient, jobId: string, workerId: string): Promise<boolean> {
    const result = await redis.eval(RELEASE_LOCK_SCRIPT, 1, this.key(jobId), workerId);
    return normalizeRedisResult(result) > 0;
  }

  static key(jobId: string): string {
    return `job:lock:${jobId}`;
  }

  private static async setIf(
    redis: RedisJobLockClient,
    jobId: string,
    workerId: string,
    ttlSeconds: number,
    mode: 'NX' | 'XX',
  ): Promise<boolean> {
    const result = await redis.set(this.key(jobId), workerId, 'EX', ttlSeconds, mode);
    return result === 'OK';
  }
}

function normalizeRedisResult(value: number | string | null): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}
