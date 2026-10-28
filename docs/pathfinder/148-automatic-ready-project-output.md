# Automatic output for ready project cables

The automatic-calculation test project `d4469afe-9d21-4888-a5b6-d835bce7e4be`
had 2,140 empty Routing/Design length pairs even though calculated proposals and
250 automatic-length observations existed. The 30-minute scheduler created jobs
without enrolling the existing automatic-pair writer. A completed job means all
its items were processed; some items can remain blocked or require review.

The older `AUTOMATIC_GENERATION_SUPERSEDED` result was a separate, valid refusal:
a newer generation replaced that job. It must not be disabled to repair output.

## New 30-minute enablement

The Enable action sends an explicit v2 command containing the existing
`when-both-empty-or-unchanged-automatic` output policy. Its original command,
receipt, account/login, administrator revision, installation, finite expiry and
enrollment are retained and checked again before writing. Historical v1 commands
and calculation-grant v1 retain their original proposal-only meaning. Re-enable
through the updated UI to start a new output-enabled generation; old proposals
are not retroactively given write permission.

Only ready calculation items receive output mandates. Missing or ambiguous
locations remain available for manual assignment and do not prevent other items
from progressing. Successful items can be saved while the rest of the batch is
still running. The existing writer updates an empty pair or an unchanged pair
previously written automatically by Path Finder. Manual edits keep Review/Apply;
automatic length publication keeps its existing independent behavior.

Admission retains the existing project/user/login and cable locks. The
installation guard is acquired before the scheduler latch. Writes continue to
check the exact generation, dependencies, sealed result and cable revision, and
retain the existing atomic history/receipt and idempotent recovery behavior.
Retry/Resume do not extend the original output permission. A fresh Enable can
issue a new finite permission; replaying its idempotency key returns its receipt.

## Independent tray preparation

Manual tray discovery now explicitly records that endpoint search was not
requested. It creates a hashed routing-only scope with no endpoint evidence or
equipment capture. Current endpoint names remain freshness dependencies.
Legacy/full discovery still refuses incomplete endpoint scans, and managed full
preparation cannot reuse a routing-only aggregate as a complete one. An older
incomplete frozen plan needs fresh discovery and freezing.

## Verification

Evidence lives under `D:/Codex-test-output/automatic-project-write-20261027/`.
The real-PostgreSQL qualification uses temporary tables in an isolated, owned
database, executes the production authority/admission queries, checks expiry,
supersession and manual protection, rolls back, and removes its container.
UI, scheduler, writer, preparation and shared-contract regression tests accompany
the change. Deployment inherits the installed native engine and SDK and changes
only the explicit API modules and frontend bundles. User workbook and model data
are preserved.
