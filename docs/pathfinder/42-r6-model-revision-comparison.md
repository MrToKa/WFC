# PF-R6 — model revision comparison and dependency fencing

Status: **TECHNICAL_PASS at the recorded local diagnostic/synthetic scope**.
Human engineering acceptance and full-plant coverage remain **NOT_ESTABLISHED**.
Local branch `pf-r6-model-revisions-local-20261019` inherits handoff
`b22c1f2d7bf95e01407b540994ccd5fbf1787118` and R5 technical
`c9d42429077c5be415eb3d71aa7ee458eb568fd9`. This report describes the final
source context, not a self-referential commit hash.

## Delivered behavior

Routes now includes **Model revision changes**. An administrator can select two
saved immutable geometry traces, compare their bounded requested scopes and
inspect old/new evidence and candidates. Names, dbIds, unscoped external IDs,
bounding boxes and unavailable signatures never silently become physical identity.
Immutable base observations remain separate from subsequent reviewed object,
frame and source-binding qualification decisions. Split/merge, ambiguity and
unqualified alignment remain explicit review states.

The refs-only comparison worker has a combined32MiB input limit, bounded candidate
edges,512MiB heap/2GiB process RSS limit,120s deadline and confirmed terminate/join.
Change pages contain at most50 rows/1MiB. Publication is current-admin/login,
target/CAS fenced; target-specific dependency scopes do not change for an
unrelated historical target. A current target's pending comparison refuses new
calculation authority. No comparison intent means explicit server-owned
not-required authority. A published diagnostic comparison may remain unqualified
for engineering review; it does not imply engineering acceptance.

New calculations/previews freeze v4 comparison/preparation/endpoint dependencies.
Historical v2/v3 records remain inspectable with no new admission/Review/Apply
authority. Confirmed migrated bindings are checked against their relevant current
frame/object/qualification basis on every readiness lane. Unrelated qualifications
do not stale an independent point. The C#11 pure Core files, strict runner DTO,
mathematics, Details allowances and drawing-only Left/Right behavior are unchanged.

## Recorded verification

All paths below are relative to `evidence/revision-comparison/`. Counts overlap.

| Check | Result and exact scope |
| --- | --- |
| Combined source regression | PASS93files1439checks/0FAIL/5optional lookup-worker NOT_RUN; raw private receipt retained. |
| Final recovery correction | PASS62scoped checks/0FAIL/0NOT_RUN, fresh server TypeScript and scoped ESLint. Latest-overall-intent recovery followed by fresh-key same-pair no-op is a production-repository fixture regression, **not** an actual DB recovery sequence. |
| Source/pins | PASS both full TypeScript checks, scoped54file lint,24 reference pins/11pure Core files; `source-checks.json`, `source-final.json`, `source-final4.json`. |
| Actual PostgreSQL | PASS15bounded phases: pending/dependency integrity, unrelated target, immutability/FKs, role/login/expiry, locking/fencing, abort and read-only COMMIT-ACK fault. Rollback-only synthetic mechanics; no paused full HTTP publication race claim. `actual-controls.json` plus per-phase receipts. |
| Actual HTTP transport | PASS11normal host checks, including typed auth-first401 and prebody413, duplicate keys/nonfinite/UTF8/compression/method/query/case/approval-field refusals. `actual-http-edges.json`. |
| Actual old/current pair | PASS protected normal UI captures and comparison publication, normal API same-pair/exact-command replay.8old/9current objects,17unresolved changes,11candidate edges,0qualified matches. `actual-converted-pair.json`. |
| Original diagnostic scope restoration | PASS original model/BC022-2 catalog, new13-object aggregate/trace and exact3existing synthetic points/names/aliases. `restored-scope-and-bindings.json`. |
| v4 production calculation | PASS9synthetic proposals; all3final routes successful, Instrumentation→Control. Two relevant current-target publications make6old proposals stale; all6Review requests return409PROPOSAL_STALE. No Apply. `actual-v4-staleness.json`. |
| Computer-use | PASS11comparison observations plus6restored path observations, historical protected bbox/record inspection, current yellow route/filled Ghost/opaque/Clear and final candidate4 reload. `computer-use-comparison.json`, `computer-use-restored.json`. |
| Storage | PASS1374old object metadata records exact;173new older-model resources streamed/verified against manifest bytes/SHA256,1547total; project/template buckets exact. `final-storage-preservation.json`. |
| Source/runtime isolation | PASS3reference checkout branches/HEAD/status/tracked patch hashes and18outside containers; only owned5191API/web replaced. `final-source-runtime-preservation.json`. |
| Cleanup | PASS6exact owner-verified unused candidate images removed,0new test containers. No prune/denied-path retry. Physical reclaimed bytes NOT_MEASURED. `cleanup.json`. |
| Full table/PF_ROOT classification | PASS100old+10newtables, full row multisets;64oldtables exact/36receipt-classified, all10newtables reconciled.63oldPF_ROOTfiles exact; all51newfiles referenced/hash-bound. `final-preservation.json`; two initial classifier FAILs retained and precisely reconciled. |

Final candidate4 source SHA256
`6374a1493beb3dd783d1e7841d52d7f3fe70e400c8a769aff47c6da0b539b203`,1378context
files/1214non-document source files. Compared with candidate3, only comparison
repository/fixture/test changed, plus the progress document. The final normal API
exact replay preserves the comparison scope. Earlier actual calculation/UI checks
ran candidate3; those calculation/Viewer modules are identical in candidate4.

API image `sha256:cae50e6368f5d26a7959ce7e265025b60b2ca1c7db29cff63efedaffafddd1b9`;
web `sha256:39225998e73df4d2226ef5808d5f323f1417ec12b072e50bbc0559f1527f47ee`.
API container `9cd8072c556f5c3322acd64ce41a5b58e612bb5511eb2a2bbbd18a57df115b19`;
web `81df32517a4d50efc04700696039ef2d308b9879d9256e95275fbf207648d100`.
PG/MinIO/storage-ready/4volumes/2networks remain owned and unchanged. Approved
private runtime descriptor6 is retained under the R6 scratch work; no secrets or
business rows are committed.

## Actual converted scope and preservation boundary

The earlier already-converted ZIP was imported **once** through the normal5191
registry into the existing synthetic UI project56eadef6-8382-49f8-a652-c8f12026602e.
No Autodesk upload/submit or seed repeated. Its original current version remains
active after inspection. Older BC022-2 was actually missing. Observed common
BC001 was independently confirmed in the copied catalog, and the sole synthetic
tray was temporarily renamed only for comparable bounded captures, then restored
exactly to BC022-2. The two tray writes and their audit events remain visible.
Common BC001 scope hashes match; this is not whole-plant equivalence.

Original13-object aggregate is now
`adfd8568-327d-4487-9279-dddd3c344055`, geometry5/catalog3, trace
`c7a0fe81-a9da-4314-b871-1e37773fdf79`. Three existing synthetic manual-world
points were reconfirmed byte-for-value from the baseline heads. No real point,
qualified common engineering frame, physical mapping or automatic binding carry
was manufactured. The two later historical diagnostic comparison pairs exist
only to test current-scope fencing. Real copied business project
1af0f807-7653-40ea-8391-7eea6c54e7d4 remains330trays/2140cables/51types,
Details7/5/10/gap1 and no engineering Apply.

Cold checkpoint469c37ef-ff35-4e76-985d-19e59d8f57f2 retained8hashedmembers/4images,
verified dump TOC and1368raw-hashed model resources across4baseline versions.
Its private host-provenance companion is separate. Full restore of this R6
checkpoint is NOT_RUN; R10 owns the final delivery restore/offline checks.

## Failures and corrected attempts retained

The first header-only HTTP transport probe returned HTML and failed JSON parsing;
its exact status was not retained. The scoped nginx streaming route lacked
revision-comparisons. Candidate3 added that suffix and actual11typed transport
checks then passed. `initial-transport-failure.json` preserves the initial failure.

The restored trace's initial outcome was UNKNOWN. A read-only inspection pinned
the original pending intent and expired lease. Reconciliation of the **same**
saved UI command returned the same successful trace ID/13objects; no duplicate
trace was created. Initial cause remains NOT_ESTABLISHED. The first binding
restoration preflight stopped before a write because the trace was not yet ready.
The first v4-check preflight used an incorrect readiness assertion (`ready`
instead of the actual `confirmed`/calculationReady contract); no command was
admitted. The corrected new-label run passed. The first final-source classifier
refused an additional known progress-document change; explicit exact four-file
reconciliation then passed. None of those first attempts is relabelled PASS.

Independent final review found older abandoned pending comparison intents could
prevent a fresh-key same-pair no-op after a successful recovery. Candidate4 now
locks the latest **overall** target intent: live pending is busy; expired latest
pending requires new publication; latest complete/head allows semantic no-op.
Exact-key receipts remain stable.62scoped checks and the final deployed replay
passed; no actual injected DB recovery sequence was performed for this last fix.

## Use and next stage

Open the owned5191project → Path Finder → Routes → Model revision changes.
Choose saved old/new traces. Inspect evidence before recording any physical
mapping/frame decision. Unqualified facts stay unavailable; admin correspondence
review alone does not establish object-local Follow. Path displays current
proposals; Review and Apply remain separate explicit actions. Clear restores the
model. All UI text is English and strict current-admin access is retained.

After this verified delivery receives its local technical commit, generate the
self-contained PF-R7 handoff with prepare-stage-handoff and immediately execute
it on an inherited local branch. R7 adds durable/coalesced automatic requests,
current-login enrollment, bounded/fair jobs and actual engine identity; R8 adds
separately qualified unattended grants/geometry producer. R9/R10 remain. Original
checkouts/sources/5190/production containers/data remain untouched. No push, PR,
merge, deployment or engineering acceptance is authorized or claimed.

Final catalog reconciliation: the two new full snapshots are baselineCR1/DR5
refresh and temporary-nameCR2/DR6. Final CR3/DR7 uses the routing projection
without materializing another full catalog. All21fact groups, temporary/restored
tray projections and unchanged routing hash of the drawing-only refresh were
verified. The classifier initially expected a final snapshot and refused it;
that failed report remains beside the exact receipt-backed reconciliation.
