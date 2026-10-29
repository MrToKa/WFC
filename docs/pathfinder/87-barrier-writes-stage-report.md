# PF-B7 — Protected writes and review in the cable window

Source delivery: local commit `34c603c709742e94788077efef54fab7ca37e824`
on `pf-b7-protected-writes-local-20261021`, inheriting B6 documentation
`040e1e2b5e6bc04f59e6f7661903174995e7650f` and B6 product
`2ccec7524d3e793fb5fdb01844a70b45fc90e979`. It contains43 source/test files.
Technical validation is complete for the scope below. The full final Tab suite
passed60/60 (1331.56s; slow Fluent/jsdom queries, no UI performance qualification).
Public receipts are evidence/barriers/b7-writes.json and b7-writes-source-files.json.
No5191/original application update occurred. Human engineering acceptance is separate.

## Implemented

- The detached cable window shows exact live old/new Routing and Design length,
  with separate Review and Apply. Existing populated values are replaceable together;
  the user does not clear Cable list first. Endpoint Save remains separate.
- Popup actions share the existing durable exact-proposal controller. Cable,
  account, model, input/policy and proposal changes fence old callbacks. Comparison
  loading/failure blocks a new approval but does not block committed receipt recovery.
  Claiming the viewer no longer discards the comparison. Assign does not Ghost the
  model; route/From/To display and the protected bridge remain unchanged.
- Selected Calculate observes only a fresh submitted job, with bounded reads and
  no automatic resubmit/Apply. Synchronous Review/Calculate latches reject duplicate
  activation before React commits its busy state.
- New Review/Apply/initial fill require exact protected dependencies.v8/result.v3,
  final ordered barrier proof, immutable seal and original C# length ledger.
  Clear, explicit drilling bypass and declared-empty scope retain distinct labels.
  Legacy proposals stay readable and cannot gain new write authority.
- Forced v2 implementation and retained barrier scope are checked before locked
  dependency collection and again after history/receipt insertion, with final
  authority/expiry fencing through COMMIT. The final physical fence does not compare
  an obsolete full cable hash after its own legitimate revision increment.
- Human Apply atomically replaces Routing/Design, checks the returned pair,
  revision increment and preservation of every other cable field, and requires one
  actual history row. Installed length is preserved. History/receipt/final-fence
  failures roll back the pair.
- Fresh receipts use apply.v3 and initial-fill.v2 with small exact evidence refs.
  Historical committed receipts and unknown-COMMIT recovery retain the original
  command/key; no old successful receipt creates a new authorization.
- Initial fill remains only both blank under the actual Save mandate, with exact
  original mathematical/barrier preferences, current target/CAS/authority and
  preserved partial/nonempty values. Accepted baseline/workflow/read projections
  recognize new strict receipts and never fall back from an invalid newest record.

## Actual checks

All tests/builds/SQL were executed by root in the isolated checkout. Groups overlap;
these counts are not a unique whole-system total. Logs remain in
`pathfinder-engine/.scratch/barrier-writes-20261021-3b6e92d9-fd73-4c0f-b4f3-43680baec838`.

| Scope | Result | Evidence |
| --- | --- | --- |
| Protected writer/initial-fill/receipt/workflow/shared group | PASS387 | protected-check3.log; later additions checked separately below |
| Exact evidence statuses and live fence | PASS27 | evidence-status-check7.log |
| Positive protected accepted baseline + tamper links | PASS68 | baseline-check6.log |
| History, recovery, applicability and human writer | PASS158 | history-check5.log |
| Actual PostgreSQL endpoint/mandate/initial fill and metadata | PASS19 | sql-initialfill-check5.log |
| Actual PostgreSQL human Review/Apply/CAS/history/auth/commit locks | PASS16 | sql-protected-check8.log |
| Pending/batch/revision UI | PASS112 | ui-recovery-check11.log |
| Popup/workspace/Results UI before the final ownership fix | PASS160 | ui-popup-check14.log |
| Results including real parent-viewer ownership regression | PASS103 | ui-results-check16.log |
| Full final Tab UI | PASS60 | ui-tab-final17.log, frozen product source;1331.56s |
| Server build and contract packaging | PASS | server-build-check15.log |
| Final client types / changed-source lint / whitespace | PASS | client-types-final17.log / lint-final17.log / git diff --check |
| Actual civil capture / photographed Aalborg cable / real2140 capacity | NOT_RUN | B8 separate gates, browser refusal preserved |
| Native engineering parity / user acceptance | NOT_RUN | unavailable license; user chose converted evidence and manual review |
|5191/original update, real-data Apply, push/PR/merge/deployment | NOT_RUN | outside this stage; no such action performed |

SQL fixtures execute real transactions, production cable revision trigger,
authorization locks, CAS, history and receipts. Their geometry, identity, dependency,
seal/capture adapters are explicitly synthetic. They are not actual civil-model or
HTTP/browser/native evidence. The new PG55441 fixture was retired only after full
ID/owner/stage/image/loopback-port/tmpfs-only checks; private contexts and logs remain,
and its removed tmpfs data is not a persistent backup.

Initial failures are retained: cloning a fixture function, invalid typed-failure
ledgers, missing automatic-match subsystem in the selected-object SQL fixture,
nullable/literal test types, comparison ownership and repeated popup text assertions.
Fixtures/boundaries were corrected without weakening production checks. Combined
UIcheck10 was interrupted with no completion, not a PASS or proof of a product loop.
Subsequent isolated tests and the full final Tab completed successfully. Final Tab
contains React act warnings in existing asynchronous endpoint-binding fixtures;
they are retained in the log and are not browser performance evidence.

## Boundary and next work

Original WFC was inspected clean main `96e63f13fdc2b1d30b8f8ff658dd662f25fac104`.
Live GitHub main matched it during2026-10-21 16:04:33–16:04:34 UTC; no B7 PR was found,
CI NOT_RUN. Cached origin divergence is not live acceptance. No pinned C# Core or
frozen expected source was edited by B7; unchanged B6 numerical evidence is reused,
not rerun as a new native result. Denied cleanup paths/parents remain untouched.

The latest user clarification adds B7a before B8: Auto calculated length updates
immediately from the exact successful PF result and is read-only; Design stays
manually editable and existing values wait for Apply. The user reconfirmed both-blank
automatic fill. Current Auto is a client tray-list estimate, so B7a needs a distinct
server-owned calculation read model; it must not use that estimate as a PF fallback.
Draft preparation was isolated in scratch until these B7 checks completed.
Execute the self-contained PF-B7a-auto-length.md automatically on a new inheriting
branch, followed by B8/B9 and
queued Simplified Preparer as authorized. Do not declare the full task complete.
