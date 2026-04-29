from __future__ import annotations

from typing import Protocol

LOCK_KEY_PREFIX = "lock:job:"
RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
"""


class RedisLockClient(Protocol):
    async def set(self, name: str, value: str, *, ex: int, nx: bool) -> object:
        ...

    async def eval(self, script: str, numkeys: int, *keys_and_args: str) -> object:
        ...


async def acquire_lock(redis_client: RedisLockClient, job_id: str, worker_id: str, ttl: int = 600) -> bool:
    result = await redis_client.set(_lock_key(job_id), worker_id, ex=ttl, nx=True)
    return bool(result)


async def release_lock(redis_client: RedisLockClient, job_id: str, worker_id: str) -> bool:
    deleted = await redis_client.eval(RELEASE_SCRIPT, 1, _lock_key(job_id), worker_id)
    return bool(deleted)


def _lock_key(job_id: str) -> str:
    return f"{LOCK_KEY_PREFIX}{job_id}"
