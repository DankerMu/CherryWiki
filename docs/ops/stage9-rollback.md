# Stage 9 Bridge Rollback Plan

Use this procedure when the Docmost Bridge path causes data integrity, availability, or permission sync issues that cannot be fixed forward quickly.

1. Revert the Docmost submodule or fork deployment to the last pre-Bridge commit.
2. Set Docmost to read-only mode so users cannot create additional divergent edits during recovery.
3. Pause write-back from Docmost to Cherry by disabling Bridge webhook delivery or clearing `DOCMOST_BRIDGE_SECRET` from the Docmost runtime.
4. Restore service reads to the last known-good Cherry index snapshot and keep the current broken snapshot inactive.
5. Reconcile after recovery by comparing Docmost changes, `bridge_events`, and Cherry wiki versions, then replay or manually apply only verified events.

Do not re-enable write-back until HMAC validation, nonce storage, event idempotency, and permission projection have passed the contract tests again.
