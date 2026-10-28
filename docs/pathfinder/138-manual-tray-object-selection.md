# Manual tray object selection

The original Aalborg `/VFD102` report stopped at **Use current model selection**,
before any manual assignment was saved. The server model remained healthy and
the existing published plan already contained an automatic match for that tray.
The browser's precise failure code was unavailable; the previous completion
handler masked terminal explanations with a generic reload caption.

Project tray assignments now use a separate `READ_TRAY_ROOT_SELECTION` command.
It returns at most 512 distinct current-model IDs through the pinned SDK's cached
tree. It does not request the model inventory, properties, external IDs, fragment
bounds or geometry. Authorization and current-load checks remain in force before
and after the read. A local refusal or 15-second timeout retires only this read;
real access revocation and model changes still retire the viewer.

Rich selection for cable endpoints and obstacles stays separate. Finishing a
preparation operation preserves the original terminal explanation. The tray
panel distinguishes saved assignments from draft changes, supports editing and
removing draft objects, and blocks saving old roots while a new selection is
being read. Scoped tickets prevent late replies from overwriting a later draft.

Existing server behavior remains authoritative: a manual assignment replaces
automatic candidates for that project tray, regardless of the selected objects'
names. Physical ownership, routing permissions and conflicts are checked during
preparation. Saving assignments requires a new preparation/publication before
the routing network uses them; it does not silently publish a replacement graph.

Focused validation: 165 runtime, 119 Controller, 83 Path Finder hook, 85 panel /
plan / discovery and 94 preparation / obstacle hook tests passed. Typecheck,
focused ESLint and independent review passed. Private runtime and delivery
evidence is under `D:/Codex-test-output/manual-tray-20261026/`.

Installed on 5191 using operation `11fe1dd4-1744-42fe-8531-29306487e27c`.
API `60f48e2fa8afca1eabf8851c3a8486764d94fc279f20fc81383cf04686af6fbd`
is a labels-only derivative with identical filesystem, native binaries and
calculation identity. Web
`a365bef9ceee0c11df1c89fa03e5e1f0ae2cc9194d5b5c99d86e7ce4d48cae23`
passed HTTP byte verification for 32 files, including the 28 first-party viewer
modules and runtime inventory. Database and artifact fingerprints matched before
and after; the verified fresh database checkpoint is 32,953,663 bytes. No manual
assignment or calculation was submitted on the user's behalf. Interactive browser
verification remains unperformed under the existing browser access policy.
