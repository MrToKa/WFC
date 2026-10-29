# Save popup readiness and original-surface point contacts: delivered on 5191

The paired B32 API/web update is installed and healthy on
`http://127.0.0.1:5191`. Owned delivery operation
`b4321926-486d-45cd-9621-5ecfb977709d` passed initialization and all eight
subsequent owned phases. Final paired verification passed: all eleven checked
served files match the immutable web image, the installed API/web pair and
native implementation match their exact candidate pins, and both temporary
image readers were positively removed without being started. The temporary
delivery target was also positively retired.

The [sanitized installed delivery receipt](evidence/popup-route-performance-20261023/b32-installed-paired-delivery.json)
is 10,330 bytes, SHA256
`6b2a6e89bf86fef71a6bc55555ae85cd75e028b4383f0d7d5a8e94cc7cfafa4c`.
The receipt confirms delivery. Separate offline engine checks are recorded
below; live browser acceptance remains unverified.

## Save, calculation progress, and Show

Save continues to request automatic calculation for the cable in the open
window before the other cables sharing its logical locations. The popup follows
that exact saved command through its impact ID and resulting selected job. It
does not submit another Save or Calculate to recover a delayed read.

The selected-item watcher now budgets polling rounds rather than individual
GETs. A completion observed on the last allowed round can still finish its
terminal detail read, state refresh, and exact result recheck. Each read window
allows up to 80 rounds within 120 seconds; individual reads are bounded by the
remaining window and a 30-second maximum. One further GET-only window can start
after five seconds. Persistent unknown outcomes retain the original command and
remain closed to duplicate submissions. Authentication, model, preparation,
scope, and evidence refusals do not trigger automatic recovery.

While the selected item is still running or its automatic write is pending,
the watcher uses lightweight job/detail reads. It defers the full project state
refresh until the selected result is terminal, then rechecks the exact detail
before handing it to Results. Background sibling work does not hold the
selected cable's completed result in a pending state.

The progress reader previously stopped when the main document became hidden.
That could leave a visible detached cable window waiting without ever learning
its Save job ID. Only the exact pending Save displayed in an open, visible owned
popup can now keep its progress GETs active while the main tab is hidden.
Unrelated hidden progress remains suspended. Closing the popup suspends reads
immediately, including when `pagehide` precedes its `closed` flag; returning to
the main tab resumes eligible reads.

Transient progress GET failures retain the last validated summary and job ID
for the same identity. They receive at most three retries at one, three, and
five seconds. A 401/403 denies further reads for that account; a hard scope
refusal such as 409 clears the current summary and remains suspended across
visibility changes. A visibility change cannot renew command authority.

After a same-model viewer reload, the workspace can restore the externally
retained selected cable ID through a current GET. It checks project/cable
identity, owner, preparation generation, read scope, and late-response fences.
It neither reopens the popup nor submits a calculation. The user can reopen
the retained cable and inspect its verified persisted result with Show.

The main route field continues to display only the verified calculated route,
without falling back to old Cable list Routing. Assign, Calculate, and Show
become available again after the selected result and its current display
payload have been verified. Show draws that exact payload. Manually edited
Routing/Design values retain their Review and Apply requirement; these
read-only recovery changes grant no additional write or review authority.

Relevant sources:

- [Cable workspace](../../src/components/pathfinder/PathFinderCableWorkspace.tsx)
- [Location impact progress](../../src/hooks/usePathfinderLocationImpactProgress.ts)
- [Save/display integration regression](../../src/pages/ProjectDetails/PathFinderSaveDisplayFlow.test.tsx)
- [Results verification](../../src/pages/ProjectDetails/PathFinderResults.tsx)
- [Cable popup](../../src/components/pathfinder/PathFinderCableRoutingPanel.tsx)

## Actual delay measurements and their limits

The installed diagnostic read measured the selected detail at approximately
598.6 ms, state preview at 629.4 ms, and the relevant mutex at 1.4 ms. Recent
job timestamps placed proposals approximately 8.4–12.3 seconds after job
creation and the latest Save job finish at 16.4 seconds. The proposal timestamps
are transaction timestamps and do not prove their COMMIT visibility time.

Those observations do not support attributing the user's 70–90 second popup
wait solely to path search. Hidden-main impact tracking, transient progress
failure, the premature polling-count limit, and repeated full state reads
were separate frontend causes addressed here. The final real browser elapsed
time remains unmeasured until a successful live acceptance run.

Private diagnostic evidence:
`D:/Codex-test-output/popup-route-performance-20261023/live-diagnostics.json`
and `installed-reader-profile.json`.

## Original-surface point-contact geometry

The exact retained 27-parent Aalborg capture was refused by the installed
verifier with `NONMANIFOLD_VERTEX`: an exactly welded vertex had disconnected
original face fans. The relevant actual fragment is from VOLMODEL 2772
(`dbid:173396`, fragment 1095, vertex 92), rather than a still-loading model.

The native change permits disconnected point-contact fans only after the
original surface components and their boundaries have been established.
It preserves all original triangle indices, source ownership, and coordinate
bits. Both original surface lobes and their shared point still block contact.
Closed-solid qualification, nonmanifold-edge refusal, invalid geometry,
protected scope, and bounded-work checks remain strict. It does not create an
opening from a bounding box, remove triangles, or use the hidden reference
equipment as a substitute for an opening in the wall.

The native implementation identity changes in B32. The packaged candidate's
six native modules and both v2 delivery and v3 mixed engine identities were
read from its immutable API image, checked against their byte digests, and
rechecked after the three calculations. Its v2 identity is
`3a3a8c9733fc6bc70069901d721174616385baa4c6fd205dee59c33b9dc6e08e`;
its v3 mixed identity is
`6f5142e4ecd41b8782eff9d06c42a865ed53ba98296e1c57cded4c1f8f4cd42a`.
The observed `PathFinder.Barriers.dll` is 119,296 bytes with SHA256
`7d1e40d9e446ac4f6ed29cfd52109e529c47e6fed4f9561c43632ad525415d27`.
The 48-file projection's observed derivation SHA256 is
`9620b34e93dbca0860ce7da5e7bdce333c35304e91c04e5990c35f4fee5cfd32`.
Final byte verification confirms that only `PathFinder.Barriers.dll` changed
among the six native modules. The other five native files, all 48 ordered files
in the protected API JavaScript projection, their policy versions, and the
compiled receipt-proof reader are identical to B31. The proof reader remains
14,389 bytes with SHA256
`4ae91dc052f49406f3928ed06e590e47d2c0ab4803cf88855a61d3369c22aab3`.
The frontend bundles changed as intended. The B31 claim of an unchanged native
implementation does not apply to B32.

Delivery preserved the currently published six-parent barrier set at revision
7. The successful 27-parent geometry qualification and route calculations below
are offline candidate checks. They are not proof that those 27 parents were
published in the live Aalborg project or accepted through its viewer UI.

Relevant sources:

- [Mixed barrier kernel](../../pathfinder-engine/src/PathFinder.Barriers/MixedBarrierKernel.cs)
- [Mixed barrier tests](../../pathfinder-engine/tests/PathFinder.MixedBarriers.Tests/Program.cs)
- [Actual point-contact fixture](../../pathfinder-engine/tests/PathFinder.MixedBarriers.Tests/OriginalPointContactFixture.cs)

## Offline actual Aalborg checks

The offline fixture uses the retained actual Aalborg snapshot of 114,111,391
bytes, SHA256
`27f8cf8c352b8847b778f764ce942aa0bb61ebfab16aeb993c0a83bd100c38e2`,
and the exact 27-parent capture of 355,621 bytes, SHA256
`719c92a58792e71343c2353d3b8af5f3935ebf996c79218486d58870a4903ed7`.
The capture contains 27 fragments, 5,031 vertices, and 3,971 triangles. Its input
bookends passed. These are private offline envelopes without publication or
engineering-acceptance authority.

The source-built Windows .NET 9.0 native runner calculated all three requests
with the exact original wall/floor geometry and drilling disabled:

| From object | Native elapsed | Design length | Result |
| --- | ---: | ---: | --- |
| BOX 55, Copy-of-TRAF1 | 8.955 s | 58 m | Includes `/BC175`; barrier status `clear` |
| BOX 58, Copy-of-TRAF1 | 7.150 s | 58 m | Same route including `/BC175`; barrier status `clear` |
| BOX 1, OUTPUT_FILTER | 6.743 s | 58 m | Uses `/BC025/C107-3`; barrier status `clear` |

BOX 55 From is
`[51.2619021370831, -6.471190246329826, 4.04500007176938]` m.
BOX 58 From is
`[52.061901374143645, -6.475189956412834, 4.045000190978669]` m.
OUTPUT_FILTER BOX 1 From is
`[51.003036780637785, -6.133999618278068, 8.619599814658784]` m.

BOX 55 and BOX 58 returned:

```text
/SECONDARY/BC020/BC030/BC030-1/BC175/C107-2/C107-1/C002/DFC003/DFC002/DFC001/DFBC002-1
```

OUTPUT_FILTER BOX 1 returned:

```text
/BC022-3/BC022-1/BC025/C107-3/C107-2/C107-1/C002/DFC003/DFC002/DFC001/DFBC002-1
```

The first request prepared the data; the later two report prepared data loaded
from disk. The timings are individual native executions, not Save-to-Show
browser timings or a throughput benchmark. BOX 55/58 found a clear candidate
without exhausting all alternatives (`searchComplete:false`,
`candidatesTruncated:true`); this is not a proof of a globally shortest route.
All three recorded `projectWrites:false`, `sdkExecuted:false`, and
`engineeringAccepted:false`.

Private evidence:
`D:/Codex-test-output/popup-route-performance-20261023/aalborg-27-offline/fixture.json`,
`qualification.json`, and `local-real-routes.json`, with the three exact
requests and full responses alongside them.

### Packaged Linux candidate execution

The root coordinator replayed those same three unchanged request byte buffers
using the actual candidate API image
`sha256:dae8390ec2cae74eaa469af949c9b3d5909e95e1ccd234a401558851d934dbcb`.
The helper used the packaged `/opt/pathfinder/PathFinder.ModelRunner.dll`,
with a read-only root and input mount, network disabled, user `1000:1000`,
1 GiB memory, two CPUs, 64 PIDs, and a new private cache in tmpfs. It did not
reuse the host Windows cache or rewrite any request path, coordinates, profile,
model snapshot, or captured geometry.

| From object | Packaged Linux native elapsed | Design length | Checked result |
| --- | ---: | ---: | --- |
| BOX 55, Copy-of-TRAF1 | 10,991.5 ms | 58 m | Same route including `/BC175`; `clear-selected-scope` |
| BOX 58, Copy-of-TRAF1 | 8,436.2 ms | 58 m | Same route including `/BC175`; `clear-selected-scope` |
| BOX 1, OUTPUT_FILTER | 8,036.6 ms | 58 m | Same `/BC025/C107-3` route; `clear-selected-scope` |

All three native statuses are `calculated`, with barrier diagnostics `clear`.
Route text and Design length match their Windows references; full response-body
parity is not asserted. BOX 55/58 each checked all 115 straight segments of their
116-point final polyline against the registered selected geometry. BOX 1 checked
173 segments of its 174-point polyline. A segment is the straight connection
between adjacent route points; these counts are not numbers of walls or
openings. The check covers the exact provided 27-parent scope and does not
certify global model coverage, physical cable diameter clearance, or engineering
acceptance.

The single helper and all three native processes joined successfully. The helper
exited zero without OOM; cleanup positively verified its exact owned identity
and removed it. Input bookends passed. The receipt records
`operationJoined:true`, `commandsJoined:true`, `helpersRemoved:true`,
`remoteExecUnknown:false`, and `unknownDockerMutation:false`. It records no
project/app/DB writes, SDK execution, Apply, live-frame authority, publication
authority, or engineering acceptance.

Packaged evidence:
`D:/Codex-test-output/popup-route-performance-20261023/packaged-real27-36fa67b1-becf-4206-9256-cf350afd1e47/result.private.json`,
18,420 bytes, SHA256
`b0242a5dd0a5e319567af001f5b0034e1c9e43da79e8c227a35bfef736a1e64a`.
The three full Linux responses and supervisor/implementation observations are
retained alongside it. This is successful offline execution of the actual
packaged engine, not a measurement of popup Save-to-Show latency or a live UI
acceptance result.

## Verification

There are **546 unique product checks** in this scoped verification:

| Scope | Passing checks |
| --- | ---: |
| Workspace polling, recovery, ownership, and restoration | 98 |
| Lightweight impact progress, transient retry, and visibility | 29 |
| Real Workspace → Results → Panel handoff with synthetic transport | 5 |
| Results and cable popup regressions | 208 |
| Native managed barrier/verifier/runtime/exact-surface checks | 138 |
| Viewer bridge | 68 |
| **Total** | **546** |

The frontend subtotal is 340. The native subtotal is 138
(41 mixed barrier, 50 verifier, 31 mixed runtime, and 16 exact surface checks).
Pure delivery-helper guards, the 46 replay-harness guards, and the Windows/Linux
offline route cases are not added to this product-test total. The final paired
helper's 178 pure guards and its actual post-delivery execution pass. Client type checking, scoped lint, client build,
server build, and scoped diff checks pass. These local checks are distinct
from packaged delivery checks and live browser acceptance.

Key logs:

- `D:/Codex-test-output/popup-route-display-20261023/owned-popup-recovery-fifth.log`
- `D:/Codex-test-output/popup-route-display-20261023/owned-popup-recovery-tsc.log`
- `D:/Codex-test-output/popup-route-display-20261023/owned-popup-recovery-lint.log`
- `D:/Codex-test-output/popup-route-performance-20261023/results-panel-regression.log`
- `D:/Codex-test-output/popup-route-performance-20261023/point-contact-after.log`
- `D:/Codex-test-output/popup-route-performance-20261023/point-contact-runtime-after.log`
- `D:/Codex-test-output/popup-route-performance-20261023/point-contact-PathFinder.BarrierVerifier.Tests.log`
- `D:/Codex-test-output/popup-route-performance-20261023/point-contact-PathFinder.MixedExactSurface.Tests.log`
- `D:/Codex-test-output/popup-route-performance-20261023/viewer-bridge-test.log`
- `D:/Codex-test-output/popup-route-performance-20261023/client-build.log`
- `D:/Codex-test-output/popup-route-performance-20261023/server-build.log`

Frozen frontend production source SHA256 values:

- Workspace: `cbd9506efbc62f0179818a9947a2737727fc5b3b48d0e72694450446e3c6d029`
- Impact progress: `c973bc59eadcff838b81abffeb6febaebc1affc5274a8ee5d4af738474a62224`

Frozen native kernel source SHA256:
`b3f33d1da5a68cb87534a2ea05dcbd1384d5f92ff05af556e574b8bbd4355d85`.

## Installed paired delivery and conservation

Installed identities:

| Component | Exact installed identity |
| --- | --- |
| API image | `sha256:dae8390ec2cae74eaa469af949c9b3d5909e95e1ccd234a401558851d934dbcb` |
| Web image | `sha256:4e0a1e6b4bd7df3fed7ef539e953eee64c95966aeb6168bd51dda42d1ba1b2bc` |
| v2 delivery engine | `3a3a8c9733fc6bc70069901d721174616385baa4c6fd205dee59c33b9dc6e08e` |

Initialization, backup, restore-quarantine, candidate-build, target-migration,
target-runtime, update-source, source-runtime, and retire-target each have a
PASS receipt. The migration qualification checked 144 legacy tables and
83,319 legacy rows, with no new tables, no managed changes, and no failures.
The independently requalified target-runtime and source-runtime windows each
checked 144 legacy tables and recorded no managed changes or failures.

The native implementation change intentionally caused engine-observer control
updates: **five project engine identities changed and five events were added
in each runtime window**. These are reported control changes, so this delivery
is not described as having no database writes. The final static verifier
performed no business writes; its receipt explicitly distinguishes those
read-only checks from the qualified engine-observer changes.

The final helper `80406609-e699-468e-8edf-4fdaa748b348` checked eleven served
files and the pinned API implementation against their immutable images after
all delivery phases. Both image readers were never started, and both were
removed after exact owned-identity checks. Final cleanup reports
`status:PASS`, `operationJoined:true`, `commandsJoined:true`,
`helpersRemoved:true`, `remoteExecUnknown:false`, and
`unknownDockerMutation:false`. Source health and release-receipt bookends pass.

Private final evidence:
`pathfinder-engine/.scratch/b32-post-delivery-80406609-e699-468e-8edf-4fdaa748b348/post-delivery.pass.private.json`,
46,222 bytes, SHA256
`8c4d0a7098b042c7895e0f8367f99c4881818b007a1867c8266723297492e153`.
Its public projection is linked at the beginning of this report.

## Viewer diagnostics and acceptance boundary

The viewer now reports the failed operation and safe code for a command error
instead of claiming generically that the whole loaded viewer stopped. This
exposes failures; it does not hide them or turn a failed command into success.

The user requested another built-in browser attempt. CUA's in-app browser
again explicitly denied origin `http://127.0.0.1:5191` under its recorded access
policy. No alternative browser or transport was used to bypass that denial.
There is no successful live UI test claim in this report.

Delivery is ready for the user's browser test. Close the old cable popup,
hard-reload the main page with
Ctrl+F5, and reopen the cable. Save the intended 27-parent wall/floor set again
to test its live publication: delivery preserved the six-parent revision-7 set
and did not publish the offline fixture into the project. Then change From/To
and Save; inspect the automatically calculated route and Show while other
affected cables continue in the background.

The user's real Aalborg wall/floor publication and Save → Assign/Calculate/Show
acceptance, including the existing wall opening and `/BC175`, remain separate
from the successful offline geometry and native execution checks. No live UI
test, new live 27-parent publication, engineering acceptance, or measured
Save-to-Show browser latency is claimed here.
