# PF-6 — Explicit Review + Apply with atomic cable provenance

Advance independent implementation prompt; refresh actual PF-5 contracts and
evidence before final delivery. Continue only in the isolated branch/runtime.
No original installation updates, push, PR or merge. Native acceptance remains
BLOCKED for real artifacts; this stage must enforce that gate, not bypass it.

Implement explicit administrator review and Apply of a server-owned successful
proposal, atomically writing **routing and design_length only**. Preserve
install_length and endpoint labels. Never accept client-computed length or route
as the authoritative Apply value. Review binds the exact immutable proposal.

The write transaction locks project first, current user row FOR SHARE, and all
relevant model/selection/artifact/location/settings/job/proposal dependencies
through commit, then the cable FOR UPDATE. Compare its dedicated server-owned
cable_write_revision and every reviewed dependency. Detect manual/import edits,
including A→B→A. Reject stale/missing/unaccepted/deleted dependencies. Recheck
current role/login, model health and artifact integrity; middleware alone is
insufficient for the commit boundary.

Persist immutable history/provenance and idempotent receipt in the same
transaction. Scope idempotency to project/actor/key and payload hash; a replay
requires fresh authorization. Serialize existing cable version history safely;
if widening the history source enum, update schema/model and tests deliberately.
Any necessary manual PATCH row-lock fix belongs to the sole backend writer.

Add the English UI Review + Apply interaction with clear conflict/review states.
No automatic proposal generation overwrites cable values. Current unaccepted
real model results display why Apply is unavailable. Only server-owned verified
synthetic demo provenance may exercise the isolated test path.

Prove atomic rollback, install-length preservation, concurrent Apply/manual/import
conflicts, dependency/role revocation during Apply, idempotency payload mismatch
and cross-project denials using separate DB resources. Record exact tests and
limitations in `06-stage-report.md`, commit locally, prepare PF-7 from the actual
combined implementation and continue without routine permission questions.
