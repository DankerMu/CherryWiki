## ADDED Requirements

### Requirement: Chat page route
The system SHALL provide a Chat page at route `/spaces/:spaceId/chat` (matching existing route format in `apps/web/src/App.tsx`). The page SHALL be accessible from the Space navigation sidebar. It SHALL require authentication and `chat:use` permission on the space.

#### Scenario: Navigate to chat
- **WHEN** user clicks "Chat" in the Space sidebar
- **THEN** the browser SHALL navigate to /spaces/:spaceId/chat and display the chat interface

#### Scenario: Unauthenticated access
- **WHEN** an unauthenticated user visits the chat URL
- **THEN** they SHALL be redirected to the login page

### Requirement: Message input and submission
The system SHALL display a text input area at the bottom of the chat page. Users SHALL be able to type a message and submit via Enter key or Send button. The input SHALL be disabled while a response is streaming. Maximum message length SHALL be 4000 characters.

#### Scenario: Submit message
- **WHEN** user types a message and presses Enter
- **THEN** the message SHALL appear in the chat history and a streaming request SHALL be initiated

#### Scenario: Input disabled during stream
- **WHEN** a response is actively streaming
- **THEN** the input SHALL be disabled and show a loading indicator

#### Scenario: Character limit
- **WHEN** user input exceeds 4000 characters
- **THEN** further input SHALL be prevented and a character count warning SHALL be displayed

### Requirement: Streaming response display
The system SHALL render assistant responses token-by-token as SSE content events arrive, using `fetch` API with `ReadableStream` and `eventsource-parser` library to parse the SSE stream (native EventSource does not support POST requests). Text SHALL be rendered as Markdown. The message bubble SHALL show a typing indicator until the first content event arrives.

#### Scenario: Token-by-token rendering
- **WHEN** content events arrive from SSE
- **THEN** each delta SHALL be immediately appended to the displayed response

#### Scenario: Markdown rendering
- **WHEN** the complete response contains Markdown (headers, lists, code blocks)
- **THEN** it SHALL be rendered with proper formatting

#### Scenario: Typing indicator
- **WHEN** request is sent but no content event received yet
- **THEN** a typing indicator (animated dots) SHALL be displayed

### Requirement: Citation display
The system SHALL display citations as clickable reference markers `[N]` inline in the response text. Below the response, a citations panel SHALL list each referenced source with page title, section name, and a relevance indicator. Clicking a citation SHALL navigate to the corresponding Wiki page.

#### Scenario: Inline citation markers
- **WHEN** response text contains citation references
- **THEN** they SHALL be rendered as superscript clickable links

#### Scenario: Citation panel
- **WHEN** a response has citations
- **THEN** a collapsible panel below the message SHALL list: source number, page title, section title, and relevance score badge

#### Scenario: Citation click navigation
- **WHEN** user clicks a citation link
- **THEN** browser SHALL navigate to /spaces/:spaceId/wiki/:pageId (matching App.tsx route, optionally scrolling to section)

#### Scenario: No citations
- **WHEN** response has no citations (empty array)
- **THEN** no citation panel SHALL be displayed

### Requirement: Session management UI
The system SHALL display a session list sidebar (collapsible) showing the user's chat sessions for the current space, ordered by most recent. Users SHALL be able to: create a new session, switch between sessions, and delete sessions.

#### Scenario: Session list display
- **WHEN** user opens the chat page
- **THEN** the sidebar SHALL show existing sessions with titles and timestamps

#### Scenario: New session
- **WHEN** user clicks "New Chat" button
- **THEN** a new empty chat session SHALL be started

#### Scenario: Switch session
- **WHEN** user clicks a different session in the sidebar
- **THEN** the chat area SHALL load that session's message history

#### Scenario: Delete session
- **WHEN** user deletes a session (with confirmation)
- **THEN** the session SHALL be removed from the list and the API DELETE endpoint SHALL be called

### Requirement: Error and empty states
The system SHALL handle: network errors (show retry button), no chat model configured (show admin configuration message), no wiki content indexed (show "knowledge base is being built" message), stream interruption (show partial response with error indicator), and fetch stream failure (ReadableStream abort).

#### Scenario: Network error
- **WHEN** the fetch request to /api/chat/completions fails (network error or non-2xx status)
- **THEN** an error message with a "Retry" button SHALL be displayed

#### Scenario: No model configured
- **WHEN** API returns 422 NO_CHAT_MODEL_CONFIGURED
- **THEN** a message SHALL inform the user to contact admin to configure a chat model

#### Scenario: Stream interruption
- **WHEN** the ReadableStream closes unexpectedly mid-response
- **THEN** the partial response SHALL be displayed with an error indicator and retry option

### Requirement: Responsive layout
The chat page SHALL follow the project's UI design specification (docs/design/12_UI设计规范_CherryStudio风格对齐.md). It SHALL support dark mode via CSS tokens. The layout SHALL be responsive: full sidebar on desktop, collapsed on mobile.

#### Scenario: Dark mode
- **WHEN** the system is in dark mode
- **THEN** all chat UI elements SHALL use the dark mode CSS token values

#### Scenario: Mobile layout
- **WHEN** viewport width is < 768px
- **THEN** the session sidebar SHALL be hidden by default and accessible via hamburger menu
