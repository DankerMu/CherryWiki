from __future__ import annotations

import asyncio

from src.lock import RELEASE_SCRIPT, acquire_lock, release_lock


def test_acquire_lock_uses_set_nx_ex_semantics() -> None:
    asyncio.run(_assert_acquire_lock_uses_set_nx_ex_semantics())


def test_release_lock_only_deletes_owned_lock() -> None:
    asyncio.run(_assert_release_lock_only_deletes_owned_lock())


async def _assert_acquire_lock_uses_set_nx_ex_semantics() -> None:
    redis = FakeRedis()

    assert await acquire_lock(redis, "job-1", "worker-1", ttl=600) is True
    assert await acquire_lock(redis, "job-1", "worker-2", ttl=600) is False
    assert redis.store["lock:job:job-1"] == "worker-1"
    assert redis.expirations["lock:job:job-1"] == 600


async def _assert_release_lock_only_deletes_owned_lock() -> None:
    redis = FakeRedis()
    assert await acquire_lock(redis, "job-1", "worker-1") is True

    assert await release_lock(redis, "job-1", "worker-2") is False
    assert redis.store["lock:job:job-1"] == "worker-1"

    assert await release_lock(redis, "job-1", "worker-1") is True
    assert "lock:job:job-1" not in redis.store


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.expirations: dict[str, int] = {}

    async def set(self, name: str, value: str, *, ex: int, nx: bool) -> bool:
        if nx and name in self.store:
            return False

        self.store[name] = value
        self.expirations[name] = ex
        return True

    async def eval(self, script: str, numkeys: int, *keys_and_args: str) -> int:
        assert script == RELEASE_SCRIPT
        assert numkeys == 1
        name, owner = keys_and_args

        if self.store.get(name) != owner:
            return 0

        if name not in self.store:
            return 0

        del self.store[name]
        self.expirations.pop(name, None)
        return 1
