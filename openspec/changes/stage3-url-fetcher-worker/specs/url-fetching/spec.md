## ADDED Requirements

### Requirement: URL content fetching
The url-fetcher-worker SHALL fetch the content of submitted URLs via HTTP/HTTPS GET requests. The fetched response body SHALL be saved as a snapshot file in MinIO. The worker SHALL support fetching HTML pages, PDF files, and other document types served over HTTP.

#### Scenario: Successful HTML page fetch (P1-E11)
- **WHEN** url-fetcher-worker receives a url_fetch Job for a valid public HTTPS URL
- **THEN** it fetches the page content, stores the HTML as a snapshot file in MinIO, creates a file_blob record with the content SHA256, and reports Job completion with file_blob_id in result_json

#### Scenario: Successful PDF download via URL
- **WHEN** url-fetcher-worker receives a url_fetch Job for a URL serving a PDF file (Content-Type: application/pdf)
- **THEN** it downloads the PDF, stores it as a snapshot file, and creates a file_blob record

#### Scenario: URL returns 404
- **WHEN** the target URL returns HTTP 404
- **THEN** the Job fails with error_type="fetch_error", error_message="HTTP 404 Not Found", and source_document status becomes parse_failed

#### Scenario: URL connection timeout
- **WHEN** the target server does not respond within 10 seconds
- **THEN** the Job fails with error_type="connection_timeout"

### Requirement: Response size limit
The url-fetcher-worker SHALL enforce a maximum response body size of 50MB. The download SHALL use streaming mode, counting bytes incrementally. If the accumulated size exceeds 50MB, the download SHALL be aborted immediately.

#### Scenario: Response within size limit
- **WHEN** url-fetcher-worker downloads a 10MB HTML page
- **THEN** the download completes successfully

#### Scenario: Response exceeds size limit
- **WHEN** the target URL serves a response larger than 50MB
- **THEN** the download is aborted at 50MB, the partial content is discarded, and the Job fails with error_type="response_too_large"

### Requirement: Request timeouts
The url-fetcher-worker SHALL enforce a connection timeout of 10 seconds and a total request timeout of 30 seconds. Timeout SHALL abort the request and fail the Job.

#### Scenario: Total timeout exceeded
- **WHEN** the server sends data slowly and the total request time exceeds 30 seconds
- **THEN** the request is aborted and the Job fails with error_type="request_timeout"

### Requirement: Snapshot storage and file_blob creation
The url-fetcher-worker SHALL store fetched content as a snapshot file in MinIO at path: `archive/{tenant_id}/{space_id}/{yyyy/mm/dd}/{sha256}_{hostname}.snapshot`. It SHALL compute SHA256 of the content and create/reuse a file_blob record. It SHALL then link the file_blob to the source_document via the upload service's linkBlob mechanism.

#### Scenario: Snapshot with dedup
- **WHEN** url-fetcher-worker fetches content whose SHA256 matches an existing file_blob
- **THEN** it reuses the existing file_blob, does not store a duplicate snapshot, and links it to the source_document

### Requirement: Chain ingestion Job after fetch
Upon successful URL fetch, the system SHALL automatically create an ingestion Job to parse the fetched snapshot. The url-fetcher-worker SHALL report completion with file_blob_id and snapshot_uri in result_json. The cherry-api Job completion handler SHALL detect job.type=url_fetch and create the follow-up ingestion Job.

#### Scenario: Ingestion Job auto-created after fetch (P1-E11)
- **WHEN** url-fetcher-worker completes a url_fetch Job successfully
- **THEN** cherry-api automatically creates an ingestion Job for the fetched snapshot, and the source_document proceeds through the normal parsing pipeline

### Requirement: No internal credentials in requests
The url-fetcher-worker SHALL NOT inject any internal headers, cookies, authentication tokens, or API keys into outbound HTTP requests. The requests SHALL be made as a plain HTTP client with a generic User-Agent header.

#### Scenario: Clean outbound requests
- **WHEN** url-fetcher-worker makes an outbound HTTP request
- **THEN** the request contains no Authorization header, no internal cookies, and a generic User-Agent string
