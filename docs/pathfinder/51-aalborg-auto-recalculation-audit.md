# Aalborg automatic recalculation: downstream source audit

Date: 20 October 2026. Scope: source inspection of the isolated local implementation in `C:/Users/todor.chankov/source/WFC-pathfinder-local`.

This document maps the normal publication, traceability, matching and calculation workflow for the next runtime check. It contains no runtime receipt, test result, capacity qualification, engineering acceptance or claim that a real cable was successfully calculated. No runtime, HTTP, SQL, browser or test operation was performed for this audit. Line references identify the inspected source and should be refreshed if those files change.

## 1. Required order through the normal application

1. In **Path Finder → Routes → Project tray purposes**, finish a current frozen preparation with every planned part and no blocking diagnostics. Inspect its current session and requested coverage, rather than relying on an earlier discovery summary. The controls are in `src/pages/ProjectDetails/PathFinderRoutes.tsx:100` and `src/pages/ProjectDetails/ProjectPreparationPanel.tsx:594`.
2. Supply **Preparation command reason**, then use **Validate and publish complete network**. The publication must be the normal application transaction for that frozen session. A private capacity harness or unpublished validation aggregate is not a substitute for this operation. The publish control is in `src/pages/ProjectDetails/ProjectPreparationPanel.tsx:625`; the route is `server/pathfinder/preparationRoutes.ts:59`.
3. After successful publication, use **Traceability → Create trace for published network** for the newly current aggregate. The control passes the selected aggregate ID and projection digest, and is disabled without an aggregate: `src/pages/ProjectDetails/GeometryTracePanel.tsx:34`.
4. In **Path**, use **Match all locations** if the shared registry does not already contain the cable endpoint names and aliases. This populates or refreshes shared suggestions; it does not confirm automatic equipment anchors against the current published preparation. See `src/pages/ProjectDetails/PathFinderTab.tsx:162`, `src/pages/ProjectDetails/hooks/usePathFinder.ts:99` and `server/pathfinder/repository.ts:193`.
5. Open **Automatic recalculation**, refresh its context, and inspect the current calculation-grant mode before requesting an automatic generation. If using finite current-login authority, use **Enable for 30 minutes** after the trace exists. If that same enabled generation already became blocked before trace creation, use **Retry recalculation** after trace creation. Repeating the same still-live Enable with unchanged preferences is deliberately a no-op; it need not start a new generation. Controls: `src/pages/ProjectDetails/PathFinderRecalculationPanel.tsx:24`; same-Enable and retry behavior: `server/pathfinder/recalculationRepository.ts:133` and `server/pathfinder/recalculationRepository.ts:143`.
6. Read the actual generation's ready/blocked counts, job item outcomes and proposal review. Do not mark engineering acceptance or Apply on behalf of the user. **Calculate all cables** is also available as an explicit calculation request; it passes `force: true`, and is not itself an authorization for ongoing automatic recalculation. See `src/pages/ProjectDetails/PathFinderResults.tsx:91`, `src/pages/ProjectDetails/hooks/usePathFinder.ts:118` and `server/pathfinder/jobs.ts:114`.

The calculated outputs remain proposals. Resolving a shared location, discovering a unique equipment candidate, enrolling a job and completing a cable calculation are distinct transitions.

## 2. The preparation plan has an independent 30-minute lifetime

`PREPARATION_LIMITS.sessionMilliseconds` is `30 * 60_000` in `shared/pathfinderPreparation.ts:6`. The server compares the frozen session's original `created_at` with the current time and checks current scope and endpoint names in `server/pathfinder/preparationSessions.ts:113`. A mismatch or elapsed lifetime transitions an eligible session to stale with `scope-or-session-deadline` (`server/pathfinder/preparationSessions.ts:118`).

The publish path invokes that current-session check at admission and again before the final publication transaction (`server/pathfinder/preparationSessions.ts:222` and `server/pathfinder/preparationSessions.ts:248`). Finishing the final capture part, running a private qualification, or waiting for an earlier failed command does not renew `created_at`. An expired session cannot be promoted by rewriting its timestamp or substituting a harness receipt. A fresh normal plan and its required capture/evidence are needed when the contract reports staleness.

Completeness is also independent of age: `requestedScopeComplete` requires the planned part coverage and absence of plan diagnostics (`server/pathfinder/preparationSessions.ts:94`). The publish path refuses incomplete coverage and validation input beyond the frozen profile's ceiling (`server/pathfinder/preparationSessions.ts:226`). A zero-blocker plan alone does not prove all parts, union validation or publication succeeded.

## 3. What normal publication changes

The production publisher creates the artifact, model-object projection and prepared routing scope, then advances the location registry revision (`server/pathfinder/preparationPublisher.ts:61` and `server/pathfinder/preparationPublisher.ts:97`). The publication service constructs the aggregate from those returned identities and commits the aggregate and current pointers atomically (`server/pathfinder/preparationSessions.ts:252`).

The new manifest records both `sourceLocationRegistryRevision` from the frozen plan and `locationRegistryRevision` returned by publication. The service inserts `pf_preparation_aggregates`, updates `pf_project_preparations.current_aggregate_id/current_artifact_id`, and marks that session published in the same transaction (`server/pathfinder/preparationSessions.ts:254`). A previous diagnostic artifact remains current until that transaction actually succeeds. No aggregate in this path claims whole-plant geometry, native parity or engineering acceptance.

The current aggregate and artifact pointer changes trigger `PREPARATION_CHANGED`; a registry revision change triggers `LOCATION_REGISTRY_CHANGED` (`server/pathfinder/recalculationSchema.ts:89`). These events can make a currently enabled recalculation policy eligible for collection. Publication does not itself create the immutable geometry trace required by automatic endpoint candidates.

## 4. Trace creation is required for automatic anchors, but ordinary trace creation does not enqueue a new generation

The normal trace command freezes the published aggregate and plan, capture evidence, runtime fingerprint and source observations. Its commit validates that aggregate and fingerprint again, then inserts the trace manifest and immutable object revisions (`server/pathfinder/geometryTraceRepository.ts:61`, `server/pathfinder/geometryTraceRepository.ts:77` and `server/pathfinder/geometryTraceRepository.ts:94`).

`readCurrentEndpointBindingContext` selects the latest trace for the **same current aggregate**, validates its digest and projection identity, and exposes its ID or `null` (`server/pathfinder/endpointBindingRepository.ts:57` and `server/pathfinder/endpointBindingRepository.ts:68`). A trace attached to the older diagnostic aggregate cannot satisfy the new aggregate's endpoint provenance.

There is an important ordering condition in the inspected implementation:

- Ordinary `geometryTraceRepository.create` inserts `pf_geometry_trace_sets`, its object index and diagnostics, completes its trace intent and saves its receipt (`server/pathfinder/geometryTraceRepository.ts:100`). It does not explicitly call `markRecalculationDirty`.
- The automatic row-trigger list does not include the geometry-trace tables (`server/pathfinder/recalculationSchema.ts:128`).
- The separate managed-grant preparation-maintenance path explicitly emits `GEOMETRY_TRACE_PUBLISHED` (`server/pathfinder/grantPreparedMaintenance.ts:192`). This is a different producer path and does not establish a dirty event for an ordinary administrator trace command.

Therefore, enabling automatic recalculation before the trace exists can enroll an all-blocked generation. Creating the ordinary trace afterwards does not by itself guarantee another generation. The normal finite-policy remedy is an explicit **Retry recalculation** after trace creation, or initial enablement only after trace creation. The retry increments the desired generation; do not alter database state or invent a producer receipt to achieve this transition.

## 5. Automatic calculation eligibility

### Shared inputs

Every admission needs a ready, healthy active model selected in Project Details; its current matching artifact; the current prepared routing scope; coherent endpoint-preparation identities; required project allowances; and a current calculation-engine identity (`server/pathfinder/dependencies.ts:42`). Relevant blocked statuses are:

| Status | Required resolution |
| --- | --- |
| `model_required` / `model_unavailable` | Select or restore a healthy active model. |
| `model_index_required` | Publish the current computational artifact. |
| `routing_preparation_required` | Publish a current permitted project routing scope. |
| `endpoint_preparation_required` | Ensure current aggregate, artifact, selection and projection agree. |
| `comparison_required` | Finish the already requested comparison for the current target. |
| `settings_required` | Supply the required project allowances in Details. |
| `engine_required` | Restore a verified available engine identity. |

A comparison is not automatically mandatory merely because another model exists. An absent target comparison head is `not-required`; a requested but incomplete/currently inconsistent target comparison is pending (`server/pathfinder/revisionComparisonRepository.ts:48`). Do not create a comparison intent merely to diagnose automatic endpoint eligibility, since that creates an additional dependency gate.

Project Secondary tray length, For end connection, Additional % for bending and Connection gap remain server-owned calculation inputs from Details. The Path preference `secondaryDistanceMeters` is a trigger preference, not a replacement for Secondary tray length. Input collection reads `projectRoutingSettings` (`server/pathfinder/dependencies.ts:72`); the browser supplies the displayed connection gap and current preferences when explicitly creating a job (`src/pages/ProjectDetails/hooks/usePathFinder.ts:118`).

### Per-cable endpoints

The dependency collector first requires a uniquely mapped shared location alias for each endpoint. A confirmed current R5 shared binding is used first. A stale or unsupported saved binding is not silently replaced by a model candidate (`server/pathfinder/dependencies.ts:107`).

For an otherwise unbound shared location, the SELECT-only automatic resolver requires all of the following:

1. A trace for the current aggregate, plus coherent aggregate, artifact, model, selection, projection, capture-frame, session and plan identities (`server/pathfinder/automaticEndpointCandidates.ts:40`).
2. No saved endpoint-binding head and no legacy saved binding for that shared location. Any such head requires explicit resolution rather than automatic supersession (`server/pathfinder/automaticEndpointCandidates.ts:74`).
3. Exactly one candidate object ID across the location's frozen endpoint evidence and aliases. Zero remains missing; more than one remains ambiguous (`server/pathfinder/automaticEndpointCandidates.ts:85`).
4. A current immutable traced object record with valid digest and provenance, an eligible object role, equipment-anchor evidence and non-hidden visibility (`server/pathfinder/automaticEndpointCandidates.ts:96`).
5. Exact corroboration of the frozen endpoint names against the object's model name or supported name/tag properties using the plan's matching policy. This includes the versioned model-name policy; it is not suffix-fuzzy matching (`server/pathfinder/automaticEndpointCandidates.ts:120`).
6. A finite equipment-bottom AABB point equal to the immutable record's derived anchor (`server/pathfinder/automaticEndpointCandidates.ts:126`).

The result has `kind: automatic-equipment-anchor`, `approximate: true` and `engineeringAccepted: false`, with trace/object/plan provenance (`server/pathfinder/automaticEndpointCandidates.ts:129`). It does not write a manual binding, a `confirmedBy` value or a human decision.

If either endpoint uses this result, dependencies are v6 and the cable is ready only for a proposal using approximate automatic anchors. Current confirmed endpoints alone use v5. Missing endpoints block the cable; unknown cable categories block separately. Instrumentation remains an accepted input category mapped through the established Control rules (`server/pathfinder/dependencies.ts:85`).

## 6. Current authority must be read again

Historical authority granted on 19 October is not evidence of authority on 20 October. Finite current-login authority lasts at most 1,800,000 ms and is capped by the current login expiry (`shared/pathfinderRecalculation.ts:6` and `server/pathfinder/recalculationRepository.ts:138`). The repository rechecks the stored actor's current administrator role, login identity, revocation state and expiry (`server/pathfinder/recalculationRepository.ts:52`). Invalid authority is represented as `awaiting_authority`, including during producer claims (`server/pathfinder/recalculationRepository.ts:156`).

The persisted calculation-only grant and the finite current-login policy are separate modes. If an enabled persisted grant is present, finite `enable`, `resume` and `retry` commands refuse with `CALCULATION_GRANT_DISABLE_REQUIRED` (`server/pathfinder/recalculationRepository.ts:129`). Inspect the real grant context before choosing a mode; do not assume an old screenshot or an old enabled flag is live authority, and do not silently toggle the other mode merely to bypass the refusal.

The runtime starts the worker and producers only when the configured engine and private storage are available (`server/pathfinder/runtime.ts:64`). The finite producer normally polls once per second (`server/pathfinder/recalculationProducer.ts:8`). Dirty generations debounce for 500 ms, bounded by five seconds from the first dirty event (`server/pathfinder/recalculationSchema.ts:61`). Claims and enrollment recheck the current generation, control revision, authority epoch, lease and current principal (`server/pathfinder/recalculationRepository.ts:162` and `server/pathfinder/recalculationRepository.ts:182`).

## 7. Registry labels and actual v6 eligibility are different observations

The Path state response still projects `fromMatch` and `toMatch` through the legacy `matchLocation` function (`server/pathfinder/repository.ts:106`). After a project aggregate is current, `match` sets `suggestionsOnly`, stores suggestions and avoids legacy automatic confirmation (`server/pathfinder/repository.ts:199` and `server/pathfinder/repository.ts:221`). These labels do not execute the v6 automatic-candidate provenance checks described above.

Consequently, an unresolved or unconfirmed legacy label alone does not prove that the calculation admission must reject an exact current automatic candidate. Conversely, one discovered candidate or a saved name does not prove a successful calculation. The reliable progression to inspect is: current shared registry and immutable evidence → actual admission ready/blocked counts → actual job item result → immutable proposal and its length ledger/provenance.

The historical figure of **230 cables with both endpoint names uniquely discoverable among 2,140 cables** is a prior potential-eligibility observation. It is neither a current admission count nor a successful routing/length calculation count. Fresh publication, trace identity, saved-head restrictions, category, connectivity, options, authority and engine outcomes may change actual admission and results. No success target may be fabricated from that historical number.

An all-blocked automatic collection records a baseline and its reasons without creating a worker job; at least one ready cable is required for a new automatic calculation job (`server/pathfinder/jobs.ts:95`). Partial eligibility is expected to produce separate ready and blocked counts. A queued item can still end in `no_path`, a model-review requirement, staleness, a deadline or a resource refusal; eligible is not equivalent to calculated.

## 8. Normal HTTP boundary map

Paths below are relative to `/api/projects/:projectId/pathfinder`. Use the current administrator session and current server revisions. These are reference contracts, not instructions to bypass the UI or fabricate request identities.

| Operation | Normal request and important frozen inputs | Source |
| --- | --- | --- |
| Read preparation | `GET /preparations/context`, `GET /preparations/:sessionId` | `server/pathfinder/preparationRoutes.ts:51` |
| Publish complete preparation | `POST /preparations/:sessionId/publish`; `wfc.pf.preparation-mutation.v1`, current `expectedSessionRevision`, command `idempotencyKey`, reason | `server/pathfinder/preparationRoutes.ts:59`; `shared/pathfinderPreparation.ts:35` |
| Create immutable trace | `POST /geometry-traces`; `wfc.pf.geometry-trace-create.v1`, current `aggregateId`, `expectedProjectionSha256`, `wfc.pf.geometry-trace-derivation.v1`, command `idempotencyKey` | `server/pathfinder/geometryTraceRoutes.ts:36`; `shared/pathfinderGeometryTrace.ts:30` |
| Match shared names | `POST /match`; current `expectedRegistryRevision` | `server/routes/pathfinderRoutes.ts:60`; `src/pages/ProjectDetails/hooks/usePathFinder.ts:99` |
| Read finite-policy context | `GET /recalculations/context` | `server/pathfinder/recalculationRoutes.ts:38` |
| Enable finite automatic calculation | `POST /recalculations/commands`; `wfc.pf.recalculation-command.v1`, current `expectedControlRevision`, command `idempotencyKey`, reason, `action: enable`, current preferences, timeout 100–120000 ms | `server/pathfinder/recalculationRoutes.ts:39`; `shared/pathfinderRecalculation.ts:69` |
| Retry an enrolled finite policy | Same command endpoint and common identity fields, `action: retry`; retains saved preferences and timeout | `server/pathfinder/recalculationRepository.ts:135` |
| Explicit calculation diagnostic | `POST /jobs`; current `expectedRegistryRevision`, `force`, optional cable IDs and current options | `server/routes/pathfinderRoutes.ts:63`; `src/pages/ProjectDetails/hooks/usePathFinder.ts:118` |
| Read actual outcomes | `GET /jobs/:jobId`, `GET /proposals/:proposalId` | `server/routes/pathfinderRoutes.ts:66`; `server/routes/pathfinderRoutes.ts:72` |

All Path Finder operations remain under server administrator authorization (`server/routes/pathfinderRoutes.ts:16`). For an uncertain mutation outcome, retain and reconcile the exact saved command, including its original key and frozen payload. Do not turn an HTTP timeout into an assumed refusal or generate a different mutation to hide the unknown outcome. The finite-policy UI exposes **Retry saved command** for this case (`src/pages/ProjectDetails/PathFinderRecalculationPanel.tsx:47`).

## 9. Evidence to collect in the next authorized runtime check

These are outstanding verification steps, not completed results:

1. Record the actual frozen preparation creation time, current scope, complete part/evidence coverage and selected limits profile. Resolve stale state through a fresh normal plan if required.
2. Record the normal publication receipt and current aggregate/artifact/projection identities. Verify the complete project preparation became current rather than the earlier diagnostic artifact.
3. Record the immutable trace receipt for that exact aggregate and its current capture frame. Keep `engineeringAccepted: false` and native parity unasserted.
4. Read actual finite-policy and persisted-grant context. Use only the chosen currently authorized mode, then record its real generation and ready/blocked reason counts.
5. Inspect an actual eligible cable's job outcome and proposal, including route identities, exact path points, endpoint provenance and complete length ledger. A missing or ambiguous endpoint remains a named resolution task, not an invented location.
6. Verify there was no automated Review or Apply and no resulting write to cable routing, design length or installed length. Preserve the user's separate engineering review and explicit application decision.

### 9.1. Source-only design: display calculation-point availability separately

Status: **PROPOSED / NOT_IMPLEMENTED / NOT_RUN**. This is a bounded follow-on
design from source inspection, not an observation that the live Aalborg model
has a published trace, usable automatic endpoints or successful cable results.

The current state projection computes cable `fromMatch` / `toMatch` through
`matchLocation` (`server/pathfinder/repository.ts:104` and
`server/pathfinder/matching.ts:9`). A uniquely registered location without a
binding remains `missing`; an `unverified` model suggestion is projected as
`ambiguous`. These are legacy binding labels, not the result of the v6 immutable
automatic-anchor resolver. Keep these existing statuses and their confirmation
semantics. Never relabel an approximate candidate as a confirmed shared location.

The smallest truthful contract extension is an **optional, deduplicated
per-location `calculationAvailability` projection**, referenced through the
existing cable endpoint `locationId`. It should distinguish a current confirmed
calculation point from an automatic model candidate and from blocked or
unevaluated evidence. Reuse the resolver's actual statuses:
`automatic-ready`, `missing`, `ambiguous`, `saved-binding-required`,
`object-unverified`, and `preparation-required`
(`server/pathfinder/automaticEndpointCandidates.ts:14`). Add an explicit
confirmed-point case and a fail-closed `not-evaluated` case for absent legacy
responses or a deliberately bounded display scope. A small projection needs
only status, point-availability, source, candidate object IDs and a reason code;
the full machine point and its provenance remain in calculation dependencies.
An automatic candidate must remain labelled approximate and unconfirmed, with
engineering acceptance unasserted. Missing DTO evidence must not default to
ready, and a candidate count of one is not a substitute for resolver validation.

Compute the projection once per coherent state read:

1. Retain the normal current-admin/project transaction. Read current endpoint
   context once and reuse the existing location/head results from
   `locations` (`server/pathfinder/repository.ts:63`) and
   `readCurrentEndpointBindingContext`
   (`server/pathfinder/endpointBindingRepository.ts:57`). Build a normalized
   name/alias-to-location index for the distinct names actually used by cables.
2. Reuse the batched point-selection pattern in
   `server/pathfinder/dependencyBatch.ts:59` through `:76`: resolve aliases in
   chunks, read needed heads once, preserve a current confirmed head first, and
   call `readAutomaticEndpointCandidates` once for the needed unbound location
   IDs. That resolver already validates current aggregate/trace/object/name/AABB
   provenance and refuses to supersede any saved head or legacy binding
   (`server/pathfinder/automaticEndpointCandidates.ts:30`). A stale saved point
   remains blocked; it must not acquire an automatic fallback.
3. Reuse the existing needed-location count/byte/deadline bounds
   (`shared/pathfinderRecalculation.ts:6`). Do not silently truncate a large
   project and present unchecked endpoints as missing or ready. An over-budget
   display evaluation needs an explicit `not-evaluated` reason or a bounded
   follow-on read. This is not a new permission to widen limits.
4. Do **not** invoke `collectDependencyBatchInTransaction` directly from the
   state endpoint. Its cable `FOR UPDATE` admission at
   `server/pathfinder/dependencyBatch.ts:27`, engine-identity read at `:50` and
   complete per-cable dependency snapshots are unnecessary for this display.
   Share/extract only the read-only endpoint collection/mapping portion if
   needed. No per-cable SQL loop, engine DLL hashing, job enrolment, matching
   writes or calculation run belongs in state projection.

The matches UI currently lives inline in `PathFinderTab.tsx`; there is no
separate `PathFinderMatches` file in the inspected revision. Its unresolved
filter is at `src/pages/ProjectDetails/PathFinderTab.tsx:67`, checkbox label at
`:165`, list labels at `:169`, and selected From/To labels at `:174` through
`:175`. Show the two observations separately, for example
**"Binding: unconfirmed; calculation point: automatic model candidate
(approximate)"**. A point-oriented filter should say **"Without a calculation
point"** and use the new availability projection, rather than treating every
unconfirmed candidate as an unusable endpoint. Keep Resolve From/To and explicit
manual confirmation available; automatic display must not save a binding.

Point availability is **not full cable eligibility or a successful route**.
Both points may be available while routing preparation, a requested comparison,
project Details values, category, engine identity or route connectivity still
blocks the proposal. Those gates remain in
`collectCommonCalculationInputs` / `freezeCableDependencies`
(`server/pathfinder/dependencies.ts:42` and `:85`); job admission must re-read
them under its existing authority and dependency fences. No display field grants
engineering acceptance, Review, Apply or permission to modify cable lengths.

Proposed source/test scope for that later change:

- `server/pathfinder/repository.ts` and `server/pathfinder/contracts.ts`: keep
  binding status unchanged; attach bounded per-location availability without
  writes. Extend `server/pathfinder/repository-match.test.ts` for legacy
  suggestion/binding preservation and a coherent automatic availability read.
- A small read-only endpoint projection helper, if extraction is needed, plus
  `server/pathfinder/dependencyBatch.ts` / `.test.ts`: prove the UI and v6
  admission use the same point precedence without introducing per-cable SQL.
  Existing batch tests at `dependencyBatch.test.ts:158` through `:183` cover
  one automatic resolver call, confirmed-head priority and stale-head refusal.
- `src/api/pathfinder.ts` / `.test.ts`: validate the optional availability DTO,
  fail closed when absent or malformed, and reject contradictory ready/source
  combinations. Keep proposal v5/v6 provenance and server errors unchanged.
- `src/pages/ProjectDetails/PathFinderTab.tsx` / `.test.tsx`: prove distinct
  binding/candidate labels, the point-availability filter, and continued manual
  resolution for missing, ambiguous, stale and unavailable evidence.
- Focused controls must cover missing current trace, changed model/aggregate,
  forged object/hash/name evidence, legacy/manual binding precedence, blank or
  duplicate aliases, no coordinates invented, no registry revision/write, and
  bounded work for repeated From/To names across many cables. Record actual
  query counts and runtime separately when the authorized executor tests it;
  this design makes no performance or live-data acceptance claim.

### 9.2. Proposed ordinary-trace recalculation event — NOT_IMPLEMENTED

This is a source-only design for a later narrow repair. No production code,
tests, database schema or live policy was changed for this section. The
ordinary-trace ordering condition in section 4 therefore still applies.

**Recommended boundary:** add one transactional dirty event only when an
ordinary current-login administrator publishes a **new** immutable trace for
the currently selected, healthy prepared aggregate. Keep the existing grant
maintenance event in its existing owner; do not make the repository emit an
additional event for a grant principal.

The existing `markRecalculationDirty` helper accepts a `PoolClient` and calls
`pf_recalculation_dirty` on that same transaction
(`server/pathfinder/recalculationSchema.ts:144`). Reuse domain `geometry`, reason
`GEOMETRY_TRACE_PUBLISHED`, and source revision `trace.id + ':' +
trace.contentSha256`, as already used by managed maintenance
(`server/pathfinder/grantPreparedMaintenance.ts:192`). The SQL permits the
declared domain set, an uppercase reason matching
`^[A-Z][A-Z0-9_]{0,95}$`, and a source revision of at most 256 bytes; there is no
additional literal reason allowlist to extend for this already-used cause
(`server/pathfinder/recalculationSchema.ts:64`). The UUID-plus-SHA256 source is
101 ASCII bytes. The helper itself is **not deduplicating**: every invocation
advances a generation and inserts an event (`recalculationSchema.ts:66` and
`:73`), so invocation ownership is the idempotency boundary.

Proposed insertion and guards:

1. In the new-publication branch of `geometryTraceRepository.create`, retain
   all existing principal authorization, frozen aggregate/runtime validation,
   lease checks, worker joins, object-page and diagnostic-page checks. Do not
   emit at admission, after the worker returns, or after the outer transaction
   commits (`server/pathfinder/geometryTraceRepository.ts:61` and `:94`).
2. After the new trace/index rows, completed intent and exact command receipt
   have been written, but before returning the receipt from the **same final
   transaction**, check `!isGrantPrincipal(who)` and read the current prepared
   pointer/active selection under the established project transaction. Compare
   aggregate, artifact, model, selection revision and content fingerprint with
   the newly frozen trace/aggregate; require the active model still ready and
   healthy. Use a bounded current-scope read, not a full endpoint or cable
   collection. A historical trace may still be stored for inspection but must
   not cause a recalculation of an unrelated current aggregate. Existing
   current-scope identity checks are illustrated by
   `server/pathfinder/endpointBindingRepository.ts:57` and
   `server/pathfinder/automaticEndpointCandidates.ts:55`.
3. For that qualified ordinary new publication, call the existing dirty helper
   once with the trace cause above, as the final SQL mutation before the
   transaction's cancellation/final-login check and COMMIT. This retains
   project/principal-before-scheduler lock ordering. The insertion point follows
   `saveReceipt` in `server/pathfinder/geometryTraceRepository.ts:107`; current
   transaction fencing and commit-unknown handling remain in
   `server/pathfinder/geometryTraceRepository.ts:23`.
4. Do not add the helper to either receipt-replay branch: exact historical key
   replay at `geometryTraceRepository.ts:64`, complete-derivation reuse with a
   new command key at `:71`, or outer unknown-outcome reconciliation at `:113`.
   Those paths return existing durable evidence and must not create another
   event. A failed transaction rolls back the new trace, receipt and event
   together; a committed but unacknowledged transaction is recovered through
   the exact existing receipt, without another helper invocation.

**Grant boundary and recursion:** the grant path must continue to create its
trace under its finite operation lease, validate its exact receipt, emit its
owned event in the grant transaction, persist `trace.dirty`, then positively
release that lease before comparison (`grantPreparedMaintenance.ts:183` through
`:198`). The proposed ordinary-only guard leaves those semantics and its
unknown-outcome quarantine unchanged. An unconditional repository event would
add a second generation to that path and is therefore unsuitable for this
narrow repair. Do not introduce a generic trace-table trigger as an alternative
while the managed-maintenance emitter remains. The new event only marks a
generation; it does not call trace creation, preparation, comparison, job
creation, Review or Apply recursively. Existing preparation publication and
trace completion remain two distinct dependency changes, not two emissions
of the same trace event.

The event must not enable a policy or mint authority. Existing SQL preserves
disabled/paused/expired-authority states, and normal producer claim/admission
still checks the current role, login, epoch, generation and engine
(`server/pathfinder/recalculationSchema.ts:71` and
`server/pathfinder/recalculationRepository.ts:162`). A newly dirty generation
may still be all blocked or produce no route. An already stored trace that was
created before the repair does not acquire a retroactive event through a replay;
use the existing explicit Retry workflow if its current generation needs one.

Proposed checks for the later implementation, all **NOT_RUN** here:

- Extend `server/pathfinder/geometryTraceRepository.test.ts` with a genuine
  new-publication fixture proving exactly one correctly scoped helper call on
  the same client after trace/index/receipt completion and before COMMIT.
  Preserve the existing current-role, final-expiry, lease, fingerprint and
  rollback/commit-unknown checks at `:38` through `:44`.
- Extend exact-key replay (`geometryTraceRepository.test.ts:45`) and
  complete-derivation reuse (`:47`) to assert zero helper calls. Exercise a
  lost final COMMIT acknowledgement whose durable receipt is then reconciled,
  proving one durable trace/event rather than a replay generation. Refused,
  cancelled, integrity-failed and genuinely rolled-back publications must have
  no committed event.
- Cover a non-current/historical aggregate and changed active selection,
  fingerprint, artifact or model health: the ordinary trace must not dirty an
  unrelated current scope. Cover disabled, paused and expired finite policy
  state: a trace event must not silently renew or enable calculation authority.
- Keep `server/pathfinder/grantPreparedMaintenance.test.ts:89` proving one
  existing trace dirty call before lease release. Retain completed-maintenance
  replay at `:131`, unknown trace completion at `:147`, unknown dirty-commit
  outcome at `:171`, and durable dirty-receipt requirements at `:206`.
  Add a repository grant-principal new-publication check proving the proposed
  ordinary emitter is skipped, so the combined path has one owner.
- Use the isolated recalculation transaction controls to prove that an
  all-blocked pre-trace generation is superseded by the newly committed trace
  event under still-live finite authority, without an explicit Retry; retain
  existing all-blocked baseline and generation-fencing checks in
  `server/pathfinder/recalculationRepository.test.ts:35` through `:42`.
  Verify event/trace rollback atomically in an owned test database rather than
  treating a SQL-spy ordering assertion as proof of database atomicity.

