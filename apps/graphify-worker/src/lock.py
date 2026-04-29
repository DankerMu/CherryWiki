from __future__ import annotations

from typing import Protocol

LOCK_KEY_PREFIX = "lock:job:"


class RedisLockClient(Protocol):
    async def set(self, name: str, value: str, *, ex: int, nx: bool) -> object:
        ...

    async def get(self, name: str) -> str | bytes | None:
        ...

    async def delete(self, name: str) -> int:
        ...


async def acquire_lock(redis_client: RedisLockClient, job_id: str, worker_id: str, ttl: int = 600) -> bool:
    result = await redis_client.set(_lock_key(job_id), worker_id, ex=ttl, nx=True)
    return bool(result)


async def release_lock(redis_client: RedisLockClient, job_id: str, worker_id: str) -> bool:
    current_owner = await redis_client.get(_lock_key(job_id))
    if isinstance(current_owner, bytes):
        current_owner = current_owner.decode("utf-8")

    if current_owner != worker_id:
        return False

    deleted = await redis_client.delete(_lock_key(job_id))
    return bool(deleted)


def _lock_key(job_id: str) -> str:
    return f"{LOCK_KEY_PREFIX}{job_id}"
