# Isolated Stage 4 acceptance environment

Use Node 24 and Docker Desktop. The runner never discovers or copies an existing `.env`. Its generated `fixture.env` contains only image names, artifact paths and a random run identity; database, JWT and MinIO credentials in this fixture are explicit disposable test values. Keep the run directory outside the repository.

```powershell
node scripts/model-registry/run-stage4.mjs init --run-dir C:/stage4-evidence/run-01
node scripts/model-registry/run-stage4.mjs build --run-dir C:/stage4-evidence/run-01
node scripts/model-registry/run-stage4.mjs start --run-dir C:/stage4-evidence/run-01
node scripts/model-registry/run-stage4.mjs regression --run-dir C:/stage4-evidence/run-01
node scripts/model-registry/run-stage4.mjs contracts --run-dir C:/stage4-evidence/run-01
node scripts/model-registry/run-stage4.mjs integration --run-dir C:/stage4-evidence/run-01
node scripts/model-registry/run-stage4.mjs status --run-dir C:/stage4-evidence/run-01
node scripts/model-registry/run-stage4.mjs stop --run-dir C:/stage4-evidence/run-01
```

`init` defaults to the two pinned Aalborg ZIP files from Stage 1/3 and independently checks their raw SHA-256 and sizes. Relocated files can be passed with `--primary-zip FILE --secondary-zip FILE`; their identities must still match. No ZIP or NWD is copied into an image or the repository.

`build` uses the actual production Dockerfile's `api-runtime` and `web-runtime` targets plus its isolated `test-runtime` target. Node build/API use the pinned official Node 24 Debian image. Dependency installation and the initial nginx image retrieval may require package/image registries during build. Runtime verification needs no download, Autodesk, Preparer or Viewer SDK. Every command has a timestamped log; before/after source inventories and image IDs are recorded in the run's evidence directory. Build only after writers freeze the source.

The unique Compose project is `wfc-model-registry-stage4-<run-id>`. Its three fresh volumes hold PostgreSQL, MinIO and a shared import staging directory. Both API workers use the same uid and shared staging volume. Existing WFC/Viewer/Preparer containers and `.data` directories are not mounted or modified. The two ZIP files are mounted individually read-only into the test driver.

Only the nginx proxy publishes a host port: `127.0.0.1:18084` by default (`init --port PORT` changes it). PostgreSQL and MinIO have no host ports. API, PostgreSQL and MinIO connect only to an internal backend network; the proxy also connects to its own ordinary bridge because Docker Desktop can suppress published ports on an entirely internal network. The generated fixture proxy preserves the production route limits/timeouts and changes only the API upstream to two workers, adding a test-only upstream observation header. Production configuration has no such header or second-worker dependency. Only the import endpoint (including Express-equivalent case/trailing-slash aliases) has the 2 GiB upload policy. Its internal, bodyless authorization subrequest checks current project editing permission before nginx can send 100 Continue. A missing preflight project is normalized to 403 through the proxy; ordinary API statuses remain unchanged. Import-specific 401/403/413 responses contain safe JSON.

`regression` executes Node version/uid, WFC typecheck, lint, build and default Vitest test selection in separate disposable nonroot Node 24 containers with network disabled and explicit synthetic configuration. Each regression container is limited to two CPUs, 4 GiB and 256 processes; Vitest uses one worker to avoid CPU contention without changing timeouts or assertions. Only Vitest receives `VITE_API_URL=http://localhost:4000` for existing absolute-URL mocks; production builds retain `/`. Built-in Node registry tests run separately through `contracts` against the disposable real PostgreSQL/MinIO. `integration` runs the peer-authored HTTP driver through the fixture proxy, restarts only the two fixture API workers, waits for both to become healthy and verifies the saved selection/metadata and all stored resource hashes again. Each attempt gets distinct main/restart report names; failed attempts remain intact. The primary import is accepted only after the public verifier and independent object readback succeed; the historical sidecar is not a verifier.

The model bucket is dedicated and private. The implementation refuses **any** existing nonempty bucket policy and never changes one. Resource uploads preserve raw gzip bytes as `application/octet-stream` without Content-Encoding. SDK HTTP retries are disabled only for the dedicated model client; input errors reach the SDK multipart stream and operation-owned HTTP requests are aborted and drained before cleanup. Bounded cleanup aborts every exact owned multipart upload ID and freshly checks complete objects and multipart IDs until both owned inventories are empty. Full SHA/size readback is required. Actual HTTP requests have a 120-second idle timeout and each storage method has a separate 10-minute total deadline. An existing exact object can be reused; a different object is never overwritten. Prefix publication/cleanup ownership comes from the PostgreSQL ledger and import session lock. `removeUnpublished` must never be called before resolving an unknown commit result or for a published prefix.

`stop` validates the run identity on every project container, network and volume before removing only that project's containers/networks/volumes. It leaves build images and all evidence for inspection. Image deletion, when no container references it, is a separate bounded cleanup step. No global prune or retry of earlier blocked filesystem cleanup is part of this runner.



The pinned MinIO server is RELEASE.2025-09-07T16-13-09Z (the same image as the preserved working WFC MinIO). Its multipart listing prefix matches an exact object key; an empty directory-prefix response does not prove absence of parts. Deleted projects retain prefix ownership after their manifests are removed, so recovery uses read-only bucket-root multipart metadata with strict owned-prefix filtering. Foreign keys/IDs are never returned, persisted or deleted. The aggregate scan is capped at 100000 MPU entries and the existing 10-minute deadline; duplicate/non-advancing pagination fails closed. Complete-object listing and every mutation remain limited to the proven owned unpublished prefix.

