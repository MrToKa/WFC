# Download and package adapter

`lib/package-adapter.mjs` connects the standalone Preparer core to the unchanged
Stage 1 public package API. It implements local preparation from normalized
provider responses. It contains no Autodesk client, credentials, `.env` loader,
CDN access, HTTP server, Docker integration or second ZIP implementation.

## Explicit package dependency

Create the adapter with exactly one of:

```js
const adapter = await createPackageAdapter({
  packageModulePath: 'C:/explicit/location/routings-model-package/index.mjs',
  workDirectory: 'C:/explicit/private/preparer-work',
  clock,
});
// Tests or an embedding application can supply the same public API object:
// createPackageAdapter({ packageApi, workDirectory, clock }).
```

The module path must be absolute and name the trusted public `index.mjs`.
There is no default lookup in the current directory or neighboring host folders,
no private-file import and no dependency installation at startup. The adapter
uses only `packModel`, `verifyPackage`, `validateProfile` and `DEFAULT_LIMITS`.

For a later Docker build, explicitly include both local projects in the build
context, copy the package module to a fixed container path, and configure that
absolute `index.mjs` path. Mount persistent data/work paths separately. This is
packaging guidance only; Stage 2 does not create or run a Docker build.

## Provider boundary and root selection

`download(job, {provider, rootId?, signal?, previous?, onCheckpoint})` requires a
durable checkpoint callback. The caller holds the core's exclusive per-job
lease for the entire operation; this adapter does not implement a competing
lock or import the package tool's private locking functions.

The provider methods are:

```js
getManifest(job.frozen, {signal})
getDownloadPlan(job.frozen, {rootId, signal})
readResource(job.frozen, {resourceId, signal})
```

The normalized manifest must report `success` and exact object/URN/submission
identity. Multiple compatible roots require an explicit `rootId`; no first-root
fallback occurs. The selected plan has this shape:

```js
{
  schemaVersion: 1,
  submissionIdentity, objectId, urn, region, rootId,
  supportProfile: 'svf-local-7.130.0-v1',
  resources: [{path: 'output/0/0.svf', resourceId, bytes, sha256?}, /* ... */],
}
```

Resource IDs are opaque normalized identifiers, not signed URLs. The provider
owns any real transport/reference enumeration. It must return the complete
supported inventory, including `properties.db`; the adapter does not copy a
ZIP parser to discover missing files. A deficient plan fails the Stage 1 public
profile closure check. No missing resource is guessed or fetched from a CDN.
The real cloud provider remains closed in Stage 2.

## Checkpoints and raw data

Plans are sorted by ordinal path before their canonical digest is calculated.
Paths are direct `output/0/` siblings of the supported profile; traversal,
encoded paths, Windows device names, case collisions, runtime files and `.env`
are refused. Filesystem ancestors/files are inspected for links, junctions,
hardlinks, special files and resolving aliases. Test temp paths use their
canonical long names on Windows.

The parent store is authoritative. The adapter does not automatically read a
legacy ledger or its own extra checkpoint file. Checkpoint state is:

```js
{
  schemaVersion: 1, status: 'downloading' | 'downloaded',
  planDigest, rootId, modelDirectory,
  checkpoints: {'output/0/0.pf': {resourceId, bytes, sha256}},
}
```

The model directory is isolated under `workDirectory/jobId/planDigest/model`.
Part files are kept in the sibling `parts` directory. Each resource is streamed
as raw byte chunks into an exclusive part file while checking actual bytes and
SHA-256. The complete part is synced, closed and atomically renamed before
`onCheckpoint` is awaited. A failed state commit stops subsequent reads and
packaging. Crash leftovers without committed checkpoints are not trusted.

Resume checks the plan/root binding, then streams every previously checkpointed
file to recompute size/SHA. Only missing/corrupt/uncommitted resources are fetched
again. Malformed checkpoint state is refused rather than silently reset. The
adapter does not retain tokens, signed URLs or foreign provider error messages.

The inherited limits are 2 GiB per raw resource, 8 GiB raw aggregate and 100,000
files. Manifest/plan/transfer/inventory uses a separate `downloadMaxMs` budget,
default and ceiling 1,800,000 ms; a supplied value must be a positive safe integer.
Its timer is cleared before public validation, which retains the package API's
600,000 ms budget and caller cancellation. Download budget exhaustion is
`PACKAGE_LIMIT_EXCEEDED`; committed checkpoints remain resumable. Declared limits are checked
before reads; actual stream lengths are enforced during transfer. Raw gzip is
preserved. The public profile validator applies its own structured and terminal
inflation limits without altering their Stage 1 scopes.

After all resources have been rehashed and exact inventory/reference closure
passes, the adapter writes `integrity.json` and `model.json`. The descriptor has
`svf`, SDK `7.130.0`, `/model/output/0/0.svf`, the captured source basename/size,
and actual resource count/bytes. Only then is `downloaded` committed. Until the
commit succeeds, the core must not call the packaging step.

Abort stops local reads and removes the currently owned part file while retaining
committed checkpoints. It does not cancel a provider conversion job. A transport
must honor the signal and release its own resources; a nonresponsive foreign
iterator is not awaited indefinitely during cleanup. Stale parts from a killed
process are preserved for explicit owner-aware recovery, not globally pruned.

## Public package operations

`buildPackage(job, {modelDirectory, signal?})` requires the model directory to
belong to that job's configured work tree. It checks captured source bytes/SHA,
then calls public `packModel` with the snapshot path, model directory, frozen
label/output and signal. The snapshot basename must equal `source.name`.
The package output is separate from model staging and the capture directory.

The Stage 1 tool performs no-overwrite publication and independent staged
readback. The adapter subsequently calls public `verifyPackage` again before
returning compact verified facts: path/transport SHA/bytes, package UUID,
content fingerprint, resource count/raw bytes, source metadata and verification
time/tool version. The core commits `lastGoodPackage` only after these facts
are verified. A failing attempt does not replace an earlier good ZIP.

The existing public packager emits `observed-local-file`. This adapter preserves
that provenance. Captured bytes and their provider/submission relationship are
recorded separately by the core's durable history; it does not rewrite the
portable manifest to assert `captured-at-conversion`.

`registerPackage(packagePath, {signal?})` uses public `verifyPackage` on an
explicit local archive and returns its report. It has no provider calls, NWD
dependency or invented remote history. Existing large packages need not be
rebuilt merely to register them.

Errors are typed `CoreError` values. Foreign provider/SDK messages are replaced
with safe messages; a trusted package error may expose only its bounded error
code as `details.packageCode`. The enclosing core records interrupted/failed
state and preserves the previous package/checkpoint history.

## Adapter checks

Run from this project:

```powershell
node --test test/package-adapter.test.mjs
```

Fixtures use three small static model resources and the actual unchanged public
Stage 1 API. They check a local pack/verify round trip, raw gzip retention,
interruption/resume, checkpoint corruption, missing property/reference data,
explicit root choice, identity mismatch, size/count bounds, abort cleanup,
sanitized errors, links and preservation of a previous good package. The static
SVF envelope is test data, not a duplicated ZIP writer, geometry acceptance
test or live cloud proof. All providers/transports in these checks are fake.
