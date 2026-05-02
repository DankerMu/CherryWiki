from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from src.storage_client import MinioStorageClient, parse_storage_uri


def test_parse_storage_uri_rejects_path_traversal() -> None:
    assert parse_storage_uri("s3://bucket/path/file.md").bucket == "bucket"
    assert parse_storage_uri("s3://bucket/path/file.md").key == "path/file.md"

    with pytest.raises(ValueError):
        parse_storage_uri("s3://bucket/path/../file.md")


def test_download_file_uses_signed_get_and_writes_destination(tmp_path: Path) -> None:
    session = FakeSession([FakeResponse(b"parsed markdown")])
    client = MinioStorageClient(
        endpoint="http://minio:9000",
        access_key="access",
        secret_key="secret",
        session=session,
    )

    destination = tmp_path / "nested" / "parsed.md"
    client.download_file("s3://source-bucket/path/parsed.md", destination)

    assert destination.read_bytes() == b"parsed markdown"
    request = session.requests[0]
    assert request["method"] == "GET"
    assert request["url"] == "http://minio:9000/source-bucket/path/parsed.md"
    assert request["headers"]["authorization"].startswith("AWS4-HMAC-SHA256")


def test_upload_file_uses_signed_put(tmp_path: Path) -> None:
    session = FakeSession([FakeResponse(b"")])
    client = MinioStorageClient(
        endpoint="http://minio:9000",
        access_key="access",
        secret_key="secret",
        session=session,
    )
    source = tmp_path / "graph.json"
    source.write_text('{"nodes":[],"edges":[]}', encoding="utf-8")

    uploaded = client.upload_file(source, "out-bucket", "prefix/graph.json")

    assert uploaded.uri == "s3://out-bucket/prefix/graph.json"
    request = session.requests[0]
    assert request["method"] == "PUT"
    assert request["url"] == "http://minio:9000/out-bucket/prefix/graph.json"
    assert request["data"] == b'{"nodes":[],"edges":[]}'
    assert "content-type" in request["headers"]


def test_upload_directory_uploads_nested_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    local_dir = tmp_path / "output"
    (local_dir / "wiki").mkdir(parents=True)
    (local_dir / "graph.json").write_text("{}", encoding="utf-8")
    (local_dir / "wiki" / "index.md").write_text("# Index", encoding="utf-8")
    client = MinioStorageClient(
        endpoint="http://minio:9000", access_key="access", secret_key="secret"
    )
    calls: list[tuple[Path, str, str]] = []

    def fake_upload_file(local_path: Path, bucket: str, key: str) -> object:
        calls.append((local_path, bucket, key))
        return object()

    monkeypatch.setattr(client, "upload_file", fake_upload_file)

    client.upload_directory(local_dir, "out-bucket", "graphify-out/tenant/space/run")

    assert calls == [
        (
            local_dir / "graph.json",
            "out-bucket",
            "graphify-out/tenant/space/run/graph.json",
        ),
        (
            local_dir / "wiki" / "index.md",
            "out-bucket",
            "graphify-out/tenant/space/run/wiki/index.md",
        ),
    ]


class FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        return None


class FakeSession:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.requests: list[dict[str, Any]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        data: bytes | None,
        headers: dict[str, str],
        timeout: int,
    ) -> FakeResponse:
        self.requests.append(
            {
                "method": method,
                "url": url,
                "data": data,
                "headers": headers,
                "timeout": timeout,
            }
        )
        return self.responses.pop(0)
