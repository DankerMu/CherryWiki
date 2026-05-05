# Stage 10 Wiki Sync Rollback Plan

Use this procedure when the Stage 10 wiki-sync-worker path causes permission drift, data integrity issues, or availability problems that cannot be fixed forward quickly.

1. Stop `wiki-sync-worker` by scaling the service to zero or stopping the worker process.
2. Leave Cherry API online. Cherry API continues accepting user traffic and persists Bridge events, but the wiki-sync-worker queues are no longer processed.
3. Confirm Bridge events accumulate in Redis/BullMQ and `bridge_events` without being consumed. Do not purge queues unless a separate recovery plan has identified invalid jobs.
4. Keep Cherry as the source of truth for permissions and wiki state while Docmost sync is paused.
5. Re-deploy the last known-good wiki-sync-worker build, or deploy a fixed build, then start the worker again to resume processing queued Bridge events.
6. Run the permission full reconcile trigger after the worker is healthy so Docmost permissions are overwritten from Cherry state.

Do not re-enable the worker until permission sync processor tests, wiki sync integration tests, and Bridge contract tests pass against the rollback or fixed build.
