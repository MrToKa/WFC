# Local application and operator workflow

The service owns one public `createModelPreparer` instance. HTTP handlers call
public methods and never edit core job JSON. It serves the Bulgarian interface,
trusted separate Viewer 7.130.0 runtime and only verified package resources.
All runtime paths are explicitly configured; WFC is not imported or started.

## Input and registration

Choose a local NWD file and version label, or select a direct regular NWD from
the configured read-only source directory. Browser files stream into a controlled
private staging directory, with a 2 GiB limit and actual byte/hash counters.
The original basename is retained in the immutable snapshot. Incomplete uploads
and cancelled capture do not appear as ready jobs. No browser text is accepted
as an arbitrary filesystem path.

For an existing portable model, open the registration section and choose a ZIP
from the allowlisted read-only package directory, or stream a browser ZIP.
Registration invokes public package verification and preserves the original ZIP,
package ID, fingerprint, source provenance and resource bytes. It adds no cloud
submission history. The existing Aalborg package is the offline acceptance input.

## Modes and price

Modes are server configuration, never request parameters. `closed` is the default
and supports capture/register/verify/preview/export locally. Building a package
from an already downloaded captured job is also local: it verifies the immutable
snapshot and raw resource profile without an APS request or renewed price grant.
`simulation` uses
server-generated synthetic inputs and separate stores, snapshots and outputs;
its evidence and geometry do not establish real Autodesk conversion.

`live` requires a separately verified current source document and a distinct APS
provider/cost capability. A missing or invalid live prerequisite leaves local
registration available with an explicit blocked reason. Valid credentials, the
historical account-tier flag and `APS_ALLOW_CLOUD` cannot grant a live approval.
See [live-cost-source.md](live-cost-source.md) for the verified operator source,
binding, expiry, reservations and current approved-source limits.

An expired proof closes cloud capabilities while retaining the requested `live`
store namespace. Restart with the same explicit `-Mode live` and proof pin to
continue a saved live job locally. Selecting `closed` instead opens its separate
store; it does not migrate live jobs. Package creation becomes available only
after the core has committed `download.status=downloaded`; partial checkpoints
alone cannot enable it. Cloud preparation and download remain refused.

Startup, listing, refresh and restart perform zero automatic cloud calls. The
operator first captures a source, explicitly reviews price, then explicitly
requests preparation. Uncertain submission offers reconciliation, never a new
conversion retry. An observation limit means check again, without erasing intent.
Several compatible 3D roots require an explicit choice before download.

The live acceptance uses the existing Aalborg object/derivative. A private source
SHA mapping identifies its previously uploaded object; actual OSS size/SHA-1 and
locally streamed SHA-1/SHA-256 are compared before reuse. This is reported as
reuse, rather than a newly executed upload/conversion. Unsupported SVF/toolkit
data fails explicitly; there is no new SVF2 conversion fallback.

## Observation, conflicts and restart

Every long action has a server operation ID. Each mutating request carries an
idempotency UUID; identical repeated requests return the existing operation,
while a changed body or conflicting action is rejected. The browser records its
request/operation IDs and refresh observes them rather than replaying actions.

Progress consists of the actual phase and available counts. No synthetic percent
is generated. Source, upload, submission attempts/observations, download
checkpoints and last verified package remain separate durable facts.

Local Stop aborts the service's own controller, including capture/registration,
and calls `core.stop` for tracked core work. It does not assert remote Autodesk
cancellation. SIGTERM requests the same aborts and drains for a bounded time.
Startup marks interrupted service operations and reads core facts, without
automatic prepare, polling or lock recovery by age.

Network download planning/transfer has a separate maximum 30-minute budget.
Expiry preserves committed checkpoints; explicit resume rechecks their hashes
and fetches missing/corrupt raw resources. The public profile/archive validator
keeps its own 10-minute budget. APS requests remain bounded individually and
the 30-minute cost review may expire earlier, in which case a fresh account
review, pinned restart and explicit approval are required before more reads.
No timer expiration or resume creates another submission.

The Linux store records boot/process-start/PID-namespace ownership. Live,
foreign, legacy-ambiguous and unverifiable owners fail closed. Graceful stop and
recreate preserve state and release owned locks. Explicit
`-RecoverStoppedContainer -Recreate` uses host-attested own-container/image/
instance identity, stopped PID zero, exclusive volume use and pinned owner
inode/nonce/SHA. It clears only matching recognized ownership files, preserving
job/ledger/WAL history. Foreign, changed, legacy-ambiguous and corrupt state
remains refused. See [store.md](store.md) and [deployment](../deployment/README.md).

## Preview and export

After full public job/ZIP verification, resource serving uses a process-local
verified preview capability bound to that artifact, its allowed original ZIP
path/file stamp, strict resource manifest and controlled extracted directory.
It avoids replaying the entire job WAL for each mesh/property resource. Every
resource still passes path containment, pinned-handle byte/SHA verification and
the original ZIP stamp check. Replacing the artifact invalidates the capability;
restart requires a fresh coalesced public job/ZIP verification. This cache does
not authorize core actions or bypass cost, state or submission guards.

Preview extracts into a private cache using the public package verifier. Only
manifest-listed safe resources are served for a job ID; byte integrity is
checked and the original ZIP stays unchanged. Model data cannot replace SDK
scripts. The trusted SDK is delivered independently with recorded provenance;
its deployment CSS uses local fonts, workers and extensions. Original SDK files
in the working Viewer are unchanged. Geometry keeps its original colors and
light illumination. Properties are loaded from the local model.

ZIP export re-verifies the current original artifact before streaming its bytes.
The report contains sanitized verification facts. Missing or corrupt artifacts
refuse preview/export instead of displaying a false valid result. The client
supplies only job/artifact IDs; there is no arbitrary proxy or download URL.

## HTTP contract

GET endpoints include `/health`, `/api/config`, `/api/jobs`, `/api/jobs/:id`,
`/api/operations/:id`, `/api/requests/:id`, `/api/imports` and `/api/source-inputs`.
Mutations require exact same-origin headers, a service CSRF token and
`X-Request-Id` UUID. Raw upload is `/api/uploads?kind=nwd|package` with an encoded
basename in `X-File-Name`; capture/register uses the returned opaque upload ID.
Known inputs use opaque IDs from their corresponding allowlisted lists.

`POST /api/jobs/:id/actions` accepts an allowed action and optional explicit root
or recovery request; it returns an operation to observe. Cancellation is
`POST /api/operations/:id/cancel`. Verified exports and preview descriptors are
under `/api/artifacts/:jobId/`; the separate preview page is `/preview/:jobId`.
The bounded browser-evidence endpoint records client-reported geometry/property
and request/CSP counts, with that evidence basis explicitly identified.

## Delivery, backup and limitations

Use [start-preparer.ps1](../start-preparer.ps1) and
[stop-preparer.ps1](../stop-preparer.ps1). Docker publishes only
`127.0.0.1:8083` by default. The original PoC config is a runtime-only `env_file`;
legacy port and Windows model paths do not determine service paths.

Stop before backup, then save all three named persistent data/work/output volumes
together with the approved configuration source and proof provenance. Keep the
core revision chains/heads, ownership metadata, snapshots, checkpoints and
verified packages together. Restore into the same stable container paths and
inspect lock ownership before explicit continuation. Never reset a store or
copy simulation approvals into live mode. An image alone is not a data backup.

Actual tests, inventories, image identity, browser proof and unresolved
limitations are recorded in the Stage 3 report. Historical Stage 1/2 passes are
kept as historical evidence. Subsequent WFC importer/DB/MinIO/session/cable work
remains outside this app.
