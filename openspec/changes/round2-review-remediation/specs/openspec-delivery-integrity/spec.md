## ADDED Requirements

### Requirement: OpenSpec change artifacts are complete before issue creation
Each remediation change SHALL have complete OpenSpec artifacts before GitHub issues are created from it.

#### Scenario: Change is used for issue generation
- **WHEN** a change is used as the source for GitHub issues
- **THEN** `proposal.md`, `design.md`, `specs/**/*.md`, and `tasks.md` MUST be present and `openspec status --change <name>` MUST report complete

### Requirement: Untracked delivery artifacts are explicitly triaged
The repository SHALL not treat untracked OpenSpec, test, or checklist files as implicit delivery content.

#### Scenario: Working tree has untracked OpenSpec changes
- **WHEN** `git status --short` lists untracked `openspec/changes/*`
- **THEN** each change MUST be marked as commit, defer, archive, or ignore before final delivery

#### Scenario: Test file is untracked
- **WHEN** a test file such as `apps/url-fetcher-worker/tests/test_main.py` validates remediation behavior
- **THEN** it MUST be included in the implementation PR or replaced by an equivalent tracked test

### Requirement: OpenSpec metadata is present
Each active OpenSpec change SHALL include its metadata file.

#### Scenario: Change directory lacks metadata
- **WHEN** an active `openspec/changes/<name>/` directory lacks `.openspec.yaml`
- **THEN** validation MUST fail or the issue MUST include a task to add the missing metadata before implementation starts

### Requirement: Issue bodies preserve traceability
GitHub issues created from this change SHALL reference the OpenSpec change and include acceptance criteria.

#### Scenario: Sub-issue is created
- **WHEN** a sub-issue is created for a remediation task group
- **THEN** its body MUST include the OpenSpec change path, relevant spec files, task checklist, dependencies, and acceptance criteria

### Requirement: Completed task checkboxes require evidence
OpenSpec task checkboxes SHALL only be marked complete when evidence exists.

#### Scenario: Task is marked complete
- **WHEN** a task checkbox is changed to `[x]`
- **THEN** the implementation PR or issue MUST include evidence such as commit references, test commands, or validation output
