# Model Browser parent selection

Status: SOURCE_CHECKS_PASS / STATIC_WEB_DELIVERED / REAL_BROWSER_CHECK_BLOCKED.
Branch pf-parent-modelbrowser-local-20261021, product source
f52017d3cf79f5abfb71d587aad8ffac386eeec7, inheriting41868b0.

## Cause and behavior

The pinned Autodesk SDK7.130.0 default Model Browser ordinary click is isolate,
not select. Clicking a parent can leave SDK selection empty or still pointing to
a previously selected canvas child. Assign correctly reads SDK selection, so
isolating a visible parent did not mean that parent was selected for assignment.

Adapter now supplies docStructureConfig with normal click selectOnly. The SDK's
own callback forwards the exact clicked ID/model to viewer.select. The default
NWD/SVF LEAF_OBJECT selection mode preserves the supplied parent ID; its name
does not imply descending to a leaf. The parent bbox reader already recursively
unions descendant fragment world bounds and returns [midX,midY,minZ]. Parent
geometry need not have direct fragments. A child remains that child; unrelated
multiple selections remain multiple and are refused by endpoint assignment.

Shift toggleMultipleOverlayedSelection and Ctrl toggleVisibility remain exactly
the pinned SDK defaults. Normal tree click no longer isolates or fits the model;
explicit route Show/Hide/Ghost/Clear operations remain unchanged. Click the node
label to select it; the disclosure arrow only expands its descendants. Assign
From/To and explicit atomic Save retain the report72 semantics and shared reuse.

Scope qualifications: native search-result selection is a separate isolate-only
SDK path and is NOT_CHANGED here. A user-saved FIRST_OBJECT/LAST_OBJECT preference
can promote ancestors; current browser preference was not observed or forcibly
reset. Existing8192-fragment selected-object cap remains unchanged. No new node
inference, geometry limit, bridge command or automatic matching rule was added.

## Source evidence and checks

Bundled SDK viewer3D.min.js SHA256
2833d5c53d250f56a59b86f22491a972486b30fd90a103bce8310dcaa970fa5b.
Line55 character anchors: default click3074502, override3075336, selectOnly3073829,
standard ModelStructure config3083204, selector LEAF default2468651,3D preference
1855648, explicit ID preservation1324297. These are pinned local primary source
observations, not a real model/browser test.

PASS:16 adapter source/mock tests including two new regressions. One executes the
exact pinned selectOnly callback against a declared synthetic public-API model:
a parent with no direct fragments and two descendants yields parent2, full bounds
[-2,-2,3]..[8,10,8], bottom[3,4,3]; child4 stays4 and independent[4,5] stays multiple.
No normal-click isolate/fit or fixture visibility/Ghost change occurs.
PASS:8 focused existing Viewer selection/bounds tests, Node syntax, diff checks,
independent source review and final production Docker web build (Vite+server tsc).
The historical120 popup tests/report72 were not rerun or counted as a new result.
Actual Aalborg reread and live browser parent Assign/Save remain BLOCKED/NOT_RUN
by the unchanged saved origin refusal. No bypass or fabricated human mapping.

## Actual delivery and preservation

PASS2026-10-21T05:09:19.596Z on exact owned5191: owner8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46,
composewfc-pathfinder-local-0cba87606e9b, runtime
pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600.
Only web was recreated with --no-deps. Image1e52058136d3500488d48e3dd253b12cd56d1ebdb337281abf81510b5486756d,
containere11ce1f43603615da6c587eb4a92c75ab236013d2b5a69b3f98a17f3112c17ff.
API3476333e, PostgreSQL and MinIO retained identity/configuration/start exactly.
No SQL/model writes, real endpoint Save/Review/Apply, grants or engine transition.
All non-web container identity/configuration hashes are conserved; external
process-state changes on the already restarting original backend are observed,
not relabelled as unchanged. Root issued no control action to that backend.

Served adapter SHA21469bc088a33d3a3fb28a5a2d9e25b8b07cada9d5f7ff3894d877c7fd8eaadc
matches the checked source. Computational pathfinder.mjs remains byte-identical
to API/prior web:bf4c8f76e63a04d6f08c0a618238bb5a417219433df1fc7700072363340e06a8.
Thus no API calculation fingerprint change was introduced. Web health and HTTP
/health200 PASS. Private operator40e079c2/readbacks/receipts/build log are under
pathfinder-engine/.scratch/parent-modelbrowser-web-20261021-f52017d.

Prior webAA5e image, private prior env/state and55296512-byte rollback tar SHA
aea55713c3c151e701217b2803870adf95c54e925bd6c6cfa58d1558a2bece65 are retained.
This backup covers the static resources changed here. Existing DB/model backups
and U8 companion remain; no new DB/model archive was made or required by this
web-only mutation. Rollback execution NOT_RUN because activation succeeded.
No disposable test container/volume was created and no unnecessary new build
remains. Active/rollback images and needed evidence stay; no prune or denied-path
cleanup. Original5180/5190/checkouts/sources were not updated; no push/PR/merge.
Live remote/PR/CI NOT_RUN for this correction.

Next self-contained prompt: handoffs/PF-U7-parent-model-browser-check.md. Resume
only after legitimate browser access changes, with Aalborg reread before actual
checks. The paused automation retains the required subsequent Simplified-Preparer
integration on main5180 after Path Finder technical checks and a fresh verified
DB/model backup for that separate update.