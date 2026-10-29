# PF-B8b — real snapshot memory qualification

Status: technical planning-memory qualification PASS, including the final
uninstrumented actual cold/disk/session/warm test. Actual civil/opening acceptance
is separately BLOCKED by the unavailable protected capture. No engineering acceptance.

Branch `pf-b8b-snapshot-memory-local-20261021`, parent
`38e4f20ca6bbbb6ee04a5aab6390afb40d8c0a6d`. All execution was by root in new owned
scratch `pathfinder-engine/.scratch/snapshot-memory-20261021-8e96ca43-92b3-4058-a617-cf000a9cefed`.
Other agents implemented separate source modules or reviewed source only.
Verified product commit `985afcd9ab3d0423d9352f999757a9f46fcce023` contains the
frozen source bytes. Checked binaries were built before this local commit;
B9 must separately qualify its exact rebuilt image/implementation identity.

## Changes

- Read an exact, bounded, regular snapshot file into one privately owned buffer;
  hash its actual bytes and check identity, growth/truncation, cancellation and
  source metadata. No caller-supplied digest alone authorizes fitting or reuse.
- Replace the full duplicate-check JSON DOM with a bounded strict UTF-8/token
  pass. Preserve decoded duplicate names, null/depth/number/shape/semantic limits.
- Share one strict parse. A named, atomic transfer detaches exact eager Core
  meshes and compact trusted metadata, consumes its checked token and returns
  before fitting. The ordinary reusable API remains nonconsuming. Independent
  lookup keeps its raw/resolved identities and cannot enter planning reuse.
- Retain compact fitted geometry and current source/category/rules guards in a
  session. Every request still hashes the actual raw file. Changed source/root/
  rules identities evict before reading replacement bytes; project/model
  mismatches refuse reuse. Graphs and barrier checks remain fresh.
- Set a worker-only managed heap ceiling of320MiB before CLR startup in both
  launchers. A valid stricter inherited aggregate is preserved; uncomparable or
  malformed inherited overrides refuse. The512MiB combined RSS guard,100ms
  sampling,64-request retirement, deadlines and all geometry limits stay intact.
  Managed allocation refusal returns `resource_limit` and discards session reuse.
- Add default-off, root-opt-in memory phases in a newly created private file,
  bounded to32 rows/64KiB. Existing files/links remain untouched; diagnostic errors
  cannot replace outcomes. No business data or wire fields are added.

The heap ceiling bounds managed commit and bookkeeping; it does not itself bound
total RSS. Both guards remain necessary. The configuration mechanism and container
defaults were checked against [Microsoft's GC documentation](https://learn.microsoft.com/dotnet/core/runtime-config/garbage-collector).
No collection is forced. The eleven canonical Core files, exact maths, surfaces,
ordering/ties, category/lookup guards and frozen expected data are unchanged.

## Verification

Root built all15 projects after the final source freeze. Windows session checks
433PASS; Linux435PASS including effective CLR budget probes, stricter inheritance,
configuration refusal, transferred-state/cancellation/race/lookup/category/cache
checks, diagnostic isolation and symlink preservation. OOM is injected boundary
coverage, not a framed plant heap-exhaustion proof.

Regression105, golden43cases/215checks, barrier kernel94, capture verifier50,
constrained54, local connectors40, ledger35, direct SECONDARY63 and protected
one-shot/session transport39PASS. Current fitted trace/identity39PASS. Model131,
reader37 and lookup37PASS against the identical Model DLL, proven by hash reuse.
Counts overlap and are not a single independent test population.

Production-default Linux workload5:69 session results +6 one-shot comparisons
PASS, actual64→65 retirement, unchanged512MiB guard and1GiB fixture hard cap.
Independent raw-triangle verification:69 results,6 full DTO comparisons and4226
clear segments PASS. Synthetic fixtures do not prove the plant's walls/openings.
Pinned Core11 and frozen fixtures3 hash checks PASS, without PF-0 receipt writers.

All13 newly owned stopped test containers were retired after exact ID/owner/image/
mount/port preflight and private log retention. No volume or host file was removed.
Needed copied inputs, cache evidence and binary closures remain. Denied paths and
all original/5191 resources were outside the retirement set.

Retained failed checks are not relabelled: build1 had a test compilation error;
build5 session389PASS/2FAIL. The latter were independently verified fixture
assumptions: null routeName falls back toFTUBE, and adjacent canonical lookup codes
coalesce. Only those test inputs/expectations changed; fresh build6 session391PASS
with production closure unchanged. Final worker-policy build7 produced the counts
above. All original failure receipts remain in own scratch.

## Actual Aalborg scope and measured failures

Read-only source ownership/path/project/port/image checks and before/after SQL
bookends protect5191. Exact current330-tray snapshot:114111391bytes,
SHA256 `27f8cf8c352b8847b778f764ce942aa0bb61ebfab16aeb993c0a83bd100c38e2`,
2965objects,1165physical leaves,1567516vertices and1546617triangles. Actual reported
cable `=H1=KF1=TAC1=WGA1`, both current confirmed fixed-world endpoints and Project
Details7/5/10/gap1 were copied privately. No business rows/points/credentials enter
Git. This is legacy planning replay, not a fabricated protected v8 barrier scope.

Original B8 and B8b attempts1–5 failed the unchanged RSS guard. Full raw receipts,
binary closures and private inputs are retained. Profile3 located failure inside
Core fitting; profile5 proved explicit transfer completed, but Gen2 count stayed
at5 before fitting. Heap estimates still included uncollected garbage. Releasing
references alone did not establish lower RSS.

With the worker heap policy, diagnostic attempt6 calculated successfully in
20.258s, sampled combined RSS440295424bytes, effective worker managed budget
335544320bytes. After fitting worker RSS321318912bytes and Gen2 count8 were
observed. No OOM/timeout; source bookends unchanged. Sampling is not an exact peak,
and this instrumented cold-only success is not the final mode qualification.

Final uninstrumented attempt7 PASS: cold20.038s, disk11.872s, session-first
disk16.581s, warm2.351s and1.262s. All five calculated successfully with exact
full DTO equality after normalizing only requestId and prepared.loadedFromDisk.
Session result ordinals1/2/3 used disk/memory/memory in one lane. Combined sampled
RSS maxima: one-shot442335232bytes, session450367488bytes; Node82026496bytes.
One sample was unavailable; these are sampled maxima, not exact peaks. The
unchanged512MiB guard remained active. Exit0, no OOM/timeout; before7/after7
source/model/endpoint/cable bookends unchanged. No phase file was emitted.

Public metadata: `evidence/barriers/b8b-qualification.json`,
`b8b-memory-diagnostics.json` (all seven attempts, earlier failures retained) and
`b8b-source-files.json`. Raw receipts, binaries, copied inputs and outputs remain
private. Final checked runner SHA256:
`2c92a10c43d9a9c91df1f1451ec7ade6bb0e42b794c7cad12ea63c30713f86ac`.
This verifies one real retained model/cable across five execution modes, not2140
cable capacity or collision correctness against uncaptured civil geometry.

## Remaining boundaries

The two user-named obstacle groups are `3D-Modell_BIS_20260304.rvm` and
`DB2401_DESIGN_01-PIPE+GRID_20260304.rvm`. Their actual parent/descendant triangles,
topology, openings and whole-group capacity remain uncaptured/unqualified.
No bounding-box solid, synthetic success or empty scope substitutes for them.
Saved5191 browser refusal was not retried or bypassed. No native parity claim.

No original5180/5190 or5191 runtime/data update, Auto write, Review or Apply occurred.
The original application and business/model data remain unchanged by this stage.
B9 still needs a fresh backup/restore and explicit migration/control-delta qualifier
before any coherent5191 update; unchanged owned-update-v2 equality checks must not
be bypassed. Simplified Preparer remains queued for its separately authorized5180
worktree. Automation stays active while useful independent work remains.

Read-only repository refresh at2026-10-21T19:53Z: original WFC clean main and live
origin/main both `96e63f13fdc2b1d30b8f8ff658dd662f25fac104`; canonical PathFinder
clean `45c24bf5f433f13e102600b36f20327c77961d0a`. Before B8b commit this local branch
was3/161 left/right against that live main, not a parity claim. GitHub returned no
PR for this local head, no combined statuses and no PR-triggered workflow runs for
the inspected main SHA. Empty responses are not CI/review approval; the workflow
wrapper filters PR-triggered runs and first page. No remote mutation occurred.
