# Local PathFinder delivery — changed-file manifest

This is a review snapshot of the current local integration, relative to committed
PF-3 checkpoint `c95ad56ebbd6b020966fa0690c98c37516df1db1`. It includes both
staged and unstaged tracked changes and the new intended source/documentation/
evidence files visible at the observation time. It is not a claim that every
PF-0–PF-8 file was introduced after that checkpoint: earlier Core, Model, frozen
contract/fixture and registry deliveries are already in the inherited history.

All paths below are repository-relative to
`C:/Users/todor.chankov/source/WFC-pathfinder-local`. `A` means new relative to the
checkpoint, including intended untracked files; `M` means an existing checkpoint
file changed. Index/worktree staging does not change this meaning. The snapshot
can precede the final local commit and later final-report/DR receipt additions;
those must be read with the final commit and source/evidence manifests.

The original `C:/Users/todor.chankov/source/WFC` checkout and both original
PathFinder checkouts remain reference-only. No push, PR, merge, deployment or
update to the original application, containers, database, storage or volumes is
part of this delivery. The local demonstration uses a separate installation and
copied/test data. Its review does not authorize later integration.

**Not accepted:** native/converted engineering correspondence, real engineering
length parity, full-plant geometry/category/visibility completeness, reusable
graph adjacency and production/full-plant capacity. Real-model Apply remains
blocked. The exact CLI-seeded synthetic fixture demonstrates local transactional
behavior only; selected-model diagnostic paths are not a native parity PASS.

The two historic policy-denied `.pf0-work/` and `.pf2-work/` children are excluded
from this manifest and remain untouched. Private environment files, credentials,
build outputs, caches, scratch/runtime state, copied model payloads and backup
archives are excluded. Retained evidence, source and the demonstration are not
classified as disposable cleanup. No tests were run to prepare this manifest.

Observation UTC: 2026-10-18T02:36:39.9407685Z
Branch: `pf-4-viewer-local-20261018`; observed HEAD: `c95ad56ebbd6b020966fa0690c98c37516df1db1`.
Listed intended changed files, including this manifest: **140**.

## Engine integration (4)

Extends the private ModelRunner entry point with bounded calculation/design/ordered-lookup/Reverse operations, exact decimal output, visibility/category guards and smoke controls. The eleven pinned original Routing source files are outside this delta and remain unchanged.

| Delta | File |
|---|---|
| M | `pathfinder-engine/tools/PathFinder.ModelRunner/Program.cs` |
| M | `pathfinder-engine/tools/PathFinder.ModelRunner/README.md` |
| M | `pathfinder-engine/tools/PathFinder.ModelRunner/test-smoke.mjs` |
| M | `pathfinder-engine/verify-isolation.mjs` |

## PathFinder backend (19)

Adds the current-login administrator transaction boundary; revisioned shared locations, aliases and model bindings; append-only audit; immutable snapshot dependencies; durable serial jobs, leases and cancellation; exact C# process invocation; diagnostic lookup; explicit Review + atomic Apply and idempotency. Synthetic acceptance is separately CLI-seeded and cannot be acquired through HTTP.

| Delta | File |
|---|---|
| A | `server/pathfinder/apply.ts` |
| A | `server/pathfinder/audit.ts` |
| A | `server/pathfinder/auth.ts` |
| M | `server/pathfinder/contracts.ts` |
| A | `server/pathfinder/demoSeed.ts` |
| A | `server/pathfinder/dependencies.ts` |
| A | `server/pathfinder/engine.test.ts` |
| A | `server/pathfinder/engine.ts` |
| A | `server/pathfinder/integration.ts` |
| A | `server/pathfinder/jobContracts.ts` |
| A | `server/pathfinder/jobs.ts` |
| A | `server/pathfinder/jobsSchema.ts` |
| A | `server/pathfinder/lookups.ts` |
| M | `server/pathfinder/repository.ts` |
| A | `server/pathfinder/runtime.ts` |
| M | `server/pathfinder/schema.ts` |
| A | `server/pathfinder/syntheticFixture.ts` |
| A | `server/pathfinder/transactions.ts` |
| A | `server/pathfinder/worker.ts` |

## Existing server integration (8)

Wires the new services into schema initialization, startup and project routes; authorizes large artifact bodies before parsing; exposes the current-admin protected-session capability; adds PathFinder history provenance and compatible route validation. Existing manual cable PATCH obtains its source-row lock. These shared-file changes explain why the delivery is broader than adding a tab.

| Delta | File |
|---|---|
| M | `server/app.ts` |
| M | `server/db.ts` |
| M | `server/index.ts` |
| M | `server/models/cableVersion.ts` |
| M | `server/routes/cablesRoutes.ts` |
| M | `server/routes/pathfinderRoutes.ts` |
| M | `server/validators.ts` |
| M | `server/viewerSessions/service.ts` |

## Administrator web workspace (14)

Adds the administrator-only PathFinder tab, typed API, reusable location resolution/picking, geometry capture/upload, job progress/cancellation, exact proposal review, explicit Apply and diagnostic ordered lookup/Reverse. Project Details allowance parsing/display and cable history labels integrate the existing application. UI labels are English.

| Delta | File |
|---|---|
| A | `src/api/pathfinder.test.ts` |
| A | `src/api/pathfinder.ts` |
| M | `src/api/types/cable.ts` |
| M | `src/pages/CableDetails.tsx` |
| M | `src/pages/ProjectDetails.forms.ts` |
| M | `src/pages/ProjectDetails.tsx` |
| M | `src/pages/ProjectDetails/DetailsTab.tsx` |
| A | `src/pages/ProjectDetails/hooks/usePathFinder.test.tsx` |
| A | `src/pages/ProjectDetails/hooks/usePathFinder.ts` |
| A | `src/pages/ProjectDetails/PathFinderLookup.tsx` |
| A | `src/pages/ProjectDetails/PathFinderResults.tsx` |
| A | `src/pages/ProjectDetails/PathFinderTab.test.tsx` |
| A | `src/pages/ProjectDetails/PathFinderTab.tsx` |
| M | `src/pages/ProjectDetails/RoutingsViewerTab.tsx` |

## Protected Viewer (13)

Adds bounded, current-admin authorized metadata/picking/capture and computed-path messages through the existing protected controller/bridge. Runtime rendering preserves filled Ghost, original route colors, visible yellow path geometry and Clear/restoration; one-point paths and empty object-ID lists have explicit handling. The product does not use direct NOP_VIEWER access.

| Delta | File |
|---|---|
| M | `scripts/viewer-runtime/prepare.mjs` |
| M | `src/viewer/ViewerController.test.ts` |
| M | `src/viewer/ViewerController.ts` |
| M | `viewer-runtime/adapter.mjs` |
| M | `viewer-runtime/bridge.mjs` |
| A | `viewer-runtime/model-capture.d.mts` |
| A | `viewer-runtime/model-capture.mjs` |
| A | `viewer-runtime/pathfinder.mjs` |
| M | `viewer-runtime/protocol.d.mts` |
| M | `viewer-runtime/protocol.mjs` |
| M | `viewer-runtime/test/bridge.test.mjs` |
| A | `viewer-runtime/test/model-capture.node-test.mjs` |
| A | `viewer-runtime/test/pathfinder.test.mjs` |

## Isolated installation and operations (15)

Defines the separately owned Docker installation and localhost configuration, scoped large-upload proxy authorization, isolated model/demo seeding, runtime inventories, coherent backup/restore, copied-session fencing, actual extra-target process-crash recovery and ownership-checked obsolete-resource cleanup. Tool presence is not a PASS claim: operational results are bound to their individual receipts.

| Delta | File |
|---|---|
| A | `docker/pathfinder.compose.yml` |
| A | `docker/pathfinder.Dockerfile` |
| A | `docker/pathfinder.Dockerfile.dockerignore` |
| A | `docker/pathfinder.nginx.conf` |
| A | `scripts/pathfinder-local/check-artifact-transport.mjs` |
| A | `scripts/pathfinder-local/check-restore.mjs` |
| A | `scripts/pathfinder-local/cleanup-obsolete.mjs` |
| A | `scripts/pathfinder-local/container-ops.mjs` |
| A | `scripts/pathfinder-local/crash-recovery.mjs` |
| A | `scripts/pathfinder-local/drill.mjs` |
| A | `scripts/pathfinder-local/record-runtime.mjs` |
| A | `scripts/pathfinder-local/runtime-lib.mjs` |
| A | `scripts/pathfinder-local/runtime.mjs` |
| A | `scripts/pathfinder-local/runtime.test.mjs` |
| A | `scripts/pathfinder-local/seed-synthetic.mjs` |

## Integration verification utilities (6)

Adds bounded fixture and observation tools for current-role denial, copied model capture, shared missing locations, Project Details recalculation, source inventories and offline scope. Their fixture scope is the isolated installation, not the original application.

| Delta | File |
|---|---|
| A | `scripts/pathfinder-tests/browser-role-fixture.mjs` |
| A | `scripts/pathfinder-tests/captured-model.mjs` |
| A | `scripts/pathfinder-tests/offline-scope.mjs` |
| A | `scripts/pathfinder-tests/settings-reuse.mjs` |
| A | `scripts/pathfinder-tests/source-manifest.mjs` |
| A | `scripts/pathfinder-tests/ui-missing-fixture.mjs` |

## Stage reports and handoffs (11)

Records stage delivery, graph/cache limitations, continuation handoffs, final local usage and progress. Reports distinguish technical verification from user acceptance and native engineering acceptance. This manifest is included as a newly created documentation file.

| Delta | File |
|---|---|
| M | `docs/pathfinder/03-stage-report.md` |
| A | `docs/pathfinder/04-stage-report.md` |
| A | `docs/pathfinder/05-stage-report.md` |
| A | `docs/pathfinder/06-stage-report.md` |
| A | `docs/pathfinder/07-stage-report.md` |
| A | `docs/pathfinder/08-changed-files.md` |
| A | `docs/pathfinder/08-local-user-guide.md` |
| A | `docs/pathfinder/19-graph-preparation-review.md` |
| M | `docs/pathfinder/automation-progress.md` |
| A | `docs/pathfinder/handoffs/PF-7.md` |
| A | `docs/pathfinder/handoffs/PF-8.md` |

## Math process and transaction evidence (20)

Retains immutable run outputs and receipts for core regression/parity, ModelRunner, registry, actual Node/.NET process invocation and SQL/HTTP Review/Apply. Earlier failure, absent-configuration and intermediate-image attempts remain visible; a filename in this group is not an unconditional PASS. The final backend 20/20 receipt is `jobs-apply-20261018T023201Z.json` on image `562e8073…`.

| Delta | File |
|---|---|
| A | `docs/pathfinder/evidence/pf1/runs/2026-10-18T01-41-17-608Z/parity-results.json` |
| A | `docs/pathfinder/evidence/pf1/runs/2026-10-18T01-41-17-608Z/parity.log` |
| A | `docs/pathfinder/evidence/pf1/runs/2026-10-18T01-41-17-608Z/regression.log` |
| A | `docs/pathfinder/evidence/pf1/runs/2026-10-18T01-41-17-608Z/run.json` |
| A | `docs/pathfinder/evidence/pf1/runs/2026-10-18T01-41-17-608Z/runner-build.log` |
| A | `docs/pathfinder/evidence/pf3/model-runner-2026-10-18T01-52-01-906Z.json` |
| A | `docs/pathfinder/evidence/pf3/model-runner-2026-10-18T02-01-36-030Z.json` |
| A | `docs/pathfinder/evidence/pf3/model-runner-2026-10-18T02-01-59-943Z.json` |
| A | `docs/pathfinder/evidence/pf3/model-runner-2026-10-18T02-15-05-042Z.json` |
| A | `docs/pathfinder/evidence/pf3/model-runner-2026-10-18T02-26-42-960Z.json` |
| A | `docs/pathfinder/evidence/pf3/registry-http-2026-10-18T02-03-37-380Z.json` |
| A | `docs/pathfinder/evidence/pf5/engine-registry-20261018T022600Z.json` |
| A | `docs/pathfinder/evidence/pf5/jobs-apply-20261018T020526Z.json` |
| A | `docs/pathfinder/evidence/pf5/jobs-apply-20261018T022415Z.json` |
| A | `docs/pathfinder/evidence/pf5/jobs-apply-20261018T023201Z.json` |
| A | `docs/pathfinder/evidence/pf5/legacy-cables-20261018T021200Z.json` |
| A | `docs/pathfinder/evidence/pf5/legacy-cables-configured-20261018T021300Z.json` |
| A | `docs/pathfinder/evidence/pf5/verification-checkpoint-20261018T021208Z.json` |
| A | `docs/pathfinder/evidence/pf5/verification-final-20261018T022415Z.json` |
| A | `docs/pathfinder/evidence/pf5/verification-final-20261018T023201Z.json` |

## Browser and integration evidence (22)

Retains the actual browser actions, selected-model diagnostics, admin/non-admin checks, shared locations, settings-only recalculation, synthetic Apply/history, Ghost/yellow-path restoration, offline observations and isolation/source inventories. Before-fix screenshots remain deliberately historical. Selected geometry and synthetic results do not establish full-plant engineering parity.

| Delta | File |
|---|---|
| A | `docs/pathfinder/evidence/pf7/actual-capture-1792289114650.json` |
| A | `docs/pathfinder/evidence/pf7/actual-computed-clear-restored.png` |
| A | `docs/pathfinder/evidence/pf7/actual-lookup-before-yellow-fix.png` |
| A | `docs/pathfinder/evidence/pf7/actual-model-shared-pick.png` |
| A | `docs/pathfinder/evidence/pf7/computer-use-20261018T0211Z.json` |
| A | `docs/pathfinder/evidence/pf7/details-reserve-recalculated-19.png` |
| A | `docs/pathfinder/evidence/pf7/engineer-deep-link-denied.png` |
| A | `docs/pathfinder/evidence/pf7/isolation-1792289542491.json` |
| A | `docs/pathfinder/evidence/pf7/offline-scope-1792290651968.json` |
| A | `docs/pathfinder/evidence/pf7/pathfinder-real-ghost-final.png` |
| A | `docs/pathfinder/evidence/pf7/remote-observations-20261018T022957Z.json` |
| A | `docs/pathfinder/evidence/pf7/settings-reuse-1792289459485.json` |
| A | `docs/pathfinder/evidence/pf7/settings-reuse-1792289487640.json` |
| A | `docs/pathfinder/evidence/pf7/shared-location-after-resolution.png` |
| A | `docs/pathfinder/evidence/pf7/shared-location-before-resolution.png` |
| A | `docs/pathfinder/evidence/pf7/sources-1792290715644.json` |
| A | `docs/pathfinder/evidence/pf7/synthetic-apply-confirmed.png` |
| A | `docs/pathfinder/evidence/pf7/synthetic-cable-history.png` |
| A | `docs/pathfinder/evidence/pf7/synthetic-clear-restored-final.png` |
| A | `docs/pathfinder/evidence/pf7/synthetic-filled-ghost-final.png` |
| A | `docs/pathfinder/evidence/pf7/synthetic-one-point-final.png` |
| A | `docs/pathfinder/evidence/pf7/synthetic-review-final.png` |

## Runtime documentation and receipts (8)

Provides the installation guide, selected-network capture instructions and timestamped seed/runtime/transport/restore observations. Private runtime state, credentials, copied databases, storage payloads and backup archives are excluded from the Git delivery.

| Delta | File |
|---|---|
| A | `docs/pathfinder/runtime/artifact-transport-1792290198792.json` |
| A | `docs/pathfinder/runtime/artifact-transport-1792290628158.json` |
| A | `docs/pathfinder/runtime/README.md` |
| A | `docs/pathfinder/runtime/restore-check-1792288076606.json` |
| A | `docs/pathfinder/runtime/runtime-initial-1792288142643.json` |
| A | `docs/pathfinder/runtime/runtime-initial-1792288165473.json` |
| A | `docs/pathfinder/runtime/selected-model-capture.md` |
| A | `docs/pathfinder/runtime/synthetic-seed-1792289050427.json` |

## Reading the evidence

Use the per-stage reports and timestamped receipts for exact commands, revisions/images, outcomes and limitations. The latest backend receipt proves 20 scoped SQL/HTTP controls with cleanup; the 34 engine/registry and 40 legacy controls have their own receipts. Backup/restore/crash, final browser and preservation results require their separate recorded evidence. Earlier failed observations are preserved rather than relabelled. No native or full-plant acceptance follows from a broad file manifest.
