# PF-U1 — complete bounded Needs routing diagnostics

Implement the read-only diagnostics/API/client/list foundation of the accepted
PF-U workflow. Continue immediately after this handoff; no new routine approval
is needed. Read live branch/status/agents/progress to avoid duplicate work.

## Baseline and decisions

Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`. Verified U0 source
commit `72df1d5`, branch `pf-u0-cable-workflow-contracts-local-20261020`, parent
`57a203ae170e43276dee5ff43a288f803d2c0fbe`; read Git for full hashes and the later
handoff commit. Create inherited `pf-u1-cable-diagnostics-local-20261020` if it is
not already active. Preserve preexisting untracked `.pf0-work/`/`.pf2-work/`.
Read plan60, report61, U0 actual receipt and final
`shared/pathfinderCableWorkflow.ts`. U0 verified47synthetic tests, types/lint/diff;
no runtime feature is enabled yet. Original WFC/5190/PathFinder/sources remain
read-only, no push/PR/merge/deployment. Only own5191 is eligible at a later gate;
this stage does not change/restart that runtime. Root alone executes SQL/HTTP/
Docker; agents own disjoint source/tests and preserve parallel edits.

The user accepted: one shared logical endpoint for matching cable From/To names,
Model Browser Apply for From/To, automatic affected recalculation, automatic
initial fill ONLY both current routing/designLength blank, and manual comparison
approval for existing/partial values. Zero is existing, installLength preserved.
No fake human Review or calculation-only grant writes. Direct SECONDARY is
settled for U6: D<F OR D<T, actual3D+E thenP+ceiling, no extraS/gap/fixedmaximum,
all device kinds within the existing non-MV scope. U1 implements no writes/math.

## Delivery and ownership

1. Backend writer: new bounded repository/query adapter and tests; a protected
   diagnostics route plus tests and its narrow registration in
   `server/routes/pathfinderRoutes.ts`. Add dedicated shared query/detail schemas
   in a new file if needed; coordinate their interface before client work.
   Do not edit hashed engine modules, existing endpoint binding writers or jobs.
2. Frontend writer: new typed API client/tests, owned read/paging hook/tests and
   `PathFinderNeedsRoutingList` component/tests. It takes an explicit selection
   callback; full popup/PathFinderTab integration occurs in U5. Do not alter
   Routing Viewer or its information-panel lifecycle.
3. Root: docs/progress, interface integration, source review, appropriate final
   checks/evidence/local commit. Existing agent read-model/auth audit is a
   reusable source-backed lead; verify code changes, not repeated exploration.

## API/read contracts

- GET `/api/projects/:projectId/pathfinder/cable-workflow` accepts strict bounded
  query: filter needs-routing/calculating/ready-for-review/up-to-date/all, literal
  NFC-trim search, limit1–100, opaque cursor and current routing preferences
  (existing defaults2m/preferVertical=true when absent). Bind query hash to all
  filter/search/preferences/limit inputs. Default Needs routing includes both
  `needs-routing` and `blocked`; MV excluded even in all, unknown category visible.
- An exact protected cable detail read may return the same current owned row plus
  context hash for the later persistent popup. Add a strict versioned detail
  schema and validate exact project/cable ownership; no business values in errors.
- Return final U0 page schema: max100matches from max200scanned candidates,
  querySha256/contextSha256, scannedCount/scannedThroughCableId/nextCursor.
  Stop at requested match limit; never consume omitted matches. Empty filtered
  pages may continue. Only exhausted nextCursor=null means no later matches.
  Context/query/project mismatch and nonadvancing/reused cursors refuse safely.
  Bound response bytes (≤8MiB) and collection deadline; no unbounded project scan.
  `%`, `_` and backslash in search are literal, not wildcard/query injection.
- Current admin role/login/project enforcement is mandatory for every read,
  including exact detail and deep links. Existing `principalTransaction()` does
  login INSERT, so use a SELECT-only-in-effect bounded transaction: current
  project/user/unrevoked EXISTING login binding and matching expiry, role/login
  locks where appropriate, final expiry check. Do not initialize schema/login
  or write business state in GET. A missing binding requires normal login/
  authorization initialization, never a manufactured diagnostics identity.
- Use newest admission baseline containing each cable, then its exact job/item/
  proposal/seal, not newest successful proposal. Newer waiting/blocked admission
  must supersede an older success in this live diagnostics view. Keep accepted
  cable values/receipts separate from the currently calculated result.
- Preserve actual itemState/outcome/error codes. Blocked siblings in an active
  job are not Calculating. A completed item in an incomplete job is not Review
  ready under the current gate. Not-evaluated is unknown, not missing.
- Read only page endpoint aliases/locations/legacy bindings/needed heads/current
  automatic candidates, plus one coherent preparation/model/options context.
  Reuse exported common-input/freeze/provenance helpers in a new adapter; do not
  call full repository.state or loop the whole project per page/poll. Do not
  loosen v5/v6 global-registry hashes early; v7/scoped invalidation is U3.
- Positive reviewable must preserve all existing proposalDto proof: complete
  uncancelled job, exact fresh recorded dependencies/engine/model/selection/
  enrollment, supported route/options, valid immutable seal/ledger and WFC
  compatibility. Unknown evidence remains unavailable, not a false ready state.
- Admission baseline.acceptedMatchesCurrent is historical. Prove today's latest
  receipt matches actual cable revision/routing/designLength and the exact own
  Apply transition before comparing remaining engineering dependencies. An
  accepted proposal's cable revision is pre-Apply; do not compare that full old
  hash directly to the post-Apply row or silently ignore intervening edits.

## UI and validation

The new list uses readable English reasons, tag/From/To and state filters, an
explicit cable selection callback, bounded pages and truthful scan/continuation
feedback. Show the actionable reason before technical detail. No implicit save,
calculation, selection binding, Review, Apply or initial-fill occurs in U1.
Hook identity includes account/project/loaded model/preferences/query; cancel
late reads, stop when inactive, reset cursors on query/context changes, enforce
one in-flight read and prevent hidden or stale account rows from leaking.

Test failures beyond the first200checked candidates; empty continuing pages;
literal and Unicode search; cursor/query/context tampering; newest blocked or
waiting versus older success; missing and ambiguous points; no_path with found
points; settings/category/model/resource/deadline/cancelled/authority reasons;
strict v5/v6 staleness and receipt-backed own-write currentness; admin/login
revocation/expiry; no DML/schema initialization/engine call/full-state collection.
Client/Hook/UI tests cover malformed responses, ownership, late races, empty
continuations, navigation/search, no false global empty, selection and zero
write requests. Use synthetic data only in Git. Root may use isolated owned DB
fixtures if meaningful; mock tests do not establish actual SQL or live visual PASS.

Run appropriate scoped tests, final type/lint/diff checks and independent source
review. Record actual revision/scope/count/PASS/FAIL/BLOCKED/NOT_RUN and failures.
Do not rerun unrelated accepted suites merely for a handoff. Commit locally,
update automation-progress.md, prepare PF-U2 selection/shared-binding handoff
with current evidence and execute it immediately. The ACTIVE heartbeat continues
PF-U only, every10minutes; Preparer stays paused. Retain own5191/demo/backups/
models/evidence and historically denied paths; no global prune or cleanup bypass.
