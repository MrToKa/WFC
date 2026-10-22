# PF-B19 — exact barrier outcomes and refresh-safe reconciliation

The popup is delivered through PF-B18. This stage implements exact terminal
barrier refusals and recovery after page/Viewer changes. It does not yet make an
open Aalborg floor a supported routing obstacle.

## Implemented

- A fully hashed, joined geometry-verifier refusal is persisted atomically for
  its original command, capture and protected full frame. Prior committed success
  wins; a refused lease cannot later publish. Operational failures remain unknown.
- An authenticated historical outcome read does not require the original Viewer
  to remain active. It matches the original user/login and all requested hashes.
  Old success receipts explicitly retain their absent historical frame digest.
- The client writes a hash-only pending record before a potentially uncertain
  request. Restored publication records permit historical reads, never old-frame
  geometry resends. Only an exact terminal outcome clears a publication lock.
  Begin/empty unknown sentinels still require a later dedicated recovery protocol.
- Capture cleanup cannot replace its primary geometry failure. Linux exited-task
  samples without RSS wait for real child close; live missing-RSS samples refuse.
  This narrow correction does not prove the cause of earlier intermittent tests.
- The actual existing API image has no configured BarrierVerifier. The Dockerfile
  now publishes, copies and configures it. This is a source fix; a new API image
  has not yet been built or installed.
- A separately selected, versioned post-B9 no-DDL delivery qualifier conserves all
  existing tables, rows, globals and sequence state. Populated history and called
  ordinals are retained. Original B9 rules and resource/backup/restore/CAS fences
  remain; no history is deleted to fit a pristine-database assumption.

## Root execution

Current source checks: 389 unique Vitest assertions (server165, client192,
process-status11, isolated SQL/cookie-HTTP/Linux verifier21), native bridge63,
delivery/comparator132, full types, scoped lint and frontend/server builds PASS.
Independent source reviews are clear. The isolated fixture used a fresh owned
PostgreSQL instance, real JWT/cookie routes and the freshly source-compiled net9
verifier. Original application data was not used or changed. Source/artifact
bookends, positive child cleanup and owned network removal passed.

Failed attempts remain retained: temporary PostgreSQL socket configuration,
fixture-only MinIO import settings and JWT timestamp precision were corrected;
earlier assertion/type/build-command errors were corrected. Two intermittent
verifier/HTTP failures preceded the diagnostic passing run; their specific cause
was not established. The final run after the narrow process-status correction
passed all21 checks. These are actual results, not remote CI acceptance.

Separately, the private surface-query foundation passed25 synthetic Linux checks
after positional range reads corrected a real warm-cache corruption failure.
It remains private and is not a routing/publication implementation. Its current
Windows source revision has not been rerun. A surface miss is not solid occupancy
or an own-endpoint exit certificate.

## Remaining work

The retained floor has928 triangles and40 exact-welded local boundary edges. The
unchanged closed-only verifier rejects it. Additive mixed original-surface and
qualified-solid publication/runner contracts, endpoint ownership, full-capacity
multipart integration and the requested real Aalborg routing test remain required.
No original triangles, openings or geometry limits were silently discarded.

Runtime5191 still serves the B18 web image and original ac0 API image. No API
restart, model/cable write, Review/Apply or original5180/5190 mutation occurred in
this stage. The saved browser refusal was neither retried nor bypassed. Paired
API/web delivery requires a fresh owned backup/restore/qualification operation.
Simplified Preparer follows completed PathFinder verification.
