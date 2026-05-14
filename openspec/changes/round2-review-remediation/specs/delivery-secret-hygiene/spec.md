## ADDED Requirements

### Requirement: Local auth-state artifacts are never committed
The repository SHALL treat browser storage state files and local authentication JSON files as secrets.

#### Scenario: Browser auth JSON exists locally
- **WHEN** a file such as `cherry-auth.json`, `*-auth.json`, or `playwright/.auth/*.json` exists in the working tree
- **THEN** the file MUST be ignored or rejected by pre-delivery checks and MUST NOT be included in commits or issues as content

#### Scenario: Auth artifact is accidentally staged
- **WHEN** a staged file contains cookie names such as `refresh_token` or browser storage state keys
- **THEN** secret scanning or a repository hygiene check MUST fail before the change is considered deliverable

### Requirement: Leaked local sessions are rotated
The delivery process SHALL require revocation or rotation of any local refresh session found in repository-adjacent auth artifacts.

#### Scenario: Refresh cookie found in local file
- **WHEN** review identifies a reusable refresh cookie in a local auth-state file
- **THEN** the operator MUST revoke or rotate that session and record the action in the remediation issue without exposing the token value

### Requirement: Manual test credentials are placeholders or excluded
Manual test checklists SHALL NOT commit real or reusable login credentials.

#### Scenario: Manual checklist references credentials
- **WHEN** a manual checklist needs login instructions
- **THEN** it MUST use placeholder text such as `<seed-admin-email>` and `<seed-admin-password>` or remain local-only and ignored

### Requirement: Secret scan evidence is captured before delivery
The remediation SHALL include a reproducible secret scanning command or CI check.

#### Scenario: Implementation PR is ready for review
- **WHEN** the PR is marked ready
- **THEN** the PR or issue evidence MUST include the secret scan command and result summary, excluding secret values
