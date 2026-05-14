# Issue #321 OpenSpec Triage and Evidence

Date: 2026-05-14
Branch: `feat/issue-321-openspec-artifact-triage`
Issue: https://github.com/DankerMu/CherryWiki/issues/321

This record covers the untracked `openspec/changes/*` directories visible in
`git status --short --untracked-files=all` during #321 delivery. The #321
delivery commit intentionally includes this evidence file and the section 4
task updates only. It does not bulk-stage unrelated proposal, design, task, or
spec draft files.

## Disposition Summary

- Commit: `openspec/changes/round2-review-remediation/triage-evidence.md` and
  the section 4 checklist update in `tasks.md`.
- Defer: all untracked local OpenSpec draft directories and draft files listed
  below.
- Archive: none.
- Ignore: none.
- Metadata added: none. Active delivery changes selected for this PR already
  have tracked `.openspec.yaml`; directories with missing or untracked metadata
  are deferred/non-active for #321 delivery.

## Untracked OpenSpec Directory Triage

| Directory | Disposition | Rationale |
| --- | --- | --- |
| `admin-group-space-delete-and-chat-nav` | defer | Fully untracked local draft; not part of #321 OpenSpec delivery integrity remediation. |
| `admin-model-health-fixes` | defer | Fully untracked local draft; #322 issue traceability is already handled by `round2-review-remediation` and this draft is not selected for #321 delivery. |
| `admin-user-delete-and-permission-defaults` | defer | Fully untracked local draft; unrelated to #321 acceptance criteria. |
| `agent-security-hardening` | defer | Fully untracked local draft; unrelated to #321 acceptance criteria. |
| `chat-ux-critical-fixes` | defer | Fully untracked local draft; unrelated frontend UX scope. |
| `docmost-auto-sync` | defer | Existing tracked `tasks.md` remains untouched; new local `.openspec.yaml`, proposal, design, and specs are not part of #321 and local strict validation currently fails, so no metadata is committed. |
| `fix-admin-space-visibility` | defer | Fully untracked local draft; unrelated to #321 acceptance criteria. |
| `frontend-ux-fixes-batch1` | defer | Fully untracked local draft; unrelated frontend UX scope. |
| `frontend-ux-fixes-batch2` | defer | Fully untracked local draft; unrelated frontend UX scope. |
| `frontend-ux-overhaul` | defer | Fully untracked local draft; unrelated frontend UX scope. |
| `graph-ux-improvements` | defer | Fully untracked local draft; unrelated graph UX scope. |
| `graphify-run-show-document-names` | defer | Fully untracked local draft; unrelated Graphify UI/API scope. |
| `multi-space-chat` | defer | Fully untracked local draft; unrelated chat scope. |
| `phase3-persistent-agent-runtime` | defer | Fully untracked local draft and not part of #321 remediation; it is non-active for this delivery, so no `.openspec.yaml` metadata is added. |
| `post-completion-review-hardening` | defer | Existing tracked `tasks.md` remains untouched; new local `.openspec.yaml`, proposal, design, and specs are not part of #321 delivery and stay local. |
| `space-knowledge-browser` | defer | Fully untracked local draft; unrelated knowledge-browser scope. |
| `wiki-docmost-renderer` | defer | Fully untracked local draft; unrelated renderer scope. |

## Active Metadata Check

Active changes selected for #321 delivery:

- `round2-review-remediation`: tracked `.openspec.yaml` present.

Other tracked active changes retained in the repository:

- `stage6-indexer-vector-bm25-source-chain`: tracked `.openspec.yaml` present.
- `stage7-chat-engine-rag-citations`: tracked `.openspec.yaml` present.
- `stage9-docmost-fork-bridge`: tracked `.openspec.yaml` present.

Partially tracked or fully untracked local draft changes are deferred for #321.
That includes `docmost-auto-sync`, `post-completion-review-hardening`, and
`phase3-persistent-agent-runtime`; they are not selected as active delivery
changes in this PR.

## Remediation Test Tracking

Command:

```sh
git status --short --untracked-files=all
```

Result summary:

- Modified tracked OpenSpec fixture files:
  `openspec/changes/round2-review-remediation/design.md` and
  `openspec/changes/round2-review-remediation/tasks.md`.
- New #321 evidence file:
  `openspec/changes/round2-review-remediation/triage-evidence.md`.
- Untracked OpenSpec directories visible in status are exactly the directories
  listed in the triage table above.
- No untracked remediation test, checklist, or auth artifact appeared in the
  command output.

Command:

```sh
git ls-files apps/url-fetcher-worker/tests/test_main.py
```

Result:

```text
apps/url-fetcher-worker/tests/test_main.py
```

The URL fetcher remediation test file is tracked.

## OpenSpec Evidence

Command:

```sh
openspec status --change round2-review-remediation
```

Result:

```text
Change: round2-review-remediation
Schema: spec-driven
Progress: 4/4 artifacts complete

[x] proposal
[x] design
[x] specs
[x] tasks

All artifacts complete!
```

Command:

```sh
openspec validate round2-review-remediation --strict --no-interactive
```

Result:

```text
Change 'round2-review-remediation' is valid
```

Additional validation context:

- `openspec validate stage6-indexer-vector-bm25-source-chain --strict --no-interactive`: valid.
- `openspec validate stage7-chat-engine-rag-citations --strict --no-interactive`: valid.
- `openspec validate stage9-docmost-fork-bridge --strict --no-interactive`: valid.
- `openspec validate post-completion-review-hardening --strict --no-interactive`: valid using local untracked draft artifacts, but those artifacts are not part of #321 delivery.
- `openspec validate docmost-auto-sync --strict --no-interactive`: failed on local draft spec format, so the new local draft artifacts remain deferred.

## Issue Traceability Evidence

Command:

```sh
for n in 317 318 319 320 321 322; do
  gh issue view "$n" --json body --jq '[
    (.body | contains("openspec/changes/round2-review-remediation")),
    (.body | contains("specs/")),
    (.body | contains("Acceptance") or contains("acceptance")),
    (.body | contains("Dependencies") or contains("dependencies"))
  ]'
done
```

Result summary:

GitHub issue checks were run for #317 through #322. Each issue body contains:

- `openspec/changes/round2-review-remediation`
- a `specs/` reference
- dependency text
- acceptance criteria text

Issue #321 directly links:

- OpenSpec change: `openspec/changes/round2-review-remediation/`
- Spec: `specs/openspec-delivery-integrity/spec.md`
- Dependency: #318 before triage to avoid committing local auth artifacts.
- Task checklist and acceptance criteria for OpenSpec delivery integrity.
