# Stage 2 report — persisted intent and write guards

Implemented on 2026-11-15 against the existing dirty working tree, preserving concurrent changes. No application database schema was changed and no deployment was performed by this stage.

## Persisted state

- `server/pathfinder/cableRoutingControlSchema.ts`: repeatable additive controls, control events and manual calculation queue; initialization is called after existing Path Finder tables. Existing nonblank Routing is classified once as protected manual; existing execution facts freeze the effective route. The insertion trigger initializes future cables. Later startup does not reclassify subsequent automatic writes.
- Control `revision` fences policy changes and automatic mandates. Independent `manual_revision` identifies changes to retained manual text/protection, avoiding false manual-length staleness when execution facts latch a freeze.
- Positive Install length or any Pull date, Connected From, Connected To or Tested date latches execution protection. Clearing dates does not release the latch. An explicit reason and cleared facts are required for release. A database trigger also refuses direct Routing changes while execution is protected.
- Legacy manual text is preserved, including invalid text, and exposed with `MANUAL_ROUTING_INVALID_TEXT` diagnostics. New mutations use the strict normalizer. Parent updated the shared persisted schema accordingly.

## Transactional APIs and public projection

- `applyCableRoutingControlInTransaction(client,{projectId,cableId,actorId,before,after,mutation,automaticRouting,expectedRevision?,unlockReason?,principal?})` returns `{control,revision,manualRevision,routing,blockedReasons}`. Caller owns the cable lock and commits its cable/history update in the same transaction. Import refusal preserves Routing and returns reasons so permitted other fields/rows can continue. Missing or blank Routing with import protection OFF is a true no-op.
- `initializeImportedCableRoutingControl(client,{projectId,cableId,actorId,after,protect,principal?})` is exclusively for a cable returned by the caller's fresh INSERT in the same transaction. It overrides the INSERT seed before applying the requested initial protection and execution freeze. Never use it for an existing or conflicted row.
- PATCH accepts `manualRoutingProtected`, `expectedCableWriteRevision`, `expectedRoutingControlRevision`, and `executionUnlockReason`. Routing carries the editable manual text. PATCH route conflicts are atomic HTTP 409 responses with `routingConflict.reasons`; import partial acceptance is a subsequent stage.
- Public view: `routingControl`, `routingControlRevision`, `cableWriteRevision`, `autoCalculatedRouting`, `autoRoutingStatus`, `autoRoutingCalculatedAt`, `manualRouteLength`, `manualRouteLengthStatus`, `routingDiagnostics`. The automatic route is a last-successful display projection tied to the hash-checked immutable result/source, never the mutable proposal route field. This projection is not current calculation/write authority.

## Automatic writes and durable queue seam

- Migrated controls are authoritative for automatic pair admission and final writer. The new `{kind:'policy',controlRevision}` ownership is retained exactly in immutable mandates/receipts and compared at write time. Unrelated cable history/import edits no longer establish manual intent. Historical rows without controls retain the old receipt inference path.
- Initial-fill and reviewed Apply check the same manual/execution guard before effective Routing/Design pair writes. Protected cables still participate in calculation and successful Auto result publication; skipping a write mandate does not suppress the calculation.
- `enqueueManualRouteCalculation(client,projectId,cableId,manualRevision,principal?)` is a same-transaction durable seam, visible to a worker only after COMMIT. `principal` is `JobPrincipal` (`userId`, `loginId`, `loginExpiresAt`). Queue columns retain actor/login/expiry. Future worker must recheck current login, project access and administrator authority; null migration authority never grants service-job authority.
- Nonblank retained manual text is queued even when protection is OFF; it remains available for comparison while the effective route may use Auto. Clearing manual text retires its queue record. Prior derived length is marked stale when a new text revision is enqueued.

## Verification

- `routing-stage2-full.log`: **226 PASS** across 7 files. Includes 16 actual PostgreSQL cases, 10 immutable route projection cases, policy ownership/revision admission, automatic writer, initial-fill writer and ordinary cable read regressions.
- PostgreSQL suite opt-in: `WFC_ROUTING_CONTROL_POSTGRES=1 vitest run server/pathfinder/cableRoutingControl.postgres.test.ts`. It verifies container boundary `wfc-test-postgres`, loopback port 55432, creates a unique `wfc_routing_control_<uuid>` database, and drops it afterward. Application databases are never bootstrapped by the test. Cases cover migration twice, future Auto classification, manual edit/uncheck/clear, principal queue/audit, all five sticky facts, explicit unlock, stale revision refusal, partial import helper behavior, initial import ON/OFF including execution facts, no-op import cells and post-COMMIT visibility.
- `routing-stage2-broader.log`: **168 PASS** across immutable revision admission/results, historical automatic receipt proof, dispatch and cable route handlers.
- `routing-stage2-policyproof.log`: **37 PASS**, including the 35 historical proof cases above plus two new nonblank policy-controlled normal/capacity-clear roots and tampered policy revision refusal. Total unique stage 2/regression cases: **396 PASS**.
- Server TypeScript `tsc --noEmit -p server/tsconfig.json`: PASS after parent corrected two concurrent Excel test import extensions. Logs are in `D:/WFC-Test/validation/`.

## Required next-stage work and limits

Manual ordered-route mathematics is deliberately not implemented by this stage. Pending/stale state is truthful; no ordered lookup sum or artificial Design length is substituted. Stage 3 must execute the full endpoint/geometry/reserve/barrier calculation using the new native manual constraint, bind its immutable inputs to manual revision plus dependency fingerprint, discard stale completions, and publish only derived manual length/diagnostics. It must automatically invalidate affected manual calculations when model/tray geometry, settings, endpoints or barriers change, independently of continuous automatic recalculation. Existing migrated jobs have no authenticated principal and cannot execute until legitimately re-enqueued under authenticated authority.

Excel import/export integration, selectable execution columns, final browser checks and deployment belong to the parent/coordinated following stages. Current stage tests use synthetic geometry or isolated database fixtures; they do not claim real-model engineering acceptance.

## Follow-up review correction

Read-only review found that latching execution before the caller's actual cable UPDATE would refuse a permitted first execution report combined with a route correction. Fixed without call-site changes: the transactional helper saves manual intent, and the cable AFTER UPDATE trigger freezes/audits the accepted new Routing. Already locked cables remain protected. `routing-stage2-first-execution.log`: **27 PASS** (17 actual PostgreSQL + 10 projection); the new `/A`→`/B` plus first Pull date case and subsequent `/C` refusal pass. The event JSON bound is widened repeatably to 524288 bytes to retain maximum accepted before/after Unicode text. This adds one unique regression, bringing stage 2 coverage to **397 unique PASS**.
