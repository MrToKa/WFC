# Copied-project recovery: owned API authentication proofs

`auth.mjs` uses only normal HTTP authentication and Viewer session/resource APIs.
It does not query or change PostgreSQL, modify authorization, forge tokens, read
browser cookies, renew sessions, revoke sessions, or retry accepted operations.
The parent operator is the sole runtime executor. Fixture tests perform no HTTP,
Docker or database operations.

Each invocation requires a **new** direct child of `pathfinder-engine/.scratch`
named `copied-recovery-auth-<UUID>`, and a new receipt under
`docs/pathfinder/evidence/copied-recovery/`. Existing files are never overwritten.
The directory has a new owner marker, private-only file permissions (Windows ACL
restricted to the current account), exclusive durable private checkpoints and a
bounded hash-chained journal. A failed preparation is not automatically retried.
Its journal retains accepted session facts for explicit operator investigation.

Commands, with repository-relative paths and fresh UUID placeholders:

```text
node scripts/pathfinder-copied-recovery/auth.mjs prepare-source --work pathfinder-engine/.scratch/copied-recovery-auth-<UUID> --output docs/pathfinder/evidence/copied-recovery/auth-prepare-<stamp>.json
node scripts/pathfinder-copied-recovery/auth.mjs check-source --capsule <prepare-work>/capsule.private.json --capsule-sha256 <SHA> --work pathfinder-engine/.scratch/copied-recovery-auth-<UUID> --output docs/pathfinder/evidence/copied-recovery/auth-source-<stamp>.json
node scripts/pathfinder-copied-recovery/auth.mjs check-target --capsule <prepare-work>/capsule.private.json --capsule-sha256 <SHA> --runtime pathfinder-engine/.scratch/copied-recovery-target-<UUID> --owner <target-owner-UUID> --backup-id <backup-UUID> --work pathfinder-engine/.scratch/copied-recovery-auth-<UUID> --output docs/pathfinder/evidence/copied-recovery/auth-target-<stamp>.json
```

Prepare immediately before backup. The source's actual idle expiry is five
minutes and absolute expiry at most thirty minutes. Descriptor/resource reads do
not renew it. A source expiry is a real failed availability proof; it must not be
relabelled backup revocation. Target persistent fencing requires exactly410
`SESSION_REVOKED` on the original session URL/cookie using the target5192 Origin.
401,403, `SESSION_EXPIRED`, or a different session do not meet that gate. The old
bearer's401 is checked separately while the source login has not expired.

Fresh login uses the bound runtime's privately generated admin credentials.
The normal login response currently grants a seven-day bearer. Its locally
decoded jti/sub/exp are row-provenance observations, not trust or authority;
`/api/users/me` and Viewer-session POST independently authenticate that bearer.
The receipt's `freshTargetSession` contains only safe IDs/times:
`actorId,loginId,sessionId,projectId,modelVersionId,loadId,expiresAt,absoluteExpiresAt`.
The recovery audit may allow exactly those two new auth rows. Bearer/cookie stay
in `login.private.json`, `session.private.json`, and the source
`capsule.private.json`; they must never enter Git or the host-provenance adjunct.

Successful target proof also writes a separate safe `allowed-auth.private.json`,
referenced by `allowedAuth` path/bytes/SHA in the receipt. Schema
`pathfinder.copied-recovery.allowed-auth.v1` contains exactly
`target:{owner,runtime,project,port:5192,backupId}`, actor/login/session/load IDs,
project/model IDs, `loginExpiresAt,sessionExpiresAt,sessionAbsoluteExpiresAt` and
`secretSha256`. The last hashes only the43-character cookie secret, matching the
server's persisted secret hash. The file contains no bearer, cookie or password.
The audit accepts its explicit path/SHA rather than broadly allowing auth rows.

The actual997-byte `resources/output/0/objects_attrs.json.gz` response is verified
against SHA`ee4df15128a2ad51a42603ba7a0bbfb52b1bfbf2cee07139af1fac2545fdac57`.
This exact entry is read from the retained SHA-verified source snapshot's five
property-resource entries, previously matched to the portable model manifest;
the receipt/capsule identifies that source path/hash. Descriptor identity also
pins the copied project/model/fingerprint and342resources/439007803rawbytes.
No redirected, partial, compressed-transfer or wrong-length resource is accepted.

Shared `binding.mjs` checks exact5191source or verified new5192target ownership,
all expected images/networks/volumes/endpoints before and after HTTP. Authorized
source cold-backup starttime changes are observations; container IDs/images must
remain identical. Per-request HTTP deadline15s, whole invocation180s (including
binding), JSON128KiB, resource2KiB, request4KiB, journal64events/4MiB, private
file2MiB. Redirects are refused. SIGINT/SIGTERM abort remaining requests. Every
non-login response's bounded raw bytes are privately journaled before assertion;
login body is omitted from journal, with only status/length/hash retained.
No public receipt contains bearer, cookie, password, login response or user data.

Run fixture controls from the isolated working copy:

```text
node --test --test-concurrency=1 scripts/pathfinder-copied-recovery/auth-lib.test.mjs
node --check scripts/pathfinder-copied-recovery/auth.mjs
node --check scripts/pathfinder-copied-recovery/auth-lib.mjs
node --check scripts/pathfinder-copied-recovery/auth-lib.test.mjs
```

Tests use the retained exact attrs resource as an immutable local fixture and
injected HTTP/binding/journal adapters. They do not claim actual recovery proof.
