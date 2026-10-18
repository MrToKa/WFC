# PathFinder registry

All project routes are mounted at `/api/projects/:projectId/pathfinder`, behind
the existing authenticated project routing and a fresh database `requireAdmin`
check for every method. Mutations repeat administrator authorization under
`users FOR SHARE`, after the project lock, and retain that protection to commit.

`PF_ROOT` must be an explicit absolute, private, persistent directory belonging
to this isolated installation. Immutable computational snapshots are stored at
`PF_ROOT/snapshots/<server-generated-artifact-UUID>.json`; HTTP clients never
provide paths. Files are published without overwrite and bound to database
SHA-256/length identities. A failed SQL publication may leave an unreferenced
owned snapshot; retain it for scoped maintenance rather than deleting unrelated
storage. No startup code performs general storage cleanup.

* `GET /state`: current active model, exact decimal Project Details values,
  cable write revisions, shared locations/bindings, latest computational artifact.
* `POST /locations`: name, aliases and expected registry revision.
* `PUT /locations/:locationId/binding`: explicit canonical world-metre point,
  optional validated object identity, expected model selection and registry.
* `POST /artifacts`: bounded canonical PF-2 snapshot, active model identity and
  expected revisions. The server rebinds the project/model envelope and hashes
  the resulting bytes. Model content fingerprint must match the selected model.
* `POST /match`: exact conservative matching for both cable endpoint columns.
  Duplicate candidates and unknown native visibility require manual review.

Engineering punctuation and leading zeroes remain significant. Comparison uses
NFC, outer trim and invariant uppercase; display text remains separate. Aliases
are unique per project and point to a single location identity shared by From/To
and all cables. Bindings are per model version; a historical binding remains
visible as stale and is never silently transplanted to a new model.

Artifact capture claims, a successful visual load or fitted geometry never grant
engineering acceptance. Uploaded artifacts have `engineeringAccepted=false`,
enforced in SQL. The unresolved native/converted reference gate is independent
of the location registry and must not be bypassed with client data.

`cable_write_revision` is owned by a database trigger, distinct from the user's
engineering revision string. Relevant business mutations advance it even when
the original value is later restored. Pure material bookkeeping does not. New
PF apply operations must compare it and protect all dependencies until commit.
