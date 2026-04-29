from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def run(job_data: dict[str, Any]) -> dict[str, str]:
    logger.info(
        "job received, no-op",
        extra={"job_id": job_data.get("id") or job_data.get("job_id")},
    )
    return {"status": "success"}
