# PF-B5 — Administrator barrier authoring

Stage source is on `pf-b5-barrier-authoring-local-20261021`, inheriting
`658997b4223be2f61daaa7dccc48e7cb563eb8b3` (B4 product
`a7aa8bce1c2ffdda8e1a9fea10661a58624d2a96`). Product revision is recorded in
`evidence/barriers/b5-authoring.json`: `07fe6dd79676c1ed45153d2ab3cd79a1ac96680e`.
This is authoring and immutable request
plumbing; B6 runtime integration and B7 write authorization remain separate gates.

## Implemented

- Common English, app-style Barriers panel: explicit wall/partition/floor/ceiling
  parent selection, deduplication, draft removal, whole-set recapture, cancellation,
  status refresh and reasoned empty declaration. Current Model Browser selection
  supplies preview; no extra SDK access, visibility mutation or Ghost operation.
- The existing protected preparation facade now exposes bounded capture/publication
  under the same current model, administrator, login, generation and abort checks.
  The strict manifest reader validates exact project/snapshot identity and digest.
- Unknown writes retain their frozen key/intent/observation for reconciliation.
  Unrelated manifest errors, changed display frames and access denials cannot prove
  an unresolved command failed. Access denial hides old data and disables authoring.
- A separate strict admission-intent version freezes the exact model/frame, registry
  revision/snapshot and explicit drilling boolean. It contains no client authority
  to certify geometry or fabricate a server policy hash. Missing scope is not empty.
- **Drill through the walls** starts off, covers every registered barrier and applies
  only to the submitted calculation. Scope/login/Viewer-generation changes reset
  it; returning to an earlier scope cannot revive an old enabled choice. Background
  preferences independently derive drilling off. Persisted impact resume compares
  the full strict intent, including absent historical fields.

## Actual checks

- PASS: 105 shared admission/facade cases in the initial root run.
- PASS: 70 final panel/hook/preparation cases, including nine new uncertainty/read
  failure combinations. Panel/hook subset is 39; the other 31 protect existing
  discovery and project preparation after the additive facade methods.
- PASS: 33 final manifest/workspace cases (six manifest integrity/cancellation cases,
  27 workspace cases including four exact resume comparisons).
- PASS: client and server TypeScript checks; changed-file ESLint; diff whitespace.
- Initial combined UI run: 114 PASS / 2 FAIL. Both were root test-fixture/expectation
  mismatches: absent prepared artifact disabled a button; old standalone assertion
  omitted the new intent. Retained raw report, corrected fixtures and assertions.
- PASS: 60 final Tab cases, including standalone exact preferences, default-off
  frozen cable requests, scope return and same-model Viewer reload reset. Actual
  jsdom suite duration 708.31 seconds, not an application/geometry benchmark.
  Nonfatal React act warnings were emitted; this is not actual browser acceptance.
- The first combined root retry was interrupted after abnormal duration. Only its
  verified owned test process tree was stopped; split runs use one worker. Preserve
  this interrupted attempt as diagnostic evidence, not a passing check or product
  performance benchmark.
- Initial client type check failed in three old preparation mocks missing the new
  facade methods. Added explicit mock methods; final client/server checks passed.

Root alone executed checks. Agents authored non-overlapping production/test files
and independently reviewed source. Review found and fixed uncertainty provenance
and resurrected drilling state. No frozen PF-0 inputs/expected/receipts or pinned
Core Routing files changed. No C# changes require another B3/B4 parity run for B5.

## Isolation and outstanding gates

All source, prompts and evidence are in the isolated worktree. No B5 runtime,
database, model, container, image or volume writes/restarts; no 5191 delivery.
Original WFC remains clean main `96e63f13fdc2b1d30b8f8ff658dd662f25fac104`,
read-only checked; live GitHub main matched at `2026-10-21T13:00:47Z`. No B5 PR.
Cached local ancestry was 149 local-only / 3 remote-only, not live CI evidence.
No push/PR/merge. No user engineering acceptance is claimed.

Actual converted capture and browser acceptance: NOT_RUN, unchanged origin access
refusal. No alternate-browser/native/CDP/origin bypass. Tiny synthetic checks do not
qualify full civil geometry or the 2140-cable workload. Historical refused paths and
parents remain untouched, including the two B2 cleanup targets denied by automatic
approval review. B5 creates no container; its evidence scratch is retained.

Before a coherent release: B6 must version all serializers/collectors/runner/cache
and replace the truthful temporary routing-unavailable caption with actual
capability/proof state. B7 must gate initial fill and Apply with current proof.
B8 qualifies integration/capacity and actual Aalborg where legitimately accessible;
B9 requires fresh owned backup and coherent delivery. Preparer remains queued.
