# Stage 4 — Excel review, execution facts and partial conflicts

Implemented locally on 2026-11-15 against HEAD cf7c64d plus preserved dirty work. Runtime deployment has not happened yet. Stage 2 persistence and the native Stage 3 contract were available; the TS manual worker gate remains independent and in progress.

## Behavior delivered
- Typed protect/preview/revision options, protect OFF by default, review dialog and explicit commit. Switching protection re-previews the exact retained File. Old/other-project preview responses are ignored. Unknown or stale commit is never automatically replayed.
- Server preview follows the real prepared import transaction and rolls back cable/control/job/history/material changes. A digest binds every imported business ID, before-write cable and control revision, auto projection and selected type. Commit checks under project-first and cable locks, returning409 if the preview is retired.
- Column presence distinguishes absent vs blank. Filled ON/OFF and blank ON/OFF follow shared intent rules. Execution conflicts retain only that cable's route, continue unrelated fields/rows and return complete tags+all execution reasons. Initial execution report accepts the permitted route and freezes it AFTER its write. Sticky locks survive cleared dates.
- Five execution columns support aliases, integer installed length, real calendar dates and1900/1904 Excel serial cells. New/edited calendar dates reject impossible days before writes.
- List export preserves one effective Routing column with shared soft semantic fills and notes. It supports selected execution columns, real Excel date cells formatted yyyy-mm-dd, editable fields and existing ID protection. List template includes the execution fields. Colors never control import interpretation.
- Toast summaries show first5 blocked tags with all their reasons and a View all action retaining the complete report. Ordinary creation also honors the new protection checkbox, binds an authenticated manual job and preserves creation history.

## Evidence
- stage4-focused.log:86PASS across8files (19 policy,16 Excel helper,33 existing export/routes,7 dialog,6 hook,4 cell,1 API at that run). Later API tests add4 explicit upload-option cases; see subsequent integration log. No summed count is claimed across overlapping runs.
- Hook cases cover explicit manual entry equal to Auto, manual clear, reviewed file/digest commit, protection toggle/old response, unverifiable and other-project preview, complete tagged toaster/report. Full workbook helper roundtrips verify cell fills/notes.
- stage-4-import-http-postgres-report.md: real production schema, real HTTP/JWT/current-role/project gates, genuine multipart XLSX, no mocks. Latest26 functional cases passed; the optional5000-row import+unchanged replay passed in a prior scale-enabled run (103.6s). Temporary databases were created on verified isolated55432 PostgreSQL, dropped and absence checked. Application DBs were not mutated by these tests.
- Earlier parent server/client typechecks and targeted lint passed. Final combined server typecheck temporarily exposed a peer-owned test-fixture typing issue during Stage3 integration; it is not marked complete until corrected in the combined gate.

## Next gate
Finish causal manual worker and immutable currentness verification, then build the combined source and deploy ONLY the5181 test stack after confirming the baseline backup. Stage5 component evidence is separate; Stage6 must verify the new behavior through the in-app browser and record exact runtime outcomes. Existing historical tests are not browser acceptance of this change.
