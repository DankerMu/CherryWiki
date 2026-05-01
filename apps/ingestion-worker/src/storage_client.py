from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlsplit

import requests


@dataclass(frozen=True, slots=True)
class StorageObjectRef:
    bucket: str
    key: str

    @property
    def uri(self) -> str:
        return f"s3://{self.bucket}/{self.key}"


def parse_storage_uri(uri: str) -> StorageObjectRef:
    parsed = urlsplit(uri)
    if parsed.scheme in {"s3", "minio"}:
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
    else:
        parts = uri.split("/", 1)
        bucket = parts[0]
        key = parts[1] if len(parts) == 2 else ""

    if not bucket or not key:
        raise ValueError(f"Invalid storage URI: {uri}")
    if key.startswith("/") or ".." in key.split("/"):
        raise ValueError(f"Invalid storage key in URI: {uri}")
    return StorageObjectRef(bucket=bucket, key=key)


class MinioStorageClient:
    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
        session: requests.Session | None = None,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.access_key = access_key
        self.secret_key = secret_key
        self.region = region
        self.session = session or requests.Session()

    @classmethod
    def from_env(cls) -> "MinioStorageClient":
        endpoint = os.environ.get("MINIO_ENDPOINT") or os.environ.get("S3_ENDPOINT")
        access_key = os.environ.get("MINIO_ACCESS_KEY") or os.environ.get("AWS_ACCESS_KEY_ID")
        secret_key = os.environ.get("MINIO_SECRET_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
        if not endpoint or not access_key or not secret_key:
            raise RuntimeError("MINIO_ENDPOINT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY are required")
        return cls(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            region=os.environ.get("S3_REGION", "us-east-1"),
        )

    def download(self, ref: StorageObjectRef, destination: Path) -> None:
        response = self._request("GET", ref)
        destination.write_bytes(response.content)

    def upload(self, ref: StorageObjectRef, body: bytes, content_type: str) -> None:
        self._request("PUT", ref, body=body, content_type=content_type)

    def _request(
        self,
        method: str,
        ref: StorageObjectRef,
        *,
        body: bytes | None = None,
        content_type: str | None = None,
    ) -> requests.Response:
        payload = body or b""
        payload_hash = hashlib.sha256(payload).hexdigest()
        now = dt.datetime.now(dt.UTC)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        parsed_endpoint = urlsplit(self.endpoint)
        canonical_uri = "/" + quote(ref.bucket, safe="") + "/" + quote(ref.key, safe="/~")
        url = self.endpoint + canonical_uri
        host = parsed_endpoint.netloc
        headers = {
            "host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        }
        if content_type is not None:
            headers["content-type"] = content_type

        signed_headers = "host;x-amz-content-sha256;x-amz-date"
        canonical_headers = (
            f"host:{host}\n"
            f"x-amz-content-sha256:{payload_hash}\n"
            f"x-amz-date:{amz_date}\n"
        )
        credential_scope = f"{date_stamp}/{self.region}/s3/aws4_request"
        canonical_request = "\n".join(
            [
                method,
                canonical_uri,
                "",
                canonical_headers,
                signed_headers,
                payload_hash,
            ]
        )
        string_to_sign = "\n".join(
            [
                "AWS4-HMAC-SHA256",
                amz_date,
                credential_scope,
                hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
            ]
        )
        signature = hmac.new(
            self._signing_key(date_stamp),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        headers["authorization"] = (
            "AWS4-HMAC-SHA256 "
            f"Credential={self.access_key}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, "
            f"Signature={signature}"
        )

        response = self.session.request(method, url, data=body, headers=headers, timeout=60)
        response.raise_for_status()
        return response

    def _signing_key(self, date_stamp: str) -> bytes:
        date_key = _hmac(("AWS4" + self.secret_key).encode("utf-8"), date_stamp)
        region_key = _hmac(date_key, self.region)
        service_key = _hmac(region_key, "s3")
        return _hmac(service_key, "aws4_request")


def _hmac(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()
