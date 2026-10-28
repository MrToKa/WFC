# PF-U6 — direct SECONDARY between nearby endpoints

READY; execute immediately under standing authorization. U5 delivery
`785649bb7ef0ce1413089e7bfe7d6ce72a950d63` is committed on
`pf-u5-cable-routing-workspace-local-20261020`, inheriting9cc8934/U4b4db75c.
Report66/u5-actual.json verify484/484 checks:470synthetic20files +8affected Tab
cases1file +6actualPG metadata cases1file; final frontend/backend types, all27
changed-source lint and diff PASS. Other49 Tab cases NOT_RUN; full styled jsdom
run was interrupted after>10m with no terminal PASS. Both new PG fixtures retired,
credentials removed; all agents frozen, no root process/fixture active. Runtime
5191/fullengine/actualUI/engineering acceptance NOT_RUN. Original WFC observed
clean main96e63f13/cachedorigin same; live remote/CI NOT_RUN. Root used
prepare-stage-handoff against actual local code/evidence; no old receipts rerun.

## Goal and boundaries

Execute the settled direct SECONDARY rule for every kind of eligible non-MV
equipment endpoint. D is actual canonical-world-metres 3D From–To distance.
F and T are exact nearest eligible fitted tray-polyline geometry distances from
each endpoint BEFORE vertical-approach preference. Choose direct `/SECONDARY`
iff D<F OR D<T, strict. Equality is insufficient; being shorter only than the
full tray graph path is insufficient. There is no fixed maximum. Missing
category-eligible geometry is unavailable, never Infinity that enables a shortcut.

Direct design length is ceil((D + E) * (1 + P/100)), with E For end connection
and P Additional % for bending from Project Details. E is added once; Secondary
tray length S and additional connection gap are not added or substituted in this
branch. Normal routing/formula/guards/tie behavior remains unchanged. The nearest
geometry criterion is not collision/clearance proof; do not invent such a PASS.

Work only in a new inherited local branch of
C:/Users/todor.chankov/source/WFC-pathfinder-local. Original5180/old5190/checkouts,
canonical PathFinder and synced sources remain read only. Root alone executes
actual runtime/SQL/HTTP/Docker. No push/PR/merge/deploy; Simplified Preparer stays
paused. Only owned5191 may be upgraded later after backup in U8. Keep needed
models/archives and denied historical paths. Saved browser-origin refusal must
not be bypassed. The automation continues U6→U7→U8 without routine stopping.

## Source-backed implementation direction

1. Preserve all eleven canonical Core/Routing/*.cs bytes, original internal
   constructor visibility and ProjectReference tests. Add a separate Core/Support
   helper in the same assembly; Core targets C#7.3/.NET9. Validate eligible
   categories, duplicate eligible identifiers, options, finite points/distances
   and cancellation coherently with the original calculator. Use deterministic
   ordinal iteration. No direct construction through a widened public API or
   production InternalsVisibleTo.
2. RouteCalculator.Calculate at Core/Routing/RouteCalculator.cs45–62 filters
   category/sorts, then private FindNearest191–217 projects onto complete polyline
   pieces. FindVerticalApproach220–257 can replace those endpoints. Therefore
   routeResult.FromDistance/ToDistance are NOT valid F/T shortcut evidence.
   The new helper must use the true nearest 3D geometry metric before that
   optional preference. Normal fallback still invokes the unchanged core.
3. ModelRunner/Program.cs141–176 is the narrow calculate strategy hook after
   prepared.Segments/category/planning checks and before RouteCalculator.Calculate.
   Lookup must remain unchanged. Use a versioned explicit opt-in so absent/false
   historical requests and frozen corpus responses remain exact. WFC deliberately
   opts in for new eligible cable calculations and relevant standalone previews;
   MV remains excluded from the accepted automatic scope. Never infer the strategy
   from route text alone.
4. Direct RouteResult carries exact From/To points (one point is valid when D=0),
   `/SECONDARY`, no imaginary tray segment IDs, zero extra gaps and explicit
   versioned decision evidence including D/F/T and frame/strategy identity. The
   yellow line joins the equipment; existing protected display endpoint IDs keep
   From/To foreground. No Left/Right changes or cable-position drawing in3D.
5. Reuse unchanged CableDesignLength.Calculate with a Support-created successful
   route of raw D and BOTH legacy secondary-end flags false; S=0 is unused in
   this branch. This preserves the actual C# double→decimal conversion, guards,
   E once, percentage and ceiling. Do not duplicate the engineering computation
   in JavaScript or count `/SECONDARY` as one/two old secondary ends.
6. Adapter/LengthLedger.cs is strict v1/pathfinder-45c24bf5,8KiB, and observes
   flagged approach removal/S replacement. Add an explicit versioned direct
   decision/ledger branch while retaining old v1 exact. Propagate it through
   ModelRunner Request/RetainedRoute (Program319/344), SessionProtocol95,
   shared/pathfinderLengthLedger.ts, server/lengthLedger.ts and strict response
   contracts in server/pathfinder/jobContracts.ts/src/api/pathfinder.ts and
   revision result projections. Record strategy in dependency/provenance identity;
   old results must not be silently reinterpreted as direct.
7. worker.ts37 mergeRetainedGeometryResponse and143–168 retained design request
   currently copy only route/category/prepared and six raw metrics. Carry the
   exact direct decision through design-only reuse, or explicitly disable reuse
   until complete. A retained direct geometry may recalculate E/P correctly, and
   S changes must not add S to its length. Preserve source proposal/dependency,
   model/frame/engine/geometry hashes. Existing geometryHash and
   verifiedDesignOnlyChange bind the engine and allow only S/E/P changes; do not
   weaken those rules or fabricate geometry after a model/location change.
8. UI should explain Direct SECONDARY, D/F/T decision and exact design components
   clearly, retaining ordinary route displays/comparison and all U4/U5 write gates.
   The explicit initial-fill mandate may write a successful current direct result
   only for BOTH blank fields. Existing/partial/0 values still require Review/Apply.

## Coordination, verification and finish

Agree request/response/decision/ledger interfaces before edits. Suggested disjoint
owners: all new C# Support/Adapter/ModelRunner/session/test source; shared/TS
ledger/response/server proof contracts; worker/retained reuse/targeted tests; root
UI/integration/docs and sole actual runtime executor. Preserve concurrent changes;
one designated writer per shared file. Builds/tests use only this isolated
checkout and new owned scratch outputs, never original checkouts or frozen
expected receipts. Installed local SDK was9.0.319 at preparatory observation.

Prove both OR branches, equality, graph-only-shorter negative case, true nearest
vs vertical preference, category exclusions/Instrumentation, empty eligible
network, D=0, nonfinite/overflow/cancellation/frame guards, deterministic ties,
exact C# design/rounding, no double E/S/gap, retained direct E/P/S changes and
preserved normal regression/parity. Preserve105/43 as historical counts until
actually rerun; never regenerate expected fixtures. Check one-shot/session
transport compatibility and strict parser refusal for forged/mismatched decision
or ledger. Run TypeScript/unit regression and independent source review.

Record report67/evidence/progress, exact revision/scope/PASS/FAIL/BLOCKED/NOT_RUN,
clean only new owned unnecessary scratch resources, and local commit. Native
oracle is unavailable and was replaced by converted-model comparison plus human
review; do not repeat entitlement refusals or claim human acceptance. Actual
5191 deployment/engineering Apply remains U7/U8, not an automatic real-data Apply.

Then apply prepare-stage-handoff and immediately execute U7. U7/U8 must supplement
the historical27-table copied recovery audit with all current PF tables, including
five U3 impact and three U4 initial-fill tables. Generic full pg_dump and dynamic
inventory already include these; exact lossless proof requires to_jsonb(t)::text
and string keys rather than JS numeric roundtrips. Stop whole owned API/producers
before captures; no-active-pf_jobs alone is not quiescence. Verify immutable rows
before API startup, keep old impact/mandate epochs unchanged, rotate only
pf_installation_state/revoke restored sessions and prove original mandates cannot
write after restore. Preserve the explicit5191 retirement refusal; never run the
historical5190 default drill. Relevant audit sources: scripts/pathfinder-copied-
recovery/audit-lib.mjs:5, audit.mjs:39/44, scripts/pathfinder-local/runtime-lib.mjs
237/307/414/466, server/operations/service.ts23/119, restore-fencing.test.mjs and
server/__tests__/operationsService.node-test.ts. These are mapped source anchors,
not newly executed restore evidence.
