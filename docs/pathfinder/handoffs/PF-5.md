# PF-5 — Durable automatic calculation jobs and design recalculation

Advance independent implementation prompt under `18-execution-resume.md`.
Refresh PF-3/PF-4 actual interfaces and stage reports before declaring delivery.
The isolated baseline inherits `3c51a00`, PF-3 registry implementation and the
new private `PathFinder.ModelRunner`; native engineering acceptance is BLOCKED.
All previous isolation, strict-admin, formula and explicit Review/Apply decisions
remain. Do not change original runtime/data or publish.

Implement durable project-scoped automatic/batch proposal jobs, bounded worker
concurrency, progress, cancellation, leases, recovery and attributable errors.
Snapshot all authoritative cable input/write revisions, shared binding revisions,
active model/selection/artifact/rules and exact current Project Details settings.
Missing/ambiguous/stale endpoints or unknown categories produce visible blocked
items; they never become fabricated coordinates/settings. Confirming a shared
location reevaluates waiting From/To uses and generates new proposals only.

Node orchestration calls the strict private C# ModelRunner through a bounded
hidden child with hard deadline, output/input bounds and kill+await cancellation.
It must not replace the Core with JS shortest-path/length math. All three
allowances come from the project row as exact strings. Settings-only changes
use operation `design` with the immutable successful retained route metrics,
without rebuilding geometry. Track new settings snapshots and review status.

Persist immutable proposals with exact route points, route/design breakdown,
diagnostics/provenance and dependency hashes. Reread dependency snapshots before
publishing/completing work. Stale work stays visible and cannot be applied.
Recover interrupted jobs idempotently; worker ownership/lease tokens prevent
late processes from overwriting a recovered or cancelled job. Current admin
revocation/session expiration and model health/selection invalidate authority.

Real unaccepted geometry may produce diagnostics, never applicable engineering
results. A server-owned explicitly synthetic test fixture may exercise the full
flow only in the separate local demo mode; no client proof flag is trusted.

Test cancellation/deadline/restart/concurrent-claim fencing, dependency changes
including A→B→A, missing settings, Instrumentation mapping, location reuse and
settings-only exact formula results. SQL/job tests use only own DB/volumes.
Record `05-stage-report.md`, exact source and actual PASS/FAIL/BLOCKED/NOT_RUN,
commit locally, generate PF-6 from the inspected state and execute automatically.
