from __future__ import annotations

import asyncio

import httpx
from aiohttp import web

from src.health import create_app


def test_health_endpoint_returns_expected_json(unused_tcp_port: int) -> None:
    asyncio.run(_assert_health_endpoint(unused_tcp_port))


async def _assert_health_endpoint(port: int) -> None:
    runner = web.AppRunner(create_app())
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"http://127.0.0.1:{port}/health")

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "healthy"
        assert payload["worker"] == "graphify-worker"
        assert isinstance(payload["uptime"], int | float)
    finally:
        await runner.cleanup()
