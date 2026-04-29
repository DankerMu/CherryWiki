from __future__ import annotations

import asyncio
import logging
import os
import signal
from collections.abc import Callable
from types import FrameType

from aiohttp import web

from .health import create_app
from .job_client import poll_jobs

logger = logging.getLogger(__name__)


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

    health_port = _parse_port(os.environ.get("WORKER_HEALTH_PORT"), 9090)
    api_base_url = os.environ.get("API_BASE_URL", "http://cherry-api:8080")
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    stop_event = asyncio.Event()

    runner = web.AppRunner(create_app())
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", health_port)
    await site.start()

    polling_task = asyncio.create_task(
        poll_jobs(api_base_url, redis_url=redis_url, stop_event=stop_event),
        name="graphify-job-poller",
    )
    _register_shutdown_handlers(stop_event)

    logger.info("graphify-worker started on health port %s", health_port)
    await stop_event.wait()

    polling_task.cancel()
    try:
        await polling_task
    except asyncio.CancelledError:
        pass
    finally:
        await runner.cleanup()
        logger.info("graphify-worker stopped")


def _register_shutdown_handlers(stop_event: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()

    def request_shutdown() -> None:
        logger.info("shutdown requested")
        stop_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, request_shutdown)
        except NotImplementedError:
            signal.signal(sig, _signal_handler(request_shutdown))


def _signal_handler(callback: Callable[[], None]) -> Callable[[int, FrameType | None], None]:
    def handler(_signum: int, _frame: FrameType | None) -> None:
        callback()

    return handler


def _parse_port(value: str | None, default: int) -> int:
    if value is None or value.strip() == "":
        return default

    parsed = int(value)
    if parsed < 1 or parsed > 65535:
        raise ValueError(f"Invalid port value: {value}")

    return parsed


if __name__ == "__main__":
    asyncio.run(main())
