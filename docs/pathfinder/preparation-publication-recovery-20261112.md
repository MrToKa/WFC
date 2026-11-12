# Preparation publication and final confirmation — 2026-11-12

The Aalborg report stopped at “Tray network saved. Confirming its final check (3 of 3)” with a preparation database deadline. The final trace publication used the project writer lock while loading and decoding large immutable pages. Status reads competed for the same lock, and the UI discarded an already confirmed publication when a subsequent status refresh failed.

Immutable fitted geometry and index pages are now loaded, verified and staged before the final publication transaction. The transaction still checks the exact intent, aggregate, plan and current preparation context before atomically inserting the trace and its receipt. A changed model, catalog, routing policy or tray resolution cannot publish an old preparation as current. From/To-only changes preserve the tray network and do not block its final trace publication. Replaying an already completed command returns its immutable receipt without repeating its writes.

Human preparation reads use a consistent repeatable-read snapshot and a project key-share lock. They do not compete with the project update lock used by publication. The user and current login remain locked through the transaction so revocation cannot pass an authorized read halfway through. Default writes and grant-scoped operations retain their existing serialization. Database deadlines are unchanged.

The UI accepts an exact successful publication receipt immediately. Optional status refreshes cannot turn that confirmed outcome back into an unknown write. If the response was lost, recovery retries the same command. If the scope changed meanwhile, an old command can still be reconciled, but its historical receipt cannot make the new scope ready. No replacement geometry capture is sent merely to confirm a receipt.

The 512 MiB capture profile and manual Discover workflow remain as introduced in the preceding release. This change neither adds selected model objects nor starts preparation after a manual tray assignment.

Regression coverage includes publication while status is read, coherent snapshots across a concurrent commit, queued writes, login revocation, exact publication receipts, lost responses, scope changes and recovery without recapture. The PostgreSQL contention tests use a dedicated disposable local database and also run in CI.

Deploy API and web from the same revision and reload the page. Reconcile a pending tray update with Retry tray update; do not remove project data or database volumes. The fix must be checked against the remote Aalborg model after deployment; local regression tests do not establish its end-to-end runtime.
