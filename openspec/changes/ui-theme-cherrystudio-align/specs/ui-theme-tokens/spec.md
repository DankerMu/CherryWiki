## ADDED Requirements

### Requirement: Design token CSS file
The system SHALL provide a `theme.css` file at `apps/web/src/theme.css` containing all design tokens as CSS custom properties.

#### Scenario: Theme file exists and is imported
- **WHEN** the web application loads
- **THEN** all CSS custom properties defined in `theme.css` are available via `var()` references throughout `styles.css`

### Requirement: Primary color alignment
The primary color token `--color-primary` SHALL be `#00b96b` (CherryStudio emerald green), replacing the previous blue `#2563eb`.

#### Scenario: Primary button uses green
- **WHEN** a `.button-primary` element is rendered
- **THEN** its background color is `var(--color-primary)` resolving to `#00b96b`

#### Scenario: Input focus ring uses green
- **WHEN** an input element receives focus
- **THEN** its border color and box-shadow use `--color-primary` tones

### Requirement: Text color hierarchy
The system SHALL define four levels of text color tokens: `--color-text-1` (primary, 88% opacity), `--color-text-2` (secondary, 65%), `--color-text-3` (muted, 45%), `--color-text-4` (disabled, 25%).

#### Scenario: Heading uses primary text
- **WHEN** a heading element (h1, h2) is rendered
- **THEN** its color resolves to `var(--color-text-1)`

#### Scenario: Helper text uses muted color
- **WHEN** a `.eyebrow` or `.login-copy` element is rendered
- **THEN** its color resolves to `var(--color-text-3)` or `var(--color-text-2)`

### Requirement: Background color tokens
The system SHALL define background tokens: `--color-background` (page), `--color-background-soft` (subtle), `--color-background-mute` (dividers/headers), `--color-background-hover` (interactive hover states).

#### Scenario: Page background uses token
- **WHEN** the body element is rendered
- **THEN** its background-color is `var(--color-background)`

#### Scenario: Table header uses muted background
- **WHEN** a `th` element is rendered
- **THEN** its background uses `var(--color-background-soft)`

### Requirement: Surface tokens for cards and panels
The system SHALL define `--color-surface` (cards, sidebar, modals) and `--color-surface-raised` (elevated panels) tokens.

#### Scenario: Admin sidebar uses surface color
- **WHEN** the `.admin-sidebar` is rendered
- **THEN** its background is `var(--color-surface)`

### Requirement: Border tokens
The system SHALL define `--color-border` (subtle separators) and `--color-border-strong` (input borders, card outlines) using rgba values for theme adaptability.

#### Scenario: Input border uses strong border
- **WHEN** an input element is in default state
- **THEN** its border-color is `var(--color-border-strong)`

### Requirement: Semantic color tokens
The system SHALL define semantic tokens for error (`--color-error`, `--color-error-soft`), success (`--color-success`, `--color-success-soft`), warning (`--color-warning`, `--color-warning-soft`), and info/link (`--color-info`, `--color-link`).

#### Scenario: Error alert uses semantic tokens
- **WHEN** an `.alert-error` element is rendered
- **THEN** its background uses `--color-error-soft`, text uses `--color-error`, border uses `--color-error-border`

### Requirement: Status badge tokens
The system SHALL define independent status badge tokens: `--color-status-healthy-bg/text`, `--color-status-degraded-bg/text`, `--color-status-unhealthy-bg/text`, `--color-status-neutral-bg/text`.

#### Scenario: Healthy status badge
- **WHEN** a `.status-healthy` badge is rendered
- **THEN** its background is `var(--color-status-healthy-bg)` and color is `var(--color-status-healthy-text)`

### Requirement: Shadow elevation tokens
The system SHALL define shadow tokens: `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-modal` for consistent elevation.

#### Scenario: Login panel uses large shadow
- **WHEN** the `.login-panel` is rendered
- **THEN** its box-shadow uses `var(--shadow-lg)`

### Requirement: Border radius tokens
The system SHALL define radius tokens: `--radius-xs` (4px), `--radius-sm` (6px), `--radius-md` (8px), `--radius-lg` (10px), `--radius-xl` (12px), `--radius-full` (999px).

#### Scenario: Status badge uses full radius
- **WHEN** a `.status-badge` is rendered
- **THEN** its border-radius is `var(--radius-full)`

### Requirement: Typography tokens
The system SHALL define `--font-family` (system sans-serif stack) and `--font-family-mono` (code font stack aligned with CherryStudio's Cascadia Code / Fira Code preference).

#### Scenario: Body uses font family token
- **WHEN** the root element is rendered
- **THEN** its font-family resolves to `var(--font-family)`

### Requirement: Transition tokens
The system SHALL define `--transition-fast` (150ms ease) and `--transition-normal` (250ms ease) for consistent animation timing.

#### Scenario: Button hover uses transition token
- **WHEN** a `.button` element transitions on hover
- **THEN** its transition-duration uses `var(--transition-fast)` or `var(--transition-normal)`

### Requirement: Dark mode support via data-theme attribute
The system SHALL support dark mode by defining all tokens under `[data-theme='dark']` selector with inverted color values appropriate for dark backgrounds.

#### Scenario: Dark mode text color
- **WHEN** `<html data-theme="dark">` is set
- **THEN** `--color-text-1` resolves to `rgba(255, 255, 245, 0.9)` and `--color-background` resolves to `#181818`

#### Scenario: Dark mode primary color unchanged
- **WHEN** dark mode is active
- **THEN** `--color-primary` remains `#00b96b`

### Requirement: Auto dark mode detection
The system SHALL include an inline script in `index.html` that checks `prefers-color-scheme: dark` and sets `data-theme="dark"` on `<html>` before first paint, preventing flash of unstyled content.

#### Scenario: System prefers dark
- **WHEN** the user's OS is set to dark mode and no manual theme override exists
- **THEN** `<html>` receives `data-theme="dark"` before React renders

#### Scenario: Manual override persists
- **WHEN** a theme preference is stored in localStorage as `cherry-theme`
- **THEN** that value takes precedence over system preference

### Requirement: Themed scrollbar
The system SHALL define scrollbar tokens (`--color-scrollbar-thumb`, `--color-scrollbar-thumb-hover`) and apply themed scrollbar styles via `::-webkit-scrollbar` pseudo-elements, aligned with CherryStudio's scrollbar.css.

#### Scenario: Light mode scrollbar
- **WHEN** light mode is active
- **THEN** scrollbar thumb is `rgba(0, 0, 0, 0.15)`

#### Scenario: Dark mode scrollbar
- **WHEN** dark mode is active
- **THEN** scrollbar thumb is `rgba(255, 255, 255, 0.15)`

### Requirement: Zero hardcoded colors in styles.css
After migration, `styles.css` SHALL contain zero hardcoded hex color values (`#xxx` or `#xxxxxx`). All colors MUST use `var()` references to tokens defined in `theme.css`.

#### Scenario: No hardcoded hex colors
- **WHEN** `styles.css` is searched for hex color patterns (regex `#[0-9a-fA-F]{3,8}`)
- **THEN** zero matches are found (excluding CSS comments if any)
