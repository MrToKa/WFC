# Routings Model Preparer

Stage 3 adds a standalone local application, Bulgarian operator interface,
verified package preview/export, Docker delivery and start/stop scripts. Version
**1.1.0** uses Node.js 24 built-ins and the public Stage 1 package API, with one
bounded SVF inspection export for real download planning.
The durable Stage 2 core remains the workflow authority.

From PowerShell in this directory, first build and start:

```powershell
.\start-preparer.ps1 -Build
```

Open [Model Preparer](http://127.0.0.1:8083). Subsequent starts use the delivered
image without downloading dependencies or the SDK:

```powershell
.\start-preparer.ps1
.\stop-preparer.ps1
```

The default runtime configuration is the explicitly authorized existing PoC
`.env`; credentials are never copied into this project or image. Its historical
`PORT`, `MODEL_SOURCE`, `MODEL_NAME`, `APS_ACCOUNT_TIER` and `APS_ALLOW_CLOUD`
do not start a task, select an input or grant permission for cloud mutations.
The user separately authorized discovery and insertion of the existing owned
`APS_BUCKET` on 16 October 2026; no other PoC setting was changed.

The default **closed** mode supports local capture and registration, verification,
offline preview and export. **Simulation** uses generated synthetic input and
separate persistent directories. The real Autodesk adapter requires the current,
source-bound operator proof described in [live-cost-source.md](docs/live-cost-source.md).
Authentication and owned-bucket checks are separate from Free-plan and remaining
allowance review. Missing or expired proof keeps live operations closed.

See [deployment](deployment/README.md), [operator/API documentation](docs/app.md)
and the Stage 3 report in WFC's `docs/routings-viewer/03-stage-report.md` for
configuration, validation evidence and current limitations. WFC integration is
a subsequent stage.

## Durable core reference (Stage 2)

Standalone **Node.js 24** ESM module, originally version **1.0.0**, for Stage 2 of the Model
Preparer. It captures immutable local input, persists jobs and submission
history, evaluates zero-cost evidence, simulates provider operations, resumes
raw downloads and uses the completed Stage 1 package tool.

Stage 2 runs **offline with factory-created fake providers and transports**.
The default real provider is closed: its methods fail with `CLOUD_CLOSED`, and
the real cost provider supplies no approval. The core has no Autodesk SDK,
credential loader, `.env` access or network transport. Stage 3's separate service
and deployment layers provide the web server and Docker project.
Constructing the core and listing/reading jobs perform local operations only.
An empty store never starts a new Aalborg preparation automatically.

This project is separate from WFC, PathFinder and the working Viewer. Its Stage 2
means **Model Preparer core** under the user's original numbering. The alternative
future-stage numbering proposed in the historical Stage 0 specification has not
been adopted; WFC import remains outside this module.

## Installation and tests

Copy this project and the existing `routings-model-package` project to explicit
local locations. Install Node.js **24.x** beforehand; the development environment
uses **24.19.0**. Both modules use Node built-ins only. There are no external
dependencies to install, and startup never downloads packages or SDK files.

From this project directory:

```powershell
node --version
node cli.mjs --help
node --test --test-concurrency=1 --test-reporter=tap test/*.test.mjs
```

The tests use controlled temporary files, fake provider responses and real child
processes for persistence/locking scenarios. They include a small integration
round trip through the unchanged public Stage 1 packager/verifier. Test fixtures
are not real conversion, price, geometry or production-acceptance evidence.
Current results, versions and limitations belong in the Stage 2 report; this
README does not carry forward historical test totals as a new result.

Use canonical absolute paths. Directory/file guards reject links, junctions,
hardlinks, special files and resolving aliases such as Windows 8.3 paths. Tests
resolve the system temporary directory to its canonical long spelling.

## Local CLI

The CLI implements exactly three local operations:

```powershell
node cli.mjs list `
  --data-dir "D:\Preparer\data" `
  --work-dir "D:\Preparer\work" `
  --package-module "D:\Tools\routings-model-package\index.mjs"

node cli.mjs read `
  --job-id "93e786c2-3ab4-4f85-a9bb-52a4e47a5a4e" `
  --data-dir "D:\Preparer\data" `
  --work-dir "D:\Preparer\work" `
  --package-module "D:\Tools\routings-model-package\index.mjs"

node cli.mjs register `
  --package "D:\Prepared models\existing-model.zip" `
  --data-dir "D:\Preparer\data" `
  --work-dir "D:\Preparer\work" `
  --package-module "D:\Tools\routings-model-package\index.mjs"
```

`register` optionally accepts `--job-id UUID`. `read` requires it; `list` refuses
it. All three commands require explicit `--data-dir`, `--work-dir` and
`--package-module`. The data and work directories must be disjoint. There is no
CLI upload, conversion, cloud polling, download or automatic legacy migration.
Registering verifies the received ZIP locally, creates a `registered` job and
does not invent remote/source-capture history.

Successful results are JSON on stdout. Runtime failures are safe JSON
`{code,message}` on stderr, without foreign SDK/provider bodies, signed URLs or
tokens. Invalid arguments and unsupported Node major versions produce static
plain-text diagnostics. Exit codes:

| Code | Meaning |
|---|---|
| `0` | Successful local operation or help. |
| `1` | State, validation, provider-boundary or IO failure. |
| `2` | Invalid CLI arguments or unsupported Node major version. |
| `130` | Local interruption. |

## Public API

Import only [index.mjs](index.mjs). The core factory is asynchronous:

```js
import { createModelPreparer } from './index.mjs';

const core = await createModelPreparer({
  dataDirectory: 'D:/Preparer/data',
  workDirectory: 'D:/Preparer/work',
  packageModulePath: 'D:/Tools/routings-model-package/index.mjs',
});
```

This configuration uses closed real providers and enables local capture,
read/list and existing-package verification. It does not enable cloud execution.
Tests explicitly inject factory-created fake providers/cost providers.

Stage 3 also exports `createAPSProvider` and `createAPSCostProvider`. Live work
requires the matched factory-created pair and a current authenticated operator
review, with separate persistent live state. The application constructs this
pair server-side; its default policy reuses existing artifacts. See
[live-cost-source.md](docs/live-cost-source.md) for the concrete proof workflow.

`createModelPreparer(options)` accepts:

| Option | Contract |
|---|---|
| `dataDirectory`, `workDirectory` | Explicit disjoint local persistence and work paths. |
| `provider` | Default `createClosedProvider()`; simulation uses `createFakeProvider`; authorized live work uses `createAPSProvider`. |
| `costProvider` | Default `createClosedCostProvider()`; simulation uses `createFakeCostProvider`; live uses the matched `createAPSCostProvider`. |
| `clock` | Object with `now()` returning integer epoch milliseconds and optional abort-aware `sleep(ms, signal)` for controlled waits. Default uses real time. |
| `packageModulePath` or `packageApi` | Exactly one explicit public package dependency when the factory constructs its adapter. |
| `packageAdapter` | Explicit adapter implementing `download`, `buildPackage`, `registerPackage`; useful for controlled tests. Overrides adapter construction. |
| `store` | Explicit store with the public store contract; otherwise the factory creates and initializes its own store. |
| `readPolicy` | Bounded read/poll options described below. |
| `fault` | Async test hook `(point, context)`; default performs no action. It does not enable a live provider. |

The returned core methods are:

| Method | Result and options |
|---|---|
| `captureJob(spec, {signal?})` | Captures a new immutable snapshot and returns the persisted job. |
| `approveCost(jobId, {signal?, recoverDead?})` | Explicitly obtains/reviews a grant from the configured matching issuer; returns a controlled cost decision. A new denial clears the old grant. |
| `prepare(jobId, {signal?, recoverDead?})` | Checks capture and shared eligibility, reuses known objects/derivatives and performs only eligible operations allowed by the configured provider policy. Returns the updated job. |
| `reconcile(jobId, {signal?, recoverDead?})` | Explicit bounded provider read; appends a derivative observation while preserving unknown intent. Returns the updated job. |
| `waitForDerivative(jobId, {signal?, recoverDead?})` | Bounded reconciliation/poll loop. Returns on observed success/failure; timeout is `READ_LIMIT`. |
| `download(jobId, {rootId?, signal?, recoverDead?})` | Requires a complete derivative ledger, selects the explicit/unique compatible root and persists raw checkpoints. Returns the updated job. |
| `buildPackage(jobId, {signal?, recoverDead?})` | Requires downloaded state and intact capture; invokes the public package adapter and commits verified `package`/`lastGoodPackage` facts. |
| `registerPackage({packagePath, jobId?}, {signal?})` | Verifies an existing ZIP and creates a local registered job, with no provider calls. |
| `readJob(jobId)` | Detached validated local job or `JOB_MISSING`; no provider calls. |
| `listJobs()` | Detached validated local jobs; corruption fails the read rather than resetting state. |
| `stop(jobId)` | Requests abort of this process's tracked `approveCost`, `prepare`, `reconcile`, `waitForDerivative`, `download` or `buildPackage` work for that job; returns `{localAbortRequested,remoteCancellationConfirmed:false}`. `captureJob` and `registerPackage` use the caller's `AbortSignal` instead. |

`readPolicy` defaults to `{maxAttempts:3,maxMs:5000,backoffMs:20,maxPolls:5}`.
Allowed ranges are 1–5 attempts, 1–60,000 ms, 0–1,000 ms backoff and 1–20 polls.
Only safe reads with an explicitly retryable foreign failure use bounded retries.
Storage creation, upload and submission do not use that read retry loop.
Polling/backoff observes stop/abort and records a local interruption.

Core fault hooks currently include `afterStorageIntent`, `afterUploadIntent`,
`beforeSubmitIntent`, `afterSubmitIntent` and `afterSubmitResponse`. Store-level
write hooks are configured on an explicitly supplied `createStore` instance.
These are test hooks for crash boundaries, not operator workflow actions.

Additional exports from `index.mjs` are:

| Export | Purpose |
|---|---|
| `createStore({dataDirectory,workDirectory,clock?,fault?})` | Durable local store/capture API; see [store.md](docs/store.md). |
| `createPackageAdapter({packageModulePath? ,packageApi?,workDirectory,clock?})` | Explicit download/package boundary; see [package-adapter.md](docs/package-adapter.md). |
| `evaluateCostEvidence({evidence,context,operation,now,consumed?,verified?})` | Pure controlled allow/deny decision for `storage`, `upload`, `submit`. |
| `issueFakeCostEvidence(context, options?)` | Synthetic grant with clock/expiry/operation counts/quota/binding; never live authorization. |
| `createFakeCostProvider({evidence?,clock?,...issuance})` | Explicit fake approval issuer with `getEvidence`, `verifyEvidence`, `issue`, `setEvidence` and sanitized calls. |
| `createFakeProvider({clock?,objects?,manifests?,resources?,handlers?,transport?,storages?,plans?})` | Factory-branded in-memory provider and fixture controls. |
| `createFakeTransport({resources?,chunkBytes?,handlers?})` | Factory-branded raw fixture transport; Buffer/Uint8Array or explicit body factories. Default chunks 65,536 bytes, allowed 1–1,048,576. |
| `createClosedProvider()`, `createClosedCostProvider()` | Closed defaults; no supported live activation switch. |
| `CoreError`, `PROFILE`, `STATES` | Typed errors, `svf-local-7.130.0-v1` and the documented state-name list. |

See [cost.md](docs/cost.md) for exact fake evidence/provider/transport shapes and
controls. Factory brands are a configuration boundary for trusted test code;
they do not sandbox arbitrary injected handlers.

`issueFakeCostEvidence` options are `clock`, `evidenceId`, `checkedAt`,
`expiresAt`, `ttlMs` (default 60,000), `allowedOperations`, `counts`, `quota`,
`status`, `amount`, `currency`, `basis`, `originReference` and `uploadBytes`.
The fake cost provider passes these issuance options through; `issue(context,
overrides)` explicitly creates a new grant and `setEvidence(value)` selects an
explicit grant or denial. The provider offers `setObject(context,value)`,
`setManifest(context,value)` and `setDownloadPlan(rootId,value)` as local fixture
controls. Provider handlers receive `(context,options,{default,provider})`.

For raw fixtures, use a Map/plain object keyed by normalized resource ID, with
values such as `{path:'output/0/0.pf',data:buffer}` or
`{path,bytes,sha256?,body:({signal})=>asyncIterable}`. Transport resource
description and read methods are `describeResources()` and
`readResource(context,{resourceId,signal?})`. A transport handler receives
`(context,options,{default})`. These fixture controls do not make cloud requests.

`STATES` contains `captured`, `registered`, `cost-blocked`, `uploading`,
`uploaded`, `submission-unknown`, `submitted`, `translating`, `downloading`,
`downloaded`, `verifying`, `packaged`, `failed` and `interrupted`.

## Immutable job specification

`captureJob` accepts the following explicit shape:

```js
{
  jobId: '93e786c2-3ab4-4f85-a9bb-52a4e47a5a4e', // optional UUIDv4
  sourcePath: 'D:/Models/example.nwd',
  namespace: {account: 'example-account', application: 'example-app'},
  region: 'EMEA', // EMEA or US
  destination: {bucket: 'example-models', objectKey: 'example.nwd'},
  conversion: {format: 'svf', views: ['3d'], xAdsForce: false},
  supportProfile: 'svf-local-7.130.0-v1',
  label: 'Example model',
  output: 'D:/Prepared models/example.zip',
}
```

The core streams and hashes the original input into a private persistent
snapshot, checks changes during capture, preserves its original basename and
independently verifies the stored bytes. Upload uses those exact checked bytes.
An update to the original source path cannot silently update an existing job.
Snapshot corruption blocks preparation/packaging.

There are separate local job, remote target, upload and submission identities.
Submission identity binds captured source **bytes/SHA**, account/application,
region, bucket/object destination, conversion settings and support profile.
Local job ID, label, output path and descriptive source basename are excluded
from its deduplication key. New labels/jobs/outputs cannot bypass a known target
or unknown submission. A changed source cannot silently overwrite the same
recorded remote target. Cost-evidence binding includes the exact descriptive
source metadata as well as the remote identities.

Frozen inputs, receipt identities, submission attempts, acknowledgements,
observations, cost usage and download checkpoints are distinct persisted data.
No credentials, tokens or signed URLs belong in the state. The runtime validates
more than the machine schemas: [job state](schemas/job-state-v1.schema.json) and
[store record](schemas/store-record-v1.schema.json).

## Durable eligibility and recovery

The append-only revision/hash chain and independent high-water head detect
truncation, missing tails, malformed JSON and mismatched state. Corruption is
`STORE_CORRUPT`; the core does not reset a store or roll eligibility back to an
older record. Writes are confirmed before dependent fake mutations. The store
uses file fsync and atomic same-volume publication, with directory flushing
where supported. Process crash/restart is its test scope; universal power-loss
durability and hostile filesystem mutation are not guaranteed.

The **shared submission write-ahead ledger is authoritative**. Job submission
fields are a projection that may lag after a crash. Eligibility and recovery
consult the shared ledger, not a stale local job status. Before submit, an
immutable attempt and exact intent are committed as `submission-unknown`.
Submission uses `retries:0` and `xAdsForce:false`. A timeout, lost response, abort,
404, pending observation, elapsed time or fresh cost grant never erases intent
or permits an automatic second submit. Failed derivatives do not trigger forced
conversion. Explicit reconciliation records subsequent observations.

Cross-process locks cover job, remote target, submission and cost reservations.
`recoverDead:true` is an explicit API option. Recovery requires a recognized
same-host owner and OS confirmation that its PID is absent. Live/ambiguous PID,
foreign owner, malformed lock or abandoned lifecycle mutex refuses mutation.
Age alone is never evidence for takeover; release checks ownership. This is
conservative local exclusion, not a guarantee of Autodesk exactly-once behavior.
Details and direct store methods are in [store.md](docs/store.md).

## Zero-cost gate

Simulation evidence binds the precise source/account/application/destination/region,
conversion/profile, allowed operations/counts, zero amount, allowance and checked
time/expiry. The core durably reserves usage, then performs a final synchronous
cost check immediately before **each** storage creation, upload and submit.
No asynchronous step separates that final check from the mutation call.

Missing, unknown, expired, paid/nonzero, exhausted, mismatched and unverifiable
grants block mutations. A newly denied `approveCost` clears an older grant.
The fake issuer caches approvals and does not silently renew expiry. If evidence
expires during upload, the uploaded object is retained, submit is blocked and
explicit fresh approval is required without repeated upload or erased history.

Fake attestations are public fixture digests, not digital signatures or evidence
of real zero price. A fake grant cannot activate the closed real provider.
Stage 3 verified an authenticated Autodesk Account operator source and implements
the distinct APS issuer/transport. Live grants additionally use a private HMAC
key and SHA-pinned source observations. Every read/mutation retains current
expiry, binding and shared reservation checks. This module does not invent an
Autodesk plan/quota API or trust an old APS Free claim, environment flag or
available credentials. See [cost.md](docs/cost.md) for the simulation contract
and [live-cost-source.md](docs/live-cost-source.md) for real authorization.

## Download and unchanged Package A

The public Stage 1 dependency is configured by absolute `index.mjs` path or an
explicit `packageApi`. There is no CWD search, implicit sibling dependency,
deep import or copied ZIP writer. Stage 3 adds only the bounded public
`inspectSvfEnvelope` export for planning; the package format, writer/verifier
and Stage 1 limits remain unchanged.

The provider supplies a complete normalized selected-root plan, including the
additional `properties.db`. Ambiguous roots require explicit selection. The
adapter preserves raw streams, checks actual counts and hashes, and rehashes
checkpoints before reuse. Missing/corrupt resources are fetched again; missing
committed checkpoints do not make orphan files trusted.

Direct adapter use requires `onCheckpoint` and the caller's job lease. Parent
store checkpoints are authoritative; no legacy or hidden adapter ledger is read.
Only complete exact inventory and public `validateProfile` closure produce
`model.json`, `integrity.json` and downloaded state. Public `packModel` performs
safe publication/readback; public `verifyPackage` is called again before the
core commits new `lastGoodPackage` facts. A failed attempt preserves the prior
good archive. See [package-adapter.md](docs/package-adapter.md).

The completed package API still emits `observed-local-file`. This core keeps
that portable provenance and separately records its captured bytes/provider
binding in durable history; it does not rewrite a package as
`captured-at-conversion`. Registered old packages have no invented remote history.

Stage 1 limits remain unchanged: 2 GiB per raw resource/outer ZIP, 8 GiB raw
resources, 100,000 files, 32 MiB portable manifest, 256 MiB per inspected nested
SVF/recognized gzip JSON, 1 GiB aggregate inspected structured inflation,
depth 16, ratio 1200:1 and 600,000 ms operation time. Opaque terminal integrity
streams retain their separate 2 GiB per-file/8 GiB computational bounds. They
are not added to the structured 1 GiB budget and are not semantically executed.

Download transport has its own bounded 1,800,000 ms budget, including manifest,
signed plan, raw transfer and byte/hash inventory. Direct adapter callers may
set `downloadMaxMs` to a positive safe integer at most 1,800,000. It is not an
HTTP or environment setting. Expiry preserves committed checkpoints and reports
`PACKAGE_LIMIT_EXCEEDED`; caller cancellation remains `LOCAL_ABORTED`. Public
profile/archive validation keeps the separate Stage 1 600,000 ms budget. APS
request deadlines, cost-proof expiry and shared read reservations still apply.

Stage 3 bundles both module roots explicitly with fixed configured paths and
persistent data/work/output mounts. See the application and deployment guides
for the delivered Docker/UI/start/stop workflow.

## Stop, evidence and remaining stages

`stop(jobId)` aborts tracked `approveCost`, `prepare`, `reconcile`,
`waitForDerivative`, `download` and `buildPackage` operations owned by the current
core process, including poll/backoff waits. `captureJob` and `registerPackage`
are not tracked by `stop`; abort those operations through the caller's
`AbortSignal`. The job records local interruption with
`remoteCancellationConfirmed:false`; already accepted provider work may continue.
Restart uses durable state and explicit reconciliation. It does not create a
replacement job or replay unknown submission automatically.

The prior Stage 1 package and code are separate immutable artifacts. Historical
Stage 1 checks are not repeated or promoted by this core's fixture tests. Its
browser smoke used a temporary HTTP font-response replacement and does not prove
production SDK/CSP configuration. The prior `.relocation-check` cleanup remains
**BLOCKED** after automatic deletion review rejected it. Stage 2 neither retries
nor bypasses that deletion. Task-owned current test/staging cleanup is separate.

Stage 3 still owns UI, Docker/Compose, operator start/stop and the complete
workflow. Live account evidence/Autodesk adapters require separate authorization
and verification. WFC importer/DB/MinIO/Details/Viewer tabs, iframe resource
sessions, PathFinder integration and production browser acceptance remain outside
this core. It performs no automatic transition into a later stage.
