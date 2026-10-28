# Cost evidence and Stage 2 provider boundary

This document records the Stage 2 simulation contract. Stage 3 adds distinct
real APS capabilities and an authenticated, expiring operator proof; see
[live-cost-source.md](live-cost-source.md). The closed default and simulation
grant isolation described here remain applicable.

At completion of Stage 2, the implementation was an offline simulation. Its
real cost provider returned no evidence, and every real provider method failed
with `CLOUD_CLOSED`. Stage 2 adapters did not import an Autodesk SDK, read
credentials or `.env`, resolve signed URLs or perform network requests.
No Autodesk plan/quota API was invented. Live account
verification was `NOT_RUN` in that stage.

## Exact binding and decision

`evaluateCostEvidence({evidence,context,operation,now,consumed,verified})` returns
`{allowed,code,reason,evidenceId?}`. Operations are `storage`, `upload`, and
`submit`. The authoritative durable store supplies the prior consumed count for
that evidence/operation; the pure gate neither reserves quota nor performs IO.
The caller must reserve usage durably under its cost-evidence lock before the
mutation. Unknown mutation outcomes retain their reservation conservatively.

Evidence schema 1 contains exactly:

```text
schemaVersion, evidenceId, kind, issuer, identity, checkedAt, expiresAt, status,
price {amount,currency,basis}, origin {kind,reference},
allowances {storage,upload,submit} each {count,quotaRemaining}, uploadBytes,
attestation
```

`identity` hashes the canonical source name/bytes/SHA-256, account/application,
region, storage/object destination, conversion settings, support profile,
submission identity and remote-target identity. Local job ID, label, output,
snapshot path and capture timestamp are excluded. Renaming a job cannot erase
the independent remote submission ledger. Object/URN responses are separately
validated by the core against its planned remote identity.

Only verified price zero with a declared currency/basis, sufficient count and
upload-byte allowance, and `checkedAt <= now < expiresAt` is allowed. Missing,
unknown, expired, nonzero, exhausted, mismatched or unverifiable evidence is
denied. Future timestamps, invalid dates, unknown fields and tampered grants
also fail closed. Reasons are controlled messages; foreign errors and
credential-shaped identifiers are not copied into decisions/call summaries.

Check again before each storage creation, upload and conversion submission.
Expiry during upload does not undo the uploaded object. Conversion remains
blocked until an explicit new approval; it must not reupload or erase the
write-ahead submission history.

## Fake issuance and persistence

`issueFakeCostEvidence(context,{clock,allowedOperations,counts,quota,ttlMs,...})`
issues a **fake** grant. Its attestation is a domain-separated SHA-256 of the
canonical serialized evidence. This public digest detects accidental fixture
changes and survives JSON persistence; it is not a signature, authentication,
real zero-price proof or authorization for Autodesk.

`createFakeCostProvider` caches the first approval per identity. Calling
`getEvidence` again never silently refreshes an expired grant. Explicit
`issue(context,overrides)` or `setEvidence(value)` controls test approval changes.
`verifyEvidence` checks the exact fake issuer, origin, binding and attestation.

The core accepts factory-branded fake providers/transports, rather than an
object labelled `mode:fake`. A fake grant cannot activate the closed real
adapter. Injected test handlers are ordinary trusted test code; factory brands
are a configuration boundary, not a sandbox for arbitrary callbacks.

## Fake provider and raw transport

`createFakeProvider` exposes the normalized methods agreed with the core:
`getStorage`, `createStorage`, `getObject`, `upload`, `submit`, `getManifest`,
`getDownloadPlan`, and `readResource`. Construction, local getters and fixture
controls perform no provider calls. `calls` contains sanitized summaries and
`counts` summarizes explicit calls. `setObject`, `setManifest`, and
`setDownloadPlan` are local fixture controls.

Submission requires `retries:0`, `xAdsForce:false`, and format `svf`. The old
Viewer's `svf2` request is not inherited into the supported SVF package profile.
Default submission returns a bound fake job identity. With fixture resources it
immediately presents a successful simulated derivative; otherwise it stays
pending. This convenience behavior does not model actual Autodesk timing.

`handlers[method](context,options,{default,provider})` can call the default action
and then simulate a lost response, or advance an injected clock, to test
acceptance/reconciliation and expiry. Core ledger durability and no-resubmit
rules remain independent of these transient fake observations.

`createFakeTransport` accepts explicit Buffer/Uint8Array fixtures or bounded
metadata with a body factory. It emits raw chunks without transparent gzip
decoding. The download plan includes region, selected root, submission/object
identity, support profile, and resource path/ID/byte count/optional SHA-256.
Unknown roots/resources are rejected. Signed URLs and credentials are not part
of the plan or checkpoint contracts. Abort stops local waits/streams and never
asserts cancellation of a remotely accepted job.

## Production prerequisite established in Stage 2

Before any later live adapter can be implemented or enabled, define a supported,
current, independently verifiable proof for the exact account/application,
destination, source/settings identity, operations, zero charge and available
allowance. Document its provenance and expiry and require explicit live
authorization. An old free-tier statement, environment flag, stored fake grant,
or available credentials cannot satisfy that prerequisite. Stage 2 contains no
activation switch or fallback for real cloud execution.

Stage 3 implements this prerequisite through the separate APS factory pair,
current account review and pinned source artifacts. Its real acceptance and
existing-artifact reuse scope are recorded in the Stage 3 report.
