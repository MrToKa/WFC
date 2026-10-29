# Selected Save completion and shared computation

Save confirms the shared endpoint assignments and queues the open cable first.
The popup follows that cable's own result and automatic-write disposition;
other affected cables continue independently. An individually sealed, current
selected result can become ready while its parent job is still running.

The Save watcher now publishes the exact job's frozen calculation preferences
before handing its terminal row to Results. This lets independent result,
job and cable-proof reads start together. Intermediate automatic-write rows
remain local until the selected cable's final write disposition is known.
Calculate no longer waits for a completed parent when this cable is ready.

From/To reads converge within a bounded read-only retry window when a registry
or cable revision advances between the two reads. A later observed selected
cable revision requests one fresh pair read. Newer contexts cannot be replaced
by an older list row. Pending Save identities and compatible drafts are retained;
authentication, preparation and scope failures remain closed. Save is never
automatically replayed by this recovery.

Ordinary parent progress and completion preserve the selected result's verified
display payload, including the intent to keep it hidden. Show consumes that
payload without repeating the verification reads. A changed result, cable
revision, model, preferences or owner still invalidates it. A fresh exact-job
failure, cancellation or cancellation request also revokes Show immediately,
even when the selected workflow row has not caught up. Historical paths remain
available through the separate history flow.

## Identical endpoint pairs

The worker can reuse one successful protected native calculation for different
cables with the same ordered logical From/To and exactly matching mathematical
inputs. These include the engine identity, prepared snapshot, endpoint points
and provenance, category, all routing/design options, barriers, openings and
qualification. The 100 mm geometry tolerance does not loosen cache equivalence.

The source cable supplies the geometry verification for the group. Recipient
work updates the shared endpoint references, route and length without repeating
native search, snapshot/mesh qualification or geometric verification. Database
metadata still establishes that the source result belongs to the same current
group. Each recipient receives its own baseline, proposal, seal and
Auto calculated length update.
Automatic Routing/Design updates and manual Review/Apply rules remain per cable.
Only the native computation is shared. Its original request ID is retained as
the identity of the actual native invocation.

The cache belongs to one worker lifetime, spans its single-item scheduling
slices, expires after five minutes and is bounded to 16 entries, 32 MiB total
and 8 MiB per entry. Only a confirmed successful source transaction can seed
it. Failure, stale inputs, cancellation or unknown commit outcome cannot seed
new reusable work. Cached responses are cloned; the source verification is
shared rather than repeated for each recipient.
The cached implementation-signature guard still reads module file metadata.
Pure seal, result-tuple and ledger recognition remain recipient bookkeeping;
they do not load or qualify obstacle geometry or run a collision search.

This removes repeated native searches for an identical pair; it does not promise
that database verification and every recipient write complete in milliseconds.
The selected popup cable remains independent of the remaining recipients.

## Verification

Frontend: Results 138, Workspace 83, endpoint hooks 139, routing panel 66 and
complete partitioned Path Finder tab suite 74 tests passed (500 total).
Client type checking, scoped lint and the production web build passed.

Backend: 323 tests across 16 suites passed, including thirteen worker slices
with one native invocation and source-only full geometry reads, thirteen
automatic writer replicas without full collector/barrier-fence/snapshot reads,
and rollback on metadata changes before writes or after receipt construction.
Server type checking, scoped lint and the production server build passed.
Independent review found no remaining blocker in this scoped change.

Installation and offline Aalborg replay evidence are recorded separately.
This source note alone does not certify installation or browser acceptance.
The browser tool can initialize, but its origin approval gate rejected 5191
with a saved-permission or managed-policy denial. No alternate browser surface
or address was used to circumvent that rejection.
