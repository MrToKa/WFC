# PF-R2 — persistent project routing permissions by actual tray purpose

Status: **READY FOR IMMEDIATE EXECUTION**. The user explicitly requires a
detailed next prompt after every technically completed stage and immediate
execution. Do not stop for routine confirmation. Record recommended routine
choices; retain human engineering Review→Apply and isolation boundaries.

## 1. Purpose and inspected baseline

Implement the project-wide **Path Finder routing permissions** card in Details,
backed by strict admin API, authoritative catalog, monotonic revisions, history,
concurrency and safe calculation invalidation. Catalog-driven geometry is R3;
Left/Right drawing authoring is the separate next stage R2a.

Read applicable AGENTS, `32-purpose-and-revision-plan.md`,
`34-r0-contracts.md`, `35-r0-stage-report.md`, `36-r1-stage-report.md`,
all relevant `r0/` contracts/examples/validation matrix and current progress.
Do not restart PF-0–PF-8, R0 or the completed R1 transfer.

- Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
- R1 technical commit: `d997dca1e7673061bd04e64bad61b6563749e1b7`, branch
  `pf-r1-tray-catalog-local-20261019`. Inspect live HEAD/status/agents first.
  The metadata handoff commit may follow it. Create new inherited local branch
  `pf-r2-purpose-policy-local-20261019` and preserve unfinished/foreign files.
- R0 technical commit `09f0e1dbdded9abca35b493db6eda7e9df9b94e4` and
  R1 assignment commit `9c5fa34646016d670dc1c30a4704375ef5591010` are historical.
- Original WFC main remains clean at
  `e1ef20202598bb4d3d78e4772cbbb9747ec23a00`; canonical PF master remains clean
  at `45c24bf5f433f13e102600b36f20327c77961d0a`. Old dirty PF remains
  `35f4fb46f7762503576bdacd9668f34a1be2b0ed` with its prior csproj/ClAddin/.vscode
  changes. These are read-only references.
- Fresh configured GitHub connector observations in
  `evidence/tray-catalog/remote-observations.json` match main/master; R1 has0remote
  refs/0PR. Candidate CI/review NOT_ESTABLISHED. R1 is45ahead/0behind cached
  origin/main before this metadata handoff, without upstream; cache is not live proof.

## 2. Actual R1 result to preserve

Owned5191 now contains **330trays,51selected types,2140selected cables**,
15material trays,14support rows/5supports,3curves/803points,6purpose report
mappings and6copied files/872680bytes. Six actual purposes are authoritative,
including their exact custom text. No raw purpose/name rows belong in Git.

R1 inserted1192records, enriched the50retained minimal type IDs and copied only
four previously NULL project drawing fields under full-row CAS:
support_distance/support_weight/tray_load_safety_factor/cable_layout_settings.
Identity/S/E/P/gap/timestamps and all2143target cables, including3unrelated,
were unchanged.45-table and original-source audits PASS;1026old model objects
unchanged,3project+3template objects added under new owned keys.

The first writer failed before writes and rolled back (JSONB scalar-null key
subtraction). The failed receipt, independent full rollback reconciliation and
real read-only SQLSTATE22023 control are retained. Corrected same-plan preflight,
copy, replay and read-only verification PASS. Do not rerun the data copy.

- Final R1 controls192/192PASS:
  `evidence/tray-catalog/final-controls-1792361864308.json`.
- Actual copy/replay/verify receipts end in `c4524e45`, `eb7c64dc`, `2672b4a9`;
  full paths/limits/hashes are in report36.
- Computer-use Trays/detail/3tools/active protected model PASS:
  `evidence/tray-catalog/computer-use-1792361908753.json`.
- Current model diagnostic snapshot is still **13objects**, not330captured routes.
 1527shared location names remain unconfirmed/missing. No bindings, real route
 calculations or engineering Apply were invented/performed.
- Pure material collation diagnostics remain NOT_VERIFIED; raw source/copy
 fidelity is separately proved. No native oracle or human acceptance is claimed.

## 3. Isolation and runtime

No push, PR, merge, deployment, original/5190 write/restart or shared volume use.
All original checkouts and `sources/` remain read-only. Root is the sole actual
runtime/SQL/HTTP/browser executor; agents have bounded nonoverlapping ownership.
Stage tests use own fixtures or rollback-only SQL with exactly owned resources.

The demonstration to retain/update is:

- runtime `pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`;
- owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`;
- Docker project `wfc-pathfinder-local-0cba87606e9b`, loopback5191;
- project `1af0f807-7653-40ea-8391-7eea6c54e7d4`;
- active model `a613151e-c370-45c5-80f3-42ae58603b9a`, fingerprint
  `b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34`.

R1 required no image changes. Before any R2 build/restart/migration, inspect
owner/path/IDs/images/labels/networks/mounts/ports and private runtime config.
Build/update only these owned API/web services. Existing R1/recovery binding pins
the old image hashes; an R2 image change needs an explicitly reviewed owned
profile/rebind, not weakened guards or changes to original containers.
Never generic-retire5191 (it is itself a restore), never use the5190default drill.
Preserve current data and source/copy/private proofs; take an owned pre-migration
backup or equivalent verified recovery checkpoint before runtime schema changes.

## 4. Normative contracts and behavior

Use R0 exact schemas/normalization/limits. Unknown or duplicate JSON members and
unknown versions refuse; do not normalize invalid uppercase UUIDs into acceptance.
Revisions are bounded BIGINT decimal **strings** (max9223372036854775807), never Number.
Decimals preserve PostgreSQL text/null/zero before the existing public tray mapper.

### Authoritative catalog

1. Read all current project Trays consistently. Public
   `pathfinder.project-tray-catalog.v1` has exactly the R0 envelope/row keys;
   dimensions are width/height/declaredLength decimal strings or null.
2. Keys use NFC+ECMAScript trim, case-sensitive, with no NFKC/casefold/internal
   whitespace merge or preset inference. Distinct raw purposes collapsing to one
   key and duplicate normalized names are explicit diagnostics. Missing/invalid
   values remain visible and block promotion; never truncate/select the first.
3. CatalogRevision and routingContentSha256 contain ONLY tray set/IDs/raw and
   normalized names/purposes plus routing identity diagnostics. Drawing dimensions,
   declared length, type/material/grounding/trefoil/layout and timestamps do not
   change this domain. ABA in separate transactions advances revision each time.
4. Full private source/dependency/normalized snapshot proofs are separate from PF
   dependencies. Persist exact canonical inputs; page all rows against one immutable
   snapshot and final count/hash. Bound100000rows/1000perpage/4096purposes, no truncation.
5. Preserve R1 retained original-copy digest as historical provenance. Current
   local mutable catalog facts need a separately versioned retained local-source
   projection; never label edited local rows as original frozen bytes. Do not bake
   private business rows into images or expose private proofs through policy API.
6. Split drawingInputRevision and full-copy hashes from routingRevision. Cover
   tray create/PATCH/delete/Excel import/project clearing and direct SQL via DB
   triggers. Timestamp/change_log-only edits do not bump routing revision. Changes
   to supporting drawing facts may conservatively invalidate drawing, never PF.

### Routing policy, history and concurrency

7. Admin GET/PUT `/api/projects/:projectId/pathfinder/routing-permissions` and
   catalog/history reads use exact R0 schemas. Rules have purposeKey and canonical
   ordered subsets of MV/LV/Control. Instrumentation follows Control; Power/VFD
   remain drawing categories and are not new routing checkboxes.
8. Missing purpose/rule is **Unconfigured**; explicit empty set is **Excluded**;
   reset removes a rule. Unknown/detached/colliding purpose keys refuse authoring.
   Rename/removal/re-addition cannot silently transfer/revive old permissions.
   Do not infer EMC or configure real engineering permissions without evidence.
9. PUT has expectedCatalogRevision/expectedRevision/idempotencyKey/changes.
   In one locked transaction: current actor/login/admin/project authority first;
   then same-key exact historical replay before new-command CAS; conflicting key
   payload409; new-key stale expectation409; successful logical Save increments
   routingPolicyRevision once and appends one before/after actor/login/time event
   and receipt. Concurrent duplicates cannot double-increment/audit.
10. Read history within explicit bounds. Unauthorized errors use exact policy
   error schema/currentRevisions:null, including middleware failures. Replayed
   historical receipts do not establish current revision; UI refreshes afterward.

### Admin UI and computation fence

11. New English card **Path Finder routing permissions** in Project→Details:
   actual purpose, tray count, MV/LV/Control checkboxes, Unconfigured/Excluded,
   reset/save/refresh, busy/error/history/conflict states. Preserve report-template
   mappings and layout settings. Do not reuse DetailsTab's current isAdmin={canEdit}:
   pass a separate strict Boolean(user?.isAdmin). Engineers cannot read/author policy.
12. Bind requests to current token/project/loaded identity; abort/discard stale
   responses and dirty state on context switch. Protect against lost response,
   duplicate receipts, concurrent Save and user refresh; no silent last-write wins.
13. Existing artifacts have **no catalog/policy scope**. Adding latest tokens to
   an old geometry artifact does not update its masks. Until R3 produces a matching
   scoped artifact, fail closed for dependent calculations/reuse/Apply and explain
   preparation is required. Keep protected visual diagnostic lookup available.
14. Version server dependency wrappers explicitly and bind only routing catalog/
   policy tokens. Keep exact C# request DTO/math/guards/lookup and tests untouched;
   worker.ts constructs that DTO explicitly. No spreading policy metadata into it.
   geometryHash currently hashes most dependency fields, so exclude full snapshot,
   source/copy/drawing digests **transitively**, not just at one outer field.
   Old proposals cannot Apply after relevant routing changes; drawing-only changes
   leave PF hashes/results untouched. Hold current auth/dependency locks to commit.

## 5. Source-backed implementation map and coordination

Suggested three bounded workers; agree exported contracts before parallel edits:

- A: new shared strict contracts/normalization + server catalog/policy schema,
  revision triggers/immutable proofs/tests. Exports readCatalog(client,projectId)
  and routing-only readRoutingCatalogScope. Reserve drawing domain for R2a without
  implementing its UI/packing now.
- B: new purpose-policy repository/routes/dependency helper/tests. Exports
  readRoutingPolicyScope with catalogRevision/routingContentSha256/
  routingPolicyRevision/policy hash only. Exact admin/current-login/transaction
  order, historical replay and calculation admission fence.
- C: new strict API/hook/Details card/tests. Shared contract from A; current
  user.isAdmin and token/project fences. No server/runtime operations.
- Root is designated writer for shared app/router/schema/Details integration
  unless explicit nonoverlapping ownership is agreed; serialize dependencies.

Relevant existing files:
`server/pathfinder/schema.ts`, `auth.ts`, `dependencies.ts`, `jobContracts.ts`,
`worker.ts`, `previews.ts`, `apply.ts`, `server/routes/pathfinderRoutes.ts`,
`traysRoutes.ts`, `projectsRoutes.ts`, `server/app.ts`,
`src/api/pathfinder.ts`, `src/pages/ProjectDetails.tsx`,
`src/pages/ProjectDetails/DetailsTab.tsx`.

`src/api/pathfinder.ts` has a fixed endpoint allowlist; explicitly extend it or
use the new strict policy API, never arbitrary paths. Put a bounded1MiB policy
raw/duplicate-member parser before generic express.json (currently100KB).
Reference duplicate-safe parsers in engineSession.ts and vendored lib/json.mjs;
JSON.parse-first loses duplicate/escaped-duplicate keys. Current generic auth
middleware error bodies need deliberate policy-route adaptation.

## 6. Checks, delivery and immediate continuation

- Pure contracts: versions/unknown+duplicate keys/UUID/revision overflow/limits,
  raw normalization collisions/null/zero/precision, category order/empty/reset.
- Actual isolated rollback SQL: tray create/edit/import/delete/clear/direct SQL,
  ABA/rollback, drawing-only split, history and one monotonic increment.
- Actual HTTP/transaction: strict admin versus engineer/outsider, role revocation,
  logout/expiry, project deletion, stale CAS, concurrent Save/duplicate key,
  historical replay after intervening catalog/policy changes, changed payload.
- PF gates: old/missing/mismatched artifact scope refuses; old proposal stale;
  source/drawing/full-snapshot change cannot affect routing/geometry hashes;
  protected lookup remains available. No real engineering Apply.
- UI: actual six-purpose card on330trays, English states, save/reload/reset,
  conflict/idempotency refresh, token/project switch and strict-admin visibility.
  Real permissions remain unconfigured unless explicitly justified; exercise
  mutations with owned synthetic/rollback fixtures and restore any deliberate demo
  test settings. Do not invent real engineering masks or location bindings.
- Run scoped Vitest suites, `npm run typecheck`, applicable build and root-owned
  isolated integration. Use computer-use for UI and retain private screenshots;
  public evidence contains counts/hashes/statuses, never secrets/business rows.

Record exact code revision/images, PASS/FAIL/BLOCKED/NOT_RUN, limitations and changed
files in a new R2 report/progress. Separate implemented/verified from human accepted.
Clean only proven owned unnecessary fixtures; retain5191and needed archives/proofs.
Seven denied scratch children/parents and the documented empty ACL Temp residue
must not be retried, pruned or bypassed.

After technical completion/review, make a local commit, apply prepare-stage-handoff
again with real local/remote evidence, save detailed **PF-R2a drawing positioning**
prompt and execute it immediately on its inherited branch. Continue R3–R10 afterward.
No routine pause, no publication/merge/deployment authorization is added.
