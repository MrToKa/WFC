# PF-B0–PF-B9 — Walls, floors, ceilings and real openings

## Goal and accepted decisions

Find physically unobstructed cable routes against explicitly registered objects
from the active converted model, including their actual openings. The reported
counterexample is cable `=H1=KF1=TAC1=WGA1`, whose approach went through a floor
to an unsuitable storey. Bounding boxes may accelerate a check; they must never
fill an opening or authorize free space. A selected parent retains its identity
and includes its own fragments plus all descendants, deduplicated.

The user confirmed on21October2026 that **Drill through the walls** applies to
all selected walls/floors/ceilings. It is off by default and is frozen for the
current calculation. On means explicit obstacle bypass, visibly identified in
results; it is not engineering acceptance. No global/per-project silent enable.
Background/scoped jobs must never borrow a previous enabled checkbox. Their
admission records exact policy explicitly; unattended new work defaults off.

Explicitly included barriers remain physical constraints when hidden/ghosted for
inspection. The earlier hidden-object exclusion for automatic From/To matching
remains separate. Rendering transparency/materials do not imply passability.

Keep current Project Details S/E/P/gap, Instrumentation→Control, non-MV user scope,
shared From/To reuse, bottom-centre anchors, exact length ledgers and rounding.
Existing cable values require comparison/human Review→Apply; automatic initial
fill remains possible only when both fields are empty AND new obstacle proof is
current. No overwrite or removal of existing values merely to introduce barriers.

## Inspected baseline and boundaries

Isolated worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, starting
`57d2694899c1e046cbe38037600df61fbbae21b1`; B0 branch
`pf-w0-barrier-contracts-local-20261021`. Only foreign `.pf0-work/`, `.pf2-work/`
untracked. Reports75–77 are delivered locally; their actual browser acceptance
remains NOT_RUN due unchanged saved origin refusal. No retry/native/CDP/alternate
browser/origin bypass. Independent implementation continues despite that gate.

Only owned5191 may be updated after verification/backups: owner
8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46, composewfc-pathfinder-local-0cba87606e9b,
runtimepathfinder-engine/.scratch/batched-capture-runtime-20261018-1600,
project1af0f807-7653-40ea-8391-7eea6c54e7d4. Original WFC5180,5190, original/canonical
PathFinder and synced sources stay read-only. No push/PR/merge. Root alone executes
runtime/SQL/HTTP and shared mutable tests. Agents own separate source modules.
Preserve refused paths, needed backups/rollback/demo; no global prune.

Original main was clean96e63f13; last live GitHub main observation matched at
2026-10-21T09:18:55.180Z. Recheck relevant source/remote state before each handoff;
cached ancestry is not live parity or CI. Preparer remains queued after the
current PF work and required real checks; it is not included in this plan.

## Source-backed design

- `RouteCalculator.cs` chooses one nearest/vertical tray projection and builds
  graph connections without obstacles. Its cost/tie model must be retained for
  remaining valid edges. The class is partial: add constrained support entry
  points without changing the eleven pinned Routing files or frozen fixtures.
- Direct SECONDARY currently uses the strict distance OR rule with no collision
  claim. Its existing decision schema cannot express “distance qualifies but the
  direct line is blocked”; introduce a versioned constrained decision.
- `TrayMeshClearance` is surface clearance with tray-specific clipping and does
  not handle all coplanar/containment cases. It is not a wall collision oracle.
- Current capture drops all non-route meshes. Add a separate immutable barrier
  artifact; do not silently add a role to old snapshot.v1/tray trace contracts.
- Pinned mesh extraction uses resident indexed triangles, binary64 fragment
  transforms and canonical metres exactly once. Nonresident, incomplete or
  over-budget capture cannot publish an empty successful barrier set.
- Dependencies v7, per-item applicability, initial fill, design reuse, previews,
  background grants and Apply contain explicit version lists. Extend them as a
  coherent migration. Missing new fields in historical hashes must not acquire
  defaults that change those immutable records.

## Execution stages and acceptance

### B0 — Contracts, fixtures, capacity and migration specification

1. Freeze separate barrier capture/snapshot/registry/policy/result contracts.
   Include project/model/content/selection/frame, selected parent identity,
   immutable revision/hash and completeness. Client actor/path/validity assertions
   are not authority. Define no configured scope, partial, ready, stale and invalid.
2. No barriers configured must not be presented as “walls checked.” With drilling
   off, obstacle-aware automatic admission requires a published complete selected
   scope; explicit no-barrier scope needs a recorded admin declaration. Completeness
   refers to selected objects, never the whole plant or hidden civil omissions.
3. Define numeric tolerance separately from physical cable clearance. Use known
   cable diameter when supporting clearance; unknown diameter must not become an
   invented physical clearance. Initially qualify centreline collision explicitly;
   any supported radius uses capsule/surface clearance, not inflated AABB holes.
4. Add synthetic solid wall, real rectangular through-opening, floor/opening,
   ceiling, transformed parent, nearest-but-blocked tray, graph-gap crossing,
   direct-secondary collision, contact/coplanar/containment/invalid data cases.
5. Fix limits for bytes/triangles/BVH nodes/work/time/memory/cancellation. Existing
   runner1MiB input and512MiB combined session limit require blob references and
   shared bounded cache, not inlining/rebuilding civil meshes for every cable.

Accept: strict contract tests and validation matrix PASS, implementation targets
and unsupported geometry states explicit. No runtime change or real acceptance.

### B1 — Independent triangle collision kernel

1. New pure `PathFinder.Barriers` library and console regression project, without
   Navisworks/Viewer/network/database dependencies or duplicate source compilation.
2. Whole-mesh BVH: AABB broad phase, actual triangle narrow phase, segment/capsule
   tests, reversed winding, edge/vertex/coplanar contact and closed-solid containment.
   An opening is empty only where the supplied mesh actually has no solid.
3. Qualify mesh topology/completeness; unsupported/nonfinite/degenerate/ambiguous
   evidence must return refusal/indeterminate, never a collision-free certificate.
   Do not fill holes to repair invalid input. Do not claim arbitrary mesh validity
   from a bbox or a few sample rays. Surface-only data needs explicit limitation.
4. Deterministic build/query, cancellation and bounded memory/work. Test at origin,
   translated/rotated coordinates, thin walls, repeated triangles and large bounds.

Accept: geometry regression, independent source review and measured bounded workload
PASS. Existing Core untouched. Synthetic geometry proof is not converted-model proof.

### B2 — Protected selected-barrier capture and immutable storage

1. Add bounded protected bridge commands and strict schemas/module closure; retain
   current admin/session/model/load authorization before and after async extraction,
   cancellation, replay and existing envelope/capability limits. No NOP_VIEWER API.
2. Capture complete unique selected parent/descendant fragments and original
   triangles, exact transforms/global offset/units. Preserve holes, source identity
   and capture evidence. Do not expand all plant geometry automatically.
3. Server-owned immutable blobs/quotas/verified paths/hash/fsync, capture intents,
   idempotent commands/receipts and atomic manifest publication. Failed partial
   capture does not replace current good scope. Cross-project/model references fail.
4. Binding to active model/frame is mandatory; selection/model revision changes
   retire old capture until recaptured/reconciled. Visual hiding does not delete it.

Accept: strict auth, cross-scope, cancellation, partial capture, topology, limits,
transforms, overlapping parent dedup and actual converted opening capture checks.
Real capture checks stay BLOCKED if legitimate browser/model access is unavailable;
independent backend/kernel work may continue, with no fake real PASS.

### B3 — Constrained approaches and tray graph

1. Add a constrained entry point in a new Core support partial file. Retain original
   calculator for explicit bypass and legacy parity; keep old cost/tie/length math.
2. Enumerate deterministic candidate endpoint projections and discard blocked
   approaches before selecting an accessible tray; do not stop at the Euclidean
   nearest tray or apply vertical preference through a floor.
3. Reject blocked internal tray polyline edges and cross-tray gap connectors before
   Dijkstra. Preserve distances/gap accounting for all remaining edges.
4. Check the entire exact resulting polyline independently before a success result.
   No route found, unverified geometry or bounded timeout is an explicit diagnostic.
5. Version direct SECONDARY decision: direct only when existing distance rule AND
   unobstructed segment qualify. Otherwise try valid tray routing. Drilling on
   records bypass; ordinary and direct formulas remain exactly as accepted.

Accept: solid wall/floor blocking, farther same-side tray, passable real opening,
blocked graph/internal segment/direct route, deterministic ties, original frozen
regression/parity on unconstrained branch and unchanged design ledger PASS.

### B4 — Approaches through offset openings and local detours

1. A straight visibility test alone cannot find every offset opening. Prototype a
   bounded deterministic local connector planner over actual free space/qualified
   portal or visibility waypoints, with explicit domain/resolution/work bounds.
2. Include passable opening candidates without declaring bbox space free. Any grid
   or sampling is only search guidance; exact triangle/capsule revalidation is
   required for every final connector segment.
3. Prefer existing accessible trays; do not invent new tray lengths or unseen holes.
   If bounds cannot resolve a narrow opening, report unsupported/no valid approach;
   never return a path crossing the solid or claim global optimality.
4. Path points and ledger include all detour distances and preserve SECONDARY
   replacement semantics. Do not shortcut a verified connector through a barrier.

Accept: offset opening reached, blocked tiny opening refused, two-storey floor case,
deterministic repeat, measured memory/time/cancellation and final collision guard.

### B5 — Administrator UI and explicit drilling

1. Add Barriers authoring section in Path Finder: Add selected wall/floor/ceiling,
   chosen parent name, capture/ready/stale/error status, counts, remove/recapture,
   model scope and preview highlighting. Use existing protected Model Browser.
2. Checkbox exactly **Drill through the walls**, initially off. Explain that it
   bypasses registered walls/floors/ceilings for this calculation. Freeze into the
   submitted request; toggling affects subsequent requests, not historical results.
3. Carry the choice consistently to standalone path, selected/batch cables and
   Save-triggered scoped jobs. Persisted impacts compare all preferences/scope;
   they cannot resume a previous drilling-enabled calculation under an off UI.
4. Show barrier-check status, ignored/bypassed status, blocking barrier identity and
   reason. Keep actual route/From/To/yellow line/filled Ghost behavior unchanged.

Accept: admin/deep-link/role-loss fencing, keyboard/form/draft behavior and UI tests.
No everyday need for terminal operations or duplicate original installation.

### B6 — Dependency versions, jobs, background work and caches

1. New versioned frozen dependency with exact server-owned barrier manifest/revision/
   hash/frame and drilling/collision policy. Preserve v7 endpoint resolution and
   per-cable applicability, supersession, cancellation and initial-fill contracts.
2. Update normal/preview/location-impact/grant/producer collectors, runner request,
   session/cache keys, geometryHash, design-only reuse and result/proposal parser.
   Obstacle changes require route recalculation, not allowance-only reuse.
3. Extend scheduler dirty-domain SQL/TS/reasons consistently; emit once per genuine
   published registry change in the same transaction, not per mesh triangle.
4. Include implementation/policy in engine identity and deliberately qualify its
   projection-file count limit. Old jobs/hashes remain readable and immutable.

Accept: browser-closed producer, wrong policy resume, changed barrier during job,
cache/restart/cancellation, design reuse refusal and per-item v8 equivalence tests.

### B7 — Review, Apply, initial fill and existing results

1. Historical collision-unaware proposals are marked unverified for obstacles and
   stay inspectable. They must not become newly applicable under the new policy.
2. Recollect current barrier/policy proof under current auth/dependency locks through
   commit for human Apply and automatic blank-field fill. New scope/checkbox/model
   changes after review refuse stale writes; idempotent receipt replay remains exact.
3. Recalculate affected existing cables as proposals and show old/new routing and
   length delta. Preserve installLength and the user's existing nonempty values.
4. User clarification, 21 October: the detached cable window itself must expose
   the exact old/new Routing and Design length comparison, Confirm review and
   Apply after selected-cable recalculation. Apply replaces both existing values
   atomically; clearing Cable list first is never required. Save continues to
   confirm shared From/To selections. Only both-blank fields may fill automatically.
   The popup delegates to the existing exact-proposal/pending-command controller;
   changing cable, calculation, inputs or policy cannot apply a previous result.

Accept: intervening barrier add/remove/model/drill changes, role loss, manual/import
revision changes and partial batch recovery refuse unsafe writes; exact receipts pass.
From the same cable popup, recalculate an already populated cable, inspect both
routes/lengths, confirm review and replace the pair with installLength unchanged.

### B7a — Server-owned Path Finder automatic length (21 October clarification)

1. Replace the cable's client-derived tray-list estimate under **Auto calculated
   length [m]** with the exact checked Path Finder design length. Update Auto as
   soon as a successful current calculation is persisted, independently of human
   Apply. Auto is read-only in forms, inline editing, API and imports; never copy a
   manually edited Design length or the old tray formula into it as PF evidence.
2. Keep **Design length [m]** manually editable. Existing or partially populated
   Routing/Design values require Review/Apply; preserve the separately reconfirmed
   both-blank Save-triggered automatic fill. Explicit Apply still writes the exact
   reviewed Routing/Design pair with installLength unchanged.
3. Use a bounded server read model tied to the exact verified result/seal, with
   source/currentness metadata and no viewer/model access for ordinary authorized
   cable readers. A failed, cancelled, old-policy or stale result cannot become a
   fresh Auto value; an older job must not overwrite a newer calculation choice.
   Preserve readable prior successful values honestly if a later attempt fails.
4. Test immediate Auto update before Apply, retained manual Design override,
   read-only enforcement, ordering/currentness/ownership and both-blank behavior.
   Do not run the legacy tray estimate as a fallback for missing PF evidence.

### B8 — Full qualification and actual Aalborg counterexample

1. Run geometry, strict contracts, protected bridge, C# legacy parity, routing,
   ledgers, jobs/security/Apply and meaningful existing UI regression.
2. Measure representative civil geometry and2140-cable workload in owned resources;
   no arbitrary larger limits or claim of full-model capacity from a tiny fixture.
3. Capture actual selected partitions/openings/floor from the active converted
   model; verify triangles/units/transforms and two sides of each opening. If the
   conversion closed an opening, report it and require corrected evidence; do not
   cut it from a screenshot or equate a dark rectangle with empty geometry.
4. Reproduce `=H1=KF1=TAC1=WGA1`; off must produce an unobstructed route on appropriate
   accessible geometry or explicit blocked reason. On must be visibly bypassed.
   Compare exact path segments against barriers; no automatic real-data Apply.

Accept: scope-specific PASS/FAIL/BLOCKED/NOT_RUN receipts; user engineering review
is separate. Never call synthetic/converted checks native parity or human acceptance.

### B9 — Local delivery, recovery and cleanup

1. Fresh verified owned5191 DB/model/PF backup and private companion before schema/
   API/engine update; exact images/owner/paths/ports, restore/rollback checks and
   engine identity. Keep the original5180/5190 installation untouched.
2. Deploy only verified stages together; unfinished dependencies cannot expose an
   unchecked “walls protected” checkbox or authorize existing unsafe proposals.
3. Computer-use demo where legitimately available, browser instructions, actual
   check report and retained archives. Clean only new proved-owned unnecessary
   fixtures/processes; keep demonstration, backups and refused paths.

## Automatic execution and stop rules

After each completed stage: record evidence/revision/limitations, make a local
commit, use prepare-stage-handoff, write PF-BN under docs/pathfinder/handoffs and
execute the next authorized stage immediately on an inherited local branch.
Maintain automation-progress and independent file ownership. Do not restart prior
PF-0–PF-8 or PF-R stages. Genuine external access/real-geometry blockers stop only
dependent checks while useful independent implementation continues. Stop repeated
attempts when no independent work remains; never fabricate walls/openings/credentials.

Use the app automation tool for any persisted heartbeat, preserving this exact
isolation and stopping policy; do not edit automation TOML or bypass a refusal.
Notify only meaningful progress/failure/required action. No silent acceptance.
