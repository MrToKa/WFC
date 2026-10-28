# PF-U2 — persistent cable endpoint selection and shared binding

Execute immediately after the verified U1 delivery. The user explicitly
authorized sequential implementation; no routine approval is needed.

## Goal and inherited baseline

Work only in `C:/Users/todor.chankov/source/WFC-pathfinder-local`. Read live Git,
agents and automation-progress before work. U0 source delivery72df1d5 and handoff
5f0119a are committed. U1 delivery is
`610da52d2bd2a437ebc872a4dfe5af4f44fe557b` on
`pf-u1-cable-diagnostics-local-20261020`:21source files;212/212checks11files
(206synthetic+6actual PG16read/auth/cursor/metadata slice with engineering adapters
explicitly mocked), final types/lint/diff PASS. Read report62 and
evidence/cable-workflow/u1-actual.json/u1-tests.json. Fresh SQL fixture owner
cbc1a2b3 was retired and its generated credentials removed. No5191runtime update.
Create inherited `pf-u2-cable-endpoint-selection-local-20261020`. Preserve parallel and
preexisting changes, including .pf0-work/.pf2-work. Original WFC main96e63f13,
old PathFinder/canonical checkout and sources/ are read-only. Original main was
observed clean96e63f13; isolated parent was97ahead/3behind its cached origin/main
before U1 delivery (now98ahead), live remote/CI NOT_RUN. No push/PR/merge/deployment/
original/5190 changes. Root is the only actual runtime/SQL/HTTP executor.

Deliver the safe reusable selection/shared-binding foundation for the U5
persistent cable popup. A selected current model object can be assigned to the
exact cable's From or To logical location; all occurrences of that shared name
and aliases then use the same binding. Do not bind one cable privately or rename
the logical endpoint to the selected object's arbitrary display name.

Accepted policy: skip MV; Instrumentation uses Control. Recalculation and initial
fill are U3/U4, never implicit in U2. Initial fill eventually requires BOTH current
fields empty (routing NULL/whitespace and designLength NULL); existing or partial
values require explicit comparison/review. Never write a fake human approval.
Direct SECONDARY U6 is D<F OR D<T with exact3D+E thenP+ceiling, no S/gap/maximum.

## Existing source anchors and remaining gaps

- `server/pathfinder/endpointBindingRepository.ts`: current scope reader,
  immutable object validator, transactional confirm/alias uniqueness/idempotency,
  object-derived server-computed bottom-AABB anchor and fixed-world points.
  `object-attached` remains unsupported without qualified attachment evidence.
- `shared/pathfinderEndpointBindings.ts`: location normalization is NFC/trim/
  uppercase while preserving punctuation/leading zeroes, exact scope/object refs,
  optimistic registry/location/head revisions and write command/receipt shapes.
- `server/pathfinder/geometryTraceRepository.ts`: object/detail currently uses
  immutable revision UUID. There is no exact current SDK dbId lookup. Do not page
  only the first25/100 objects and conclude a selection does not exist.
- `PathFinderPreview.tsx`: protected readSelection already enforces one current
  object and canonical point guards. Use the protected bridge, never NOP_VIEWER.
- `hooks/useEndpointBinding.ts`: currently pending commands live in a ref and can
  be lost on unmount; cosmetic contextKey changes can reset state. Fix ownership
  deliberately without changing the old Routing Viewer hover panel lifecycle.
- `EndpointBindingPanel.tsx`: surface pick currently uses the displayed object
  page only; unknown picks can become fixed-world with no object provenance.
  New cable workflow must distinguish manual fixed points and retained evidence.

U1 exports createCableWorkflowRepository.page/detail and
cableWorkflowReadTransaction(pool,projectId,who,operation,signal): SELECT-only
bounded transaction, never use it for a write. Client exports
fetchPathFinderCableWorkflowPage/Detail, usePathFinderCableWorkflow with
readDetail and PathFinderNeedsRoutingList(onSelect(row)). UI access identity
includes account/project/model/preferences. Reuse these current ownership/read
interfaces rather than introducing duplicate diagnostics or whole-state polls.

## Implementation and ownership

Agree exact shared schema/API first. Separate backend writer (new bounded cable
endpoint context/selection adapter/routes/tests), frontend writer (owned editor
state/client/command recovery/tests), root (integration/docs/actual runtime only).
Other agents share the tree: preserve edits and coordinate shared interfaces.
No agent executes actual SQL/HTTP/Docker. Do not silently expand into engine/U3.

1. Add bounded exact cable/end context resolving the current normalized endpoint
   name and unique project location/aliases. A new location and binding are one
   atomic command if no shared location exists. For an empty endpoint name, show
   the precise action to set its logical From/To name in Cable list first; do not
   invent a name or silently change cable endpoint fields in this binding stage.
   Ambiguous alias matches fail with a clear reason.
2. Add exact current SDK object selection lookup, constrained by project,
   modelVersionId/selectionRevision/fingerprint/current aggregate/trace and dbId.
   Bound the SQL candidate count (reject duplicates), object bytes, response and
   deadline. Validate immutable record hash, current frame/geometry identity,
   object role, equipment anchor and server-derived bottom point. A same UUID in
   another project/model or stale trace is never accepted.
3. For an unretained selected object, use a genuinely verified bounded capture
   path if available; otherwise report evidence unavailable and offer a clearly
   labelled fixed-world manual point using existing admin-authorized semantics.
   Do not promote the SDK-reported bounding box into trusted retained geometry,
   claim that a fixed point follows an object revision, or fabricate capture proof.
   Preserve a display-only selected SDK ID separately if needed for foreground.
4. Save against the exact cable/end/logical-name/revision and selected model
   context. Server derives the shared location identity and validates aliases;
   expected location/head/registry prevents lost updates. Reuse the existing
   atomic binding writer or refactor a narrow same-transaction helper; never
   invoke a second transaction inside a locked project transaction.
5. Store/retain uncertain commands under account+project+logical endpoint ownership
   outside component lifetime without persisting tokens/secrets. Replay only the
   exact idempotency key/body after normal authentication. Closing/collapsing the
   popup, iframe focus or changing cable must not silently discard an unknown
   outcome. Logout/account changes hide data immediately and cannot replay across
   principals. Abort is not proof a mutation failed; reconcile unknown outcomes.
6. Return honest usage counts/affected cable IDs or a bounded impact reference for
   U3. Matching must include both ends/all cables/aliases, deduplicate a cable whose
   two ends share the location, and preserve the old alias meaning until commit.
   Do not start a whole-project calculation or invoke Review/Apply in U2.

## Validation and result

Synthetic tests: object beyond firstpage; exact SDK identity vs stale/foreign/
ambiguous/repeated object; finite/units/frame/hash guards; unavailable retained
geometry vs explicit fixed-world fallback; selectedlogicalname unchanged;
new/known/alias endpoints;20cables sharing the location across From/To; concurrent
edit/revision conflicts; duplicate command/response loss/reload; role/login expiry
and revocation through commit; no engine/cable length write and no NOP_VIEWER.
UI tests check owner state and late selection responses; they do not prove actual
iframe focus/Model Browser behavior. Reserve real computer-use for U7 when site
permission allows it; do not bypass a saved browser refusal.

Run scoped tests, types/lint/diff and independent source review on final bytes.
Record exact revision/hash/scope/PASS/FAIL/BLOCKED/NOT_RUN and limitations, including
the unresolved visual check. Commit locally, update progress and prepare the
self-contained U3 per-cable currentness/targeted recalculation prompt through
prepare-stage-handoff, then execute immediately under existing authorization.
Preparer stays paused; preserve own5191/demo/models/backups/evidence and denied
scratch paths. No runtime upgrade before the later integrated verification gate.
