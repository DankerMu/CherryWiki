## ADDED Requirements

### Requirement: UI design specification document
The system SHALL include a design specification document at `docs/design/12_UI设计规范_CherryStudio风格对齐.md` that defines visual standards for all CherryWiki frontend development.

#### Scenario: Document exists at specified path
- **WHEN** a developer looks for UI guidelines
- **THEN** the file `docs/design/12_UI设计规范_CherryStudio风格对齐.md` exists and is readable

### Requirement: Token reference table
The design guide SHALL include a complete token reference table listing every CSS custom property name, its light mode value, dark mode value, and usage description.

#### Scenario: Developer looks up a color token
- **WHEN** a developer needs to choose a text color
- **THEN** the guide shows `--color-text-1` through `--color-text-4` with values and when to use each level

### Requirement: Component pattern guidance
The design guide SHALL document standard component patterns (buttons, inputs, cards, badges, modals) with their token usage, showing which variables to apply for background, text, border, and hover states.

#### Scenario: Developer creates a new card component
- **WHEN** a developer implements a new card-style panel
- **THEN** the guide specifies to use `--color-surface` for background, `--color-border` for border, `--radius-md` for corners, and `--shadow-sm` for elevation

### Requirement: Dark mode development rules
The design guide SHALL define rules for dark mode compatible development: always use `var()` references, never hardcode colors, test both modes, use rgba for opacity-based borders.

#### Scenario: Developer adds new CSS
- **WHEN** a developer writes new CSS for a Phase 2+ feature
- **THEN** the guide instructs them to use only token variables and verify appearance in both light and dark modes

### Requirement: CherryStudio reference mapping
The design guide SHALL include a mapping between CherryWiki tokens and CherryStudio's corresponding token names, enabling developers to reference CherryStudio components for visual parity.

#### Scenario: Developer checks CherryStudio alignment
- **WHEN** a developer wants to match a CherryStudio component style
- **THEN** the guide maps CherryWiki's `--color-primary` to CherryStudio's `--color-primary`, `--color-text-1` to CherryStudio's `--color-text-1`, etc.

### Requirement: Prohibited patterns
The design guide SHALL list prohibited patterns: hardcoded hex colors, inline style colors, raw rgba without token, adding CSS framework dependencies without approval.

#### Scenario: Code review reference
- **WHEN** a reviewer checks a PR adding new CSS
- **THEN** the guide provides a checklist of prohibited patterns to verify against
