# PF-R1 — exact project tray catalog and drawing dependencies

Status: **READY FOR IMMEDIATE EXECUTION**, explicitly authorized by the user on
19 October 2026. After technical completion prepare the next detailed stage
prompt through prepare-stage-handoff and immediately execute it. Do not pause
for routine confirmation; record the recommended routine decisions.

## Purpose and actual baseline

Implement the catalog prerequisite for the accepted purpose-routing and drawing
plan. Read `32-purpose-and-revision-plan.md`, `34-r0-contracts.md`,
`35-r0-stage-report.md`, all `r0/` module contracts, validation matrix and current
`automation-progress.md`. Do not restart PF-0–PF-8 or repeat R0 documentation.

- Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
- Completed R0 commit: `09f0e1dbdded9abca35b493db6eda7e9df9b94e4`, branch
  `pf-r0-purpose-contracts-local-20261019`. Create a new local inheriting R1 branch
  after inspecting live HEAD/status/active agents; keep unfinished/foreign work.
- Original WFC main and live GitHub main: `e1ef20202598bb4d3d78e4772cbbb9747ec23a00`.
  Canonical PF master/live master: `45c24bf5f433f13e102600b36f20327c77961d0a`.
  Read-only observations are in `r0/evidence/remote-observations.json`.
  Old dirty PathFinder stays at `35f4fb46...` with its existing changes.
- R0 actual fresh owned read-only counts: **0 trays, 0 purpose report mappings,
  2140 cables, 50 cable types, all 50 missing purpose and diameter, 0 active jobs**.
  See `r0/evidence/catalog-counts.json`. Counts are not exact source-catalog fidelity.
- Existing retained 27-table recovery audit **does not cover trays or report
  mappings**. Add the required R1 projections instead of misusing its PASS.

## Isolation and ownership

Original checkouts and `sources/` remain read-only. No original/5190 writes,
restarts, image updates, mounts or storage changes; no push/PR/merge/deployment.
Only the explicitly owned 5191 demonstration may receive copied data:

- runtime `pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`;
- owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`;
- Docker project `wfc-pathfinder-local-0cba87606e9b`, loopback port 5191;
- copied project `1af0f807-7653-40ea-8391-7eea6c54e7d4`;
- active model `a613151e-c370-45c5-80f3-42ae58603b9a`, fingerprint
  `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`.

Validate actual Docker endpoint/IDs/images/labels/networks/mounts/ports and DB
identity using the existing proven guards before any operation. The retained
source is itself a restore; never call generic retirement on it. Root is the
sole actual runtime/SQL/HTTP/browser executor. Split agent ownership into new
nonoverlapping modules; preserve concurrent changes and coordinate shared APIs.

## Read-only source and private immutable plan

1. Inspect `scripts/pathfinder-current-inputs/source-copy.mjs`, `source-lib.mjs`
   and README-source for original source endpoint/identity/read-only guards;
   inspect retained private source and seed mappings through
   `scripts/pathfinder-copied-project/seed-lib.mjs`. Reuse the exact source project
   already copied to 5191. Verify identity fresh; do not select another project
   by a partial name or invent credentials. Never rerun the original seed writer.
2. Implement a new bounded consistent **READ ONLY** source projection for tray
   rows and necessary dependency closure. Preserve PostgreSQL NUMERIC as text/
   JSONB-text; public DTO/Excel Number conversion is not a lossless copy proof.
   Original source must remain unchanged before/after. No source bootstrap,
   migrations, job creation, Viewer sessions or write-capable source SQL.
3. Include exact tray names/purposes/type/dimensions/length, grounding/trefoil
   facts and required types/materials/support/load curves. The existing 50 local
   types are deliberately minimal: reuse retained mapped IDs and enrich only
   against verified expected initial facts. Include additional grounding types
   when required. Preserve null and zero; do not guess missing drawing facts.
4. Distinguish private `wfc.pf.catalog-copy-projection.v1` from the proposed public
   normalized catalog. R1 produces the exact private transfer and public evidence;
   do not implement R2 policy APIs/schema prematurely. Preserve raw purpose/name
   and record normalization collisions/unsupported route codes for later resolution.
5. Create a fresh owned private work directory, restrictive ACL, immutable source
   snapshot, source-to-local ID maps and hash-bound plan. Capture source counts,
   totals/limits and provenance. Only hashes/counts/statuses go into Git.
   Validate rows/FKs/size/finite/decimal/identity/duplicates before target writes.

## Transactional target and dependencies

6. Plan new tray/dependency IDs. Reuse shared material/support/curve rows only
   after exact equality; never overwrite a global unique-name collision used by
   another project. Explicit conflicts remain unresolved rather than merged.
   Preserve existing project/model/selection/registry/bindings/jobs/proposals,
   cable IDs, routing/design/install length and cableWriteRevision.
7. Enrich the 50 minimal types only with expected-state/CAS protection and exact
   source→local map; reject intervening edits. New referenced types are distinct
   owned insertions. A blanket upsert is prohibited.
8. Apply an exact plan in one bounded SERIALIZABLE target transaction with project
   advisory locking and dependency checks. Exact successful replay is idempotent;
   partial, foreign, changed, stale or conflicting target state refuses atomically.
   Lost COMMIT acknowledgement requires explicit same-plan reconciliation, not
   replacement IDs or blind write retries. Persist raw private transport evidence.
9. For referenced report templates/images, copy actual bytes to owned storage
   with new local mappings and hash/readback checks. Preserve purpose→report-file
   semantics; do not turn report mappings into routing permission records.
   Never point copied rows at the original app's active storage keys. Stage new
   objects before relational commit and retain/refuse clearly on uncertain state.
10. Independently verify exact target business/NUMERIC text and all mapped FK
    dependencies. Preserve unrelated target rows and original source. Extend the
    audit to newly involved tables/files; verify exact allowed additions/enrichment.

## Checks and observable acceptance

- Synthetic controls cover precision pairs, null/zero, source/target identity,
  foreign project/FK, duplicate IDs/names/normalization, partial/changed type,
  global material collision, stale/replayed plans, rollback, output/deadline and
  lost-acknowledgement reconciliation. Tests use only newly owned fixtures.
- Root performs fresh source read, target guards, actual plan/apply/readback and
  source/target preservation. Record exact revision, source hashes, counts,
  new/enriched/reused/conflicted records and unfulfilled dependencies.
- Use computer-use to inspect the owned 5191 Trays list/detail drawing input
  after copying, confirming real catalog presence and preserved existing Path
  Finder three-tool/model behavior. Do not Apply engineering routes or invent
  location bindings. English UI only.
- Whole-plant graph capacity, left/right implementation, routing policy APIs,
  old/new geometry comparison and engineering acceptance remain NOT_RUN in R1.
- Source reports and actual copy must agree; do not call a partial catalog with
  missing necessary drawing inputs a complete successful R1. Continue independent
  code/controls while investigating a concrete prerequisite, without repeated
  unchanged failed source operations.

## Delivery and next stage

Create scoped new transfer/operator/control modules, documentation, exact evidence
and R1 report; keep secrets/business rows in owned ignored private storage.
Retain needed 5191 demo/backups/model packages/private evidence. No new conversion
or active-model replacement is needed: current342-resource and old173-resource
packages are already hash-verified. Do not touch any of the seven denied scratch
children/parents or use prune. Clean only new owned unnecessary resources.

After checks and independent review, make a local commit, update progress, apply
prepare-stage-handoff and save detailed `PF-R2-purpose-policy.md` with the actual
new baseline, retained dependencies and remaining scope. Immediately create its
new inheriting local branch and execute R2; then continue R2a/R3–R10 in plan order.
