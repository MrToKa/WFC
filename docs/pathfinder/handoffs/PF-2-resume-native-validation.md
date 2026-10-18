# PF-2/PF-7 — Resume the first unmet real-model gate

This is the next unmet part of the accepted PF-0–PF-8 plan, not a newPF-9 or a
success claim. The independent admin workflow and operations delivery are
already implemented; do not duplicate them.

## Verified baseline and authority

As observed18October2026, the isolated worktree is
`C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Integrated source commit:
`51cc8324b40bd0ce2ed7d0b03decbdc06385b54a`.
Integration evidence/handoff commit:
`03db8f7`.
Verified local operations delivery:
`bf9dfdf8b075259880b58cc7a31202844a902f87`.
Heartbeatpathfinder is now PAUSED through the application tool with its other
fields preserved; see `evidence/pf8/automation-paused-20261018.json`.
Current delivery branch:
`pf-8-delivery-local-20261018`; inspect its live HEAD/status and the final
`automation-progress.md`/`08-stage-report.md` before acting.

Read applicable AGENTS.md,00-specification,00-validation-matrix,00-parity-fixtures,
02-stage-report,07-stage-report,08-stage-report,19-graph-preparation-review and
the originalPF-2 handoff. Keep all historical failed checks and frozen fixtures.
No push, PR, merge, original-installation update, original checkout build/edit,
synced sources/ edit or shared database/storage write is authorized. New code
uses another local branch inheriting the final delivery. Preserve old dirty
PathFinder checkout and two denied cleanup children.

Original WFC main remains e1ef20202598bb4d3d78e4772cbbb9747ec23a00.
Canonical clean PF master remains45c24bf5f433f13e102600b36f20327c77961d0a.
Read-only remote observation02:29:57UTC18October:
`evidence/pf7/remote-observations-20261018T022957Z.json`.
It is timestamped evidence, not a forever-current ref. No remote feature branch
was published; current PR/review/CI state is not proven for local delivery.

Standing authorization permits implementation and routine recommended choices.
It does not authorize licence/account changes, fabrication, weakening the
engineering gate, publishing or updating the original app. Automation should
remain paused while this external prerequisite is unchanged.

## Concrete external prerequisite

Native Automation failed0x80080005; the separate actual Manage2027 CLI started,
then exited2 with NOT Authorized / entitlement not found before capture.
No complete full-precision same-source native oracle exists in retained data.
Do not repeat that unchanged attempt, automate licence UI or alter activation.

Obtain one of:
- A complete native-oracle.capture.v1 export from a host/user with an existing
  authorized Navisworks Manage entitlement for this same source model.
- The user's confirmation that the local entitlement is working and permission
  to make a new bounded capture attempt using the already isolated oracle.

This is validation of equivalence; the web routing runtime itself has no
Navisworks dependency. An authorized exported reference can satisfy validation
without requiring Navisworks on the final user's machine.

## Required evidence and sequence

1. Reverify source/copy hashes, transport/resource fingerprints and final model
   versions. The current converted ZIP transport hash differs from historical
   metadata; equal raw-resource fingerprint alone does not prove a native-source
   translation link. See the actualPF-2 receipts; never silently pick the old hash.
2. Use `pathfinder-engine/tools/PathFinder.NativeOracle/README.md` and its unique
   copied-NWD runner/capture contract on the authorized host. Never open/save the
   original NWD or replace installed plugins. Retain full binary64 round-trip
   coordinates/matrices/metrics, source identity, unit/root/offset evidence,
   complete fragment boundaries, hierarchy, visibility, planned categories,
   measured/fallback states and untruncated explicit-scope data.
3. Pair native/converted identities deliberately. Use existing
   `pathfinder-engine/tools/model-capture/compare.mjs` and strict canonical
   normalization/comparator. Native counter IDs and equal names are not pairing
   proof. Compare native equipment bottom-AABB endpoints, straight/bend/junction
   fits, connection/gap topology, exact ordered/automatic path points,
   approach lengths, SECONDARY replacement, reserve-once-before-percent,
   double-to-decimal casts and final rounding under the exact same inputs.
4. Investigate reported differences instead of relaxing thresholds. Earlier
   selected converted totals107.55007443085563/37.050260813690024m and later
   product-selected35.30345579516123m are different recorded scopes from old
   rounded100.972/35.299m. None establishes native parity.
5. Once actual correspondence is established, complete full selected planning
   inventory/category/visibility, bounded whole-model capture and representative
   capacity measurements. Current52-object/26-segment product capture is not a
   plant. Confirm Instrumentation→Control, resolve unknown categories explicitly,
   and preserve current English UI/Ghost/yellow/clear/protected bridge.
6. Complete graph preparation at a justified scope. Current cache stores fitted
   geometry; each one-shot calculation rebuilds its endpoint-dependent graph.
   Follow19-graph-preparation-review. Any behavior-preserving graph refactor must
   retain the pinned reference, document a deliberate updated extraction
   contract, compare all original regression/frozen cases plus attachment/tie/
   exact-limit/category/query-order cases, and measure actual memory/time.
   Do not present a second unused API or a fitted cache as reusable graph proof.
7. Re-run affected end-to-end, security, cancellation/recovery and operations
   checks on an incrementally rebuilt isolated candidate, using computer-use.
   Do not repeat unrelated frozen receipt-writingPF-0 validators just for handoff.
   Review real-engineering acceptance mechanism only after the evidence gates
   are satisfied; HTTP-supplied proof flags must remain ineffective.

## Acceptance and reporting

Record exact revisions, source/artifact hashes, parameters, timing and
PASS/FAIL/BLOCKED/NOT_RUN. Technical passing checks do not equal user acceptance.
Deliver new compact paired fixtures/receipts, append the matrix, update current
reports/progress and commit locally. Keep bulk copied/private models ignored;
do not expose secrets or commit final backup/private companion files.

If the prerequisite remains absent, state that precise gate, keep the retained
5190 demonstration/source/backup and stop unchanged repeated attempts.
Do not mark PF-2/PF-7 or the whole feature engineering-accepted. Once an actual
complete local result is verified, present it for the user's separate review;
merge/deployment requires separate authorization.
