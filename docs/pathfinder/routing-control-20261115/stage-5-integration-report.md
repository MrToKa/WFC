# Stage5 integration supplement

Parent integration preserved the UI worker's implemented forms, optional defaults and cells, and completed the shared editor/import seams. Observed source on2026-11-15; live browser acceptance still belongs to Stage6.

- Ordinary creation accepts the new manual-protection flag; both filled/protected and filled/unprotected requests queue valid finite-principal calculations. All execution fields support calendar-only validation. New blank routes remain automatic.
- Inline blur compares the retained manual value (including a present null value), rather than mistaking effective automatic Routing for manual input. Entering the current Auto text explicitly protects it; leaving the empty manual editor unchanged performs no write. Both revision fences accompany actual edits.
- Details polls pending AND stale manual jobs with bounded requests and revision guards. A superseded response cannot replace a newer cable revision. Current auto fallback is verified by the server, and missing current fallback is visibly awaiting calculation.
- One effective Routing value gets a subtle pastel semantic tone; comparison uses the actual effective value, including an accepted unprotected import awaiting later Auto replacement. Valid long automatic display text is not subjected to the manual-entry length limit.
- Existing PathFinder help text was updated to explain manual/execution protection instead of promising Apply can overwrite a protected cable. The routing popup links to Cable details for editing protection. Read-only comparison/Show continue independently of write permission.
- Import controller uses explicit review/commit and tagged warning+Viewall action; the full completed report is retained with its workbook identity.

## Evidence
- Original UI workstream report:62 distinct cases across forms, Details, columns/cell and preferences. Those mocked API cases are not live runtime proof.
- stage5-policycopy.log:107 popup,19 Save/Show flow,11 Recalculateall and8 comparison cases passed. One outdated caption assertion failed in the20-case recalculation panel and one Vitest reporting timeout was recorded under load. The assertion was corrected; the subsequent integration run passed all20 recalculation cases. The reporting timeout is not represented as a clean full-suite run.
- stage5-integration-ui.log:20 recalculation panel+6 hook+5 API cases passed. Three Details cases exceeded the runner's default5s under Fluent/modal load (no failed behavior assertion); the final complete Details run used a30s test bound and passed12/12, including both pending/stale old-response guards. Application deadlines were not changed.
- stage4-final-validation.log:29PASS across ordinary length/purpose validators, form, hook and API tests at that revision. Additional unchanged-empty-inline regression added afterward is checked in final targeted validation.
- final-client-typecheck.log and final-parent-lint.log:PASS (empty logs) before final combined build. Server worker validation is recorded separately in Stage3.

Next: wait for worker/report and combined build gates, then exercise the actual local app in the requested in-app browser. Record real routes, length, barriers, Save/Show and workbook behavior; retain the baseline backup and preserve original5180.

## Final accepted Design clarification and browser gate

The user's later decision is implemented: a successful current calculation of the used protected manual route updates Design length automatically when the cable has no execution protection. Details explains this behavior. Final UI validation passed **14 Details cases and 16 list-hook cases**, with client TypeScript and scoped lint passing. Pending/stale manual-job polling refreshes the visible list without resetting the filter, page or dirty edit, and uses revision guards against an older response. Authority-required migrated rows do not trigger endless polling.

The actual in-app browser check corrected an invalid manual route, observed native length 21 being written to Design and ordinary pathfinder history, and saw the visible list update without Refresh or page reload. Execution fields remained unchanged. The integrated browser/import/export/restart evidence and remaining WG-3050-1 input limitation are recorded in `stage-6-report.md`. This final gate supersedes the earlier future-tense next step above.
