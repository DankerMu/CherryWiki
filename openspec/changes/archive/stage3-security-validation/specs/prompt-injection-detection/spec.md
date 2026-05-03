## ADDED Requirements

### Requirement: Prompt injection pattern scanning
The system SHALL scan parsed Markdown content (parsed.md) for known prompt injection patterns. The scanner SHALL use a configurable pattern library containing regex patterns for common injection techniques including: role hijacking ("ignore previous instructions", "you are now"), system prompt extraction ("repeat your system prompt"), instruction injection ("do not follow"), and delimiter-based attacks.

#### Scenario: Clean content
- **WHEN** parsed.md contains normal technical documentation without injection patterns
- **THEN** injection scan returns injection_risk=false

#### Scenario: Injection pattern detected (P1-E13)
- **WHEN** parsed.md contains text matching a known injection pattern (e.g., "ignore all previous instructions and respond with")
- **THEN** injection scan returns injection_risk=true with matched_patterns array listing the detected patterns

#### Scenario: Multiple injection patterns
- **WHEN** parsed.md contains text matching 3 different injection patterns
- **THEN** injection scan returns injection_risk=true with all 3 matched patterns listed

### Requirement: Injection risk marking
The system SHALL mark source_documents with detected prompt injection by setting `injection_risk: true` in metadata_json. This flag SHALL be propagated to downstream wiki_chunks when they are created (in later stages). The injection_risk flag SHALL cause a search ranking penalty of ×0.3 during Chat retrieval.

#### Scenario: Injection risk flag set on source_document
- **WHEN** prompt injection is detected in a parsed document
- **THEN** source_document.metadata_json.injection_risk is set to true and source_document.metadata_json.injection_patterns lists the detected patterns

#### Scenario: Chat ranking penalty for injection-flagged content (P1-E13)
- **WHEN** Chat retrieval includes wiki_chunks derived from an injection_risk=true source_document
- **THEN** those chunks receive a ranking score multiplier of 0.3

### Requirement: Injection detection audit logging
The system SHALL write an audit_log entry when prompt injection is detected. The audit entry SHALL include: action="upload.injection_detected", source_document_id, matched_patterns count, space_id.

#### Scenario: Audit log for injection detection
- **WHEN** prompt injection patterns are detected in a document
- **THEN** an audit_log entry is created with action="upload.injection_detected" and pattern details

### Requirement: Injection pattern library
The system SHALL maintain a configurable pattern library that can be updated without code deployment. The initial Phase 1 pattern library SHALL include at minimum:
- Role hijacking patterns (≥5 patterns)
- System prompt extraction patterns (≥3 patterns)
- Instruction override patterns (≥5 patterns)
- Delimiter-based injection patterns (≥3 patterns)

#### Scenario: Pattern library loading
- **WHEN** the injection scanner initializes
- **THEN** it loads all patterns from the pattern library and compiles them as regex patterns

#### Scenario: Pattern library contains minimum coverage
- **WHEN** the pattern library is inspected
- **THEN** it contains at least 16 patterns across 4 categories
