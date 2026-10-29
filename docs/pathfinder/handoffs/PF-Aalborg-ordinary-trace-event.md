# Aalborg — atomic ordinary trace publication event

**READY; execute under the user's existing autonomous continuation authority.**
Use prepare-stage-handoff for the next justified stage only after this technical
delivery. Do not restart completed PF0–PF8/PF-R0–R10 work.

## Goal and inspected baseline

Implement audit51§9.2: a genuinely new ordinary current healthy geometry trace
publication must mark the geometry recalculation generation exactly once in the
same final transaction. It must not enable authority or Apply. Preserve grant
emission ownership and every replay/integrity/current-role fence.

Worktree C:/Users/todor.chankov/source/WFC-pathfinder-local. Create a new inherited
local branch after the availability delivery/checkpoint commit. At09:40UTC,
branchpf-aalborg-endpoint-availability-local-20261020 HEAD
8407e52c815db636cccff2cd46a1efce561df6cf,81ahead/3behind cachedorigin/main;
runtime receipt/report/handoff changes are pending this checkpoint. Historical
.pf0-work/.pf2-work remain untouched. Read liveHEAD/status/progress before edits.

GitHub connector at09:40UTC: WFCmain96e63f13fdc2b1d30b8f8ff658dd662f25fac104,
PathFindermaster45c24bf5f433f13e102600b36f20327c77961d0a. OriginalWFC cleanmain96e63,
canonicalreview-pathfinder cleanmaster45c24, cachedrefs0/0. OldPFmaster35f4fb46 has
preservedAddinRibbon.csproj/ClAddin.cs/.vscodechanges; cached0/0 is not live45parity.
Connector search found no open PR for the local availability branch; no remoteCI
acceptance of this local feature is established. No push/PR/merge/pull/deployment.

Availability source8407e52 is verified161tests/types/lint/serverbuild and normal
owned runtime/UI. Report53 and evidence/aalborg-availability/runtime1.json carry
exact proof. Calculation identity remains
4b9fac7d2b045a230c5cbf7ce4aeaea08917a20b3605ee15642a5effff8a74fd.

## Scope and boundaries

- **Skip MV.** Selected normal joba29cd4c2-2d86-4ee0-9cbb-5bc598552781 completed:
  1808nonMV,230calculated/1578locations_required,332MVexcluded. All230ledgers
  verified againstDetailsS7/E5/P10/gap1. All-category policy staysPAUSED(control7),
  grantdisabled. Never enable a policy or start all2140 for this test.
- Runtime5191 owner8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46,
  composewfc-pathfinder-local-0cba87606e9b,
  pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600,
  DBepoch69f3bee1-298b-48d1-8af9-3ecbea23d975,
  copiedproject1af0f807-7653-40ea-8391-7eea6c54e7d4. Current binding
  availability1-source-runtime.private.json in the privateb3c21429work; images in
  report53/progress. Check owner/path/project/ports/images before mutations.
- Preserve real aggregate6e21b230-188e-49b8-92a8-fd3f202a9567,
  artifact04782773-0701-4e60-b3af-d4e42b3f8288,
  trace3976df4c-a6a1-4001-bf08-faf7070c4977. Do not republish/retrace this actual
  model solely for tests. Keep filledGhost/originalcolors/yellowline/Clear,
  protectedbridge, Instrumentation→Control, strictadmin/currentrole and noApply.
- Originals/5190/sources/old/canonicalPF read-only; no restarts/datachanges there.
  No Navisworks licence/nativeoracle; user chose converted/manual review. No
  invented locations or acceptance. Denied scratch children/parents untouched;
  no retry/bypass/prune. Clean only proven own unneeded resources.
- Root sole actualruntime/SQL/HTTP/UI/test executor. One writer geometry trace
  repository/unit tests; one independent read-only reviewer; root integration
  fixture/scripts/docs/runtime. Preserve all other concurrent changes.

## Implementation

1. Inspect geometryTraceRepository.ts create/finaltransaction, audit51§9.2,
   geometryTraceRepository.test.ts, geometryTrace.integration.ts and existing
   grantPreparedMaintenance.ts/.test.ts. Reuse markRecalculationDirty from
   recalculationSchema.ts, domaingeometry/reasonGEOMETRY_TRACE_PUBLISHED,
   sourceRevisionmanifest.id+':'+manifest.contentSha256(101ASCIIbytes).
2. Only in the genuinely new final-publication branch, after trace/object/index/
   diagnostics inserts, completedintent and exactreceipt, check
   !isGrantPrincipal(who). Use a bounded same-client current pointer/selection/
   readyhealthy model read. Match aggregate/artifact/geometryrevision and
   model/selectionrevision/fingerprint against the frozen aggregate/manifest.
   Historical/mismatched publication remains inspectable but emits no current
   event. Do not collect all endpoints/cables for this check.
3. Emit once as the last SQL mutation before existing final cancellation/login
   checks and COMMIT. No generic trace trigger, no out-of-transaction emitter,
   no schema migration. Exactreceipt replay, completedderivation reuse,
   finaltransaction replay and outercommit-unknown reconciliation emit nothing.
   A rolled-back trace/receipt/event must roll back together.
4. Grant path skips this branch before any added current-scope read. Keep the
   managed grant trace→receiptcheckpoint→dirtytransaction→dirtyjournal→lease-
   release ordering in grantPreparedMaintenance.ts; it remains that path's sole
   emitter. Dirtyhelper is not deduplicating: every invocation advances generation.
5. Preserve auth, locks, resource limits, math, currentness, exactcommands,
   cancellation and unknown outcomes. GeometryTraceRepository is outside the
   calculation identity allowlist, but IS hashed into trace runtime derivation
   identity by geometryTraceEngine.ts. Preserve changed-runtime replay refusals;
   do not promise old create-command replay after the upgrade or retrace the same
   aggregate under an unchanged derivation label. Historical GET/list stays readable.

## Required verification and completion

- Focused tests: new currenthealthy ordinary publication oneevent, order/client;
  model/pointer/artifact/geometryrevision/selection/fingerprint/health mismatch
  zeroevent; grantnewpublication zeroordinaryevent; all replay branches zero;
  finalrole/login/cancel/rollback/commitunknown preserve exactlyonce durable effect.
  Existing managed grant maintenance tests retain onegrant-owned event and journal/
  lease behavior. Disabled/paused/expired authority is never renewed or enabled.
- Actual owned test database fixture must prove atomic trace/receipt/event commit
  and rollback, then lost-ack reconciliation/replay without a new generation.
  Use a fresh owned synthetic fixture; SQL-spy ordering alone is insufficient.
  Keep real5191Aalborgdata untouched. Exact fixture ownership, DB target, scope,
  bounds, cleanup and noApply must be recorded. Do not use5190/default olddrill.
- Run appropriate types/lint/build and independent review. If replacing own5191
  API/web, require quiescence/newbackup/positiveownership/outsidepreservation;
  compare actual calculation identity, existing trace reads, availability/current
  proposals, pausedpolicy/disabledgrant and final cablehash/zeroApply. Trace
  derivation identity changes intentionally; do not carry old producerqualification
  or grant authority silently. No real recapture or MV calculations for proof.
- Exactrevision/scope/PASS/FAIL/BLOCKED/NOT_RUN, localcommit, report/evidence only
  aggregated/nonsecret. Keep demo/neededbackups/private evidence. If only manual
  mappings/engineeringreview remain, state exact next actions and stop recurring
  retries via appautomation; otherwise prepare next useful handoff and execute.

Preparing this prompt is separate from implementation; the user's explicit prior
instruction authorizes immediate execution. No new permission for publication,
merge, realApply or engineering acceptance is granted.
