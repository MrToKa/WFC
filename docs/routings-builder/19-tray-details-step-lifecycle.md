# Tray Details STEP lifecycle and status

## User behaviour

Materials tray Details now embeds the same canonical STEP editor as the list's
STEP file action. Administrators can add/replace STEP, download any revision,
remove the current STEP with confirmation, and restore a historical revision.
Readers can inspect/download files. The shared Materials catalogue remains the
single source for Routings builder.

Removal retires the active selection rather than physically destroying revision
files. No earlier revision is automatically promoted. The tray then has no current
STEP for new catalogue selections; previously pinned project placements retain
their geometry and history. Restore explicitly selects a historical revision as
current. File/metadata immutability and one-current-revision constraints remain.

Trays table and Details use explicit semantic-colour/text badges: green STEP
attached, amber No STEP; loading/error remain neutral and do not claim a missing
file. Table status is loaded in one catalogue request, not a request per row. It
refreshes after upload/removal/restoration, dialog closure and list Refresh.

## API

- DELETE /api/materials/components/:componentId/cad-assets/:assetId: admin only,
  204 when the current revision is retired. Missing/mismatched identity404,
  inactive409. Changes only active; no object deletion.
- POST same asset path + /activate: admin only, strict JSON
  {expectedActiveAssetId: UUID|null}. Component row lock serializes lifecycle and
  publication. Stale current selection409; success200. Deactivate then activate
  inside the transaction preserves the one-active-revision index.
- Existing history/download/upload endpoints remain canonical.

No schema migration was needed. Protected references and source objects persist.

## Verification — 2026-11-10

- 34 API tests: 24 lifecycle and 10 existing route tests passed.
- 10 component editor, 4 table status, 9 Details and 17 Materials regression tests
  passed: 74 tests total.
- Frontend/server typecheck and ESLint checks passed; both Docker images built.
- Deployed only PoC API/web on 5181. Original WFC containers retained their start
  times and zero restarts; main and port5180 were not changed.
- Deployed API tested no-op activation of current revision, stale selection409 and
  missing-asset retirement404. History before/after was identical. No existing
  asset was retired merely for a test.
- Browser confirmed Details upload/download/remove/restore controls, removal
  confirmation and Cancel, active status, plus mixed green/amber badges in Trays.
- Local screenshots: .data/tray-details-step-crud.jpg and
  .data/tray-step-status-colors.jpg.
