# PF-R2a — shared cable positioning and tray drawings

Status: **TECHNICAL_PASS at the verified local scope; user acceptance NOT_RUN**.
Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, inherited branch
`pf-r2a-drawing-positioning-local-20261019`, pre-delivery HEAD
`4832f9500a8c80f4e3571d2ace31989662bbbd7e`. The following local commit contains
this report and the hash-bound implementation. Nothing was published or merged.

## Delivered behavior

Project Details has a strict admin-only **Cable positioning** card, separately
versioned from routing permissions. Each authoritative tray purpose has four
drawing categories, MV/Power/VFD/Control, with exclusive Left/Right choices and
Use default layout. Saved rules support history, current-role authorization,
CAS, idempotent retries and purpose removal/re-add protection. Reset removes the
authored override. Routed grounding retains its separate default family and is
included by an explicit MV side override.

One bounded placement engine now serves the normal tray page, free-space
metrics and XLSX export. It computes default sides from the whole input before
overrides, pools compatible cables on their final side and retains phase,
diameter-range, packing, grounding and clamp constraints. Both occupied sides
produce one2px visual divider; one side produces none. Central free space is not
counted as occupied. Overflow and missing/unknown input block shared output.

Normal authorized drawing readers receive the same immutable server snapshot
and layout without PF/model permissions. Existing engineer/admin editing rights
can save per-tray bundle overrides; browser local overrides become explicit
unsaved drafts. Failed reads never silently restore a legacy calculation.

Reports freeze data, tray counts and freshly rendered offscreen bundle/load
curve images before asynchronous generation. Changes cancel generation before
upload. The server stages and verifies exactly three owned files, rechecks the
current snapshot and authorization, then commits their metadata/provenance
atomically. Exact uncertain retries reconcile the same command. Generated output
does not invalidate its own source unless selected as an actual source template.
Historical catalog proofs remain immutable; new proofs use an explicit v2 source
projection. The routing projection/hash is unchanged by drawing settings.

## Verification

| Check | Result and precise scope |
| --- | --- |
| Combined retained/new regression | **622/622 PASS in31files**; includes189retained placement/clamp checks and asynchronous report race controls |
| TypeScript / targeted lint | PASS;56changed TS/TSX files linted |
| Actual SQL/HTTP | **15/15 PASS** through owned API/nginx: current admin/readers, shared identity, bounds before body, duplicate JSON, CAS/replay/reset/ABA, ordinary override rights, server XLSX cell authority, atomic export, stale/source/tray-kind fences and revocation |
| Actual project drawing capacity | **330/330ready**,330proofs,0blocked,200response in19,307.97ms; drawings only, not routing graph capacity |
| Computer-use | **13 scoped checks PASS**: mutual choices/save/reload/defaults, mixed-side pooling/divider, single-side/no divider, stale conflict, read-only drawing, blocked input, real material/curve facts and protected model |
| Database preservation | **53tables PASS**, including all2143existing cables. Only the additive v1 projection discriminator on retained catalog proofs is normalized; one new v2 real-project proof is explicitly allowed |
| Storage | **1032objects unchanged**, exact logical inventory hash retained:3project/3template/1026model objects |
| Runtime/resources | Only owned5191 API/web replaced. PG/MinIO/storage-ready, named volumes/networks and all18protected containers retain their exact identities/images/start times/state after the documented owned cold-backup stop/resume |
| Source/reference isolation | Original WFC and canonical/dirty older PathFinder branch/HEAD/status match R0 baseline;23frozen reference paths unchanged; no expected data regenerated |
| Independent source review | PASS for authority/locking/staging/proof exclusions/shared report consistency/fixture ownership; no independent engineering acceptance claimed |

Exact evidence: [final source closure](evidence/drawing-positioning/source-closure-final.json),
[actual controls](evidence/drawing-positioning/actual-controls-1792367291540.json),
[real capacity](evidence/drawing-positioning/real-330-capacity-1792367393085.json),
[computer-use](evidence/drawing-positioning/computer-use-final.json),
[53-table reconciliation](evidence/drawing-positioning/business-preservation-1792367656903.json),
[storage](evidence/drawing-positioning/storage-preservation-1792367668457.json),
[upgrade](evidence/drawing-positioning/runtime-upgrade-1792367271475.json).
Final formatting cleanup removed trailing whitespace only. Its rebuild did not
produce identical image IDs, so that equivalence assertion was recorded as a
failed check and no candidate3 deployment followed. Candidate4 was built and
explicitly installed instead, then all15actual controls,53-table/storage
preservation and protected-model reload were checked again successfully. Current
API is `sha256:1ae01697093fa8374af378d16fdacef6158bef167ef419937bd7a309641e8fa0`;
web is `sha256:134cce47c50621e7ac39f78d22cbcbd57094798ac3bcc4e1fc65a87556cc6698`.
The [final runtime closure](evidence/drawing-positioning/final-runtime-closure.json)
links these fresh checks and exact source/runtime hashes. Earlier receipts retain
their original checked revisions. The final staged whitespace check passes.
Raw business rows, credentials, screenshots and helper input/output remain private
in owned ignored work `pathfinder-engine/.scratch/tray-catalog-bebbc6b5-3be9-4e50-930d-3339074393b9`.

## Recovery, limitations and next work

Verified pre-migration backup **038dcba7-048b-4475-928b-e2d7327cd2a1** and its
separate private companion are retained. The unused first candidate was
superseded after independent review found report count/image races; it was never
deployed. Its two unreferenced owned images were removed; four superseded
candidate2/3 images were also removed after final reference checks. Both synthetic control
projects and their temporary accounts/objects were cleaned, with exact ownership
and deletion reconciliation. No new test containers remain. Historical denied
scratch paths/parents and the denied Temp residue remain untouched; no prune.
See [cleanup](evidence/drawing-positioning/cleanup-1792367703549.json).

Current demonstration stays at5191 with330real trays/2140selected cables/51types,
zero authored real routing/positioning rules, zero confirmed bindings and zero
trusted artifact scopes. The diagnostic network is still13objects;1527shared
location names remain unresolved. DetailsS/E/P/gap remain7/5/10/1. No real
routing/design/install value was applied or invented. Own demo browser logout/
login changed only ordinary local authentication sessions; temporary accounts
were removed and the normal demo admin session was restored.

Actual generated DOCX visual rendering, a fresh yellow/Ghost route execution,
full-network routing capacity, native parity and human acceptance are **NOT_RUN**
for this stage. Existing Viewer sources and C# mathematical Core are unchanged;
their inherited checks are not recounted as fresh execution. R10 must include
the report document workflow alongside the wider integration checks. The user
has chosen converted-model comparison and manual engineering review; no native
entitlement retry is needed.

Next: prepare and immediately execute **PF-R3 bounded project preparation and
atomic aggregate/global calculation scope** on a new inherited local branch.
Keep the automation ACTIVE. R4–R10 remain pending; this stage is not completion
of the overall requested functionality.
