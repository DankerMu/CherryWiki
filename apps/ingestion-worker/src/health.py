from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class _HealthHandler(BaseHTTPRequestHandler):
    worker_name = "ingestion-worker"
    started_at = time.time()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/health":
            self._send_json(404, {"error": "not_found"})
            return

        self._send_json(
            200,
            {
                "status": "healthy",
                "worker": self.worker_name,
                "uptime": round(time.time() - self.started_at, 3),
            },
        )

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_health_server(
    port: int, worker_name: str = "ingestion-worker"
) -> ThreadingHTTPServer:
    _HealthHandler.worker_name = worker_name
    _HealthHandler.started_at = time.time()
    server = ThreadingHTTPServer(("0.0.0.0", port), _HealthHandler)
    thread = threading.Thread(
        target=server.serve_forever, name="health-server", daemon=True
    )
    thread.start()
    return server
