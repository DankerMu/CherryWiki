## ADDED Requirements

### Requirement: Task list page with filtering
The system SHALL provide an admin task center page that displays all jobs with filtering by type, status, and space.

#### Scenario: Admin views task list
- **WHEN** an admin navigates to the task center page
- **THEN** the page displays a paginated table of jobs with columns: type, status, space, progress, created_at, duration

#### Scenario: Filter by job type
- **WHEN** an admin selects type=`graphify` in the filter dropdown
- **THEN** only graphify jobs are displayed

#### Scenario: Filter by status
- **WHEN** an admin selects status=`failed` in the filter dropdown
- **THEN** only failed jobs are displayed

#### Scenario: Combined filters
- **WHEN** an admin selects type=`ingestion` AND status=`running`
- **THEN** only running ingestion jobs are displayed

### Requirement: Task detail view
The system SHALL provide a detail view for individual jobs showing full status, progress, events timeline, and payload/result data.

#### Scenario: View job details
- **WHEN** an admin clicks on a job row in the task list
- **THEN** the detail view shows: job id, type, status, space, created_by, created_at, started_at, completed_at, progress (percent + stage), payload_json, result_json or error_json

#### Scenario: View job events timeline
- **WHEN** an admin opens job detail view
- **THEN** a chronological timeline of job events (state transitions, progress updates) is displayed

### Requirement: Cancel job action
The system SHALL allow admins to cancel jobs from the task center UI.

#### Scenario: Cancel a pending job
- **WHEN** an admin clicks "Cancel" on a pending job
- **THEN** the system calls POST /api/jobs/{job_id}/cancel and the job status updates to `cancelled`

#### Scenario: Cancel a running job
- **WHEN** an admin clicks "Cancel" on a running job
- **THEN** the system sets cancel_requested_at and the UI shows a "Cancelling..." status until the Worker acknowledges

#### Scenario: Cancel button hidden for terminal states
- **WHEN** a job is in `succeeded`, `failed`, or `cancelled` status
- **THEN** the Cancel button is not displayed

### Requirement: Real-time progress display
The system SHALL display job progress in the task list and detail views, updating without full page refresh.

#### Scenario: Progress bar for running job
- **WHEN** a job is in `running` status with progress percent=65 and stage="chunking"
- **THEN** the task list shows a progress bar at 65% with "chunking" label

#### Scenario: Progress updates via polling
- **WHEN** jobs are in `running` state
- **THEN** the UI polls GET /api/admin/jobs every 5 seconds to refresh progress data

### Requirement: Task center navigation
The system SHALL integrate the task center into the existing admin sidebar navigation.

#### Scenario: Navigate to task center from admin
- **WHEN** an admin clicks "任务中心" in the admin sidebar
- **THEN** the browser navigates to the task center page showing the job list
