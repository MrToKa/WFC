# PF-2 continuation — retained model coverage audit

Prepared with prepare-stage-handoff after worker delivery25e49401a7eca4117bbb261208be00bc92a7b36a.
Execute now under the user's standing automatic continuation authorization. This
is an independent remaining PF-2 completeness investigation, not a new PF-9 or
an assumption that the previous stage's unresolved observation passed.

## Baseline and authority

- Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, new inheriting
  branch `pf-2-coverage-local-20261018`, base25e49401. Tracked tree clean before
  this handoff; inherited denied untracked roots remain. Inspect live Git and
  active agents first, preserve others' changes. No push/PR/merge/deployment.
- [Report25](../25-private-worker-reuse.md): exact worker implementation and
  bounded checks complete, but final disposable-target post-UI workflow check
  FAIL_NOT_RETAINED after an audit/retirement sequencing mistake. Do not replay
  or relabel it as PASS. Existing5190/defaultone-shot and originals unchanged;
  final primary12preservation and original5-group isolation PASS separately.
- [Remote observation](../evidence/worker-reuse/remote-observation-20261018T1343Z.json)
  uses configured GitHub read-only connector: WFCmain e1ef20202598bb4d3d78e4772cbbb9747ec23a00,
  canonicalPFmaster45c24bf5f433f13e102600b36f20327c77961d0a; candidatePRlist empty.
  Cachedmain baselineed077 was26ahead/0behind; base25e494 is27ahead/0behind.
  No candidate remote CI/review/acceptance is established.
- Read applicable instructions,00-specification,00-validation-matrix,
  00-stage-report,00-parity-fixtures,20manual-review decision,22/23tabs,24/25reports
  and progress. Native oracle is NOT_PERFORMED/NOT_REQUIRED_BY_USER; human
  engineering review remains separate. No original DB queries or entitlement
  retries. Originals/sources/Core11/Model/PF0 fixtures remain read-only.

## Inputs and scope

Use only retained, non-secret copied files; no server or new container is needed:

1. `pathfinder-engine/.scratch/pf2-converted/captures/inventory-1792271145372-receipt.json`,
   SHA256ade029bcbe1b764ff7257017d6633ab90f9e4be4a560a5217e1c3fad708d1986,
   with214declared parts. Receipt declares438155objects,664556fragments/
   associations,438156externalIdentityObjectCount. Verify actual parts rather
   than carrying declarations forward. Inventory complete is not geometry or
   property completeness; native visibility/source linkage remain unproved.
2. `.scratch/pf-capacity-7b1ce2e8-46a6-45ad-bf6e-dfcee51a1e20/input/snapshots/75c61dc7-d456-45b0-9052-2a0822240350.json`
   under `pathfinder-engine/`, SHA256b47365401aaf078374607c944e22ac5100f2aa6fe4389c056fbdd963526f17ed.
   Current selected52objects/26routing leaves, zeroequipment-roleobjects.
   Snapshot identity project105913f0-7ee4-45f2-bfd8-2c01f9be9f2a,
   model925c0fc0-6e36-4d47-b1ce-38b0beff5953,
   contentb5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34.
3. `pathfinder-engine/.scratch/session-coverage-metadata-a9fb410e-504c-4679-b359-b9171fa5501f/metadata.json`,
   SHA25685af065d0f31943f6cc1e0fecbb1eebca7f97f50a96c2f99a47b17fc6017648b.
   Schema pathfinder.coverage.retained-metadata.v1;3QA cables,6locations,7aliases,
   6bindings,2entries under singular `selection`. Provenance
   [copy receipt](../evidence/session/coverage-metadata-copy-1792329239891.json).
   No representative business cable list is established. Syntheticproject54cf...
   must not be matched against the real inventory. The copy omits live artifact
   purpose/status and matching rows; do not infer every live stale/ambiguity gate.

## Implementation direction and ownership

Create one bounded retained-file audit CLI plus meaningful integrity controls in
`scripts/pathfinder-coverage/`; a designated writer owns these files. Parent owns
report26, appended matrix/progress/evidence and handoffs. Review can be parallel
read-only. Writers are not alone: preserve all peer changes and coordinate shared
interface changes before editing. No application/schema/UI changes in this scope.

- Validate exact receipt/part bytes and hashes, safe paths/no symlinks/escapes,
  schemas, identity, bounded counts/size/depth and sequential offsets. Read parts
  incrementally, retaining only required structural indexes, not full geometry.
- Audit unique IDs/dbIds, complete parents, root/cycle/depth, declared child-count
  agreement, fragment ranges/duplicates/association totals, external-ID/name
  duplicates as diagnostics. Report exact root/submodel composition and unknowns.
  Reconcile438155inventoryobjects versus438156external-identity declaration only
  if evidence supports it; otherwise preserve the difference as unexplained.
- Join current snapshot objects/parents/names/externalIDs/fragments/route boundaries
  against same-content inventory. Quantify selected versus retained hierarchy and
  each selected root's descendants without treating all model objects as trays.
  Explicit categoryAssignmentSource/allowedCategories/planningExcluded fields
  establish selected scope; names alone do not establish eligibility/categories.
- Units/transforms: snapshot vertices already canonical-world-metres. Verify
  declarations/finite matrices/identity consistency, never apply offset twice or
  call internal consistency native proof. Inventory has no meshes/bounds/properties
  for equipment computation; do not fabricate endpoints from names/fragments.
- Endpoint audit: normalization NFC→trim→uppercase, punctuation/zeroes preserved.
  Fence aliases/locations/bindings by project, selectedmodel/content and finite
  world-metre points. Distinguish raw model-name candidates, valid recorded manual
  bindings, stale/unknown bindings and insufficient data. Shared cable automatic
  matching considers visible role`object`; standalone Path also allows a unique
  nonhidden routing leaf. Do not conflate these contracts or overwrite bindings.
  Name-only miss does not prove property-alias miss; manual bindings can resolve
  endpoints absent as model names. Report all actually supplied3QA cables only.
- Keep existing4096selectedobject/64MiB capture and computational limits unchanged.
  Bigger retained metadata traversal does not authorize bigger product capture.
  Do not change active planning roots, assign unknown categories or Apply results.

## Acceptance and reporting

- Actual complete214part integrity/hierarchy/fragment audit with checked revision,
  source/input hashes and exact PASS/FAIL/BLOCKED/NOT_RUN per criterion. Any failed
  gate writes its detailed result before throwing; never delete inputs/evidence
  before a required observation is durably recorded.
- Meaningful malformed/hash/path/offset/duplicate/orphan/cycle/childcount/fragment/
  crossproject/manual-binding controls; use own new scratch, not frozenPF0 data.
  No tests that merely restate implementation; reuse production normalization
  semantics explicitly, no second guessed algorithm presented as production.
- A compact report `docs/pathfinder/26-retained-model-coverage.md`, machine receipt
  under `evidence/coverage/`, reproducible CLI/readme and matrix/progress update.
  Preserve retained large private inputs in ignored storage; don't commit model
  inventory, registry copy, secrets or bulk dumps. Record exact unmet prerequisites.
- Commit locally, prepare next handoff from demonstrated remaining scope, execute
  useful independent work. True globally prepared graph remains NOT_IMPLEMENTED:
  pinned RouteCalculator adds query projections before contacts and uses those
  nodes for parallel attachments. Worker/fitted geometry reuse does not close it.
  A topology/query-overlay change requires separately reconciled contract/parity;
  never add an unused graph artifact or silently fork the pinned Core.
- Stop only dependent work needing unavailable facts/user engineering decisions;
  continue other authorized work. No blanket fullplant, business endpoint or
  engineering acceptance PASS. Existing5190 and all18baselinecontainers stay
  unchanged. No new GUI change means no new GUI check is required for this audit.

## Cleanup

No Docker resources needed. Clean only new verified owned unnecessary scratch;
preserve inputs/results. The six denied children named in progress/current prior
handoff, and their parents, stay untouched. Never retry/bypass blocked deletion,
run general Docker prune, or delete a proof before recording its failed detail.
