# Keep From/To model objects visible with a Path Finder route

Date: 2026-10-20. Isolated worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-path-endpoints-visible-local-20261020`, inherited from
`0166c8828458f35e676627bebe9a3f93cb2c903c`.

## Behavior and boundaries

Cable proposal previews and standalone Path searches add verified From/To object
IDs to the existing route foreground through the protected Viewer bridge.
Endpoint assemblies/children keep their original materials/colors; the rest of
the model keeps the existing Ghost appearance. Native transparent materials
retain their own transparency. Yellow path points, route text, exact geometry,
length calculation, Zoom bounds and Clear/restore remain unchanged. No C#,
server, protocol or permission changes are involved.

Automatic endpoints use exact current-model provenance already present in the
normal proposal GET; a whitelisted optional client projection preserves those
display fields. Confirmed object bindings require the matching binding and
geometry record, model/frame/aggregate/hash chain. These optional display reads
are bounded to four GETs and ten seconds total. Missing visual evidence cannot
invent an object or grant calculation/Review/Apply authority. Pure coordinate
endpoints have no equipment object to infer. Explicit Use selection as From/To
keeps a model-scoped UI-only object ID; it is not added to calculation requests.
Editing coordinates/name or changing model discards that selection evidence.

All foreground IDs remain under the existing512unique-object bridge limit;
overflow refuses the display without truncating the route or its points.
Account/model/cable changes abort pending endpoint reads and reject late results.
The feature affects only Path Finder proposal/standalone path displays; ordered
Path lookup and the separate Routings viewer retain their existing behavior.

## Verification and runtime

Normal authenticated GETs in the positively identified5191 runtime verified two
actual From/To references from a retained Aalborg proposal against the active
model. A private offline replay through the production proposal parser and new
helper retained both endpoint IDs and the exact path points. This is converted
model reference verification, not native parity or a live browser screenshot.
No location, calculation, Review, Apply or credentials were created/changed.

Final checks: **71 distinct tests PASS**:44helper/API,14Results,8Preview,
4affected full-Tab integration scenarios and1private actual-reference replay.
Frontend/backend typecheck, scoped lint and diff check PASS. The remaining53Tab
cases were not rerun for this delivery. Source writers were frozen before build.
WEB build PASS with before/after consumed-source closure; WEB-only upgrade PASS.
Private work and receipts stay under owned ignored
`pathfinder-engine/.scratch/tray-catalog-466d4ef7-a66c-476a-ad0b-8038ea4fe4b3`.

Retained failures: the first Results run had13/14PASS because the initial proposal
read's revision effect cleared the foreground-budget notice; notice invalidation
was narrowed to actual dependency changes. A second13/14run timed out in a pending
recovery scenario; it passed in isolation without a change. The final14/14run
passed after conditional review-state reset cleanup; no timeout was increased.
The first private replay failed before tests because the Node guard module uses
a file URL under Vitest's transformed environment; the private harness was fixed
to write its result directly inside the already validated private directory.
The corrected production-source replay passed1/1. Earlier failures are not relabelled.

WEB build PASS at2026-10-20T15:37:34.627Z:1280consumed inputs/94,459,479bytes,
manifest SHA256 `0a1761a94fe0187537694f947762fb7cffdc240cff55e6ad49a629f42123794a`.
Operator equivalence to the previously reviewed WEB-only operators and exact
frozen script hashes were checked before execution. Build operator SHA256
`9d473c78dca9b5667839442e15519d6b1765c5102ef5ebc60e3c79174b54b465`.

WEB-only upgrade PASS at15:39:00.210Z. Current web image:
`sha256:cf8f9bc50b7ccccdfcb009dc28908c91aa2c61e8b6bcd169f0330424ba0de397`.
API image remains `sha256:78536ccdf8050ccd732f383d09da56456e3fc9b10d9312568238577eea976f9c`;
API/PostgreSQL/MinIO IDs and start times, volumes/networks and outside configuration
were unchanged. All2153database cable rows and2preexisting Apply receipts stayed
exact; calculation engine identity stayed exact. Global active jobs progressed
from3to2naturally while API continued; no cancellation or API control occurred.
One original backend restart-loop transition was observed during build; it was
not controlled by the agent. Upgrade outside running/start transitions:0.

A fresh concurrent consistent DB snapshot preceded web replacement:17,970,330bytes,
SHA256 `01ddc648bbca62f9e993dc3a3e4bc83cdd409173912775254723e2fddfa454bc`.
Mounted TOC verification passed84,447bytes; final dump byte/hash readback passed.
This is not a cold snapshot or new restore drill. Upgrade operator SHA256
`da1fbd0c5eb983ea3df50802727137e0c918843418e54e783d6188bdba6a8d11`.
Final readback PASS15:39:54.338Z: health200, exact runtime resources and0temporary
helper containers. Actual-reference replay yielded7foreground objects, including
both verified From/To objects, without changing exact path points. Raw endpoint
IDs/business data remain private. Sanitized [actual.json](evidence/path-endpoint-visibility/actual.json)
records source byte hashes, scope and limitations. Live browser rendering remains
NOT_RUN because the earlier saved tool denial is unchanged; no bypass was tried.

At http://127.0.0.1:5191 use Ctrl+F5, then open a cable proposal or calculate a
standalone Path. Linked From/To equipment stays foreground with the route; Clear
uses the existing restoration. Local changes are on the named isolated branch;
read live HEAD for the containing commit. Live remote main is still96e63f13;
the branch was92ahead/3behind cached main before this delivery commit. No remote CI.

Keep active API calculations running; only the owned5191 web container may be
replaced. Preserve originalWFC5180/old5190, original/canonicalPathFinder, synced
sources, backups/model archives and historically denied paths. PrimaryPreparer
and recurringPFautomation remain PAUSED. No push/PR/merge or real engineering
acceptance is authorized by this visual change.
