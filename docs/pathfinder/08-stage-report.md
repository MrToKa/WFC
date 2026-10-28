# PF-8 — Isolated local delivery and operational verification

**Technical local delivery PASS at the scopes below. Overall real engineering
acceptance remains BLOCKED; user acceptance is NOT_RUN.** The separate demo is
available at **http://127.0.0.1:5190**.

Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-8-delivery-local-20261018`.
Integrated source commit: `51cc8324b40bd0ce2ed7d0b03decbdc06385b54a`.
Integration handoff commit: `03db8f7b557c1afcf05c18b81e704119db459503`.
Local delivery commit `bf9dfdf8b075259880b58cc7a31202844a902f87` contains this
report, final operational receipts and preservation audit. The following
metadata-only commit records the actual automation pause; inspect live HEAD.
Nothing was published or merged into main.

## Available functionality

A separate current-admin-only PathFinder project tab uses the active model.
Shared confirmed location names/aliases serve both From and To for all cables;
missing/ambiguous/stale endpoints are explicit. Surface picking/manual world
coordinates persist. Ready cables automatically produce proposals, with durable
batch jobs/progress/cancellation/recovery. Exact C# paths, all original
calculations and Details-based SECONDARY/reserve/percentage are retained.
Settings-only edits reuse computed geometry. Instrumentation follows Control.

Exact previews show original route colors, yellow path and filled Ghost.
Review is explicit; eligible Apply atomically writes routing/design, preserves
installLength and records attributable history with idempotency/staleness fences.
Real captured models cannot obtain engineering acceptance through an HTTP flag.
The trusted, clearly labelled synthetic fixture demonstrates Apply while the
real selected model remains diagnostic. All UI text is English.

[User instructions](08-local-user-guide.md),
[grouped changed-file manifest](08-changed-files.md),
[operations and commands](runtime/README.md),
[full technical integration results](07-stage-report.md).

## Actual final operational evidence

| Control | Observed result |
|---|---|
| Separate runtime |Own Composeproject wfc-pathfinder-local, owner7c713695-a3c9-40b6-852e-5ceb51642d65, loopback5190 only; own database/MinIO/staging/PathFinder volumes and private backend network |
| Cold combined backup |PASS; backup43365396-de8c-4f4f-a680-76819e06af0f; eight data/image files1,346,316,196bytes; database, MinIO, staging, private PF snapshots/artifacts and exact four images |
| Fresh restore |PASS in separate extra project wfc-pathfinder-local-02b4956c8401/port5191; database/artifact inventories and active selection match |
| Real model readback |2 model versions,684resources,878,015,606bytes; same original resource inventory |
| PF artifact readback |10files,2,533,791bytes, SHA25658717134bbdf74f390297afdf9710059505ac2b341c40dd267a7ea55b5614227 |
| Session fencing |Source Viewer cookie200 before/after backup and after target crash; copied target cookie410 SESSION_REVOKED, sourceJWT401, fresh target cookie200; target JWT rotated and restored sessions fenced |
| Actual process death |Observed real .NET supervisor/child pair; interrupted ONLY extra API at8/64, exit137/PID0/noOOM; no SQL lease manipulation |
| Natural recovery |After restart attempt1→2,64/64complete within46,170ms; exactly64distinct proposals,0duplicates; no Apply, all64install77/routingNULL/designNULL/writeRevision0 retained; current actor/login verified |
| Extra target retirement |PASS, zero remaining target containers/networks/volumes; primary5190 retained |
| Offline scope |Local Viewer/SDK/assets, restrictive CSP and internal backend network checked; exercised routing needs no Navisworks/cloud call. Host Internet disconnect NOT_RUN |
| Original preservation |PASS5groups in finalPF-8 isolation audit, including all13 original container IDs/images/start times, three source checkouts/old dirty files,11Core sources/8originaltests,14native pins and31frozenPF0deliveries |
| Cleanup |PASS for new own disposable resources;8superseded own images and903,979,537bytes of exact old backup archives removed. Image layer physical reclamation not measured; build cache retained |

Primary drill:
[runtime/final-drill-1792291231726.json](runtime/final-drill-1792291231726.json).
Cleanup:
[runtime/cleanup-1792291263831.json](runtime/cleanup-1792291263831.json).
Final primary runtime health/topology/resource bounds:
[runtime/final-health-1792291335683.json](runtime/final-health-1792291335683.json),
HTTP200 with the retained exact images, four own volumes and loopback5190 only.
Preservation:
[evidence/pf8/isolation-1792291275364.json](evidence/pf8/isolation-1792291275364.json).
Final documentation links:15documents/24local links/0missing PASS in
[delivery-doc-audit-1792291445568.json](evidence/pf8/delivery-doc-audit-1792291445568.json).
Final805-file source manifest:
[evidence/pf7/sources-1792291275723.json](evidence/pf7/sources-1792291275723.json),
SHA2563ea5002ae0c0c32ebaa8fda491b44003002f8b9a2ec78e67dcc48962010c985b.
The earlier630817...manifest differs only in the strengthened operations crash
driver; application API/web source/images are unchanged. Final preservation
engine source-set SHA256ae8af38d90ab70b1f79b41b4a1d26f6d13408c2fa180a12c4598c90a34ff025c.

Final APIimage562e80739ed2c105f280a8f460ba449b26aaa6a7a63bcb9b311ff58345407a01
and webimage81bb13b4c3370c903e364503f99ef28341fa840e6c451adf9b5163281fd345cb
remain available in the primary runtime and backup. The cold backup records its
own observation time/revision; later source commits do not rewrite that record.

## Retained local artifacts

The required final backup is ignored at
`pathfinder-engine/.scratch/pf-final-backup-20261018-0237`.
Its separate matching private companion and current runtime credentials stay
ignored outside Git. Keep both for recovery; never publish them or paste them
into reports. Necessary captures/native inputs/build outputs/evidence remain
for investigation. The obsolete backup retains its receipt/manifest, with old
payload archives explicitly superseded by the verified final backup.

Two historic cleanup children remain:
`.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c` and
`.pf2-work/model-tests-2733f823d57d477ba5e338a7d9a08cc9`.
Automatic approval review previously rejected their removal as blocked by policy.
No retry, bypass, parent deletion or hiding through ignore rules occurred.
They are the only intended untracked leftovers after final delivery commits.

## Remaining gates and next executable handoff

The native host's entitlement failure prevents obtaining the full-precision
paired native oracle. Real source/conversion identity, visibility/categories,
fitting/topology and representative complete path/design parity remain
**BLOCKED**. Full plant capture/capacity is **NOT_RUN**; reusable graph
preparation is **NOT_IMPLEMENTED**. Fitted geometry is cached; graphs are built
per query. Cross-computer restore and host network disconnection are NOT_RUN.
See PF-7/19 for exact limits; these are not waived by operational passes.

The next task is
[PF-2-resume-native-validation](handoffs/PF-2-resume-native-validation.md).
It carries the actual baseline, needed authorized native export/working
entitlement, comparison checks and remaining graph/capacity work. Its dependent
work cannot proceed honestly by repeating the same licence refusal. The runtime
itself does not need Navisworks; the native requirement is validation evidence.

The user has not accepted this new feature or authorized its integration into
the existing app. No push, PR, merge, deployment, original checkout change or
original application/data/volume/container write was performed. After delivery
commitbf9dfdf the application tool set heartbeatpathfinder to **PAUSED**; stored
status and unchanged name/prompt/schedule/target were independently read back.
[Automation receipt](evidence/pf8/automation-paused-20261018.json) records the
remaining external gate. The native reference prerequisite, graph preparation
and capacity work carry forward explicitly; the whole task is not accepted.
