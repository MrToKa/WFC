# PF-U5 — persistent cable routing workspace

Status: TECHNICAL_FOUNDATION_PASS, 484/484 distinct checks within the stated
scope. Deployment, actual computer-use and human acceptance remain unperformed.
Branch `pf-u5-cable-routing-workspace-local-20261020` inherits U5 handoff
`9cc893442a7a897165cd80155a2f086e0ffb4bd1`, U4 source
`b4db75c5c0aa4deea81b7760b0a5d481113b22fe`. Git records the containing delivery
commit; `evidence/cable-workflow/u5-actual.json` binds exact checked source hashes.

## Implemented behavior

The Path tool now mounts the bounded Needs routing workspace, with filters for
missing/ambiguous locations, calculated/current/failed/stale/no-path cables and
all non-MV cables. The old full-state missing-point list, general location editor
and standalone path tools remain available under Advanced. Routes and Path lookup
are preserved.

A persistent nonmodal Portal popup exposes exact From and To names and separate
Apply for From/To actions. It remains open through Viewer focus, orbit and outside
interaction, with no backdrop or focus trap. Collapse/Close pauses editor work
without discarding the durable unknown command. Close/Escape restores focus.
Missing names link to Cable list rather than inventing logical locations.

The one-click operation gets fresh endpoint context, reads exactly one protected
Viewer selection, verifies retained geometry, and retains the exact v3 command
before saving. Object-derived anchors remain explicitly approximate. Unavailable
retained evidence never silently falls back to a fixed-world point. Shared usage
is explained before saving; exact occurrence counts come from the saved receipt.
Both-empty initial fill and existing-value Review/Apply are described explicitly.

The same saved logical location supplies all matching From and To occurrences.
Save confirmation is separate from calculation and cable writing. Compact
affected-impact and initial-fill metadata GETs report waiting/processing/written/
review-required/stale/refused/unknown without granting or renewing authority.
Updated is displayed only after a bounded live cable read verifies accepted
receipt-backed values, not merely because a counter says written.

Periodic full `/state` polling is disabled for this Tab. Initial, explicit and
coalesced post-mutation reads remain; compact polling is single-flight and stops
when hidden, inactive, terminal or no longer owned. This removes that UI read
overhead; it is not a claim of a faster mathematical engine.

Selecting a calculated bounded row opens its exact proposal and validates the
real sealed admission, fresh exact parent job and live cable proof. A current
sealed v7 item may be reviewable before siblings complete. Legacy whole-parent
gates remain intact. Explicit history selection keeps its own scope and batch
readiness. Changes to readiness recheck the same immutable proposal without
retargeting another result or requiring a historical selector search.

Existing ordered comparison, human individual/batch Review/Apply, exact pending
Apply recovery and server authorization remain. Confirmed writes notify the
bounded list; unknown responses and close-without-apply tombstones do not.
Filled Ghost, original route colors, yellow line, endpoint visibility and the
protected bridge are preserved; no product NOP_VIEWER access was added.

## Integration races found and corrected

Independent source review found four concrete edge cases. Tests now cover:

- A late Workspace A read cannot override an advanced parent selection of B.
- Confirmed manual/batch/reconciled Apply refreshes the bounded row/list. If the
  notification arrives while Path is inactive, refresh waits until it resumes.
- Pausing after a verified save during storage cleanup still reports the exact
  saved impact once to the live owner. Original model scope and calculation
  preferences survive retained v1/v2/v3 recovery; new editor settings do not
  rewrite them. Account/model changes suppress stale callbacks.
- A selected legacy result moving from running to complete is rechecked. An
  explicit historical selection remains in control through that readiness change.

First progress reads may already be terminal. The workspace observes these too,
with synchronous key deduplication, instead of waiting for a change that can never
arrive. No action starts a full-project job for one shared endpoint.

## Verification and boundaries

PASS: 470 synthetic checks in20 files (`u5-tests.json`, `u5-test-scope.json`), plus
8 affected Tab composition scenarios in1 file (`u5-tab.json`): admin exclusion,
endpoint recovery, availability, exact path/review, ineligible Apply refusal,
late selected-cable response, blank-name link and three tools/one protected host
with periodic full-state polling disabled. Other49 Tab scenarios were skipped
in this bounded run and are NOT_RUN, not PASS. The initial full57-case styled
jsdom Tab run exceeded ten minutes and was interrupted without a terminal report;
`u5-tab-interrupted.json` preserves that limitation. Only the verified root-owned
Vitest parent and direct worker were terminated; no application process changed.

PASS: final frontend/backend TypeScript, all changed source lint and Git
whitespace check. Earlier aggregate467 and component slices are overlapping
draft evidence, not added to the final distinct count. Final104 Results/history
and97 endpoint/popup/API/store checks are subsets of the470 aggregate.

Actual PostgreSQL: final 6/6 PASS in `u5-progress-sql.json`, exercising the new
real bounded SELECT joins, immutable impact/mandate loaders, current admin/login,
account scope, waiting/no-path/unknown/receipt observations and read-only behavior.
These are synthetic seeded metadata, not a real-model route calculation.

First SQL draft was 5/6: a fixture created/expiry timestamp used two clock reads
and could exceed the strict 30-minute mandate by one millisecond. Production
guards correctly refused it. A single captured fixture clock fixed it. The
failed receipt is retained in `u5-progress-sql-draft.json`; the final suite used
a fresh owned database/schema rather than rewriting the first run.

Root alone created/retired the two memory-backed PostgreSQL fixtures:
`d57e972d-2365-4806-b19a-94100b9eff6e` / container
`778c78c0f59107e6a521ff623489bff951d729d046bd6580006b27110f533339`, and
`82612605-b80a-48e2-82e8-94ee5e7adfbd` / container
`b0cb85b52c9dc088747128268db43c3f1de384d8a410025c85d73e87b1a16c9d`.
Their generated credentials were removed after exact owner/path/image checks.
No broad prune or historical denied path deletion was attempted.

5191 image upgrade/migration, full engine/normal HTTP end-to-end and actual
computer-use checks NOT_RUN at this stage; saved site refusal is not bypassed.
Human acceptance and native parity NOT_RUN. No original5180/old5190 data,
containers, files or restarts; no5191 runtime changes, calculations or Review/Apply.
Original WFC remained clean main96e63f13 at observation. Live remote/CI NOT_RUN.
Simplified Preparer stays paused. No push, PR, merge, deployment or sources edit.

After this stage is technically complete, commit locally, apply
prepare-stage-handoff and immediately execute U6 direct SECONDARY. The accepted
condition is strict D<F OR D<T, all non-MV device kinds, no fixed maximum. Formula
uses actual 3D D plus Details end connection once, then Details bending percentage
and ceiling, without S or additional gap. That engine change is not part of U5.
