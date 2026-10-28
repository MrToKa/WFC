# Private worker qualification

This harness measures the compiled production `createSessionEngineExecutor` and
existing `runEngine` client. It does not implement another framed client or
change routing mathematics. The default application mode remains `oneshot`.
Only an explicitly isolated test target receives `PF_ENGINE_MODE=session`.

`prepare.mjs --runner <published-directory> --fixture <MemoryLane-publish>
--real <retained-capacity-input-root> [--deadline <NoResponseLane-publish>]`
compiles server sources into a new owned scratch bundle, emits the single C#
owner's 31-case corpus and copies the retained 52-object real input. It records
source/binary hashes and excludes Windows apphosts. No original runtime data,
credentials or environment file is mounted or copied.

`run.mjs --bundle <new-bundle> --mode mixed|policy|age|rss|deadline` creates one
owned ephemeral Linux container with no network/ports, a read-only root and
three read-only bundle mounts plus one owned writable output directory. Limits
are 4 GiB, 256 PIDs and 2 CPUs. It verifies exact image/ownership/mount source paths,
applies an external whole-container deadline, removes only its exact container
and verifies that the existing 5190 API/Postgres identities remain unchanged.
Raw receipts remain under that bundle's parent scratch directory.

The mixed test compares all decoded response fields, excluding only requestId
and prepared.loadedFromDisk. Object keys are canonicalized; point numbers,
decimal strings and every array retain their original values/order. It tests
the real model A/B/A, all 31 synthetic requests against fresh one-shot calls and
the same 31 requests in reverse order on a new lane. The old real reference is
compared separately for the complete route/design/category. This proves
regression equality, not native or engineering acceptance.

Private observer events establish actual process/ordinal identity and
preparedReuse=memory. Endpoint-dependent graphs are still rebuilt per query.
Timing includes Node validation, serialization and IPC, and is measured with a
50 ms process sampler active. Samples are small; no full-plant capacity or
production speed guarantee follows. RSS is an estimate from sequential /proc
reads, may miss short peaks and is not an atomic or exact peak measurement.
Fresh one-shot RSS is not separately sampled by this harness.

Policy tests exercise actual 64-request and 30-second idle recycling, active
cancellation, concurrent rejection, namespace process crash and recovery.
The age mode runs the actual 10-minute lifetime with 20-second keepalives and a
5-second request deadline, recording any normal deadline headroom rotation.
The deadline mode distinguishes the real warmed 1 ms runner deadline from the
Node hard guard: its separate test-only NoResponseLane warms successfully,
then stops replying until the actual production Node guard kills/reaps it.
MemoryLane is another clearly test-only .NET executable that touches 575 MiB to
exercise the real combined-process 512 MiB RSS guard. Neither fixture is an
application backdoor or a real-model memory-capacity test.

All fixture builds must use a fresh owned output/SDK-home and explicitly set
DOTNET_GENERATE_ASPNET_CERTIFICATE=false, DOTNET_CLI_TELEMETRY_OPTOUT=1 and
DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1. Never build outputs into the source tree or
remove unrelated certificates. `node --test scripts/pathfinder-session/session.test.mjs`
checks the full comparison/parser/tree methodology.

Direct restoration of an existing verified archive to 5191 is separate from
this networkless harness. It never cold-backs-up or restarts 5190. Job authority,
lease/publication, cancellation, crash and graceful stop checks use only that
extra target. No Review/Apply is performed. Loss of the advisory connection
quarantines the worker until an explicit backend restart; same-process
automatic reacquisition is not claimed.

`target-ops.mjs <verified-extra-runtime> <qualification-bundle>` checks the exact
rebuilt target DLL against the retained real route/design, actual memory reuse,
advisory connection loss and graceful stop. Its historical call to the older
64-cable runtime helper missed the fast active window. The separate owned
`crash-once.mjs <verified-extra-runtime> <prior-owned64-job-id>` reuses only that
guarded fixture, completes ownership checks before enqueue and observes a
running batch/process pair in parallel. Post-KILL evidence permits a boundary
between items: an unfinished durable batch, unchanged old owner/attempt and
all 64 item states accounted for. It then waits for natural lease expiry,
requires exactly one new attempt and 64 unique calculated proposals, preserves
install77/routing/design and records durable cancellation. No SQL lease edit,
process pause or artificial engine delay is used.

The stage evidence records 210 networkless engine checks, then 10 durable-job
controls on the revised worker image and a successful natural 64-item
crash recovery. The observed PostgreSQL client error exposed a real listener
lifecycle bug, which was fixed and retested on the separate target. Historical
failures and harness metadata/overstrict-boundary mistakes remain retained as
separate receipts. The final read-only closure additionally verifies progress
counter coherence and NULL-safe item status counts. A replacement owner UUID
was not sampled while running; completion clears that token, so only the new
attempt and successful recovery are claimed. See the dated evidence under
`docs/pathfinder/evidence/session/` and the parent stage report for exact source,
DLL/image bindings and all limitations. The 23 methodology checks include the
unfinished-batch boundary and its negative controls.
