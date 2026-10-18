# PF-8 continuation — fresh isolated UI data-preservation investigation

Prepared through prepare-stage-handoff after coverage delivery
7aedfe0b0b14b38ba58bc20ef40599403d4114c6. Execute now under the user's automatic
stage-loop authorization. This closes a concrete remaining proof gap, not a new
feature, a PF-9 or an engineering acceptance decision.

## Baseline and boundaries

- Work only in `C:/Users/todor.chankov/source/WFC-pathfinder-local`, new branch
  `pf-8-ui-preservation-local-20261018`, inheriting7aedfe0. Tracked tree initially
  clean; denied inherited roots remain. Inspect live status/agents; preserve
  concurrent changes. No push/PR/merge/deployment/original app or DB writes.
- [Report25](../25-private-worker-reuse.md): worker delivery25e49401 has scoped
  runner/transport/lifecycle/job/browser checks. Final disposable5191 post-UI
  comparison reported a mismatch, then lost its detailed object before erroneous
  retirement. Historical status remains FAIL_NOT_RETAINED regardless of this run.
  Do not recreate/relabel the lost result. This stage produces NEW evidence.
- [Report26](../26-retained-model-coverage.md):43controls and actual214part/
  438155object/664556fragment retained audit PASS at scoped coverage,52selected
  objects/26LV+Control leaves/all99fragments/10chosen root subtrees. Whole plant
  geometry/equipment/category coverage, native visibility and engineering
  acceptance are not proved. Graph remains per query; no Core optimization here.
- Existing own5190 APIee402f8d/web1895a3fa/defaultoneshot and all18baselinecontainers
  stay unchanged. Original WFCmain e1ef2020, canonicalPF45c24bf5 and dirtyoldPF
  remain reference-only. Synced sources/Core11/Model/frozenPF0 stay unchanged.
- Configured read-only GitHub observed at2026-10-18T14:04:33Z: WFCmain still
  e1ef20202598bb4d3d78e4772cbbb9747ec23a00; current coveragebranch PRlist empty.
  CanonicalPFmaster live45c24bf5 at13:43. Base7aedfe0 is29ahead/0behind cachedmain,
  separately from live observations. No remote candidate CI/review established.

## Hypothesis and accepted semantics

Source inspection only, not a diagnosis of the lost observation:
`src/pages/ProjectDetails/PathFinderResults.tsx:25` automatically submits a
calculation when ready state loads; PathFinderTab keeps Results mounted even
when another tool is shown. `server/pathfinder/jobs.ts:57` deduplicates within
the same actor/login. A new browser login may create an automatic cable job and
proposal. Worker also has an automatic scan. The user explicitly requires
automatic calculation into proposals; proposal creation is not Apply.

Measure before browser mount, after automatic work settles, then after one
standalone Path calculation/Clear. Do not assert blanket12-group equality across
an authorized automatic-calculation UI visit. Every change still needs exact
observed provenance, current authority/dependencies and documented semantics.
Cable routing/design/install/write revisions, settings, active selection,
registry/locations/bindings/model data and Review/Apply must not change from
these browser actions. Existing proposal immutable inputs/results stay intact;
any supported state transition needs its exact causal trace. Unexplained changes
fail the gate and require investigation while the target still exists.

## Ownership and execution

Runtime writer owns only new `scripts/pathfinder-ui-preservation/**` audit/tools/
focused controls/README and its new machine evidence under `evidence/ui-preservation/`,
plus coordinated fresh target lifecycle. Parent owns report27/progress/matrix/
handoffs and browser actions through computer-use. Independent review is read-only.
Writers are not alone; preserve others' changes and coordinate shared interfaces.
Do not change application source without an actual reproduced bug and parent
coordination. Existing runtime restore/build/start/ownership/retirement helpers
already suffice; do not widen or alter them merely for this stage.

1. Verify retained archive3db9fa33-c10e-4646-82bc-fe99f3d8af35 at
   `pathfinder-engine/.scratch/path-lookup-archive-462d5a9465e8`, preserving private
   companion separately. Use existing direct `runtime.mjs restore` to a fresh own
   localhost5191 target, fresh database/storage/volumes/credentials. Build current
   frozen production source for that target, start session mode explicitly, bind
   source/image/container/DLL/mode identities. Never run a drill which coldbacks-up
   or restarts5190. Do not copy/reveal secrets or call Autodesk/native services.
2. Add a bounded read-only audit with the exact ordered12queries from
   `server/pathfinder/lookupAudit.ts`, one repeatable-read read-only transaction,
   exact serialization/canonical hashes. Persist full relevant rows privately and
   publish compact hashes/counts/diffs, excluding authentication data. Also retain
   bounded job/item/preview/matching/event metadata needed for causal attribution;
   never export users/login/JWT/password/session data. Snapshot all evidence to
   exclusive paths and verify its written hashes BEFORE testing assertions.
3. **A0** before browser login/UI; **A1** after normal Path Finder mounting and
   automatic work settles; **A2** after one standalone Calculate; **A3** after Clear.
   Capture observations at boundaries; avoid pretending an exact Core instruction
   was observed. Root uses an owned browser tab, ordinary UI and no direct
   NOP_VIEWER/evaluation/API injection as a product interface.
4. Real QA project105913f0-7ee4-45f2-bfd8-2c01f9be9f2a, active model925c0fc0-6e36-4d47-b1ce-38b0beff5953,
   names=PF-DEMO-NETWORK-START/END,Control,Details gap1/SECONDARY3/end5/%10.
   Expected existing selected-network result35.30345579516123m/design45,4gaps/
   0.9840583861033791m, filledGhost/originalcolors/yellow/Clear. Do not Review/Apply,
   edit settings/locations/cables, import fixtures or seed new cables for this run.
5. Save full before/after and structured row/column differences BEFORE any
   assertion. Attribute additions to exact current automatic calculate or preview
   jobs, observed actor/login identity fingerprint (never token), engine/model/
   Details snapshots and requested cable IDs. Existing proposal result/dependency
   content cannot change silently. Separate expected automatic proposal additions
   from preview-only records and forbidden review/apply/business edits.
6. On mismatch, keep owned target available for bounded read-only diagnosis;
   do not unconditionally retire from finally. Retirement is allowed only after
   complete evidence and a durable parent disposition. Preserve failed receipts;
   if a code bug is proved, coordinate a minimal scoped patch, actual verification
   and honest new attempt instead of relabelling failed results.

## Validation and delivery

- Meaningful focused audit/diff safety controls (ordering/NULLs/add/change/delete,
  allowed additions and provenance failures, exclusive failure receipts, wrong
  target/ownership/precondition refusal, no cleanup before disposition). No broad
  regression reruns absent a production code change. No new10minute/64crash/native
  qualification or primary coldbackup is required.
- Actual A0/A1/A2/A3 comparison plus ordinary UI screenshot evidence with current
  exact image/source identities, saved noReview/noApply/cable preservation proof
  and causally bounded expected changes. Unknowns stay explicit. This investigation
  does not authorize engineering acceptance or activate session mode on5190.
- Report `docs/pathfinder/27-ui-data-preservation.md`, compact machine receipts,
  append matrix/progress, local commit. After successful bounded investigation,
  apply prepare-stage-handoff to actual remaining scope and continue useful
  independent authorized work. Human engineering acceptance/main integration
  remain the user's separate decisions.
- Original5190/all18baseline preservation audit remains read-only; unchanged
  baseline identities/images/start times and workflow counts/hashes required.
  Target is disposable; retain exact qualified module/evidence before cleanup.

## Cleanup

Only new verified owned target resources/unreferenced candidate images may be
removed after evidence and disposition. No general prune. Preserve5190/archive,
evidence, required inputs and exact artifacts. Seven denied scratch children and
their parents remain untouched/no retry/no bypass: the six in prior handoff plus
`pathfinder-engine/.scratch/coverage-controls-14b7cdcb-10cb-4ad5-a8d4-a1962a8f0ea7`
(406bytes, automatic approval review blocked by policy). The proposed cleanup
result for that child does not exist. Maintain this restriction in recovery.
