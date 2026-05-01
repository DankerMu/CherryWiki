from __future__ import annotations

import os
from dataclasses import dataclass

import boto3
from botocore.config import Config


@dataclass(frozen=True, slots=True)
class StorageObjectRef:
    bucket: str
    key: str

    @property
    def uri(self) -> str:
        return f"s3://{self.bucket}/{self.key}"


class MinioStorageClient:
    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
        bucket_prefix: str = "cherrywiki",
        client: object | None = None,
    ) -> None:
        self.bucket_prefix = bucket_prefix
        self.archive_bucket = f"{bucket_prefix}-archives"
        self.client = client or boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    @classmethod
    def from_env(cls) -> "MinioStorageClient":
        endpoint = os.environ.get("MINIO_ENDPOINT") or os.environ.get("S3_ENDPOINT")
        access_key = os.environ.get("MINIO_ACCESS_KEY") or os.environ.get(
            "AWS_ACCESS_KEY_ID"
        )
        secret_key = os.environ.get("MINIO_SECRET_KEY") or os.environ.get(
            "AWS_SECRET_ACCESS_KEY"
        )
        if not endpoint or not access_key or not secret_key:
            raise RuntimeError(
                "MINIO_ENDPOINT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY are required"
            )
        return cls(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            region=os.environ.get("S3_REGION", "us-east-1"),
            bucket_prefix=os.environ.get("STORAGE_BUCKET_PREFIX", "cherrywiki"),
        )

    def upload(self, ref: StorageObjectRef, body: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=ref.bucket, Key=ref.key, Body=body, ContentType=content_type
        )
