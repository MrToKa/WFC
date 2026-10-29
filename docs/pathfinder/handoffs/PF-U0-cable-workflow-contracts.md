# PF-U0 — freeze cable workflow contracts and accepted write policy

Implement only the standalone contracts, fixtures and execution plan for the
user-authorized PF-U0–PF-U8 workflow. Read
`docs/pathfinder/60-cable-routing-workflow-plan.md` and live progress/agents first.
Do not rerun previous PF/PF-R stages or change5191 runtime during this stage.

## Baseline and ownership

Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`;
branch `pf-u0-cable-workflow-contracts-local-20261020`, inherited from
`57a203ae170e43276dee5ff43a288f803d2c0fbe`. Initial tracked state was clean;
historical untracked `.pf0-work/` and `.pf2-work/` must be retained. Original
WFC5180/old5190/PathFinder/sources are read-only. No push/PR/merge/deployment.
Root owns docs/handoffs/progress and is sole runtime/SQL/HTTP executor. The
contract writer owns only new `shared/pathfinderCableWorkflow.ts` and its test.
Preserve all parallel edits; coordinate before touching shared interfaces.

## Required contracts

1. Pure display/eligibility decisions are separate from write authorization.
   Automatic initial fill is eligible only when current routing is NULL or
   whitespace and current designLength is exactly NULL. Zero is a value;
   partial records require manual review. Undefined/invalid/unread current state
   cannot authorize an automatic write. MV is excluded; Instrumentation follows
   Control; unknown categories stay explicitly blocked.
2. Distinguish endpoint readiness, job status, outcome, currentness and accepted
   current values. Found From/To does not imply connected route. Not-evaluated
   does not imply missing. Cancelled/incomplete/stale results do not become ready
   merely because they contain a historical path. Export versioned bounded
   diagnostics row/page schemas, max100rows, with existing canonical IDs/decimals.
3. Keep server-side current admin/login, model/dependency/revision/idempotency,
   both-blank-at-commit and installed-length preservation as mandatory future
   initial-fill gates. Do not create a fake human Review or grant writes to a
   calculation-only authority. Existing data needs explicit ordered route and
   length comparison and manual approval; old approvals retain old semantics.
4. Shared endpoint identity uses existing NFC/trim/uppercase and explicit aliases
   across both ends of every cable in one project. A3Dselection needs one exact
   current object and retained geometry/frame evidence; object-attached is not
   supported. The popup must be nonmodal and preserve unknown command ownership.
5. Direct `/SECONDARY` is a separately versioned later strategy. The user has
   now confirmed D<F OR D<T for all device types, where D is the actual From/To
   distance and F/T are the shortest approaches to category-eligible trays.
   Equality does not qualify; do not add a fixed maximum or use S as a threshold.
   Formula: ceil((D+E)*(1+P/100)), actual3Ddistance, E once, no extraS/gap.
   Do not implement that mathematics in this contract-only stage.

## Checks and reporting

Run meaningful synthetic truth-table/classification/schema tests, scoped type/
lint/diff checks. No DB/model/business rows, frozen PF-0 receipt rewrites, runtime
changes, new calculations, human Review/Apply or real initial-fill here. Record
actual source hashes, result counts, failures/limitations and a local commit.
The previously delivered65tests belong to report59's revision, not this stage.

Update automation-progress.md and the report with exact ownership and next step.
The existing heartbeat automation was explicitly updated through the app for
this PF-U scope, ACTIVE every10minutes, on the same chat; the Preparer integration
remains PAUSED. Do not create a duplicate automation. After a verified local
commit, apply prepare-stage-handoff and save/execute
`docs/pathfinder/handoffs/PF-U1-needs-routing-list.md` immediately. U1 implements
the complete bounded diagnostics/read-model; it does not grant initial-fill
rights early. Keep live browser verification distinct from pure tests and
record the existing browser-tool refusal without bypassing it.
