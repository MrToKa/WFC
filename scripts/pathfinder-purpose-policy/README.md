# PF-R2 actual controls

`actual-controls.mjs` is a root-operated fixture harness, not an application
startup task. It runs only inside the explicitly ownership-bound isolated5191
API with its current reviewed image, private runtime configuration, owner and
fresh fixture UUID. Do not invoke it against the original application or5190,
and do not use a generic default runtime selector.

The harness verifies strict policy transport, catalog/revisions, concurrency,
authorization through commit and trusted preparation scope. It creates its own
synthetic project/trays/users and removes exactly those identities after checking
ownership. Context refusal must have no cleanup side effects. Its aggregate
receipt contains no raw business rows or credentials.

The root operator must first verify owner/path/project/port, exact role/image
IDs, network/volume bindings and a private recovery checkpoint. Old R1 image
guards intentionally refuse the R2 images; never weaken those checks to run it.
The actual R2 run and its exact script digest are recorded in
`docs/pathfinder/evidence/purpose-policy/actual-controls-1792363829250.json`.
No rerun is needed for a handoff.

See `docs/pathfinder/37-r2-stage-report.md` for results, retained failed attempts,
the separate computer-use evidence, cleanup and limits. Real routing masks,
location mappings, engineering calculations and Apply were not performed.
