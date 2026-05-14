# Secret Hygiene Delivery Check

Use this checklist before staging delivery artifacts or closing a remediation issue that touched auth, browser automation, or manual-test evidence.

## Local Auth Artifacts

Browser auth-state files are local secrets. Keep files such as `cherry-auth.json`, root `*-auth.json`, root `auth-state.json`, root `storage-state.json`, and `playwright/.auth/*.json` outside commits. These files may contain refresh cookies or browser local storage that can authenticate as a real user.

If authenticated Playwright state is needed, generate it during the local or CI run. Committed fixtures must be placeholders only and must avoid the reserved local artifact names.

## Manual Checklists

`test-checklist.csv` is local-only and ignored. Tracked manual-test docs must use placeholders such as `<seed-admin-email>` and `<seed-admin-password>` instead of reusable credentials.

## Secret Scan

Run the repository-local scan before delivery:

```bash
pnpm secret:scan
```

The scan checks commit-capable files, including tracked files and non-ignored untracked files, for:

- reserved auth-state artifact paths that became staged or otherwise commit-capable;
- browser storage-state cookies and local storage in JSON files;
- reusable `refresh_token` cookie or storage values;
- concrete manual-test passwords where placeholders are required.

The command fails closed and prints only file paths, line numbers, rule names, and summaries. Do not paste token, cookie, or password values into issues or PRs.

## Session Rotation Evidence

When a local auth artifact contains or may contain a reusable refresh session, revoke or rotate that session before marking the issue ready. Record only the action and scope, for example:

```text
Session hygiene: revoked the local browser test session associated with the discarded auth-state artifact on YYYY-MM-DD. No token or cookie values were recorded.
```

If the session cannot be revoked directly, rotate the affected seed account password or invalidate all sessions for that test account, then record the same value-free summary.
