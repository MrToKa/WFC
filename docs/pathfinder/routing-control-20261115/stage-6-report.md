# Stage6 — actual local application and in-app browser acceptance

Observed2026-11-15 in the isolated5181 stack, restored DB wfc_restored_20261113 on wfc-test-postgres127.0.0.1:55432. Base repository cf7c64d3845aa42276c10743b62a146b5f3ce77d plus preserved pre-existing and new working changes. Original5180 containers were not rebuilt/restarted. No remote publish/push.

## Backup and startup
Baseline dump before migrations: D:/WFC-Test/validation/routing-control-20261115/baseline.dump,115367137bytes. Current database/role and container ports were asserted before startup. Combined API/web builds and repeated isolated startup succeeded. Initial migration mapped3825cables,2642nonblank routes→protectedmanual,0execution locks. WG4022 retained route/Design21/writeRevision5; WG30501 retained empty route/Design/writeRevision1; PH03603 retained its existing route/Design24/writeRevision7. Two clearly named owned validation cables were created through the real API, with the existing confirmed WG4022 shared endpoint names.

## Observed browser results (all PASS)
|Check|Actual observation|
|---|---|
|Saved locations/model loading|Saved From/To names were reused. No FindandAssign operation was submitted. Reopened model retained searched1083/1091,kept727. Loading showed progress without premature error; ready state showed148savedbarrierparents,revision47, matching current frame.|
|Optional execution columns|All5 initially unchecked. Enabling showed values and export fields. They were restored OFF after checks; old selections retained.|
|Tooltip/colors|Keyboard focus exposed manual/auto/protection/diagnostics. Soft warning and execution tones readable in dark/light. Dark warning background rgb≈84/81/77 with white text; light warning≈255/252/248 with dark text. Theme restoredDark.|
|WG4022 unchanged Save|Real Details Save activated the pending migrated manual check with the real login, exact raw path retained. Native clear result21m, drillfalse, barrier snapshot e8bbb8c2… registry47. Business route/Design/writeRevision5 stayed unchanged. Readonly manual length21 appeared automatically.|
|Automatic persistence and Show|Owned fixtureA calculated /BC067/BC056/SECONDARY,Design21 and saved through real automatic pair receipts with no humanApply. Show became pressed/Hide after the verified model display. Recalculation also saved when Routing was empty but Design21 already existed, despite import/edit history.|
|Execution dates|UI saved Installed21 and all4dates2026-11-15. Those facts froze the used route. A conflicting route edit was refused; later mixed import named the fixture and all5 reasons.|
|Sticky lock/unlock|Clearing execution fields left execution_locked=true and original execution route intact. Separate reasoned unlock released it. A stale historical free result was kept for display while used route became pending/null.|
|Current free fallback|After a fresh free calculation, explicitly protecting an identical manual route and then clearing it selected the verified current Auto path21m. Manual text/protection cleared; current used route stayed /BC067/BC056/SECONDARY.|
|Mixed workbook|Actual two-row .xlsx uploaded in IAB. Preview default protectionOFF; togglingON re-previewed1manualprotection. DB read beforecommit proved no write. Commit retained protectedAroute but updated itsDelivery; allowedBroute/Delivery saved.|
|Toaster/report|Displayed protected fixturetag plus Installed/Pull/From/To/Tested reasons. Viewall reopened the complete report. Reimport showed0new,0updated,2unchanged; existing protection preserved.|
|Invalid manual|FixtureB /DOES_NOT_EXIST retained exactly, with MANUAL_ROUTE_REQUIRED_TRAY_UNAVAILABLE and the missingcode. Earlier derived21 remained explicitlyinvalid, with no automatic route substitution.|
|New Design rule|After correctingB inline, native manual result21 automatically wrote Design21+pathfinder history. Visible list updated without Refresh/reload; filter remained. Receipt moved writeRevision3→4, historyversion5. Install/dates stayednull.|
|Filter recovery|InternalTAB search produced supported-filter warning. Corrected/trailingTAB search normalized and returned1matchingAwithout reload.|
|WG30501|Found normally inAllnonMV. BothFromandTo showNo model object assigned; current calculation reason asks to resolve both. No endpoints were fabricated. This input issue does not stop other cables.|

The temporary PF browser tab was closed. The original IAB tab is left open on real WG4022 Details with manual/auto path and21m visible. Screenshots were captured in the browser transcript; no standalone screenshot file was emitted by that surface.

## Actual exported workbook
Browser download C:/Users/todor.chankov/Downloads/004-cable-list (1).xlsx was inspected using ExcelJS. Copied evidence: D:/WFC-Test/validation/routing-control-20261115/browser-validated-export.xlsx and stage6-export-inspection.json. One visibleCables sheet, exactlyoneRouting column, twoownedrows, no metadata sheet. AexecutionfillFFF2F3F5, BinvalidwarningFFFFF2DB; notes include both routes/status/diagnostic. Installed21numeric; fouractualExcelDatecells2026-11-15 withyyyy-mm-dd. Color was never used as import authority.

## Independent mathematical and scale gates
- Backend final Design clarification:626/626 across17files, including35actualworker PostgreSQL cases and4freshnativechild calculations; TypeScript/lintPASS.
- Frontend Design refresh:Details14+hook16PASS; typecheck/lintPASS. Earlier domain/import/export/column/auto-flow evidence remains in stage reports with its exact revision/scope.
- Native BC182 geometry follow-up:26/26PASS. Used5→7m span yieldedDesign32→35 afterfullformula; unusedpartialextension25→25 withidenticalpath/ledger. Literalstraight extension crossedSECONDARYthreshold and gave21→17. No nominaldelta is blindly added.
- Real HTTP/PostgreSQL XLSX tests:27distinctpassingcases plus unchanged-full-form regression. 5000rows+unchangedreplay passed in103.6s. All uniquely owned fixture DBs were dropped/absence checked.

## Scope and completion
Real converted-model proof is WG4022/owned same-endpoint fixtures with148activebarriers; broad route/geometry corner cases use documented native/SQL fixtures. No physical real-model BC182 geometry was edited merely to test a formula. Manual text is not auto-renamed. Nominal tray length changes require the model/prepared geometry to represent the physical section.

## Final restart, cleanup and completion — PASS

Final API restart completed at `2026-11-15T10:53:10Z`. Before deleting the owned validation rows, a database read proved that fixture A still had its automatic route `/BC067/BC056/SECONDARY`, Design 21, `manual_routing=null`, `manual_protected=false` and no execution lock. Repeated initialization therefore did not reclassify a future automatic route as a migrated manual route.

The final cleanup exposed an older cable-to-job-item cascade that attempted to delete an immutable automatic mandate. The repair drops only the live-cable foreign key on `pf_job_items`; job/project ownership, proposal/receipt references and immutable mandate guards remain. Historical admissions remain readable after a cable is deleted, and a new admission for the missing cable is refused. Four actual PostgreSQL regressions reproduced the old refusal, verified repeatable migration, checked unchanged audit records, checked missing-cable refusal and checked whole-project deletion. The complete focused gate passed **170/170**; server TypeScript and scoped lint also passed. Evidence: `D:/WFC-Test/validation/routing-job-audit-delete.log`, `routing-job-audit-delete-types.log` and `routing-job-audit-delete-lint.log`. These audit cases overlap earlier gates and are not an additional 170 distinct tests to add to the 626 backend count.

Both owned fixtures were then deleted through the ordinary authenticated API, using a still-valid existing administrator login and checking exact project/ID/tag first. Both requests returned HTTP 204. No triggers or immutable guards were disabled. The two job items, proposals, mandates, dispatch records and apply receipts each retained identical before/after SHA-256 hashes. Owned live controls, control events, manual jobs and manual results were removed by the normal cable deletion. The retained historical audit is intentional.

Restored database totals: **3825 cables, 2642 protected manual routes, zero execution locks**. The original WG-4022 route and Design 21/write revision 5, WG-3050-1 empty route/Design/write revision 1, and PH-03603 route and Design 24/write revision 7 all match the business baseline. No original cable was deleted. Cleanup evidence is `D:/WFC-Test/validation/routing-control-20261115/stage6-final-cleanup.json`.

Final runtime evidence is `stage6-final-runtime.json` in the same validation directory:

| Surface | Final image | Verification |
| --- | --- | --- |
| Local API | `sha256:3be8d128ce75d0c35d8be039c38c26602dfda25e3bc85e14d9f8fe9287ba8dc4` | Running, healthy |
| Local web, port 5181 | `sha256:6593ce16284b4c932fe9107de9175e9311902b15746c828ea437458294a470ea` | Running; HTTP 200 |
| Original web, port 5180 | `sha256:a9226e283b2bb2810bdf48484cd776d4bb6e6d92aad3706419f6c8724c6543d0` | Healthy; still started on 2026-11-14 |
| Original API | `sha256:ec6fc3cf89dc9fea8ae201e9507655ba6534f608070b79480a81910ae89ff451` | Healthy; still started on 2026-11-14 |

The final audit-only change was rebuilt and deployed to the isolated API; it lies outside the calculation implementation identity. No web or native calculation source changed after the recorded browser acceptance. Final `git diff --check` passed (only Windows line-ending notices). All six planned stages are complete. No remote commit, push or production deployment was performed.
