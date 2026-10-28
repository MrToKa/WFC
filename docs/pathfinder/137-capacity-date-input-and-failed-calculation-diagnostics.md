# Capacity Date input and failed-calculation diagnostics

The Aalborg cable `=H1=KF1=TAC1=WGA1` retained its saved From assignment but its
next three calculations stopped with `invalid_request`. The original failure
was reproduced using production reads, before dispatching the native engine.

`readTrayCapacityRouting` passed raw PostgreSQL tray rows into the strict JSON
canonicalizer used by the occupancy fingerprint. The driver's `Date` values in
`created_at` and `updated_at` caused `INVALID_POLICY_JSON_VALUE`. The worker's
generic exception handler then reported “The private calculation engine failed.”
This was a preparation error, rather than evidence that the From point was
unreachable.

The occupancy fingerprint now projects the mapped tray fields consumed by
placement: ID, name, type, purpose, width, height and trefoil-clamp use. Audit
metadata and fields used only for weight or reports are excluded. The global
JSON canonicalizer, native binaries, engineering dependency checks and route
acceptance rules stay strict. Old occupancy observations must still match the
fresh fingerprint before reuse.

The popup also retains the selected cable's diagnostic message from its exact
calculation job. Failed-result details are scoped to the account, model, cable
and job; an earlier result or another cable cannot supply the failure message.
No failed result becomes drawable or applicable through this diagnostic view.

Regression coverage includes actual PostgreSQL `Date` values, equality with
equivalent string timestamps, audit-only stability, physical-field sensitivity,
and failed-job diagnostic scoping. Live-data qualification uses the saved From
`[96.25805882958798, -3.417996200309318, 5.0158659621531]`, the unchanged To,
31 published obstacles and drilling disabled. It does not submit a live
calculation or change the project's assignments.

Private diagnostic and qualification receipts are retained under
`D:/Codex-test-output/routing-failure-20261026/`. Native timings there measure
the native invocation, not time until the popup's Show button is available.

Validation for the frozen fix:

- Capacity reader/execution tests: 42 passed.
- Popup workspace/panel tests: 199 passed; focused ESLint and complete typecheck passed.
- Independent backend and UI reviews: no findings.
- Exact current request with live balancing inputs: calculated, 244 points,
  design length 100 m, barrier status clear; cold native invocation 11.945 s.
- The response also passed the existing strategy, length-ledger and capacity
  settlement checks without creating a job or writing project data.

The API update preserves the exact installed native binaries and protected
calculation projection; only the compiled capacity reader changes on the server.

Installed on 5191 with operation `a5b0fa5d-28ec-47f6-905c-1eabf69faede`:
API `7b97083db41ac977033ba18e56725ed8040b4430a00780de8aadd71f35523efe`,
web `37542dfe77c7927fa9d07142574f2e5fe345d26f77200c4ad539013bf8a282c0`.
Health passed; full database row/count hashes and Path Finder artifact hashes
matched before and after. The fresh verified database checkpoint is 32,211,404
bytes; the previous full storage backup and image pair remain available.
The installed reader qualification also passed without an overlay. No live
calculation or engineering-data write was submitted during these checks.
