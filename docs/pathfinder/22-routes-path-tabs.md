# Path Finder — Routes and Path revision

User decision18October2026: use two inner tabs **Routes + Path**, and rename the
outer project tab to **Path Finder**. The canonical addon at45c24bf5 actually
constructs Routes, Path and Path lookup; the user explicitly selected the first
two after clarification. Ordered lookup remains inside Path as an advanced
section, rather than becoming a third tab.

Status: implementation/testing in progress. This document records the accepted
direction; final runtime results will be appended only after actual checks.

## Source verification before the runtime checkpoint

| Scope | Actual result |
| --- | --- |
| Backend preview/preferences/boundary, matching and settings | PASS: 25 + 20 + 15 tests; server TypeScript and targeted ESLint pass |
| Root API, hook and Details formula labels | PASS: 7 + 10 + 7 tests; targeted ESLint passes |
| Protected bridge, path and protocol | PASS: 47 Node tests |
| Rule/legacy capture | PASS: 19 Node tests, including two actual C# process cases |
| Adapter and legacy Ghost restoration | PASS: 27 Node tests |
| Viewer controller | PASS: 19 tests and targeted ESLint |
| Model boundary, transforms and fitted cache | PASS: [94 model checks](evidence/pf2/model-tests-20261018T072725411Z.json); ModelRunner build has zero warnings/errors |
| Runtime ownership and preview recovery safety boundaries | PASS: 19 tests; syntax check passes |
| Frontend interactions | PASS: full 36-case run (471.33s, explicit 30s case budget); after the stable endpoint-name callback follow-up, one historical endpoint-save case and two name-capture/cancel-baseline cases pass on final production bytes |
| Combined frontend/server types and UI lint | PASS; final test-metadata frontend type/lint recheck also passes; [exact UI source receipt](evidence/routes-path/frontend-source-20261018T075446Z.json) |
| New runtime/API/browser/drill | Pending; do not infer a pass from the source checks above |

The earlier 31-case frontend run passed 30 cases; its keyboard case needed an
activation action and then passed separately. An expanded 35-case run exceeded
the default per-case timeout in expensive jsdom/Fluent queries and was stopped.
Bounded instrumentation did not establish a production render loop and was
removed. A final run uses an explicit 30-second case timeout and will be recorded
separately. Real-browser keyboard/response checks are still required.

Independent read-only review identified an accepted-artifact-after-cancel race
in route preparation. The correction reconciles an accepted same-model save
into the prepared baseline even after cancellation or a tab change; newer
draft edits remain dirty. A deferred-result regression covers it. The reviewer
subsequently inspected the closing diff and marked the finding resolved.
The final full suite and focused follow-ups pass. No additional actionable finding was
reported in preview authorization, dependency checks, worker recovery or API
boundaries.

## Baseline and ownership

Isolated worktree C:/Users/todor.chankov/source/WFC-pathfinder-local, new branch
pf-two-tabs-local-20261018 inheritingfcd8f1dc39569c430125b897c95756fac9c28a89.
Original WFC and PathFinder checkouts, synced sources/, original13containers,
databases/storage/volumes remain unchanged. No push, PR, merge or deployment.
The owned5190 installation and backup2ae6f51b remain until a new candidate passes.

Writers own separate paths: frontend PathFinder*.tsx; backend server/pathfinder
and its router; Viewer protocol/Controller/capture plus Model snapshot boundary;
root API/hook/outer tab/Details label/docs/evidence. No duplicate implementation
or partial-source image build. Existing review, job and protected Viewer guards
must be preserved while the common Viewer remains mounted across both tabs.

## Functional mapping

Routes selects model objects/groups and assigns MV/LV/Control per rule. Captures
include deepest geometry descendants. Editing or re-adding a rule makes it the
newest; the newest overlapping rule controls the leaf. An empty category rule
excludes that selected region. Model/selection revision changes clear drafts.
Prepared snapshots retain per-leaf categories. Rule drafts are session state,
as in the native addon; saving a snapshot is separate from editing a rule.

Native route-name resolution stops at the selected root. New snapshots carry an
optional routeBoundaryId, validated against actual ancestor identities; the
existing C# RouteNameResolver receives the bounded names. This avoids a second
JavaScript route-name parser. Eleven extracted pure Core files stay unchanged.
Legacy exact-code captures and snapshots remain compatible.

Path retains shared locations and cable calculations/ReviewApply. Standalone
From/To accepts explicit points or confirmed aliases/unique prepared names,
category, SECONDARY trigger and vertical preference. It uses the original C#
calculation/design formula. Missing/ambiguous/stale names require resolution.
Standalone results never create cables, proposals, reviews or Apply receipts.
Reverse uses the original RouteResult.Reverse after calculation, preserving
tie behavior. From/To source labels remain traceable.

Connection gap and the three design allowances remain authoritative in Project
Details. Existing default1m gap and mathematical order do not change. The default
SECONDARY trigger remains2m; vertical preference true. Background transparency
is an explicit0–100% command for the currently displayed computed path; the
accepted default filledGhost remains until the user applies a transparency
value. Clear/restore returns the saved rendering state.

## Contracts and guards

The project URL key/API/schema/code identifiers remain pathfinder. Only visible
branding changes to Path Finder. Strict current administrator access applies to
the tab, deep links and all operations.

Approved bridge additions: READ_SELECTION/MODEL_SELECTION, routeRules capture
union (1–100rules,<=512selectedroots, selection read<=16objects with explicit
over-limit failure), and SET_PATH_TRANSPARENCY/PATH_TRANSPARENCY_UPDATED. Commands
retain project/model/load/session authorization, byte/event quotas, finite
coordinates and current-route ownership fences. No direct NOP_VIEWER interface.

Standalone POST/GET /previews uses existing durable worker/lease/cancellation
infrastructure, kind preview and no cable job items. Current selection/artifact/
registry/settings revision fences apply before, after and on result reads.
settings.revision is exposed as an exact string. Client values cannot override
Details gap/allowances. Existing DELETE/jobs cancels the operation.

Switching tabs or tools clears the common overlay, cancels picking and fences
late display/Review responses. A proposal must match the currently selected
SECONDARY/vertical preferences before review. Server proposal metadata comes
from immutable original options; missing original options fail closed.

## Required verification and limitations

Check rule overlap/category edit/remove/model invalidation and deepest geometry;
legacy capture output compatibility and strict boundary input rejection;
selection/transparency stale-command guards and Clear restoration. Check actual
standalone name/point/reverse/design/cancel/staleness/admin/kind separation and
no cable writes, plus existing atomic ReviewApply controls. Check both tabs,
keyboard selection, one mounted Viewer, retained drafts and late response fences.

Build/restart only the owned5190 installation after coordinated freeze. Verify
with computer-use using copied/synthetic data, record exact source/images and
screenshots, retain a verified replacement backup and clean only own obsolete
resources. Native reference is NOT_PERFORMED / NOT_REQUIRED_BY_USER; human manual
route/length acceptance remains pending. Whole-plant capacity and reusable graph
are not established by this UI/functionality revision.

Third cleanup denial: model-tests-c13957af670e4ee2869cf876aa60d581 under owned
engine scratch was rejected with blocked by policy and is retained without
retry/bypass, alongside the two earlier denied children. One initial SDK launch
reported development-certificate installation before its environment was fully
isolated; later runs disable first-launch certificate setup. No original checkout
or application was built/changed and no certificate deletion is attempted.

## First candidate and browser findings

Source checkpoint `46152f9873764ec22537029d98bbfcc453052768` built and started
only the owned 5190 installation. API image `905dcb21` and web `09dcf672` are
bound in [the startup receipt](runtime/two-tabs-candidate-health-1792310191915.json).
The actual synthetic driver passed
[29/29 controls](evidence/routes-path/live29-20261018T075720Z.json), with
[exact driver/image binding](evidence/routes-path/live29-binding-20261018T075720Z.json)
and [zero temporary fixture residue](evidence/routes-path/cleanup-readback-20261018T075720Z.json).
The older host compiled driver was not executed; the exact new container driver
hash is recorded. These results do not establish later image verification.

[Actual browser checks](evidence/routes-path/computer-use-before-appearance-fix.json)
passed keyboard switching, retained drafts and one Viewer, category editing,
dirty preparation/discard, capture of ten actual route roots in two rules,
stale-binding refusal and reconfirmation, selection-derived coordinates, and
standalone forward/reverse length. The new rule capture still produces 52 objects
and the same 35.30345579516123m geometry / 45m design result. Native comparison
was not performed. A technical QA Review enabled Apply; switching tabs removed
eligibility. No Apply was performed on the real demonstration.

Two observed defects are preserved as failures in that earlier receipt:

- Explicit 75% and 0% transparency used the black Ghost shader and obscured
  original route colors in the dense plant. The default filled Ghost passed.
  Corrective work uses original-material transparency, matching the addon,
  with bounded preparation, protected foreground colors and complete restoration.
  [Autodesk's material example](https://aps.autodesk.com/blog/material-swatches-forge-viewer)
  documents fragment material assignment and unconsolidation; the pinned local
  SDK is also inspected for the actual APIs used. Runtime recheck is pending.
- After reconfirming a stale shared location, the editor retained its old stale
  hint. The narrow caption correction preserves the point, identity and
  derivation, fences later draft/model changes, and passes the affected save
  test (1/1), frontend types and two-file ESLint. Runtime recheck is pending.

Root bridge follow-up passes 29 Node tests, including three new cases for ACL
revocation after material preparation, cancellation/clear/replacement/disposal,
and a late final authorization. The SDK callback reauthorizes immediately before
the synchronous material commit. No source/image promotion, replacement archive
or cleanup is inferred while the appearance correction remains in progress.

The final corrective source is now frozen: 60 relevant Node tests pass (21
PathFinder SDK, 30 bridge, 9 adapter), and 18 current API/hook tests pass (7+11).
The saved-location caption correction passes its affected test, types and lint.
[Source evidence](evidence/routes-path/appearance-followup-source.json) records
the actual separate runs. Independent review found and closed recovery-state
loss during SDK cleanup and an overlapping preflight/recovery race. Pending
restoration is retained, independent cleanup proceeds, still-bound clones are
not disposed, and Clear remains retryable through a sanitized nonterminal error.
New operations recheck pending recovery after yields and before commit.

Explicit material edits require SDK unconsolidation. Clear restores appearance
and visibility, while that rendering optimization remains disabled until model
reload. This is an operational limitation, not an assertion of whole-plant
performance. Final real 75/0/100/Clear and new-image verification still follow.

## Corrected appearance candidate and backend follow-up

Checkpoint542e101 runs on API fcd7b866 and web9cd76986, bound by
[corrected startup health](runtime/two-tabs-corrected-candidate-health-1792312346296.json).
The new source manifest has816files and SHA256
3cbf30f0879b2338fe88b8fb30b1994bdfa6e20c6851c5f6b33fd7342625e6ec.
[Actual corrected computer-use](evidence/routes-path/computer-use-corrected-appearance.json)
passes default filledGhost, explicit75/0/100 using original materials, protected
route colors/yellow line, Clear restoration, shared-save caption, both tabs with
one Viewer, and new forward/reverse35.30345579516123m/design45m. A new calculation
returns to default Ghost even if the transparency input still reads100. These
are actual selected-network observations, not whole-plant performance proof.

The corrected candidate's final backend attempt passed27/29 with cleanup PASS.
One assertion exposed lost effectiveCategory/prepared metadata when a valid
existing route was reused for design-only calculation. Geometry10m and design18m
were already correct; the category display returnednull. The worker correction
retains original geometry diagnostics and derives the canonical category from
the immutable accepted cable inputs, rejecting contradictory metadata. Fresh
69/69 unit checks (9new+60existing), server TypeScript and ESLint pass.

The other failed assertion assumed that a particular explicit request must own
the fresh calculation after a gap edit. Concurrent automatic work can validly
compute the same new geometry first. The strengthened driver now requires
different old/new geometry hashes plus an actual fresh successful full
calculation for the exact new hash/settings after the PATCH, and records its
job/proposal IDs. The failed receipt remains preserved; unavailable full response
IDs from that earlier attempt are not invented. A fresh candidate/live rerun is
required before promoting this backend correction.
