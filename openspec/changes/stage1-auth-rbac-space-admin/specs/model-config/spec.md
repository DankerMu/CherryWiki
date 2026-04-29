## ADDED Requirements

### Requirement: List model configurations
The system SHALL allow admins to list all model configurations with their status and usage stats.

#### Scenario: List models
- **WHEN** admin GETs `/api/admin/models`
- **THEN** system returns list of model configs with id, name (mapped from display_name), provider, model_id, model_type, status (mapped: enabled=true→"active", false→"disabled"), config (embedding_dim, max_tokens, rate_limit_rpm, base_url), visible_group_ids

#### Scenario: Non-admin denied
- **WHEN** user without `admin:model_manage` GETs `/api/admin/models`
- **THEN** system returns `403 PERMISSION_DENIED`

### Requirement: Create model configuration
The system SHALL allow admins to add new model configurations for chat, embedding, or rerank types.

#### Scenario: Successful creation
- **WHEN** admin POSTs to `/api/admin/models` with provider, model_id, model_type, display_name, base_url, encrypted_api_key_ref, embedding_dim, max_tokens
- **THEN** system creates the model config and records `admin.model.create` audit event

#### Scenario: Duplicate model
- **WHEN** admin POSTs with a provider+model_id combination that already exists for the tenant
- **THEN** system returns `409` with error code `MODEL_NAME_CONFLICT`

### Requirement: Update model configuration
The system SHALL allow admins to update model configuration fields including enabling/disabling.

#### Scenario: Disable a model
- **WHEN** admin PATCHes `/api/admin/models/{model_id}` with `{ "enabled": false }`
- **THEN** system updates the model config
- **THEN** system records `admin.model.update` audit event

#### Scenario: Model not found on update
- **WHEN** admin PATCHes `/api/admin/models/{nonexistent_id}`
- **THEN** system returns `404` with error code `MODEL_NOT_FOUND`

### Requirement: Model connectivity test
The system SHALL allow admins to test a model configuration by sending a probe request to the configured endpoint.

#### Scenario: Successful connectivity test
- **WHEN** admin POSTs to `/api/admin/models/{model_id}/test` with a test_prompt
- **THEN** system resolves the API key from encrypted_api_key_ref
- **THEN** system sends a test request to the model endpoint
- **THEN** system returns reachable=true, latency_ms, response_preview

#### Scenario: Unreachable model
- **WHEN** admin tests a model with an invalid base_url
- **THEN** system returns reachable=false with error details

#### Scenario: Invalid API key
- **WHEN** admin tests a model with an incorrect API key reference
- **THEN** system returns error code `MODEL_AUTH_FAILED`

#### Scenario: Secret reference not found
- **WHEN** admin tests a model with an encrypted_api_key_ref that cannot be resolved
- **THEN** system returns error code `SECRET_NOT_FOUND`

#### Scenario: Model not found on test
- **WHEN** admin POSTs to `/api/admin/models/{nonexistent_id}/test`
- **THEN** system returns `404` with error code `MODEL_NOT_FOUND`

#### Scenario: Connectivity test audited
- **WHEN** admin runs a connectivity test
- **THEN** system records `admin.model.test` audit event with model_id and result (reachable/unreachable)

### Requirement: API key security
The system MUST NOT store model API keys in plaintext in the database. The `encrypted_api_key_ref` field SHALL contain a reference to an environment variable or secret manager entry.

#### Scenario: API key not in database
- **WHEN** a model config is created with encrypted_api_key_ref="secret:openai_key"
- **THEN** the actual API key is resolved from environment variable `OPENAI_KEY` at runtime
- **THEN** no actual API key value is stored in the model_configs table

### Requirement: Model visibility control
Model configurations SHALL support `visible_group_ids` to restrict which Groups can use a model. Empty array means visible to all.

#### Scenario: Restricted model visibility
- **WHEN** a model has visible_group_ids=["grp_rd"]
- **THEN** only users in Group "RD" can select this model for Chat (enforced in Stage 7)
- **THEN** admin can see and manage all models regardless of visibility

### Requirement: Single active embedding model constraint
The system SHALL enforce that at most one embedding model is enabled per tenant at any time (Phase 1 constraint).

#### Scenario: Enabling second embedding model
- **WHEN** admin enables a second embedding model while one is already active
- **THEN** system returns `409` with a message indicating only one embedding model can be active
