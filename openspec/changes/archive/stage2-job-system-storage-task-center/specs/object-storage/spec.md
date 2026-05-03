## ADDED Requirements

### Requirement: S3-compatible storage service
The system SHALL provide a StorageService that wraps MinIO/S3 operations with a consistent API. The service MUST be backend-agnostic (MinIO in dev, AWS S3 or R2 in prod).

#### Scenario: Upload file to storage
- **WHEN** a service calls `StorageService.upload(bucket, key, buffer, contentType)`
- **THEN** the file is stored in the specified bucket with the given key and content type

#### Scenario: Download file from storage
- **WHEN** a service calls `StorageService.download(bucket, key)`
- **THEN** the file content is returned as a readable stream

#### Scenario: File not found
- **WHEN** a service calls `StorageService.download(bucket, key)` for a non-existent key
- **THEN** the service throws a `STORAGE_NOT_FOUND` error

### Requirement: Bucket auto-creation on startup
The system SHALL check for required buckets on application startup and create them if they do not exist.

#### Scenario: Required bucket does not exist
- **WHEN** the API starts and the `uploads` bucket does not exist in MinIO
- **THEN** the system creates the bucket automatically and logs the creation

#### Scenario: Required bucket already exists
- **WHEN** the API starts and the `uploads` bucket already exists
- **THEN** the system proceeds without error

### Requirement: Presigned URL generation
The system SHALL generate time-limited presigned URLs for both upload and download operations.

#### Scenario: Generate download presigned URL
- **WHEN** a service calls `StorageService.getPresignedDownloadUrl(bucket, key, expiresInSeconds)`
- **THEN** a URL is returned that allows unauthenticated download of the file for the specified duration

#### Scenario: Generate upload presigned URL
- **WHEN** a service calls `StorageService.getPresignedUploadUrl(bucket, key, contentType, expiresInSeconds)`
- **THEN** a URL is returned that allows direct upload to MinIO/S3 for the specified duration

#### Scenario: Presigned URL expires
- **WHEN** a presigned URL is accessed after its expiration time
- **THEN** the request is rejected by the storage backend

### Requirement: Storage health check
The system SHALL expose a storage health check that verifies MinIO/S3 connectivity.

#### Scenario: MinIO is reachable
- **WHEN** the health check runs and MinIO responds to a HEAD bucket request
- **THEN** the storage component reports status=`healthy` with latency_ms

#### Scenario: MinIO is unreachable
- **WHEN** the health check runs and MinIO does not respond within 5 seconds
- **THEN** the storage component reports status=`unhealthy`

### Requirement: Storage configuration via environment variables
The system SHALL read storage configuration from environment variables to support different backends.

#### Scenario: MinIO configuration in development
- **WHEN** the environment has `MINIO_ENDPOINT=http://minio:9000`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`
- **THEN** the StorageService connects to the local MinIO instance

#### Scenario: S3 configuration in production
- **WHEN** the environment has `S3_REGION=us-east-1`, `S3_ENDPOINT` (optional), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- **THEN** the StorageService connects to AWS S3 or compatible endpoint
