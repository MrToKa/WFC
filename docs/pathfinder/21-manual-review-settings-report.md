# Project Details gap and manual real-result review — technical report

Status: scoped technical delivery PASS, including source/API/browser checks,
combined backup/restore/crash recovery, owned cleanup and final preservation.
Human manual route/length acceptance remains PENDING. This is the local
project-gap/manual-review revision, not a whole-plant or reusable-graph completion.
Branch pf-manual-validation-settings-20261018 inherits5485283. Work is confined
to the isolated local checkout and own5190 runtime; no main merge/push/deployment.

The user's latest criteria are in
[20-manual-review-and-project-gap.md](20-manual-review-and-project-gap.md).
Required native-oracle acceptance has been replaced by manual per-proposal
review. Native comparison is not performed; it is not reported as a passing
engineering check. Human review of the new result remains pending.

## Implemented changes

- Persistent Project.connectionGap, default1metre for new and existing projects,
  finite>0<=100 validation, independent Details card with3decimal input precision.
- Current project gap overrides caller/old-job tolerance in automatic routing,
  explicit calculation and ordered lookup. Gap changes participate in effective
  options/geometry dependencies and force rerouting/stale old proposals.
  The three design allowances stay authoritative in Details; allowance-only
  changes reuse successful geometry and recalculate design length.
- Existing Automatic cable length calculation card distinguishes the old
  tray-list estimate and exact PathFinder formula/current3allowances. Actual
  gaps are already included in geometry and are not added again.
- Existing strict-admin Confirm review + Apply now supports real-model manual
  review. Real engineeringAccepted remains false; provenance records actual
  review actor/time/hash and acceptanceScope manual-review/nativeParity not-performed.
  Legacy unclassified reviews cannot silently authorize this new acceptance path.
- Existing current-role/login/project/model/artifact/registry/cable revision
  fences, cancellation, atomic history/receipt, idempotency and installLength
  preservation remain. No blanket model-acceptance flag was introduced.
- Cleanup helper supports only a fully verified older same-owner/project backup
  after its verified replacement, exact regular payload files only, preserving
  manifests/markers and refusing root/sibling/escaped/junction paths. Historical
  denied children and original resources remain untouched.

## Verification at the current source milestone

| Scope | Actual observation |
|---|---|
| Backend process/settings/registry |51/51 PASS:20matching,15settings,16actualNode/.NET; gap0.5m disconnects at0.25 and connects at1; original formula remains exercised |
| Server build |PASS, TypeScript0errors |
| Existing server project/access/cable regressions |191/191 PASS:10projectRoutes,4projectChangeLog,137middlewareaccess,40cable/history/export/length |
| Frontend |147/147 PASS across8files before final follow-ups; final affected PathFinder tab19/19 PASS including eligibility and deferred-response controls; TypeScript/targetedESLint PASS. These are scoped runs, not a fresh combined aggregate |
| Runtime cleanup ownership/path controls |17/17 PASS; script syntax/whitespace PASS |
| Coordinated final API/SQL atcfdcd3f/API286e image |23/23 PASS and cleanup PASS, including actual over-limit design canApplyfalse/Review409/no write; [receipt](evidence/manual-settings/live23-20261018T065834Z.json), [exact image/driver binding](evidence/manual-settings/live23-binding-20261018T065834Z.json), [cleanup/readback](evidence/manual-settings/cleanup-readback-20261018T065834Z.json) |
| Computer-use at873afeb/e884 +a71 images |PASS: separate default1 card, invalid0 refusal,0.25 persistence/reload, restored1, formula/current allowances, read-only lookup gap, actual manual proposal/Ghost/yellow, explicit Review enables Apply and reload resets it. [Receipt](evidence/manual-settings/computer-use-before-review-fence-20261018T0648Z.json) |
| Computer-use on final286e/5003 candidate |PASS: fresh ready real proposal, exact35.30345579516123m/design45m, filledGhost/yellow, explicit Confirm enables Apply; fullreload/reselect resets Review and leaves Applydisabled. No actual demo Apply. [Final receipt](evidence/manual-settings/computer-use-final-20261018T0700Z.json) |
| Replacement backup/restore/session fencing/actual crash |PASS on exact final286e/5003 images; [new combined drill](runtime/final-drill-1792307077877.json). Verified new backup2ae6f51b retained; only extra target interrupted/retired |
| Owned cleanup/final health |PASS:8superseded backup payloads1,346,316,196bytes and6unused own images removed; [cleanup](runtime/cleanup-1792307113805.json), [final health200/retained archive](runtime/manual-final-health-1792307147471.json). No physical image-layer savings inferred |
| Final preservation |PASS:5groups preserve11Core/8regression files,31frozen PF-0 deliveries with append-only matrix,14native pins, original3checkouts/dirtyfiles and13container IDs/images/starttimes; [audit](evidence/pf8/isolation-1792307166050.json) |
| Native comparison |NOT_PERFORMED / NOT_REQUIRED_BY_USER; no native host/licence retry |
| Human manual route/length acceptance |PENDING; technical QA does not impersonate user acceptance |

Final source/image identities and browser/API/operational receipts are recorded
below. Original11Core source bytes and
frozen expected fixtures are unchanged; no PF-0 receipt generator is rerun.
Whole-plant capture/capacity and reusable graph preparation remain separately
unimplemented/unverified at the scopes already reported, not implied by this
settings/manual-review revision.

## Final candidate identity

- Worktree: C:/Users/todor.chankov/source/WFC-pathfinder-local.
- Branch: pf-manual-validation-settings-20261018.
- Settings/manual-review source checkpoint873afeb; final production follow-ups
  feac4eb8b85f38ef4f9a0ec6f53845e8df2bb033; corrected test driver/build checkpoint
  cfdcd3f5974636737ff34acec0fc3de391d35ab1. Later report commits do not change
  production image inputs.
- API: sha256:286e0d43fb12d23c77727eb2c899eac161571d98998e0eb0f212911006adb500.
- Web: sha256:500345218d8c3f4629725ce6b1d3cbeeb6dc12f7b4cb1f06d5b92ecf8949ba64.
- [Final startup/topology/limits](runtime/manual-retry-candidate-health-1792306676273.json).
  The actual final web image ID changed from0f51326f, although its ten RootFS
  layers/runtime Config/Created were identical. The receipt binds the actual ID;
  expected image identity was not substituted for observation.
- [Final source manifest](evidence/pf7/sources-1792306936902.json):810nonignored
  source files, SHA256d0ad1efa75f4d21063fa0661124914475d4aedc5a8d4b5f9cf93df3db113ee76.
  This binds source bytes; it is not another functional or engineering test.
- [Live remote baseline](evidence/manual-settings/remote-baseline-20261018T0650Z.json):
  WFCmain e1ef2020 and canonicalPFmaster45c24bf5 unchanged; local feature branch
  unpublished. Earlier GitHub connector observations retain their own dates;
  no remote feature CI or PR acceptance is claimed.

## Real converted demonstration

The own copied project PF-LOCAL-DEMO contains PF-MANUAL-DEMO, a clearly named
QA cable whose shared From/To aliases use actual first/last canonical points
from the recorded selected-network lookup. These are not claimed business
equipment identities. The captured artifact has52objects/26segments, SHA256
df1b67a0c832e9eed426d4f00741373616b4738f0520b65eb3ff3898c9fd2640.

Current explicit example settings are gap1m, SECONDARY3m, end reserve5m and
bending10%. Only gap1m is the newly requested general default. Actual route
length35.30345579516123m,90points, four measured gaps, design45m; no SECONDARY
replacement is needed for its zero-length endpoint approaches. The measured
gap total0.9840583861033791m is already represented in route geometry and is
not another additive allowance. See the [actual seeding/calculation receipt](evidence/manual-settings/real-demo-1792305637264.json)
and [user guide](08-local-user-guide.md).

The first QA seeding attempt received400 because project cable types require
a linked material catalogue type. The helper was corrected to create/link its
own clearly named local QA type before the cable. The successful retry revoked
its own login and recorded no credentials. That failure was not an application
routing failure and is not reported as a passing attempt. The helper change is
test tooling, outside production image inputs. No Apply was performed on this
real demonstration; the actual23-case disposable fixture separately exercises
the manual-review write/provenance/idempotency path.

## Final review follow-ups

A deferred frontend Review response was shown to restore an old cable's panel
after selecting another cable. In that reproduced case Apply remained disabled;
there was no observed Apply authorization bypass. The verified fix fences the
completion by current selection/proposal/dependencies and prevents late success
messages appearing under another selection.

Read-only review also found DTO canApply could invite review for a design above
the existing WFC1,000,000m write limit; Apply already rejected it safely. The
bounded correction makes proposal eligibility display the same limit. Focused
backend17boundary+16actual Node/.NET checks and frontend19affected checks pass;
server/frontend TypeScript and targeted frontend lint pass. Exact scope is in
[the follow-up receipt](evidence/manual-settings/focused-review-followups-20261018T0652Z.json).
Both changes are committed in production checkpoint
feac4eb8b85f38ef4f9a0ec6f53845e8df2bb033. The fresh candidate has started:
[startup/identity receipt](runtime/manual-final-candidate-health-1792306430082.json).
Repeated final23 live controls, brief final UI verification and final combined
backup/restore/crash recovery, owned cleanup and preservation now PASS, as linked
in the table. Only actual human acceptance and stated unperformed scopes remain.

The first extended live run on that image recorded22/23 and cleanupPASS, retained
in [the failed receipt](evidence/manual-settings/live23-20261018T065457Z-failed.json).
The oversized result correctly returned canApplyfalse, a clear limit issue and
Review409. Its unchanged-cable assertion incorrectly compared the revision from
before calculate() deliberately changed the fixture tag. The comparison baseline
was moved after that intentional test mutation; the unchanged-write assertion
and all guard assertions remain. This test-only correction is committed in
cfdcd3f5974636737ff34acec0fc3de391d35ab1 and compiled successfully. The corrected
driver's SHA matches the actual final API container; the repeated run23/23PASS
is retained separately. The failed run is not relabelled PASS.

## Changed files and scope

Production server changes are in db.ts, models/project.ts, validators.ts,
routes/projectsRoutes.ts, services/projectService.ts and projectChangeLogService.ts,
and pathfinder/{settings,dependencies,jobContracts,jobs,jobsSchema,lookups,
worker,apply,repository,syntheticFixture}.ts. The new shared design-bound helper
does not modify the formula or pinned Core sources.

Frontend changes are in api/{types/project,projects,pathfinder}.ts,
pages/ProjectDetails.tsx, ProjectDetails/{DetailsTab,PathFinderTab,
PathFinderLookup,PathFinderResults}.tsx and hooks/{usePathFinder,
useProjectNumericField}.ts. Related tests supply the new project field and
exercise persistence/permissions/Review state; ChangeOrdersTab.test.tsx has
only a typed fixture field, not a Change Orders behavior change.

Operational code changes are confined to scripts/pathfinder-local/
cleanup-obsolete.mjs and its ownership/path tests. The QA demo helper and
server integration driver create only disposable/copied local data. Documents,
handoffs, dated JSON receipts and screenshots are under docs/pathfinder/.
The local commits and final source manifest provide the complete exact list.

Next handoff: [PF-user-manual-review.md](handoffs/PF-user-manual-review.md).
Technical verification is separate from the user's engineering acceptance.

## Retained backup and operational checks

The new combined cold backup is
`pathfinder-engine/.scratch/pf-manual-backup-20261018-0703`, ID
`2ae6f51b-34ee-46d4-8594-757f882fd216`. Its matching private companion remains
separate and excluded from Git. It contains the own database, MinIO, staging,
PathFinder artifacts and four exact API/web/PostgreSQL/MinIO images. Follow
[runtime instructions](runtime/README.md), not original WFC lifecycle scripts.

The fresh extra5191 restore verified equal database/file inventories, both
selected model versions,684resources/878,015,606bytes and13PathFinder artifact
files/2,547,207bytes. Source Viewer cookie200 before/resume/after extra target;
copied cookie410SESSION_REVOKED, old bearer401, fresh target cookie200.

An actual .NET supervisor/child pair was observed on the extra target, then its
API was interrupted with exit137/PID0/noOOM. Natural lease recovery completed
64/64 on attempt2 in46,113ms after restart, with64distinct proposals, zero
duplicates and all64cables unchanged. No Apply was performed by this test.
Primary5190 stayed healthy. The successful extra target was retired, leaving
zero target containers/volumes/networks. This is same-host/platform evidence;
cross-computer restore and host network disconnection remain NOT_RUN.

The already open browser's Viewer frame was blank after the source maintenance
interval, despite the ready result panel. A full page reload and reselect restored
the664,556-fragment model, filled Ghost/yellow route and35.30345579516123m/45m
result, with Confirm enabled/Apply disabled. This is recovery after an explicit
browser reload, not automatic recovery of the old frame. Both observations are
retained in final-after-backup.png and final-after-backup-reload.png under
evidence/manual-settings/. The guide tells operators to reload after restart.

The verified new backup contains1,346,348,226payload bytes and is retained with
its private companion. Only after replacement success, the old43365396 backup's
eight payload files were removed (1,346,316,196bytes), along with six unreferenced
images carrying this installation's ownership. Old compact manifests/retirement
markers and failed receipts remain. The old433 archive set is intentionally
no longer restorable. No recursive parent removal or Docker prune occurred.

Two inherited scratch children remain because automatic approval review had
previously rejected their removal with **blocked by policy**:
`.pf0-work/core-1f723e37-f152-4a60-9b1e-46adc6c3179c` and
`.pf2-work/model-tests-2733f823d57d477ba5e338a7d9a08cc9`. Neither denial was
retried or bypassed. They remain visibly untracked. The required demo, copied
inputs, current backup, private configuration and compact evidence are retained.

The final five-group audit confirms that original WFCmain and both reference
PathFinder checkouts, including old local modifications, are preserved. All13
original container IDs/images/starttimes match the baseline. Only the isolated
application/resources were rebuilt/restarted; there was no push, PR, merge,
deployment or original working-data write. The user can review the local result
before making a separate integration decision.

Local technical delivery/evidence commit:
961d24ff0f8e6cbbe9a77807d631aa0b3d7f00ef. A following metadata-only commit
records the actual heartbeat PAUSED result and this reference. The app tool
confirmed PAUSED and stored status/name/schedule/target were read back;
[receipt](evidence/manual-settings/automation-paused.json). This avoids repeated
unchanged checks while the next required action is the user's manual review.
It is not a declaration that the remaining whole-plant/graph work or human
acceptance is complete. The next handoff preserves those limitations.
