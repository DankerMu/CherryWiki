## ADDED Requirements

### Requirement: Upload center page route
The system SHALL provide an upload center page at route `/spaces/:spaceId/uploads`. The page SHALL be accessible to users with read permission on the Space. A "上传中心" menu item SHALL be added to the Space navigation sidebar.

#### Scenario: Navigate to upload center
- **WHEN** user clicks "上传中心" in the Space sidebar
- **THEN** the upload center page loads showing the file upload area and upload list for this Space

#### Scenario: Access without permission
- **WHEN** user without Space read permission navigates to /spaces/:spaceId/uploads
- **THEN** they are redirected to a 403 page or the Space selection page

### Requirement: Upload list display
The upload center page SHALL display a table of all uploads in the current Space. The table SHALL include columns: filename, file type icon, size (human-readable), status (color-coded badge), uploader name, upload time (relative), and action buttons. The list SHALL support pagination (20 items per page).

#### Scenario: Upload list with mixed statuses
- **WHEN** user views the upload center with uploads in various statuses
- **THEN** each upload shows the correct color-coded status badge: blue for processing (uploaded/archived/parsing), green for completed (parsed), red for failed (parse_failed/security_rejected)

#### Scenario: Empty upload list
- **WHEN** user views the upload center for a Space with no uploads
- **THEN** the page shows an empty state with a prompt to upload files or submit URLs

#### Scenario: Pagination
- **WHEN** the Space has more than 20 uploads
- **THEN** the table shows pagination controls allowing navigation between pages

### Requirement: Upload detail view
The system SHALL provide a detail view for each upload showing: full metadata (filename, MIME type, SHA256, size, source_type, classification), processing status with progress indicator, job information (job_id, job_status), error details (for failed uploads), and timestamps (created_at, updated_at).

#### Scenario: View processing upload detail
- **WHEN** user clicks on an upload with status=parsing
- **THEN** the detail view shows current progress percentage, processing stage, and job information

#### Scenario: View failed upload detail
- **WHEN** user clicks on an upload with status=parse_failed
- **THEN** the detail view shows error_json details (error type, message) and a "重新处理" button

### Requirement: Reprocess action
The upload center SHALL provide a "重新处理" button for uploads with status=parse_failed. Clicking the button SHALL call POST /api/uploads/:id/reprocess and refresh the status.

#### Scenario: Reprocess failed upload
- **WHEN** user clicks "重新处理" on a parse_failed upload
- **THEN** the system calls the reprocess API, the status updates to uploaded, and the upload starts processing again

#### Scenario: Reprocess button visibility
- **WHEN** user views an upload with status=parsed (success)
- **THEN** no "重新处理" button is displayed

### Requirement: URL upload form
The upload center SHALL include a URL input field with an "添加 URL" submit button. The input SHALL validate URL format (http/https only) before submission. Submitting a valid URL SHALL call POST /api/spaces/:spaceId/uploads with source_type=url.

#### Scenario: Submit valid URL
- **WHEN** user enters "https://example.com/doc.pdf" and clicks "添加 URL"
- **THEN** the URL is submitted, a new entry appears in the upload list with status=uploaded and source_type=url

#### Scenario: Submit invalid URL protocol
- **WHEN** user enters "ftp://files.example.com/doc.pdf"
- **THEN** the form shows a validation error "仅支持 http 和 https 协议" and does not submit

### Requirement: Status auto-refresh
The upload center SHALL automatically poll for status updates when any upload in the current view is in a processing state (uploaded, archived, parsing). The poll interval SHALL be 5 seconds. Polling SHALL stop when all visible uploads reach a terminal state (parsed, parse_failed, security_rejected).

#### Scenario: Auto-refresh during processing
- **WHEN** user uploads a file and it enters parsing state
- **THEN** the status updates automatically every 5 seconds until it reaches parsed or parse_failed

#### Scenario: Polling stops at terminal state
- **WHEN** all uploads in the current view are in terminal states
- **THEN** no more polling requests are made until a new upload is added
