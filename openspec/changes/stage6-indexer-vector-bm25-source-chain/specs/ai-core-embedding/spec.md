## ADDED Requirements

### Requirement: EmbeddingProvider interface
The system SHALL export an `EmbeddingProvider` interface with method `embedBatch(texts: string[]): Promise<number[][]>` that returns embedding vectors for a list of input texts.

#### Scenario: single text embedding
- **WHEN** embedBatch is called with ["hello world"]
- **THEN** returns [[0.1, 0.2, ...]] — an array containing one vector of dimension matching the configured model

#### Scenario: batch embedding
- **WHEN** embedBatch is called with 100 texts
- **THEN** returns 100 vectors, each of consistent dimension

### Requirement: OpenAI-compatible embedding client
The system SHALL implement `OpenAIEmbeddingProvider` using the `openai` SDK, configured via model_configs table fields: base_url, model_id, encrypted_api_key_ref.

#### Scenario: client configured from model_configs
- **WHEN** OpenAIEmbeddingProvider is created with model_config { base_url: "https://api.openai.com/v1", model_id: "text-embedding-3-small", encrypted_api_key_ref: "ref_001" }
- **THEN** the underlying OpenAI client uses the resolved API key and base URL

#### Scenario: custom base_url for proxy/local model
- **WHEN** model_config has base_url: "http://localhost:11434/v1"
- **THEN** embedding requests go to the custom endpoint

### Requirement: API key resolution
The system SHALL resolve `encrypted_api_key_ref` to plaintext API key at runtime. Phase 1 implementation: `encrypted_api_key_ref` is the env var name containing the key (e.g., "OPENAI_API_KEY"), resolved via `process.env[ref]`.

#### Scenario: env var key resolution
- **WHEN** encrypted_api_key_ref = "OPENAI_API_KEY" and process.env.OPENAI_API_KEY = "sk-xxx"
- **THEN** resolved key is "sk-xxx"

#### Scenario: missing env var
- **WHEN** encrypted_api_key_ref = "MISSING_KEY" and process.env.MISSING_KEY is undefined
- **THEN** throws descriptive error "API key env var MISSING_KEY not found"

### Requirement: Auto-batching with size limit
The system SHALL split large input arrays into batches of configurable max size (default 2048) and process sequentially.

#### Scenario: input exceeds max batch size
- **WHEN** embedBatch is called with 5000 texts and max_batch_size = 2048
- **THEN** makes 3 API calls (2048 + 2048 + 904) and concatenates results in order

#### Scenario: input within batch size
- **WHEN** embedBatch is called with 100 texts
- **THEN** makes 1 API call

### Requirement: Error retry with backoff
The system SHALL retry transient errors (HTTP 429, 500, 502, 503, 504) up to 3 times with exponential backoff (1s, 2s, 4s). Non-transient errors (400, 401, 403) SHALL fail immediately.

#### Scenario: rate limit retry
- **WHEN** embedding API returns HTTP 429 on first attempt
- **THEN** retries after backoff delay and succeeds on second attempt

#### Scenario: auth error no retry
- **WHEN** embedding API returns HTTP 401
- **THEN** throws immediately without retry

#### Scenario: max retries exhausted
- **WHEN** embedding API returns HTTP 500 three times consecutively
- **THEN** throws after third attempt with last error details

### Requirement: Token counting
The system SHALL export a `countTokens(text: string, model: string): number` utility that estimates token count for chunking decisions. Phase 1: use tiktoken-compatible estimation or character-based heuristic (chars / 4).

#### Scenario: token count estimation
- **WHEN** countTokens("hello world", "text-embedding-3-small") is called
- **THEN** returns a positive integer approximating the token count

### Requirement: Embedding dimension discovery
The system SHALL provide `getEmbeddingDimension(provider: EmbeddingProvider): Promise<number>` that returns the vector dimension by embedding a probe text.

#### Scenario: dimension discovery
- **WHEN** getEmbeddingDimension is called on a provider configured for text-embedding-3-small
- **THEN** returns 1536 (or the model's actual dimension)
