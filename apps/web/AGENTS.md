# apps/web Agent Instructions

Root authority: `../../AGENTS.md` remains authoritative for completeness, Docker safety, Python venv usage, testing, progress updates, and global repository rules. This file only adds stricter Web-local boundaries.

## Boundaries

- This is the React + Ant Design frontend. Keep pages as composition boundaries; move reusable state into hooks and reusable UI into focused components.
- User-visible text is Chinese/i18n-managed by default. Keep API error, permission, empty-state, and checklist wording aligned with backend semantics.
- Use Ant Design tokens and existing CSS variables for theme work. Do not introduce one-off theme constants when a token already exists.
- Chat refactors must preserve REST/SSE payload behavior, session switching/deletion, selected-space scope, model/database gating, message rendering, citations, and source-chain display.
- Do not redesign Chat or move API contracts while doing boundary cleanup unless the issue explicitly requires it.
- `external/*` is reference or forked third-party code; do not include it in implementation refactors for Web work.

## Verification

- `pnpm --filter @cherrygraph/web test`
- `pnpm --filter @cherrygraph/web typecheck`
- For Chat work, run the targeted Chat Vitest command first when available, then the full Web test command.
