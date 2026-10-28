# PF-U0 — cable workflow contracts

Date: 2026-10-20. Status: **TECHNICAL_CONTRACTS_PASS; PF-U1 NEXT**.
Worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-u0-cable-workflow-contracts-local-20261020`, parent
`57a203ae170e43276dee5ff43a288f803d2c0fbe`. Read Git for the containing local commit.

The user authorized an understandable Needs routing list, a persistent nonmodal
cable popup, protected Model Browser selection and Apply for From/To. One shared
project binding must update every matching From/To occurrence and trigger only
affected recalculation. The accepted write rule is automatic initial fill only
when current routing and designLength are both blank; existing or partial values
need ordered old/new route and length comparison and explicit manual approval.

Delivered contracts in `shared/pathfinderCableWorkflow.ts` and its synthetic test:

- Exact NULL/whitespace routing plus NULL design eligibility. Zero/defined length
  is existing; undefined/nonfinite/invalid state never grants a candidate. The
  helper grants no write authority. MV is excluded; unknown categories blocked;
  Instrumentation maps to Control without editing the stored category.
- Independent endpoint availability, whole-job state, per-cable item state,
  outcome/currentness, immutable proposal references and bounded reason/error
  codes. A blocked sibling in an active job remains actionable; it is not
  incorrectly called Calculating. A complete item still retains the current
  whole-job Review gate until the later targeted-work stage.
- Ordered, unique, project-owned diagnostics pages:100matches from a bounded
  scan≤200, query/context hashes and opaque continuation. Empty filtered pages
  may continue. The scan stops at the100thmatch instead of skipping omitted
  matches. Only nextCursor=null indicates exhaustion.

No server, UI, database, model, C# calculation, endpoint binding, initial-fill
write or runtime integration is enabled by U0. Those are later PF-U stages.
Current admin/login mandates, final both-blank/revision/dependency checks,
atomic pair/history/idempotency and installLength preservation remain required.
Calculation-only grants must not gain writes; human reviews must not be forged.

The additional direct SECONDARY decision is settled and recorded in plan60:
D<F OR D<T for all device types; use category-eligible nearest tray distances,
strict inequality, no fixed maximum, formula ceil((D+E)*(1+P/100)), without S/gap.
The mathematics and strategy are not implemented in U0. A straight line is not
evidence of collision clearance or native engineering parity.

## Actual verification

Final standalone synthetic tests: **47/47PASS**, scoped ESLint PASS, final
frontend/backend typecheck PASS, diff check PASS. Initial36tests passed their
earlier contract, but source review found two missing concerns: blocked items
inside running jobs, and empty filtered pages with later matches. Both contracts
were corrected and the expanded47-case suite passed. Earlier results are not
carried forward as verification of the revised source.

No runtime/SQL/HTTP, new job, real Review/Apply, initial-fill write, Docker control
or original-checkout edit occurred. No runtime build or live visual test was
needed for U0; both are NOT_RUN. Historical denied paths and preexisting untracked
`.pf0-work/`/`.pf2-work/` remain untouched. No secrets or business rows added.
Sanitized file hashes and results: [U0 actual](evidence/cable-workflow/u0-contracts.json).

The existing heartbeat automation was updated through the application, not by
editing its configuration file. It is ACTIVE every10minutes on the same chat,
renamed **Path Finder — shared locations and cable routing**, scoped to PF-U only
and carrying the latest direct-SECONDARY answer. No duplicate automation was
created. Simplified Preparer remains paused. Original WFC was cleanmain96e63f13;
local branch94ahead/3behind cachedorigin/main before U0 commit. Live remote/CI
NOT_RUN; no push, PR, merge or deployment.

Next: generate/execute PF-U1 handoff, add the complete bounded diagnostics/read
model and list. Local-only branches inherit completed work. Keep5191 runtime
unchanged until an appropriate later deployment gate and backup.
