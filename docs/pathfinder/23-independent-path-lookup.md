# Independent Path lookup tab

User request18October2026: add the third addon tab and its functionality.
Delivered locally on branch pf-path-lookup-local-20261018,
inheriting9e6561e33ccf9ab535fb2184c858ecd20240071d. Technical implementation and
the scoped source/API/browser/archive/restore/cleanup checks PASS. Human
engineering acceptance is PENDING. Original WFC/PathFinder,
synced sources/, original13containers and working data remain reference-only.
No push, PR, merge, deployment or original-installation update is authorized.

## Canonical functionality and accepted scope

Canonical PathFinder45c24bf5 constructs Path lookup in
AddinRibbon/Ctr/PathFinderControl.cs272–352. RoutingSession.Lookup.cs20–94
searches requested visible logical owners independently from the Routes session.
It collapses nested same-name wrappers, rejects separate-branch ambiguity, and
uses pinned RouteNameResolver/RouteCodeParser and RouteLookupCalculator.

The third web tab therefore does more than relocate the existing accordion.
It must work without a planning snapshot and while Routes has unprepared drafts,
without replacing that snapshot or staling saved cable locations/proposals.
It accepts one ordered route, displays exact path/geometric length/gap metrics,
distinct used leaves and prepared-network approximation diagnostics, and supports
Restore/Cancel. Web Reverse is retained as an additional diagnostic control;
there is no native batch workflow to reproduce. No equipment legs, SECONDARY
replacement, spare, percentage, cable design length or Apply belongs to lookup.
The user's Project Details gap (default1m) supersedes the native historical0.25m.

## Implementation contracts

- POST /lookups/plan returns distinct canonical routeCodes, exact selectionRevision
  and current Details connectionGap. The private C# parser supplies codes; no
  logical owner/parser implementation is copied into JavaScript.
- Protected capture accepts lookupRouteCodes with no equipment names or planning
  assignments. It captures bounded current-display-visible candidate geometry and
  full hierarchy. Native visibility/completeness/engineering proof flags remain
  false. C# resolves logical owners and exact eligible leaves before fitting;
  missing and ambiguous owners fail explicitly.
- POST /lookups accepts a canonical snapshot as a strict alternative to the
  compatible legacy planning-artifact request. Artifact purpose is server-owned;
  lookup snapshots cannot enter planning/preview/calculation. Same lookup-scope
  snapshot SHA can be reused under the project mutex with stored-file verification.
- Lookup dependencies pin their own artifact, current model/selection/fingerprint,
  current gap/settings and current administrator/login authority. Planning state,
  registry, location bindings and cable values are not promoted or modified.
- Large lookup snapshots use the existing scoped256MiB pre-body authorization;
  plan remains on the small parser. No global parser/permission expansion.
- One Viewer serves three persistent panels. Switching tools fences late responses
  and review eligibility. Inputs/results invalidate on edits and dependencies;
  explicit cancellation handles pre-job capture and accepted durable jobs.

## Evidence status

Source and final runtime evidence follows below. Historical passes from report22
retain their original scope; this delivery does not silently promote them.
All UI text is English.

Whole-plant completeness/capacity and reusable graph remain unproved at the prior
scopes. Native comparison is NOT_PERFORMED/NOT_REQUIRED_BY_USER; human engineering
acceptance is PENDING. Exact standalone-preview crash recovery remains NOT_RUN
from the previous PARTIAL extension and is not silently retried or relabelled.
The three previously denied cleanup children remain untouched without bypass.

## Frozen implementation and source checks

Source checkpoint: `60e9ce66680d2e86b17be5c9a73d1247d20d9fc0` on
`pf-path-lookup-local-20261018`. The [828-file manifest](evidence/pf7/sources-1792316045377.json)
has source-set SHA256 `991c0b32bd65a92834974a157b7142b5f47e3d71533318a4b6ec3d21020f6fa4`.
All those file hashes matched before and after the actual Docker build.

| Scope | Actual result | Evidence |
|---|---|---|
| Canonical lookup owner/scope resolution | 37/37 PASS | [Core/capture controls](evidence/lookup-tab/core-runtime-controls-20261018T093108156Z.json) |
| Existing Model regression on changed reader/cache | 94/94 PASS, isolated output | [Exact new receipt](evidence/lookup-tab/model-regression-94-20261018T093108156Z.json) |
| Protected protocol/capture/adapter/bridge | 75/75 PASS, fresh private C# interop | Core/capture controls above |
| Viewer Controller | 20/20 PASS | Core/capture controls above |
| ModelRunner | 42/42 PASS | [Runner receipt](evidence/pf3/model-runner-2026-10-18T09-23-41-746Z.json) |
| Server/purpose/storage/transport/worker, including five real private C# process checks | 106/106 PASS | [Backend source receipt](evidence/path-lookup/backend-source-20261018T093242Z.json) |
| API/hook, cancellation and late responses | 23/23 PASS | [Root source checks](evidence/lookup-tab/root-source-checks.json) |
| Three-panel UI, lookup independence and cancellation | Baseline44/44 PASS; final-byte affected9/9 PASS (47loaded,38skipped) | [Exact scope and reviewer closure](evidence/pf7/path-lookup-ui-20261018T0938Z.json) |
| Frontend/server TypeScript and scoped ESLint | PASS | Owner/root source receipts |

The [independent guard review](evidence/lookup-tab/guard-review-20261018T093216812Z.json)
found no additional backend/hook issues. Its pending-view cancellation finding
was corrected in the checkpoint and is covered by the final targeted UI checks.
The initial hook cancellation-message failure and historical-DLL interop failure
remain explicit in the evidence; their corrected scoped runs passed.

[Actual build binding](evidence/lookup-tab/build-binding-1792316207041.json) records
API `1630510e3240a8ede43d9cc9b77297bedb150cc25ad9480e9425f31797177bc3`
and web `f4b5a13c603d091e1473983aed9d20e26daabf04e4603819883c28e860fb6617`.
At that receipt's boundary the build was held: the desired image state changed,
while all18 live container identities/images/start states remained identical.
Runtime/browser/restore proof is recorded separately after actual execution.

An additional owned compatibility scratch removal was rejected by automatic
approval review with `blocked by policy`:
`pathfinder-engine/.scratch/lookup-model-compat-459be54639f5400ebe91f856c64d7f5a`.
It and the three earlier denied children/parents are retained without retry or
bypass. This cleanup limitation does not change the test result.

## Focused actual API verification

The [actual10/10 integration](evidence/path-lookup/live10-60e9ce6-20261018T094056Z.json)
and [compiled-driver/image/cleanup binding](evidence/path-lookup/live10-binding-cleanup-60e9ce6-20261018T094118Z.json)
pass on API1630510e/webf4b5a13. They cover exact10m mathematical geometry,
Reverse, SECONDARY/adjacent duplicates, lookup snapshot reuse, purpose/model/
selection/current-admin/login/gap fences, actual nginx/API pre-body401/413 and
an actual13,201,771-byte successful bounded upload. Both disposable artifacts/
files and the fixture actor were removed. This is synthetic mathematics/API
proof, not native or real-model length acceptance. The live no-planning-history
case is NOT_RUN: the existing fixture history was deliberately preserved;
separate source tests prove that no planning artifact or registry query is needed.

The [real-project UI baseline](evidence/path-lookup/real-ui-baseline-60e9ce6-20261018T094118Z.json)
matches all pre-synthetic workflow hashes: planning artifacts/latest, registry11,
locations/aliases/bindings,104model objects, cable,5proposals,3reviews and0Apply.
The following computer-use window is compared to this baseline separately.

Startup itself passed through the owned runtime helper and new API was healthy.
A separate supplemental combined health/startup-receipt command was rejected by
automatic approval review with `blocked by policy`; it was not retried or bypassed.
No supplemental startup JSON exists or is cited. Actual successful start output,
build binding and subsequent independent10/10 live API result supply their stated
evidence without inventing that missing receipt.

## Real model and caption correction

[Computer-use record](evidence/lookup-tab/computer-use-first-candidate.json) and
[read-only post-UI audit](evidence/path-lookup/real-after-ui-60e9ce6-20261018T095018Z.json)
prove actual forward, reverse and dirty-Routes-independent lookup on the first
candidate. Geometric length is35.30345579516123m, with4gaps totaling
0.9840583861033791m. Both reverse90point arrays are exact forward reversal.
There are25used leaves. Raw55objects/27leaves resolves to52objects/26segments;
one broad discovery leaf is excluded by the pinned owner resolver. All three
completed jobs reuse lookup-purpose artifactb06ab4c4-60e2-4b87-8010-61e1b547f795,
rawSHA1aa3036066f74aa7dfe0dfb9d702f8107bdb5836a2f563be8cb6432e113f8b6b.
No equipment approaches, design length, cable items or Apply are created.

Restore, explicit background controls, the original tray colours/yellow line,
filled Ghost and actual capture Cancel were observed. A B002 rule draft did not
block lookup, while Path calculations stayed disabled. Discard restored the
stored network. The same protected Viewer instance remained across the tools.
All12 audited settings/selection/registry/planning/location/alias/binding/object/
cable/proposal/review/Apply hashes remain unchanged from the pre-UI baseline.

The first caption incorrectly called25used leaves the prepared leaf count.
[Correction73c13aa](evidence/lookup-tab/diagnostic-label-correction.json) changes
only the caption/section name and one assertion; affected1test/types/lint PASS.
Fallback counters keep their explicit whole-prepared-network scope. The final
[828source manifest](evidence/pf7/sources-1792316750590.json) has SHA256
c3a58fd623df881da39fa8f043a6260eb93ca3f989d938089a15015de958f2d7.
[Corrected build](evidence/lookup-tab/build-binding-1792316973178.json) binds
APIee402f8d972256c7c912349a360c321de8ce1f19238b7a7c149fb463960daa45 and
web1895a3fa33c25933024ab514ef61bd2d1568ffb33477d114541b855da65445b7.
The API's16ordered filesystem layers and full runtime configuration are identical
to actual-tested1630510e, so the backend10/10 evidence applies to that identical
payload/configuration; image metadata IDs remain distinct. Final browser proof
for the corrected text is recorded separately after operations.

The shell command to overwrite the older manual-review handoff was separately
rejected by automatic approval review with `blocked by policy` before execution.
That command was not retried; the old document remains unchanged. A new additive
[three-tab manual-review handoff](handoffs/PF-path-lookup-manual-review.md) was
created with the file-editing tool, preserving the historical two-tab artifact.

## Corrected candidate archive and restored lookup

[Cold archive/restore drill](runtime/final-drill-1792317333519.json) passes on the
corrected APIee402f8d/web1895a3fa. Retained archive ID is
`3db9fa33-c10e-4646-82bc-fe99f3d8af35`, at
`pathfinder-engine/.scratch/path-lookup-archive-462d5a9465e8`, with a separate
ignored private companion. Both model versions,684resources/878,015,606bytes,
and27PathFinder artifact files/7,678,830bytes match after restore. Source cookie
200 before/after capture and extra restore, copied target cookie410, source
bearer401, fresh target cookie200 and active-model selection preservation pass.
Both crash controls are explicitly NOT_RUN in this scoped drill; earlier scopes
retain their original status.

[Fresh target lookup readback](evidence/lookup-tab/restored-lookup-readback-1792317387751.json)
passes for jobd522c782-4b4c-49f1-b797-3718b3fcf316: complete/nonstale,
35.30345579516123m,90points, designnull, engineeringAcceptedfalse. The artifact
purpose remains lookup and raw/dependency snapshot SHA exactly matches
1aa3036066f74aa7dfe0dfb9d702f8107bdb5836a2f563be8cb6432e113f8b6b.
[Actual target retirement](evidence/lookup-tab/restore-target-retirement-20261018T095731438Z.json)
leaves zero containers/volumes/networks for the extra5191 target.
[New combined evidence](runtime/combined-lookup-drill-1792317499732.json) links the
unchanged raw drill, actual readback and actual retirement; no historical
receipt was relabelled or replaced. Guarded obsolete-archive cleanup is recorded
after its actual outcome below.

## Final verification, cleanup and next step

[Actual corrected browser](evidence/lookup-tab/computer-use-final-corrected.json)
passes after the cold operations: fresh ready protected model, all three tools,
the same35.30345579516123m result, correctly labeled25used leaves and separately
scoped2bend/2straight/0clearance fallback counts. The final stable screenshot
is [path-lookup-final-delivery.png](evidence/lookup-tab/path-lookup-final-delivery.png).
The last display-only job06c0b624-2d84-432e-9f1d-1c6f23cc4f6c follows the archive;
that archive retains the three earlier completed jobs and the same snapshot.

[Final read-only audit](evidence/path-lookup/final-real-audit-73c13aa-20261018T100301Z.json)
binds actual API3d05017e/ee402f8d and webffc99c7a/1895a3fa containers/images.
All12 workflow hashes/counts still match the09:41baseline. Cablea49521ad-e4e1-
47d9-b3b2-948375a83905 remains revision0, routing/design/installnull; Apply0 and
lookup cable-items0. The final completed job reuses the same lookup artifact/raw
SHA and retains90points with the stated metric/diagnostics.

[Guarded cleanup](runtime/cleanup-1792317597812.json) removed eight superseded
d7archive payloads totaling1,348,954,278bytes and four unused owned images.
[Post-cleanup verification](evidence/lookup-tab/cleanup-verification-1792317675878.json)
reverifies the retained3dbarchive, separate private companion and zero extra
target resources. No prune or recursive directory deletion was performed. Small
old manifests/private provenance and needed test/capture inputs remain. Four
denied scratch children/parents were untouched; image sizes are not a physical
reclaimed-layer-byte claim.

[Final preservation audit](evidence/pf8/isolation-1792317744025.json) passes all
five groups:11Core/original-regression pins, frozenPF0, native-oracle source
pins, original checkout branches/dirty files, and all13original container
identities/images/starttimes. This is not a content audit of original databases;
no original application/data writes were performed. The [changed checkpoint
manifest](evidence/lookup-tab/changed-checkpoint-files.json) lists59paths,
including45code/test/configuration paths; following changes are docs/evidence.
No push, PR, merge, deployment or original-installation update occurred.

The next step is the new [human review handoff](handoffs/PF-path-lookup-manual-review.md),
prepared from accepted decisions and actual local/remote evidence with
prepare-stage-handoff. [The existing heartbeat is PAUSED](evidence/lookup-tab/automation-paused.json)
through the app tool, preserving its name/schedule/target. Native comparison
remains NOT_PERFORMED/NOT_REQUIRED_BY_USER and engineering acceptance PENDING.
The whole-plant/reusable-graph/cross-computer/offline-disconnect and historical
exact-preview-crash limitations above remain explicit. The rejected supplemental
startup command and old-handoff overwrite were not repeated; no nonexistent
receipt is claimed.

Final metadata whitespace check passes with only the verbatim AX `.txt` captures
excluded: those preserve nine trailing label spaces reported by the ordinary
Git whitespace check. No source files changed after the recorded checkpoint;
these raw-evidence formatting bytes were deliberately retained.
