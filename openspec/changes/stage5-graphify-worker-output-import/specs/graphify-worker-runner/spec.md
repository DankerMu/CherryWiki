## ADDED Requirements

### Requirement: Manifest generation
The `apps/graphify-worker/src/runner.py` SHALL generate a `graphify_input_manifest.json` in the working directory containing: `space_id`, `run_id`, `mode`, `input_files` (list of local paths to parsed.md files), `graphify_ref` (from GRAPHIFY_PINNED_REF env).

#### Scenario: Generate manifest for 4 input files
- **WHEN** job payload contains space_id, run_id, and 4 source_document URIs
- **THEN** manifest SHALL list 4 input_files paths after downloading from MinIO

### Requirement: Download inputs from MinIO
The `runner.py` SHALL download all parsed.md files referenced in the job payload from MinIO to a local working directory (`GRAPHIFY_WORKDIR/{run_id}/input/`).

#### Scenario: Download multiple files
- **WHEN** job payload references 4 MinIO URIs
- **THEN** all 4 files SHALL be downloaded to `{workdir}/input/` before Graphify execution

#### Scenario: Download failure
- **WHEN** a MinIO URI is not found (404)
- **THEN** runner SHALL report job as failed with error_json containing the failed URI

### Requirement: Graphify CLI execution
The `runner.py` SHALL invoke `graphify` CLI via `subprocess.run()` with arguments: `--wiki`, `--mode {mode}`, `--output {workdir}/output`, and input directory. Timeout SHALL be `GRAPHIFY_TIMEOUT_SECONDS` (default 3600).

#### Scenario: Successful execution
- **WHEN** Graphify CLI exits with code 0
- **THEN** output directory SHALL contain `graph.json`, `wiki/`, `GRAPH_REPORT.md`

#### Scenario: CLI timeout
- **WHEN** Graphify CLI exceeds GRAPHIFY_TIMEOUT_SECONDS
- **THEN** process SHALL be killed and job reported as failed with `error_json: { "reason": "timeout" }`

#### Scenario: CLI non-zero exit
- **WHEN** Graphify CLI exits with code 1
- **THEN** job SHALL be reported as failed with stderr captured in error_json

### Requirement: Output validation (Doc 12 §6.1)
After successful CLI execution, `runner.py` SHALL validate the output directory per Doc 12 §6.1:

| Check | Rule | Failure action |
|---|---|---|
| graph.json exists | File exists and is valid JSON | → failed |
| wiki/ exists | Directory exists, contains ≥1 .md file | → failed |
| GRAPH_REPORT.md exists | File exists | → failed (non-fatal warning if missing) |
| File path safety | No `..`, no absolute paths, no symlinks in output | → failed + security alert |
| Single file size | Any output file ≤ 100MB | → quarantine error |
| Total output size | Sum of all output files ≤ 1GB | → quarantine error |

Note: Node/edge count limits and shrink guard are checked by the API layer (not the worker), since they require DB access to the previous run.

#### Scenario: Missing graph.json
- **WHEN** output directory lacks graph.json
- **THEN** runner SHALL report job as failed with `error_json: { "reason": "missing_graph_json" }`

#### Scenario: Missing wiki directory
- **WHEN** output directory lacks wiki/
- **THEN** runner SHALL report job as failed with `error_json: { "reason": "missing_wiki_dir" }`

#### Scenario: Path traversal detected
- **WHEN** output contains file with `../` in path
- **THEN** runner SHALL report job as failed with `error_json: { "reason": "path_traversal", "file": "..." }`

#### Scenario: Oversized file
- **WHEN** graph.json exceeds 100MB
- **THEN** runner SHALL report job as failed with `error_json: { "reason": "quarantined", "quarantine_type": "file_size", "details": "..." }`

### Requirement: Upload outputs to MinIO
After validation, `runner.py` SHALL upload outputs to MinIO under `graphify-out/{tenant_id}/{space_id}/{run_id}/`:
- `graph.json`
- `GRAPH_REPORT.md`
- `wiki/*.md` (all files)
- `graph.html` (if exists)

The runner SHALL report completion with all output URIs to the API.

#### Scenario: Upload with graph.html
- **WHEN** Graphify produces graph.html (< 5000 nodes)
- **THEN** graph_html_uri SHALL be set in completion report

#### Scenario: Upload without graph.html
- **WHEN** Graphify skips graph.html (> 5000 nodes)
- **THEN** graph_html_uri SHALL be null in completion report

### Requirement: Generate validation_report.json
After output validation, `runner.py` SHALL generate a `validation_report.json` in the output directory containing: `{ run_id, graphify_ref, validation_passed: boolean, checks: [{ name, status, details }], node_count, edge_count, wiki_page_count, total_output_bytes, generated_at }`. This file is uploaded to MinIO alongside other outputs and consumed by the API for quarantine decision diagnostics.

#### Scenario: All checks pass
- **WHEN** output validation passes
- **THEN** validation_report.json SHALL have `validation_passed: true` and all checks with `status: 'passed'`

#### Scenario: File size check fails
- **WHEN** a file exceeds 100MB
- **THEN** validation_report.json SHALL have `validation_passed: false` and the failing check with `status: 'failed'` and file details

### Requirement: Node count check for shrink guard
After successful CLI execution, `runner.py` SHALL parse graph.json to count nodes and include `node_count` in the completion payload. The API layer uses this for shrink guard detection.

#### Scenario: Report node count
- **WHEN** graph.json contains 150 nodes
- **THEN** completion payload SHALL include `stats_json: { "node_count": 150, "edge_count": ..., "wiki_page_count": ... }`

### Requirement: Cleanup working directory
After job completion (success or failure), `runner.py` SHALL remove the working directory `{GRAPHIFY_WORKDIR}/{run_id}/`.

#### Scenario: Cleanup after success
- **WHEN** job completes successfully
- **THEN** `{workdir}/{run_id}/` SHALL not exist

#### Scenario: Cleanup after failure
- **WHEN** job fails
- **THEN** `{workdir}/{run_id}/` SHALL not exist

### Requirement: Storage client for MinIO
The `apps/graphify-worker/src/storage_client.py` SHALL provide `download_file(uri, local_path)` and `upload_directory(local_dir, prefix)` methods using MinIO/S3 SDK, consistent with ingestion-worker's storage_client pattern.

#### Scenario: Upload directory with nested wiki/
- **WHEN** uploading `{workdir}/output/` containing `graph.json`, `wiki/a.md`, `wiki/b.md`
- **THEN** 3 objects SHALL be uploaded with correct key prefixes

## MODIFIED Requirements

### Requirement: runner.py replaces no-op with actual logic
The existing `apps/graphify-worker/src/runner.py` `run(job_data)` function SHALL be replaced with the full execution pipeline: download → manifest → CLI → validate → upload → report.

#### Scenario: End-to-end run
- **WHEN** `run(job_data)` is called with valid job payload
- **THEN** it SHALL return `{ "status": "success", "graph_json_uri": "...", "wiki_output_uri": "...", "report_uri": "...", "stats_json": {...} }`
