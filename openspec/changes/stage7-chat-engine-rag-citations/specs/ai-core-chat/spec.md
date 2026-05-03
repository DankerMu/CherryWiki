## ADDED Requirements

### Requirement: Chat provider interface
The system SHALL define a `ChatProvider` interface with method `streamCompletion(params: ChatCompletionParams): AsyncIterable<ChatChunk>`. ChatCompletionParams SHALL include: messages (array of {role, content}), model (string), temperature (number, optional), max_tokens (number, optional), stream (boolean, default true).

#### Scenario: Interface contract
- **WHEN** a class implements ChatProvider
- **THEN** it MUST implement streamCompletion returning an AsyncIterable of ChatChunk objects

#### Scenario: ChatChunk structure
- **WHEN** iterating the AsyncIterable
- **THEN** each ChatChunk SHALL contain: type ('content'|'done'|'error'), delta (string, for content type), finish_reason (string|null, for done type), usage ({prompt_tokens, completion_tokens, total_tokens}, for done type)

### Requirement: OpenAI-compatible chat provider
The system SHALL implement `OpenAIChatProvider` that calls OpenAI-compatible `/v1/chat/completions` endpoint with `stream: true`. It SHALL resolve the API key from `model_configs.encrypted_api_key_ref`, use `model_configs.base_url` as the endpoint, and respect `model_configs.max_tokens` as the ceiling.

#### Scenario: Streaming response
- **WHEN** streamCompletion is called with valid params
- **THEN** it SHALL yield ChatChunk objects as SSE data arrives from the upstream API

#### Scenario: API key resolution
- **WHEN** a chat completion is initiated
- **THEN** the provider SHALL resolve the API key from encrypted_api_key_ref using the same key vault mechanism as embedding provider

#### Scenario: Timeout handling
- **WHEN** the upstream API does not respond within 60 seconds
- **THEN** the provider SHALL abort the request and yield a ChatChunk with type='error'

#### Scenario: Rate limit retry
- **WHEN** the upstream API returns HTTP 429
- **THEN** the provider SHALL retry once after the Retry-After duration (max 30s wait), then error if still 429

### Requirement: Token counting utility
The system SHALL provide a `countTokens(text: string, model: string): number` function that estimates token count using tiktoken-compatible encoding. For unknown models, it SHALL fall back to character-count / 4 approximation.

#### Scenario: Known model counting
- **WHEN** countTokens is called with model='gpt-4o'
- **THEN** it SHALL use cl100k_base encoding for accurate count

#### Scenario: Unknown model fallback
- **WHEN** countTokens is called with model='custom-model-xyz'
- **THEN** it SHALL return Math.ceil(text.length / 4) as approximation

### Requirement: System prompt injection
The system SHALL support prepending a system message to the messages array. The system prompt SHALL be configurable per request and SHALL include RAG context instructions.

#### Scenario: System prompt prepended
- **WHEN** streamCompletion is called with a systemPrompt parameter
- **THEN** the outgoing API request messages array SHALL have {role: 'system', content: systemPrompt} as the first element
