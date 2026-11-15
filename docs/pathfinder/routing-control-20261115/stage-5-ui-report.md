# Stage 5 UI implementation report

Implemented against the Stage 1 policy and the shared `CableRoutingReadView` supplied by the backend workstream. This report covers the independent UI workstream; end-to-end acceptance remains gated by the server/calculation stages and the parent's in-app browser checks.

## Delivered behavior

- Cable Details shows the used route, saved manual route, readonly automatically calculated route, automatic result status, manual-route length/status and execution fields. The existing automatic-length projection remains separate from Design and installed length.
- The shared cable editor includes manual route protection, installed length, Pull date, Connected From, Connected To and Cable tested dates. A real route text change checks manual protection; clearing it removes manual protection. Explicitly unchecking it remains possible without erasing the saved text. Opening an automatic cable does not copy its used automatic route into the manual field.
- Writes include available cable/control revisions. Legacy DTO fixtures remain compatible without supplying unavailable fields.
- Execution protection remains visible after dates are cleared. Unlock is explicit, with a reason, after the execution facts have already been cleared and saved. A refused single-cable PATCH keeps the editor open and states the cable tag, protecting fields and that no changes were saved. The parent implements partial acceptance specifically for imports.
- Pending manual lengths refresh automatically, with at most 30 reads and 1.5/2 second intervals. A completed older response cannot overwrite a newer revision or stop the pending refresh. Cleanup prevents cross-cable/unmounted updates.
- The five execution columns are selectable and hidden by default. Explicit client/server defaults preserve the earlier default subset; stored personal selections remain intact. The list displays installed length and the four dates and passes selected columns to export.
- Routing cells use the shared blue/green/gray/orange semantic palette mixed with the Fluent background for subdued light/dark presentation. Warning takes priority. Tooltip content exposes used/manual/automatic routes, execution reasons and diagnostics on focus and hover; the value remains keyboard focusable.

## Ownership and integration

UI changes: `src/pages/CableDetails.tsx`, `src/pages/ProjectDetails.forms.ts`, `src/pages/ProjectDetails/CableDialog.tsx`, `src/pages/ProjectDetails/CableListTab.tsx`, and new `src/components/pathfinder/CableRoutingValue.tsx`.

Column preferences: `src/api/cableListPreferences.ts`, `server/models/cableListColumns.ts`, `server/routes/userRoutes.ts`. The only shared `ProjectDetails.tsx` change was the completed visible-field list; the parent owns subsequent import-dialog edits.

Backend DTO and mutation policy were not changed by this workstream. The parent owns `useCableListSection`, import/export/API upload/toaster integration and browser acceptance. The parent was notified that inline routing must compare the persisted manual route rather than the effective automatic route, and submit manual intent plus available revision fences.

## Verification

All tests use isolated mocked APIs; no live project records were changed by this workstream.

- `src/pages/cableRoutingForm.test.ts`: 6 passed. Manual edit/uncheck/clear behavior, separate automatic values, revision fences, calendar validation, non-negative installed length.
- `src/pages/CableDetails.test.tsx`: 11 passed in the full targeted run. Includes route editing/protection, separate readonly automatic route, execution date submission and refusal diagnostics. The strengthened pending-length regression passed separately after adding an older completed response followed by the current completed result.
- `src/pages/ProjectDetails/CableListTab.test.tsx`: final complete run 12 passed. Covers the five hidden execution columns, selection persistence and export, existing inline fields, personal settings and failures.
- `server/routes/userRoutes.test.ts`: 29 passed, including explicit defaults without execution columns.
- `src/components/pathfinder/CableRoutingValue.test.tsx`: final run 4 passed. Covers tone priority, keyboard tooltip in light/dark themes, and hover with concrete execution reasons and diagnostics.
- Client `tsc --noEmit`: passed after final runtime changes, log `D:/WFC-Test/validation/routing-control-20261115/ui-tsc-client-final.log` (empty).
- Targeted ESLint: passed, log `D:/WFC-Test/validation/routing-control-20261115/ui-eslint.log` (empty).

The initial combined run exposed timeouts from repeated accessible-role queries in the new column-selection test. Cached label queries removed the unnecessary cost; the final complete column suite passed with unchanged 20-second runner timeout. No application deadlines were increased. Existing Fluent modal tests take several seconds each in this environment.

Detailed logs are in `D:/WFC-Test/validation/routing-control-20261115/`: `ui-routing-full-tests.log`, `ui-columns-final-tests.log`, `ui-pending-revision-regression.log`, `ui-cell-final-tests.log` and the type/lint logs above. The first combined log retains the superseded timing failure for audit.

## Remaining acceptance

Parent in-app browser checks must verify real saved manual/automatic routes, execution conflicts and unlocking, pending length completion, dark/light color visibility and hover behavior against the integrated server. The UI does not itself calculate route geometry or mutate installed length from a calculation.

## Clarification delta: used manual route automatically updates Design

The user's later clarification makes a successful calculation of the used protected manual route update Design length automatically when there is no execution protection. The backend owns that write/history and the unchanged execution-protected exception. The UI now explains both rules beside the manual-derived length. Details' existing pending/stale polling remains intact; its tests now show a current completed projection updating both manual length and Design to 21 while rejecting an older completed response.

The parent released `src/pages/ProjectDetails/hooks/useCableListSection.ts` and its existing test file for this delta. Its seven import-review/inline-intent tests and controller behavior were preserved. A bounded two-second read loop observes only eligible pending/stale rows on the currently visible page. It excludes `MANUAL_CALCULATION_AUTHORITY_REQUIRED`, pauses during writes/reloads/imports and skips open editors or dirty rows. It never submits a calculation or resets the current page/filter. Only the targeted visible IDs merge; project/login/request/write epochs and cable/control revision comparisons reject superseded responses. Each stable owner/page/filter/write session has a thirty-read cap.

Whole-list draft synchronization previously rebuilt every inline form whenever any cable changed. It now reconciles untouched forms and preserves dirty drafts, so observing one completed manual result cannot erase another cable's unsaved edits. Explicitly disabling inline editing retains its intentional draft reset.

Verification for the delta:

- Details: **14 passed**, including pending and stale completion to Design 21, readonly automatic values, execution-protected/unprotected rule text and all existing material/history tests.
- Hook: **16 passed** in the final focused run. Nine added cases cover visible-only Design 21, page/filter retention, another dirty draft, older cable/control revisions, edits begun during a read, project and login switches, legacy authority-required exclusion, the thirty-read limit and in-flight user writes. The parent's seven cases also passed.
- Initial combined run: **29 passed** (Details14 + then-current hook15); the extra control-revision case subsequently passed in the final hook16 run.
- Client typecheck passed after the implementation. Targeted lint and final checks are recorded in `D:/WFC-Test/validation/routing-control-20261115/ui-manual-design-poll-tsc.log` and `ui-manual-design-poll-eslint.log`. Test logs: `ui-manual-design-poll-tests.log`, `ui-manual-design-hook-tests.log`.

Only the UI files/tests and this stage's prompt/report were changed by the delta. Runtime UI files were declared frozen to the parent for the web rebuild; browser/server acceptance remains with the parent.

## Automatic calculation live business-value refresh

The GVL244 audit found that an already mounted Cable list retained its initial ordinary cable rows while an automatic job later saved Routing/Design. Manual pending-length polling could not observe those automatic writes. The list now observes the small recalculation context only while the Cable list tab is active, then rereads the currently visible clean rows when processing/save progress changes and during the final save drain. Navigating to a different page/filter after completion also gets those visible records again.

The parent added an authorized project-scoped GET selector for 1–100 unique UUIDs. `fetchCableRows` uses that selector and the existing actual cable DTO; Routing and Design come from the business row, never from a proposal or inferred automatic result. Both the new automatic observer and the earlier manual observer now use bounded row reads instead of periodic full-project cable-list downloads. Initial ordinary list loading remains unchanged.

The observer preserves paging, filters, personal column settings, dirty inline drafts and open editors. Existing project/login/request/write and revision fences reject superseded responses. A 503 keeps old values and retries with exponential backoff. Paused, expired, blocked or inactive calculations stop; denied/unsupported status responses stop without a toast. An administrator may observe another login's live job without acquiring or renewing calculation authority. Reads stop at the finite authority deadline, with an additional hard thirty-minute/900-context-read bound.

Focused verification: **39 passed** (`useCableListSection`29 + cable API10), including actual Routing/Auto/Design122 updates, bounded IDs, final drain, post-completion filter navigation, stale revision rejection, project switch and dirty-edit fencing, GET503 recovery, terminal stops and denied/other-login behavior. Log: `D:/WFC-Test/validation/routing-control-20261115/ui-auto-business-live-tests.log`. Final client typecheck passed (`ui-auto-business-live-tsc-final.log`, empty); targeted lint passed (`ui-auto-business-live-eslint.log`, empty). A separate CableListTab regression passed **1/1**, checking actual saved values render without remounting (`ui-auto-business-cell-test.log`).

Parent wiring adds only `active: selectedTab === 'cable-list'`. No rendering/selection logic was changed in CableListTab; the underlying list receives current rows. Runtime files are frozen for the parent's deployment and in-app browser test during a fresh 271-cable run.

### Resume after cancelling the only visible editor

The parent's actual browser audit found a missed observer dependency: opening the only visible cable editor correctly paused background row merging, but Cancel did not change the observer's previous dependency keys. It could remain stopped while the saved row changed, including a job that completed during the edit.

The minimal correction adds the clean visible cable IDs to the observer effect dependencies. A transition from no eligible rows back to a clean visible row now starts a fresh authorized context/row read. The stored Delivery is retained and the local discarded Delivery draft is never submitted.

Focused suite: **42 passed** (hook32 + API10), log `D:/WFC-Test/validation/routing-control-20261115/ui-auto-observer-cancel-tests.log`. Three additional regressions cover a filtered only-row modal Cancel during an active/completed job and discarding the only dirty inline row after completion. They assert actual Routing/Auto/Design updates without remounting, unchanged filter, preserved draft while editing, no Delivery write and no whole-project reload. Existing403/unverifiable status, ownership and older-revision cases remain passing. Targeted lint passed (`ui-auto-observer-cancel-eslint.log`, empty), and owned-file whitespace checks passed. Runtime fix contains only the eligibility key and dependency.

Actual in-app browser acceptance after the web-only rebuild: filtered -WD3120MS-1 while its current job was waiting; opened Edit, entered an unsaved Delivery draft and clicked Cancel. Without Refresh, reload, filter navigation or remount, the same row changed from empty Routing/Auto/Design to `/C001/BC015/BC016/BC017/SECONDARY`, Auto67 and Design67 after the native calculation at 13:29:12 UTC. A separate database read confirms Delivery remains null. All 188 successful unprotected automatic pairs in the full job were written, with no saved-value mismatch. Final job completed 13:29:13 UTC. Deployed web image `sha256:196d6c1a08fe1179d69b5ef99258828a0c761ffe712dae188299aeedab682f0f`; the API worker was not restarted during the test.
