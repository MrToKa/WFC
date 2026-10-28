# PF-6 — Explicit local Review + Apply

Status: **implemented; 20 scoped live integration controls PASS; real-model Apply BLOCKED**.
The local synthetic result is a demonstration of transactional behavior, not
acceptance of the converted Aalborg model or native numerical parity.

## Delivered behavior

A review record binds the current administrator to an immutable proposal hash.
Apply accepts proposal/review identity, an idempotency key and expected dedicated
cable write revision; it accepts no client route or calculated length.

In one transaction, the server locks the project, current administrator/login,
proposal/job/review, selected model/selection, artifact, locations/registry,
synthetic proof and target cable. It compares current dependency identities and
the server-owned write revision, verifies the immutable snapshot file hash and
checks login expiry after I/O and before commit. A successful Apply writes only
`routing` and `design_length`, appends cable history with source `pathfinder`, and
stores its before/after/provenance/idempotency receipt atomically. Install length,
endpoint labels, installation dates and other cable fields remain unchanged.

The database owns the write revision for manual/import/PF writes, including
A→B→A changes. Every distinct accepted PF Apply consumes a new revision even when
its routing/design values equal the current values; an identical idempotent replay
returns the receipt without consuming another revision. Existing manual PATCH now locks its source cable row before
building the history snapshot. Existing history types/checks/labels explicitly
recognize PathFinder Apply. Routing text is limited to the compatible 8,000
characters/100 ordinary segments; long results remain visible diagnostics and
cannot silently enter a cable field the existing Routings viewer cannot display.

All registry operations share the same current-login transaction boundary. Binding
provenance distinguishes manual world point, picked surface and equipment-bottom
AABB intent in a fixed canonical metre frame. Bounded append-only location events
record actor, revision and before/after values for creation, aliases and bindings.

## Actual live evidence

[SQL/HTTP receipt](evidence/pf5/jobs-apply-20261018T023201Z.json),
`2026-10-18T02:32:01.087Z`, **20/20 PASS**, running API image
`sha256:562e80739ed2c105f280a8f460ba449b26aaa6a7a63bcb9b311ff58345407a01`.
The driver uses a private fixture account and temporary cable records in the
separate marked synthetic project, never the real Aalborg project.

Verified controls include:

* Explicit Review + Apply, unchanged install length 99m, `pathfinder` history,
  identical idempotent replay and mismatched-key payload conflict. A distinct
  same-value Apply advances the write revision, stales the prior proposal and
  still permits its original idempotent receipt replay without another write.
* Two-connection mixed existing-cable import/new-cable FK and admin-assignment
  lock-order controls complete without a deadlock under the project mutex.
* Manual routing, Project Details allowances and model selection A→B→A conflicts.
* Revoked login denial for authorization/state/location/match/job endpoints; current role denial
  and cross-project proposal lookup denial.
* Receipt-insert failure rolls back the cable update, write revision and history.
* A concurrent administrator revocation waits for an already protected Apply to
  commit, rather than changing authority within its transaction.
* A direct concurrent model-health change similarly waits on the protected model
  row; checks remain valid through commit.
* A short-lived login that expires while Apply is deliberately paused returns 401
  and rolls all writes back.
* HTTP-uploading even the known synthetic geometry does not acquire the separate
  server-seeded proof: Apply returns `ENGINEERING_ACCEPTANCE_REQUIRED` with no write.

Temporary SQL pause/failure triggers and their functions, private test account,
test cables/locations/jobs/uploaded snapshot were cleaned up. The original local
synthetic allowances/model selection/health were restored. Append-only audit
events are deliberately retained as evidence.

## Remaining acceptance work

The accepted demonstration proof is available only for the exact known synthetic
fixture created by the CLI under explicit local-demo mode, in a server-marked
project. There is no HTTP proof checkbox, arbitrary hash authorization or real
model acceptance override. Native/converted engineering verification remains an
external **BLOCKED** gate; consequently real-model engineering Apply stays denied.

Full concurrent import HTTP, settings/location mutation during a paused Apply,
large-route/large-batch performance and an active-process crash/restart drill are
not established by the 20-control receipt. Its actual tested scope must not be
expanded to those claims. The SQL import/FK lock pattern is covered explicitly;
the entire existing import HTTP workflow is a separate claim. Combined UI,
transport, backup/restore and any later recovery drill have separate evidence.
