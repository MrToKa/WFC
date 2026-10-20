# PF-U6a — From/To Properties matching and hidden-object exclusion

READY; execute immediately under standing authorization. U6 delivery
`3572a95dc480319f912ab005035a0e38c037260a` on
`pf-u6-direct-secondary-local-20261020` passes1313checks (587TS/25files +726C#),
11canonical source byte checks, types/lint/diff. Report67/u6-actual.json and
u6-csharp-actual.json specify synthetic scope and exact hashes. Actual UI, real
converted-model direct calculation, SQL chain and5191upgrade remain NOT_RUN.
An ignored synthetic canonical-regression.log is being explicitly added with
this handoff; all other U6 sources frozen. Read actual live Git/agents/progress.

## Goal and decisions

The user explicitly added: automatic From/To matching searches object Properties
as well as Model tree names; hidden objects are ignored. Search own object name
and all readable scalar property values, not only Tag/Name/Location labels.
Keep exact NFC/case/one-leading-slash semantics, engineering punctuation and
ambiguity. Do not copy parent tags onto every child, invent missing locations,
silently choose the first duplicate or rewrite confirmed manual bindings.

Use a new `wfc.pf.project-exact-candidates.v3` contract. Historical v1/v2 bytes
remain historical; current automatic candidates require the new display-visible
evidence or an explicit prepare-again state. Do not treat SDK display visibility
as native visibility. `nativeHidden:null`/planning proof flags remain honest.
Hidden/off ancestors, fully hidden geometry and partial/unverifiable visibility
cannot authorize an automatic endpoint. Re-showing an object must re-evaluate
visibility despite cached property postings. Existing PF Ghost/isolation is
temporary appearance, not user-hidden/native-hidden evidence.

## Source map and implementation direction

- viewer-runtime/pathfinder.mjs316–415 builds cached equipment index from every
  SDK row;361–377 uses a small property-name allowlist and no display filter.
  model-capture.mjs235, matching.ts.objectMatchNames and
  automaticEndpointCandidates.ts153 repeat the allowlist. Centralize a bounded
  scalar-property extractor in equipment-names.mjs/.d.mts for all these paths.
  Exclude hidden/internal child/reference SDK metadata, not custom human labels.
- Protect capacity: indexing every property posting for438k SDKobjects can
  exhaust memory. Use bounded query-scoped matching or another demonstrated
  bounded exact approach, without truncating candidates into a false unique or
  claiming a complete scan after omitted rows. Existing bridge page24KiB limits
  remain; do not accidentally echo huge name arrays. Coordinate query packing,
  cache keys and complete-property evidence before implementation.
- model-capture.mjs158–179 already demonstrates ancestor hidden/off and fragment
  visibility for independent lookup. PF pathfinder captureGhost/clear/showPath
  at105/178/202 saves/restores baseline visibility. Read baseline safely or
  restore PF-owned temporary appearance before observation; do not classify the
  ghosted rest of the plant as hidden. Preserve rollback/error/ownership guards.
- Agree a visibility contract before parallel edits. Direction: a versioned
  discovery `visibilityScope` with SDK baseline basis and content hash, frozen
  into plan.requestedScope.endpointVisibility; capture must use the same scope.
  Per equipment snapshot object, a versioned equipmentEligibility proof binds
  new matching policy, scope hash, visible state and ancestor/fragment checks.
  Preserve it exactly in geometry trace historicalModel and validate on server.
  Optional fields stay absent in historical records. A changed visibility scope
  during preparation refuses/retries rather than publishing stale completeness.
- Scope relevant contracts: preparation-input.mjs/.d.mts, protected protocol/client
  discovery collector, shared/pathfinderPreparation.ts, server/contracts.ts,
  shared/pathfinderGeometryTrace.ts, geometryTraceBuilder, preparation planner/
  part validation/publisher and endpoint point policy schemas. C# Model Contracts
  and SnapshotReader need additive optional metadata validation; do not edit the
  eleven canonical Core Routing files. Include helpers in fixed engine identity
  derivation/copy-runtime closures where actually required.
- automaticEndpointCandidates currently counts frozen candidates BEFORE reading
  object visibility. New discovery/plan/proof closure must exclude hidden matches
  before unique/ambiguous classification, and server corroborates visible-only
  candidates/properties. Do not silently trust old unknown-only preparations.

## Ownership and boundaries

Create a new inherited local branch. Work only in WFC-pathfinder-local; original
WFC5180, old5190, old/canonical PathFinder and sources/ remain read only. No
push/PR/merge/deployment. Simplified Preparer stays PAUSED. Root is sole actual
SQL/HTTP/Docker/runtime executor; agents own nonoverlapping source/tests. Agree
shared field names before editing. Suggested split: shared/extractor+protocol/
bounded client collector; protected SDK discovery/capture+optional C# metadata;
server matching/preparation/proof/geometry contracts; root integration/docs/UI.
All writers preserve others' changes and coordinate shared boundaries.

No5191upgrade until U8 backup. Saved browser-origin refusal cannot be bypassed;
source/mock checks can proceed and real UI is honestly NOT_RUN/BLOCKED. Keep
historical denied scratch paths untouched; no prune. Keep U6 owned runner DLL.

## Validation and finish

Prove custom property value, own Model tree name, numeric/text scalars and exact
normalization; hidden/internal metadata ignored; visible duplicate ambiguous;
visible+hidden duplicate resolves visible; hidden parent/off/all-hidden fragments
excluded; partial/missing API fail closed; show-after-hide and cached freshness;
PF Ghost baseline respected; visibility mutation between pages/parts refused;
missing SDK rows/budget failures never false missing/complete; no history/hash
default insertion. New v3 proofs survive snapshot→C# read→trace→automatic candidate
and forged/wrong frame/model/scope/policy evidence refuses. Retain MV exclusion,
current admin, shared manual bindings and all U4/U5 write gates. Run relevant
Node Viewer, TS/schema/server tests, C# metadata tests, types/lint/diff. Record
timing/limits and distinguish source verification from real-model/UI acceptance.

Write report68/evidence/progress, local commit, then prepare-stage-handoff U7 and
execute immediately. U7 actual SQL chain must use genuine engine/snapshot/seal/
writer/live diagnostics, not reuse mocked admission/proof adapters as end-to-end
evidence. U7/U8 restore needs dynamic lossless ALL-public-table inventory; source
enumeration134tables is not live count. Historical27-table audit is incomplete;
keep source5191 and explicit retirement refusal, never old5190default drill.
