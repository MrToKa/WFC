# Retained portable model ZIPs

The model importer now retains the verified original portable ZIP independently of its extracted viewer resources. Successful imports and successful content duplicates both have a downloadable archive. Importing does not change the active model selection.

## Startup and storage

`server/modelRegistry/schema.ts` adds `model_package_archives` and its index/ownership protection trigger in the existing transactional startup schema initializer. It does not rebuild or delete existing tables or models. This source change has only been applied to a disposable PostgreSQL 18 fixture, never to the working WFC database.

Archive ownership records include import/project/version IDs, exact SHA-256 and length, a private prefix, owner token, publication and cleanup state. Archive objects use the existing private model bucket at `archives/<project UUID>/<import UUID>/package.zip`. Viewer resources retain their existing version prefixes. Each archive preserves its own package UUID and manifest; two archives with the same model fingerprint may have different bytes.

Both a new version and a duplicate import remain unfinished until the original uploaded ZIP is stored and fully read back by SHA-256 and byte length. The archive and successful import are published in the same database transaction. Duplicate publication rechecks current project editing access and the existing ready version; it does not rewrite its label, provenance, resources, health or active selection.

Startup/periodic recovery retains published archives, reconciles lost commit replies, and removes only proven unpublished archive objects/multipart uploads under their independently owned prefix. Ownership is retained after project deletion so an unpublished orphan can still be cleaned safely. Published orphan retention follows the existing explicit operational retention policy.

## Download contract

```http
GET /api/projects/:projectId/model-versions/:versionId/package
Authorization: Bearer <current WFC login>
```

HEAD is supported. Export permission follows existing file export rules: administrator or Engineer; assigned Technician may also download. Basic accounts cannot export packages. The current account role, project access and token are rechecked after verification before any ZIP bytes are sent.

WFC reads the newest retained archive record for the ready version, verifies all bytes into a private pinned temporary handle, then streams that same handle with `Content-Type: application/zip`, attachment filename, exact `Content-Length`, `X-Package-SHA256`, `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. No object-storage key, secret or login token is placed in a public URL. Disconnects cancel verification and close the handle.

Older versions whose original ZIP was discarded remain ready and usable. Download returns `404 PACKAGE_NOT_FOUND` until a new compatible import retains an archive. A verified content duplicate can supply the missing ZIP even when it carries a different package UUID. Missing/corrupt storage returns a safe package error and does not change viewer resource health or active selection.

The WFC project Details section exposes **Download SVF ZIP** for the active model to users with editing access. It uses the current login, cancels on login/model changes, and shows a clear missing-archive message for legacy versions. The browser receives the ZIP as a bounded Blob before saving; large archives require corresponding browser memory. Preparer can use the same authenticated HTTP contract and stream its response.

## Backup and validation scope

The existing cold backup captures every public database table and the entire MinIO data tree, so it includes the archive table and objects. The historical `audit-models` report checks viewer resources; ZIP byte integrity is verified on retention and each download. No production migration, deployment or cloud operation was run for this change.

Focused tests cover new and legacy duplicate imports, failed archive readback, lost publication replies, orphan archive cleanup, private storage integrity/pinned reads, authenticated GET/HEAD, revoked access while spooling, frontend cancellation and safe legacy feedback. See `server/modelRegistry/importService.test.ts`, `server/modelRegistry/storage.test.ts`, `server/routes/modelPackageDownload.test.ts`, `src/api/projectModels.test.ts` and `src/pages/ProjectDetails/ProjectModelSection.test.tsx`.

`server/modelRegistry/packageArchives.integration.test.ts` adds five tests against an isolated PostgreSQL 18 container: additive schema installation over existing ready data and repeated initialization, real repository publication for new/legacy duplicate archives, role/assignment revocation rollback, and ownership immutability triggers. It is skipped unless `WFC_TEST_DATABASE_URL` explicitly names the loopback `codex_test` / `codex_wfc_package_test` disposable fixture. This suite does not read application `DATABASE_URL`, use production volumes/networks, or claim a MinIO byte integration. The temporary database container and its dedicated network are removed after verification.
