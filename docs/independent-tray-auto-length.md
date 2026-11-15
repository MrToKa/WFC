# Assigned-tray Auto-length

In Edit tray, Auto-length measures the objects assigned to this tray in Path Finder.
It does not require a complete or published routing network. The first measurement
loads the protected model, captures only those assigned roots, and uses the same
centreline fitting engine as route visualization. The displayed progress explains
which stage is running. The temporary viewer is released when finished or cancelled.

Lengths of individual fitted polylines are summed without connecting disconnected
elements, then rounded to three decimal places in millimetres. A cached measurement
is reused while the active model and this tray's assignment are unchanged. Other
trays, cable endpoints, and routing permissions do not invalidate that measurement.

For an empty length, the measured value fills the edit form. An existing manual
length needs the separate acceptance action before replacement. Save changes
persists the length and its automatic source; measuring alone does not change it.

Deployment requires rebuilding both `api` and `web`. The standard API image now
includes the fitting engine; Compose persists its working storage in
`pathfinder-data`. No additional application container is required. Existing project
and model data remain in their current volumes.

Validation covers the frontend lifecycle, assignment and model changes, manual-value
approval, dedicated PostgreSQL save fences, and real engine execution in the built
API image. `scripts/tray-auto-length-container-check.mjs` runs inside that image with
`PF_ROOT=/tmp/tray-length-test` and synthetic configuration values for required API
environment variables. It uses synthetic DB responses and no project database,
checks two disconnected straight elements total 5000 mm, and verifies cache reuse.
