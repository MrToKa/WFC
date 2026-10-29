# 134 — Selected-route popup readiness (B33 installed)

Status: **installed and delivery verified on 5191; live popup timing unmeasured**.
Completed 2026-10-24. The source, installed bytes and delivery receipts below are
verified. Runtime write freeze has been released for user testing.

## Intended behavior and scope

Save calculates the selected cable first. Its popup should regain Assign,
Calculate and Show once its own result and display objects are verified, while
other affected cables and project-wide list updates continue in the background.

B33 changes four frontend files. Native routing, graph construction, barrier
geometry, backend scheduling, automatic/manual write ownership and numerical
policy remain unchanged. There is no Dijkstra rewrite and no new geometry or
native-route replay claim in this stage. Existing per-cable Drill policy and
manual Review/Apply requirements remain intact.

## What the observations establish

The user reports correct routes, with Cable list updates after roughly 10–15s
and popup availability after 17–20s. These are user observations, not instrumented
B33 timings. A retained diagnostic has a 13.848s interval between job creation
and the selected proposal's database transaction timestamps. This is not a
measured COMMIT time, native-only solve time or end-to-end popup latency.

The installed reader profile measured selected-detail at 663.61ms (51 SQL calls)
and a global five-proposal state-preview read at 765.73ms (159 SQL calls). These
are bounded local reader measurements, not the complete /state HTTP request or
a Save-to-Show benchmark. They cannot establish a production latency guarantee.
The evidence points to avoidable frontend sequencing after the result exists;
it does not establish that A* or native graph search caused the popup delay.

The latest read-only registry observation has 31 published parents at revision 11.
B33 performs no geometry recapture or barrier publication for this UI fix.

## Implemented frontend changes

The first actual opening of a stored cable issues a bounded fresh GET for its
current exact result. Cached list hints do not replace that read, and opening
does not automatically submit Calculate.

- Workspace uses the exact calculation job and a terminal selected-cable detail
  read as the handoff. The initial cached status hint no longer forces another
  broad state refresh before inspecting a result that can already be terminal.
  A successful current terminal row uses that one owned detail read instead of
  serially repeating project state and the same selected read.
- The Save acknowledgement starts its frozen-policy GET watcher immediately.
  Global state refresh remains background work. GET recovery preserves the
  original command identity; it does not submit duplicate Calculate commands.
- Deferred diagnostics and same-job list catch-up cannot replace a newer exact
  selected proof with an older list hint or make the settled popup grey again.
  A genuinely newer cable revision or changed model/account still invalidates it.
- Results verifies the exact proposal, parent job and current cable evidence,
  using the submitted or server-recorded calculation policy. The next-calculation
  checkbox does not redefine the policy of an already computed route.
- The freshly verified row is passed to Workspace with its account/model/artifact
  scope. It can repair presentation that lagged behind the exact result. It is
  not a new write or Review/Apply grant. Account changes clear this authority.
- From and To display lookups run concurrently under the same bounded deadline.
  Refusal aborts its peer; missing evidence is not silently accepted as a
  successful route-only foreground. Show uses the payload already checked for
  this exact tuple. The main route field continues to avoid falling back to an
  old stored Cable list route while the selected proposal is unavailable.

Source anchors: Workspace:379,561,675; Results:269,302,391,425;
pathFinderEndpointVisibility:66; Tab:127,252,302.

## Frozen source and verification

All paths below are relative to the repository root.

| File | Bytes | SHA256 |
| --- | ---: | --- |
| src/components/pathfinder/PathFinderCableWorkspace.tsx | 72888 | 45428fd7e740b178f7983e07316208f06ae62d1b4d285dd5dde49e04f7f54a35 |
| src/pages/ProjectDetails/PathFinderResults.tsx | 78651 | c774a050a4a395317417c9f7a7cc2eb60b78f69dbdcc1f4897bae8b56912b231 |
| src/pages/ProjectDetails/pathFinderEndpointVisibility.ts | 13005 | ab9f6e08414cd525f495550ca949939348d0021c4591987f997d4ec6e71521b2 |
| src/pages/ProjectDetails/PathFinderTab.tsx | 34638 | 3e1d109a1ae9384773b57bfcc167358caf4308a668866119d8a8d932f8340b89 |

The final combined frontend run passed **482 tests across six files**: Workspace
114, Results 151, endpoint visibility 69, Save/display flow 8, Tab 74 and Panel 66.
The earlier 220 partition was Results 151 + endpoint 69, not 220 Results tests.
Earlier Tab/Panel 140 and flow 8 counts overlap; do not add them to 482. Client
build passed in 28.93s; type checks, server build, scoped lint and diff checks
passed. The private delivery helper passed 193 guards, including its actual bound
release, and all 15 JavaScript syntax checks. Those pure tests use synthetic
transports and execute no Docker, native solver, DB access or live UI.

## Installed delivery evidence

Owned operation: 8e4bb05b-8bde-4455-a0e2-f86dc004e8b2. Initialization and all eight
owned phases passed; the temporary target was positively retired. Frozen context:
2155 files/108315121 bytes, SHA256
47f09a9098faa9605eb75bc6fb3373a625e665c9348dc5a687797015f098d85b.
Operation file SHA256:
bdf5340a0c7a3ff5404ba0f3490cf5a04421a980e8e4b4d1641c128a6ddf4d9b.

The installed immutable image pair is:

- API: sha256:e359b9320f9f96db1514fb3074435c84c18641276eee3f88999318eb1f58bb27
- Web: sha256:33acdd49a0e9c35e38271dd4a85f8f3e8fb7d50a43228dea650afc528f48b32f

The final independent readers proved actual candidate-image byte equality for
all six native DLLs, 48 protected projection files and the compiled receipt proof
against completed B32 operation b4321926-486d-45cd-9621-5ecfb977709d. The complete
v2 identity body/policies also remain identical, with engine digest
3a3a8c9733fc6bc70069901d721174616385baa4c6fd205dee59c33b9dc6e08e.
Actual image readers now establish this equality. No new geometry or native-route
execution was needed in B33.

Eleven served files matched their immutable image bytes: index, three app bundles
and seven viewer-runtime modules. Health, release bookends and resource identity
checks passed. Both temporary image readers were never started and were
positively removed; all commands and the operation joined, with no unknown
remote execution or Docker mutation.

All three retained raw inventory windows were independently requalified. Target
migration checked 144 legacy tables/83840 rows with no new tables or managed
changes. Both target-runtime and source-runtime recorded 0 engine-changed projects,
0 added observer events and 0 managed changes in the qualified delivery windows.

The private final PASS is 45752 bytes, SHA256
7c75ac0132faca1a36428cd80bf7a464f2dd29f6613a6aaa9576907429e6d20f.
The sanitized [installed paired-delivery receipt](evidence/popup-ready-latency-20261024/b33-installed-paired-delivery.json)
is 9752 bytes, SHA256
0aad847350aa3f86c4bccaebfeabb70dbcc9ea4e7c048dd1e07a0af1ddbfa924.

## Remaining acceptance limit

Browser access to 5191 was denied previously. No new browser attempt or workaround
was made in this stage. Source/integration tests and installed byte proofs do not
measure the user's actual browser: Save-to-Show elapsed time, immediate button
readiness and rendered-path behavior still require user testing with this build.
Initial-open and Save/Calculate regressions cover background work. User testing
can resume; the write freeze is released.

Private reader profiles, diagnostics and test logs remain local audit inputs.
The linked sanitized receipt is the public delivery evidence.
