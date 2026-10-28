# Selected route popup and automatic origin continuity: installed on 5191

The paired B31 API/web update is installed and healthy on
`http://127.0.0.1:5191`. Initialization and all eight subsequent owned delivery
phases passed under operation `4e9eed18-0070-45f6-978b-938b67a17e5d`. The final
verification matched all ten checked served files to the immutable web image,
confirmed the exact installed API/web image pair and positively removed its
temporary helpers.

## Corrected behavior

Save keeps the open cable's calculation and result handoff ahead of the other
cables that share its logical From/To locations. Its completed result can make
Assign, Calculate and Show available while the other cables continue in the
background. A later edit to the next-calculation draft does not abandon the
already submitted command's frozen preferences. Account, model and preparation
generation changes still invalidate the old work.

Opening a saved selected result uses the proposal's server-recorded calculation
preferences. It does not require a local submission acknowledgement or a valid
next-calculation draft. A positive acknowledgement, when present, must still
match the exact proposal. Current model, endpoint, barrier, result identity and
job cancellation checks remain required.

The popup publishes the exact calculated route text separately from foreground
Show readiness. Its main route field is always **Calculated routing** and never
falls back to the stored Cable list routing. Stored Routing and Design length
remain in the comparison or stored-values section. Show becomes available once
the current result's display payload is checked and uses that checked payload
without repeating the same verification reads on the click.

An accepted automatic write may advance this cable's revision while its parent
job is still queued or running. Its exact current receipt-backed result can be
shown without borrowing review authority from an obsolete item proof or waiting
for sibling cables. Parent-job completion preserves the already checked path
and its visible state without another verification read.

These read-only display changes do not approve a manual cable update. Manually
changed Routing/Design pairs still require Review and Apply under the current
configuration and authority. Auto calculated length remains calculated data.

## H1 automatic origin continuity

Read-only inspection of `=H1=KF1=TAC1=WGA1` found matching Path Finder automatic
receipts and history entries. Default material synchronization changed
`materials_initialized` and `updated_at` between otherwise unchanged receipt
snapshots. The old full-snapshot equality check therefore classified the
automatic origin as `AUTOMATIC_PAIR_ORIGIN_UNPROVEN`.

The historical continuity check now allows default material initialization
(`false` to `true`) and later timestamp maintenance (`true` to `true`) only when
material customization remains false. The complete key set and every other
value must match, including route, design/install length, logical endpoints,
type and cable write revision. Timestamps are compared at exact microsecond
precision and must be monotonic and no later than the successor's authorization.
Receipt hashes, recorded history, sealed results and the successor baseline
remain required. Resets, customization, engineering edits, unexpected fields,
invalid timestamps and out-of-order timestamps remain refused.

The candidate compiled reader first returned `automatic` against the real H1
history without project writes. After delivery, the actual installed packaged
reader was checked again, with an API image identity precheck and a repeatable
read, read-only transaction. It also returned `automatic`, at cable write
revision 2 and history version 2, with origin receipt
`e3fbf930-0117-4b6d-8240-16bb6424c7e8` and previous receipt
`01b4e449-bf09-4589-942b-4e480e9cb1b9`. The compiled reader SHA256 was
`4ae91dc052f49406f3928ed06e590e47d2c0ab4803cf88855a61d3369c22aab3`.

The installed diagnostic is recorded in
`D:/Codex-test-output/popup-route-display-20261023/h1-installed-reader-live-readonly.log`.
It confirms the packaged ownership reader against real H1 data; it performs no
route calculation or UI action and does not prove a live Save has completed.
No receipt, ownership flag or cable value was rewritten to repair the history.

## Validation

All **854 unique product tests passed**:

| Area | Passed |
| --- | ---: |
| Backend | 342 |
| Results | 142 |
| Endpoint hooks | 139 |
| Cable routing panel | 66 |
| Cable workspace | 88 |
| Real Workspace / Results / Panel integration | 3 |
| Tab composition, exact union | 74 |
| Frontend subtotal | 512 |

The three new integration cases use the real Workspace, Results and popup Panel
with synthetic transport and SDK boundaries. They cover manual-protected Save,
automatic-owned Save while siblings remain unfinished, and reopening a saved
result without a local calculation acknowledgement or available new-calculation
configuration. They check the latest route and Show without another Calculate
or Save. They are not real-model browser or engineering acceptance tests.

Client and server type checks, scoped lint and production builds passed. One
existing long pending-Apply test initially exceeded its five-second test budget;
the full Results suite passed with a bounded twelve-second budget, without
relaxing the pending-command checks. The Tab suite completed its exact 74-test
union using partitioned scheduling because expanded Fluent/jsdom queries are
expensive. The first 19-test partition took 373.61 seconds, with individual
finite advanced-tool tests taking up to about 42 seconds. A read-only callback
audit found no render loop. An additional 36 rerun cases also passed and are
not counted twice in the 854 total.

The frozen UI source SHA256 values are:

- Results: `1d680fb5aa59b99c2e4a7a5807c50bcf855a3faee7ecaf8cd8e8fa677a683e18`.
- Cable routing panel: `9497035717c1eb38439b3e4620d9452472906be89b052d99bf8ff888f33c33ee`.
- Cable workspace: `7d671af3fc65e713de660598e59c3c12a4fc9c2d9b2fc332e4291f1c24e13c1c`.

This increment changes UI lifecycle and automatic-origin proof continuity. The
six native modules, policy versions and protected 48-file projection are
identical to the delivered baseline. It does not change native routing
mathematics, the search algorithm or native obstacle policy.

The implementation is in [Results](../../src/pages/ProjectDetails/PathFinderResults.tsx),
[the cable workspace](../../src/components/pathfinder/PathFinderCableWorkspace.tsx),
[the popup panel](../../src/components/pathfinder/PathFinderCableRoutingPanel.tsx)
and [automatic receipt continuity](../../server/pathfinder/automaticPairReceiptProof.ts).
The new [component integration tests](../../src/pages/ProjectDetails/PathFinderSaveDisplayFlow.test.tsx)
exercise their Save/display handoff. The [implementation note](130-selected-route-hydration-and-automatic-origin.md)
describes the bounded behavior and proof requirements.

## Installed delivery evidence

Initialization and all eight subsequent owned delivery phases passed. The
installed image identities are:

- API: `sha256:c418d6fb43486d3e9647c6bc0c4bde7c1a7a57377431dbb35ef9650b608e6598`.
- Web: `sha256:affb34782c0b4dabaed57f3642ed0b2bee798f9fd50020d7d296a634da6d80ba`.
- Engine: `8afec7c450c909b6cecb429d2964cf503e6933462d151dbc3c24225fb11a07b7`, unchanged.

The temporary target clone was positively retired. Target migration checks
covered 144 tables and 82,777 legacy rows, with no new tables, managed changes or
failures. The source runtime check covered 144 tables, with no managed changes,
zero projects whose engine identity changed and zero added events. The source
API and web are healthy on 5191.

The first final static-file verification helper stopped with
`DOCKER_OUTPUT_LIMIT_INVALID` because its buffered-copy maxima exceeded the
32 MiB limit. Cleanup passed and no unknown mutation was reported. That failed
helper and its evidence were retained.

The second fresh helper (`c34` attempt) stopped with
`B31_POST_RESOURCES_CHANGED_DURING_STATIC`; its cleanup also passed. The read-only
resource observation in
`resource-observation-diagnostic-fd92547c-2cab-491a-a896-0e29349ed219.json`
identified only a changed `startedAt` value for the foreign container
`/wfc-app-backend-1`. Its durable foreign identity and every source normalized
container observation were unchanged. This was not a reported change to the
delivered source services.

The third fresh helper, `bc6effe4-4431-46d5-b88e-8dd97f7f3478`, passed.
Its foreign-resource final comparison uses only the existing operator
`outsideIdentity` projection. Strict checks for owned resources, source
services, volumes and networks remain in place. Its 126 pure guard tests passed,
as did an independent 47-test peer subset. These helper checks are separate from
the 854 unique product tests above and are not added to that total.

The final check verified ten served files: the root page, three application
bundles and six viewer-runtime modules. Their lengths and SHA256 values matched
the immutable web image, and the API/web image pair matched the installed
release. Release receipt bookends passed. The operation and all commands joined;
temporary helpers were positively removed, with no unknown remote execution or
Docker mutation reported.

The [public delivery receipt](evidence/popup-route-display-20261023/b31-installed-paired-delivery.json)
records the phase receipts, image identities, conservation checks, all ten
served-file hashes and cleanup results. Its file SHA256 is
`b087201e2594eb1f3b8c94cc02907d4a4e92eceb0221c23bc6238d026a5b29f0`.
The separately recorded post-delivery receipt is 44,532 bytes with SHA256
`288fa6fb6dd2fe147223facbdedbeffdfa1489dc1a9e71457655693f60f6628f`.
The first two failed helper attempts remain diagnostic history; they are not
treated as successful checks or substituted for the final PASS.

## Aalborg and browser evidence boundary

At diagnosis, the published live barrier head was revision 4 and contained only
the floor `GENPRI 1 of VOLMODEL 2956` (`dbid:174115`). It did not contain the
walls from the retained 28-obstacle offline case. The floor-only H1 result was
56 m and omitted `/BC175`; the retained wall/floor calculation was 58 m and
included it. These are different obstacle inputs, and no route code is forced
or inserted to make them equal.

The existing browser-tool access denial for origin 5191 has not been bypassed.
Live popup Save/Show behavior with Aalborg walls, floor and wall openings remains
unverified by automated browser interaction. The user has authorized the update
and will test the installed version with the real model, the previously supplied
walls and floor and cables that cross the walls. The H1 check must use the
current intended From location, inspect the actual opening geometry and check
the expected `/BC175` segment; the hidden penetration reference object is not
an obstacle-opening substitute. The agreed insignificant deviation is 0.10 m.

Installation, conservation, source health, the ten-file served-byte comparison
and positive clone/helper cleanup are confirmed above. These checks and the
installed H1 read-only ownership diagnostic do not certify live Aalborg UI,
Save, Apply or engineering acceptance. No prior missed cable update is claimed
to have been backfilled.
