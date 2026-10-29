# From/To foreground after automatic cable-list updates

Product `1e844ed57926acc92f19e67a23dc78e134e55cea`, local branch
`pf-endpoint-show-consistency-local-20261021`, inherits `06c7259` and report76.
Evidence: `evidence/cable-workflow/endpoint-show-consistency-actual.json`.

## Cause and correction

The screenshot's cable was inspected through bounded read-only SQL and the
production command-display reader, without a login impersonation or cable write.
Its calculation's cableWriteRevision differs after the automatic fill. Both
saved fixed-world heads, points, model selection and named object hints still
match. The old foreground resolver rejected every endpoint solely because the
proposal was marked stale. The runtime then correctly ghosted all objects absent
from its supplied foreground list. Restarting containers does not repair that
decision; it also does not replace JavaScript already loaded in an open tab.

Show now checks display evidence separately from write eligibility. An unchanged
model/selection/fingerprint/artifact and exact current head/point/command proof
keep their From/To object IDs even after a cable-list fill. Object-derived
geometry retains its immutable-record hash checks; legacy bindings retain exact
confirmed revision/point/model checks. Review/Apply staleness and all calculation,
binding, shared reuse and initial-fill policies remain unchanged.

A second omission path silently swallowed display API failures/timeouts and
showed just the route. Such failures now reach the existing retry notice before
changing the view. A successfully read coordinate-only binding remains a point;
the code never guesses an object from its name or coordinates. Hidden/Off policy,
parent descendant handling, route points, yellow line and Ghost remain unchanged.

Close old cable popup windows, reload the main5191 tab with Ctrl+F5, reopen the
cable and use Show. If a real endpoint/model has changed, recalculate and inspect
its current result rather than borrowing an old display identity.

## Validation

- PASS255 regression tests across5 files: foreground resolver, result panel,
  cable workspace, routing popup and Path Finder tab. Covers stale-after-fill
  fixed-world and object-derived objects, stale mismatched heads/points/models,
  failed read retry without view mutation, unchanged Review/Apply and cancellation.
- PASS49 runtime tests, including a new tray + two parent endpoint subtree union,
  original colors/opaque foreground, successive routes and complete Clear restore.
- PASS client TypeScript, strict lint of3 changed TS files, diff check, independent
  source review and production web build (which also builds server sources).
- PASS real selected cable read-only diagnostic: both endpoint heads/points and
  saved named hints match despite the changed cable write revision. This is not
  actual browser rendering or engineering acceptance.
- NOT_RUN real Aalborg browser/SDK/native-window/multimonitor checks: the existing
  saved origin refusal is unchanged. No retry or alternate origin/browser bypass.
  The first JSON-only regression run was cancelled by root for progress reporting;
  it has no passing result claim. The final verbose run passed all255 tests.
  An initial diagnostic script used a nonexistent alias column; the read rolled
  back, the script was corrected to the real display_alias column, and final
  read-only checks passed. No product schema change was needed.

## Isolated delivery and preservation

Only the owned5191 web service was recreated at2026-10-21T09:46:54.522Z:
`sha256:4fd5982ca8c68fe40c358d16925f1f3eab1e46faf92b09a3d365e9f9da165732`.
Owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, compose
`wfc-pathfinder-local-0cba87606e9b`, runtime
`pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`.
Project `1af0f807-7653-40ea-8391-7eea6c54e7d4` remains on5191.
Health200 and updated web health PASS. API image/container/start time, PostgreSQL
and MinIO identities/config/start times are unchanged. Outside container identities
and configurations are unchanged; the already restarting original
`wfc-app-backend-1` changed its start time externally, with the same image. No
management of that container was issued or authorized by this correction.

Fresh static web rollback archive:55313920B, SHA256
`dc8a4645a5f23e467368427a3b2f696b9d5eec044006250158cc607a281e76a2`,
in `pathfinder-engine/.scratch/endpoint-show-consistency-20261021/deploy`, together
with separate private runtime metadata. The earlier full cold archive
`c388f3f6-dada-4f05-9faf-6b0b9f628907` remains retained; it was not recreated or
restored for this static-only update. No database/model writes, migrations, Save,
calculation, grant, Review or Apply were issued. Original5180/5190, original
checkouts and synced sources remain untouched by this task.

Forced engine identity read still equals
`ebb19973d052848e544e5d75e382f599498453375a6478ef84000c306836021d`.
Served computational runtime `bf4c8f76e63a04d6f08c0a618238bb5a417219433df1fc7700072363340e06a8`
and adapter `21469bc088a33d3a3fb28a5a2d9e25b8b07cada9d5f7ff3894d877c7fd8eaadc`
are unchanged. No new test server/container was created; the owned cancelled
test process exited. Needed receipts/rollback are retained, foreign `.pf0-work/`,
`.pf2-work/` and historically refused paths untouched. No prune/push/PR/merge.

Original WFC remains cleanmain96e63f13. Last live GitHub main observation was
96e63f13 at2026-10-21T09:18:55.180Z; this timestamp is not refreshed by this report.
No PR returned for this branch. Cached main3behind/138ahead at product is not
remote parity; unpublished feature CI NOT_RUN.

Next prompt: `handoffs/PF-U7-endpoint-show-browser-check.md`; actual browser
verification remains the first unfinished prerequisite before queued Preparer.
