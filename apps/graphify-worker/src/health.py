from __future__ import annotations

import time

from aiohttp import web

WORKER_NAME = "graphify-worker"


def create_app(started_at: float | None = None) -> web.Application:
    start_time = time.monotonic() if started_at is None else started_at
    app = web.Application()

    async def health(_request: web.Request) -> web.Response:
        return web.json_response(
            {
                "status": "healthy",
                "worker": WORKER_NAME,
                "uptime": round(time.monotonic() - start_time, 3),
            }
        )

    app.router.add_get("/health", health)
    return app
