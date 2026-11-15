# Automatic equipment-centre fallback — implementation and live gate

## Implemented and locally checked

The user-approved fallback applies to a saved automatically matched equipment bottom anchor that the native engine conclusively identifies inside registered material. Native diagnostics distinguish From, To and both endpoints using the two existing exact occupancy queries; an indeterminate opposite endpoint does not authorize a move. There is no new collision exemption, tolerance, query, budget increase or drilling default.

The server verifies the original saved match, current head/model/frame and source receipt. It tries the centre of the same observed bounds once, preserving healthy endpoints, purpose permissions, project settings and active barriers. A complete successful route/barrier proof and length ledger are required. Manual/picked/RIO fixed points, calculation grants, partial/resource-limited failures and unsupported provenance are excluded.

A short authorized settlement transaction preserves the immutable original failure, validates exact source heads and proof-bound trial points, appends audited centre revisions and retains the full machine trial in a bounded command receipt. Both endpoints update atomically, including deduplication when they share a location. Cancellation or finite-period expiry rolls back all changes. The ordinary global dirty trigger remains active, and the old job retires atomically as superseded. A fresh normal generation must calculate and write actual Routing/Design; a private trial never becomes a result against old dependencies.

Original source object display and same-model reuse retain the centre. Cross-model SDK matching verifies the old source/centre ledger, compares new equipment centre within25cm and creates an ordinary new-model bottom assignment for fresh physical checking. Native cross-model recovery also compares centres correctly, but its new object-derived bottom lacks SDK matching provenance and remains ineligible for this fallback. That separate provenance path is a documented boundary, not fabricated evidence.

## Verification evidence

- Native:544 passing checks across10 suites; `centre-native-gate-summary.json`. Additional actual3820 corpus replays produce TO_ENDPOINT_IN_BARRIER both normally and with reversed output, and a76m full-clear centre route with the original148 barriers. Evidence: `source-correction-previews/WD3820MS-1.DIAGNOSTIC-SIDES-*`.
- Frozen feature:280 passing checks across11 suites; server/frontend types and scoped lint pass. Logs `centre-server-focused-tests.log`, `centre-server-types.log`, `centre-server-frontend-types.log`, `centre-server-lint.log`.
- Independent read-only review covers authority, immutable proof chain, currentness, both-endpoint atomicity, expiry, supersession and shared-location dirtiness. SQL unit tests use transactional mocks; they do not establish actual PostgreSQL acceptance.

## First live run and capacity parity repair

The initial deployment is healthy on5181. Browser enablement creates generation2350/job `597c1bdc-5963-448c-a168-fe777b3b7d28`, with147 parent barriers at revision48. The pump source remains its original head `f205f135-4396-4fd6-ba51-8d55ee0ffc6a`, bottom Z7.980000212564879, history4; no point has been pre-edited.

A live read of current capacity diagnostics reveals UNKNOWN_DRAWING_CATEGORY forBC018/BC019, while free-space restriction is disabled. The new fallback's extra refusal on unavailable capacity data would wrongly prevent its source append, although ordinary successful calculations retain these as warnings. The test is paused normally after39/271 processed; job cancellation and unchanged source are confirmed.

Both normal calculated-route settlement and centre settlement now use the same capacity acceptance predicate: actual assessed blocked route codes refuse, unknown-category diagnostics remain warnings. A65-case regression gate (overlapping the280-case feature gate) passes: fallback26, capacity11 and worker reuse28, with current server types and scoped lint. The regression exercises real capacity execution, full centre proof and source append, preserving warnings in the machine ledger; a genuinely blocked tray still refuses. Evidence: `centre-server-capacity-{regression,types,lint}.log`. Independent review confirms the no-capacity/failure path was not loosened and barrier checks are unchanged.

## Repeated actual acceptance — in progress

API-only correction deployed healthy as `sha256:09d83bc742941483d36f1a876fcf6547e9334da6acdf14917719ce7a6b2b4688`; web `sha256:d30884b49cac3c54f29251bbd88c2d8efe9789d433cc8c73c4f6e088a19b6938`. Original5180 remains untouched and healthy. Re-enabled through the in-app browser at14:45:56 UTC, finite period ends15:15:56 UTC; generation2352/job `f8fb6054-1580-4857-b522-687be8d93812`.

## Actual PostgreSQL centre append — PASS

At15:02 UTC the normal enrolled worker executes the definitive To-side fallback. It appends head `fef01200-4ff4-444c-bac0-902b119e2499`, derivation `matched-model-centre-fallback.v1`, point `[10.89999821977582,82.5349999010227,8.280000212564879]`. This is the exact binary64 centre formula from the observed bounds; its last decimal differs by one ULP from the earlier manually serialized diagnostic preview, so that preview was not copied as a source assignment.

The original head `f205f135-4396-4fd6-ba51-8d55ee0ffc6a` and its hash remain unchanged. History grows4→5. Original failure proposal `017aa760-8a73-43bc-8f7e-c0adbeea08a5` retains `no_path` / `TO_ENDPOINT_IN_BARRIER`. The machine command retains a successful76m trial, `clear-selected-scope`, drilling off and both unknown-capacity warnings forBC018/BC019. No direct point edit was used.

The same source-append transaction retires the old job as cancelled/superseded. The normal producer independently admits generation2354/job `8bde2118-e1b9-4d34-ad29-b6689ee7bb79` with the new head and the same original finite deadline15:15:56 UTC. A complete before/after comparison of all738 source heads proves exactly one changed:15-P3820. The other737 source assignments, including fixed RIO points, are unchanged.

Evidence: `gvl244-centre-actual-append.json`, `gvl244-centre-only-expected-head-change.json`, `gvl244-centre-all-heads-{before,after}.json`, `gvl244-centre-live-monitor.jsonl`. Before-source snapshots remain available in `gvl244-centre-source-before.json` and `gvl244-centre-all-heads-before.json`.

## Actual automatic pair write and browser — PASS

Fresh normal scoped job `ac69519e-6887-415b-86e8-144045283ea5`, admitted with `automaticPairPolicy`, independently calculates the saved current centre and automatically writes Routing `/C001/C002/C003/BC018/BC019/BC069/SECONDARY` and Design76m at15:09:02 UTC. It is not a copied probe or a manual Save. Proposal `69d6b064-60e0-4536-ae68-8f7bf55ee2a6` binds the new head, registry48 and `clear-selected-scope`; receipt `2ce0e852-ba12-4349-9f35-7e09f4f1bc0d` confirms the actual business write. Evidence: `gvl244-centre-actual-pair-written.json`.

The already-open in-app Cables list updates from empty fields to actual Routing, Auto76 and Design76 without Refresh, filter change or page reload. A fresh HTTP endpoint read verifies the same source SDK105296 ACPPEQUIPMENT and the centre point through the complete source/machine ledger (`gvl244-centre-http-current.json`).

The live Show check finds a separate frontend state-decoder omission: backend `/pathfinder/state` returns HTTP200 with the valid unchanged model and new centre binding, but `src/api/pathfinder.ts` omits the new derivation from its local read enum. This rejects the entire state as INVALID_RESPONSE502 and misleadingly reports model unavailable/changed. The exact captured response reproduces the failure; adding the shared centre constant to the existing enum resolves it without weakening unknown-value rejection.80 frontend checks pass, plus client types and scoped lint. Capture replay is opt-in by `WFC_CENTRE_STATE_CAPTURE`; ordinary tests have no machine-specific file requirement. Evidence: `centre-state-frontend-{before-fix,after-fix,tsc,eslint}.log`, `centre-state-frontend-verification.md`.

Web-only deployment `sha256:8675fb122635a6049dea09fcd07b9080ae14bde9b84428fe13e9092b191b1275` resolves actual browser model loading. The API worker is not restarted. After page reload, the model is ready,147 barriers revision48 match, the To field retains the same equipment and Z8.280000212564879, Routing76m is saved, Show is enabled and Save is correctly disabled with no endpoint changes. Show To focuses the actual pump above the floor; Show and Zoom to path render the checked route and equipment approaches. Source history remains preserved. A separate list HTTP refusal is transient: Refresh cables succeeds without page reload; its wording and schema distinguish it from the fixed parser failure.

## Final full-cohort verification — PASS

The original finite period ends normally at15:15:56 UTC after171/271 items of generation2354. The job stops with AUTOMATIC_AUTHORITY_EXPIRED rather than acquiring extra authority. A new explicit supported scoped request selects only the remaining100 admitted, uncalculated items and submits the same automatic pair policy; job `3201b5b8-5e87-4efb-968e-61f29f804188` begins at15:16:43 UTC. The earlier current results are retained. Evidence: `gvl244-current-tail-job.json`, `gvl244-tail-monitor.jsonl`. This does not extend the old authority or reset the completed cohort.

The100-item job completes at15:23:19 UTC with100 calculated,76 automatic pair writes and24 preserved manual pairs. Final all-row checks at15:24 UTC combine the171 current completed results and these100 results:

| Check | Actual final result |
| --- | --- |
| Current clear From/To pairs | 271 |
| Calculated / waiting / failed | 271 / 0 / 0 |
| Actual saved Routing + Design length | 271 / 271 |
| Automatic pair writes with matching values | 191 |
| Protected original manual pairs | 80, exactly unchanged from the initial snapshot |
| Stored automatic lengths matching each latest proposal and value | 271 / 271 |
| Successful unprotected result without a write / value mismatch | 0 / 0 |
| Latest successful barrier proofs | All271 at revision48, clear-selected-scope, drilling false |
| Source assignments changed | Exactly1 of738:15-P3820; all other737 retained |
| Cable identifiers and business totals | Original1223 GVL244 IDs unchanged;3825 global records |
| Execution facts / Delivery drafts / active calculation jobs | 0 / 0 / 0 |

Evidence: `gvl244-all-271-final.json`, `gvl244-all-271-final-support.json`, `gvl244-all-271-verified.json`. These are complete cohort checks, not sampled observations.952 other project cables lack at least one saved From/To and remain honestly input-blocked. The completed results are retained after the finite automatic period; that period is not represented as indefinitely enabled.

Current test runtime: API `sha256:09d83bc742941483d36f1a876fcf6547e9334da6acdf14917719ce7a6b2b4688`, web `sha256:8675fb122635a6049dea09fcd07b9080ae14bde9b84428fe13e9092b191b1275`. No production deployment, push, commit, user record deletion or changes to original5180 were made.

Remaining source boundary: automatic native cross-model recovery creates a verified object-derived bottom anchor without the original SDK bulk-match provenance used by this centre fallback. It therefore cannot automatically apply this fallback to that new native head. A separate native machine-provenance extension is needed to support that path; the implementation does not pretend a missing SDK scan exists. The current saved SDK-match path, current-model persistence, the actual15-P3820 source and the271-cable live cohort are verified above.
