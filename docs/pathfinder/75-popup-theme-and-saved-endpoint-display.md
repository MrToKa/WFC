# Popup theme and saved From/To object display

Product `da95c71c0b542b13491c0f96ef0b000d50594275` on local branch
`pf-popup-theme-and-endpoints-local-20261021`, inheriting report74/abe2c1f.
Evidence: `evidence/cable-workflow/popup-theme-and-endpoints-actual.json`.

The current correction is implemented, technically checked and running on the
isolated5191 installation. Actual Aalborg browser/SDK acceptance remains unverified.
Simplified-Preparer-WFC on main5180 remains the next conditionally authorized task.

## Result

Both cable windows now render Fluent/Griffel styles into their own document and
inherit the application theme. The styled content sits below that document's
renderer; assignment drafts, pending commands and Viewer ownership stay in the
opener. The separate browser window remains movable using its native title bar.

Manual Assign intentionally uses the selected parent's bounding-box bottom centre
for the calculation. A fixed-world binding does not acquire object-following
geometry authority. The missing piece was display recovery: its saved command
already retained an SDK ID, but Show only recovered object-derived bindings.
The normal admin endpoint-context read now returns a separate display-only hint
from an exact successful per-end command matching the current head and preparation.
Show includes those From/To parent IDs in its existing512-object foreground union.
It preserves original route colours, yellow line, filled Ghost and explicit Hide.
Assign itself does not enable Ghost. Coordinates, formulas and approvals do not change.

New explicit Save commands can also retain the selected object's bounded display
name. Logical cable From/To names remain unchanged. Existing successful commands
without the new optional name still recover their SDK ID; the UI shows that ID
rather than inventing a historical name. Coordinates alone imply no object.
Old unsent contexts may correctly require reconciliation after a context hash
changes; successful command replay remains exact. Reload the opener with Ctrl+F5
and close/reopen old popup windows to load the new client.

## Checks

- PASS659 source/mock tests across18 files, including both popup consumers,
  endpoint hooks, command contracts, server reads and foreground visibility.
- PASS11 actual PostgreSQL18 command/auth/transaction tests in a newly owned,
  separate synthetic database. Covers old no-name commands, opposite-end/alias
  reuse, another administrator's no-op, explicit null clearing and stale scope.
- PASS5001-row synthetic ledger lookup:20.190,20.399,20.373ms. This qualifies that
  bounded workload; it does not establish an unlimited history capacity.
- PASS client/server TypeScript, strict changed-file lint, diff checks, independent
  source reviews and production API/web builds.
- PASS limited computer-use appearance fixture5193, with no WFC login/API/model
  connection: actual detached popup Segoe UI,12px panel padding,1px button border,
  dark background rgb(41,41,41), white text; light background white, text rgb(36,36,36).
  Theme changes and Return to page retained the synthetic draft.
- NOT_RUN actual Aalborg reread/SDK/Brave/multimonitor checks because the previously
  saved origin refusal is unchanged. No retry or alternate-origin/browser bypass.
  The user's earlier screenshots establish their observations, not acceptance of
  this new revision. No native engineering parity or human approval is claimed.

Initial checks exposed and repaired a fixture startup race, a historical SQL
fixture missing the genuine preparation session/plan, and test cleanup ordering.
Failed receipts remain separate from the final passed receipts. The first cold
archive attempt failed audit under a64MiB helper temporary filesystem; an actual
model resource is233991168 bytes. A fresh bounded512MiB temporary filesystem
attempt passed. This supports insufficient temporary capacity as the cause; the
generic first audit failure did not expose a more specific private error.
An activation guard also correctly refused before mutation because its in-memory
undefined fields differed from omitted JSON fields. JSON-compatible comparison
was repaired after confirming actual container identities/configurations matched.

## Runtime and preservation

Only owned5191 API/web were recreated at2026-10-21T08:44:11.712Z:

- API `sha256:f837f52afd0c6913a45457979c286ed6727111b95fafeafa832bc8063a57ba16`.
- Web `sha256:5c83f8165da77cd5a83b3f397cb5849cc8e322261bfde123f1bd8754669e2105`.
- Owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, compose `wfc-pathfinder-local-0cba87606e9b`.
- Runtime `pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`.
- Project `1af0f807-7653-40ea-8391-7eea6c54e7d4` on `http://127.0.0.1:5191`.

Fresh complete cold archive `9e6698af-7659-4ed1-9996-d27c341228ca` is in
`pathfinder-engine/.scratch/popup-theme-endpoints-update-20261021-2/cold-backup`;
3159402059 bytes across its manifest members. It includes the database, MinIO,
staging, PF artifacts and four image archives, with a separate private companion.
Its readback audit and archive verification passed. No restore was executed by
this correction; previous restore receipts are historical evidence only.

Actual calculation identity was compared before/after and remains
`ebb19973d052848e544e5d75e382f599498453375a6478ef84000c306836021d`.
Served computational runtime `bf4c8f76e63a04d6f08c0a618238bb5a417219433df1fc7700072363340e06a8`
and adapter `21469bc088a33d3a3fb28a5a2d9e25b8b07cada9d5f7ff3894d877c7fd8eaadc` match.
Health200 and both updated service health checks passed. PostgreSQL/MinIO
identities/configurations were preserved; MinIO was temporarily stopped/resumed
for the cold archive. Outside container identities/configurations were preserved.

Post-update read-only hashes match the archive for cables, cable types, projects,
trays, model versions/selection, locations/aliases, binding heads/revisions/commands,
jobs/items and proposals. Whole isolated DB includes2153 cable rows over5 projects;
these are not claimed as2153 Aalborg cables. No Save, calculation, grant, Review,
Apply or new migration was issued. API startup's existing idempotent schema
initialization is unchanged. No original5180/5190, source checkout or synced source
was edited. Test containers were retired by exact owner/name/ID; fixture5193 tab,
server and two generated files were removed. Needed archives/evidence and
historically refused paths remain. No global Docker prune.

## Repository and next step

Original WFC remains clean `main` at96e63f13fdc2b1d30b8f8ff658dd662f25fac104.
GitHub main was read at that same revision on21October2026; no PR exists for this
local correction branch. Cached origin/main was3behind/134ahead at the product
commit; that is not a remote parity or CI result. No push/PR/merge occurred.

Use `handoffs/PF-U7-popup-theme-and-endpoints-browser-check.md` for the remaining
actual browser check. It preserves the user's required sequence: finish PF checks,
then resume Simplified Preparer with a fresh main5180 inventory and backups.

Synthetic appearance evidence (returned-to-page panel; not Aalborg/native popup):

![Synthetic popup styling check](C:/Users/todor.chankov/.codex/.chatgpt-projects/g-p-6ad0a317833c8191bf8e4e8c824a1056/work/pf-popup-theme-endpoints/browser-fixture-return.png)
