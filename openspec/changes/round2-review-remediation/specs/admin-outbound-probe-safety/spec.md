## ADDED Requirements

### Requirement: Admin model probes reject unsafe target URLs
Admin model connectivity probes SHALL validate target URLs before making outbound requests.

#### Scenario: Unsupported scheme
- **WHEN** a model `base_url` or fallback `MODEL_API_BASE_URL` uses a scheme other than `http` or `https`
- **THEN** the connectivity test MUST return `{ reachable: false, error: "<safe validation error>" }` without making a fetch

#### Scenario: Localhost or metadata target
- **WHEN** a model probe target resolves to localhost, private, link-local, or metadata address ranges
- **THEN** the probe MUST be blocked unless the target is explicitly allowed by a documented admin model probe allowlist

#### Scenario: Allowed public target
- **WHEN** the model probe target is an allowed public endpoint and the API key is configured
- **THEN** the target MUST pass validation and the existing chat, embedding, and rerank probe behavior MUST execute normally

### Requirement: Internal model allowlist is explicit
Self-hosted internal model providers SHALL be enabled through explicit configuration rather than arbitrary admin-entered URLs.

#### Scenario: Private model endpoint is approved
- **WHEN** an operator needs to probe a private model endpoint
- **THEN** the endpoint host or CIDR MUST be present in a documented allowlist before the probe is permitted

### Requirement: Probe errors do not leak secrets
Admin outbound probe failures SHALL return safe error messages.

#### Scenario: Provider returns authorization error
- **WHEN** a model probe returns 401 or 403
- **THEN** the response MAY include the status class but MUST NOT include API keys, authorization headers, cookies, or full request headers

#### Scenario: Network library includes request details
- **WHEN** fetch or DNS validation throws an error containing sensitive request metadata
- **THEN** the service MUST sanitize the message before returning it to the admin UI or writing audit metadata

### Requirement: Admin health outbound checks are bounded and target-validated
Admin health checks that call external services SHALL use bounded timeouts and validated configured URLs.

#### Scenario: Docmost health URL is configured
- **WHEN** `DOCMOST_BASE_URL` is configured
- **THEN** the health check MUST use a bounded timeout and reject unsupported schemes before making the request

#### Scenario: Docmost health URL resolves to unsafe target
- **WHEN** `DOCMOST_BASE_URL` resolves to localhost, private, link-local, or metadata address ranges
- **THEN** the health check MUST be blocked unless the target is explicitly allowed by the same documented admin outbound allowlist

#### Scenario: Docmost health check fails
- **WHEN** the Docmost health request fails or times out
- **THEN** the returned health error MUST be sanitized and MUST NOT include cookies, authorization headers, or other secret material
