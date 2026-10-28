# Copied-project recovery — local execution record

Status: scoped technical delivery PASS, including backup, restore, resource
access, browser recovery, verified target retirement, final source demonstration
and wider preservation. This is an operational delivery; engineering and user
acceptance remain pending.

The isolated working copy is `C:/Users/todor.chankov/source/WFC-pathfinder-local`,
branch `pf-8-copied-project-recovery-local-20261018`. It inherits technical
delivery `3fbdc9d41a82a06d9d91af20c028bdbb7584ac62`; assignment commit is
`94f83c11747e3ff6d3efb7b8064ef115b364c5df`. The assignment is
[PF-8-copied-project-recovery.md](handoffs/PF-8-copied-project-recovery.md).

## Scope and identities

The retained source demonstration is `http://127.0.0.1:5191`, runtime
`pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`, Docker project
`wfc-pathfinder-local-0cba87606e9b`, owner
`8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`. Its copied engineering project remains
`1af0f807-7653-40ea-8391-7eea6c54e7d4`, active model
`a613151e-c370-45c5-80f3-42ae58603b9a`.

The temporary recovery target used port 5192, Docker project
`wfc-pathfinder-local-63ab3043713e`, owner
`7a64aa2a-88c3-43b9-962d-af391b72300d`, runtime
`pathfinder-engine/.scratch/copied-recovery-target-982a9013-34cb-4e3f-9e7c-c01325f5c0f8`.
It received fresh containers, networks, volumes and authentication keys. It has
now been retired. The source and target used the same pinned application,
PostgreSQL and MinIO image IDs; this stage rebuilt no product image.

The new tools and their controls are confined to
`scripts/pathfinder-copied-recovery/`. No product code, routing algorithm,
calculation formula, database schema or model seed/import was changed. Runtime
operations were performed by the parent after focused controls and independent
source review; delegated writers and the reviewer performed no live SQL, HTTP,
Docker or browser operation.

## Controls and source review

All 174 final focused controls PASS: 45 authentication, 48 audit, 55 provenance,
18 binding and 8 real CLI refusal controls. Relevant syntax checks PASS. The
receipts preserve the tested source hashes and the controls' limited scope:

| Evidence | Result and scope |
| --- | --- |
| [Authentication controls](evidence/copied-recovery/auth-source-controls-1792345713726.json) | 45/45 and three syntax checks; bounded normal API contract and timing controls. |
| [Audit controls](evidence/copied-recovery/audit-source-controls-20261018T175710Z.json) | 48/48 and three syntax checks; synthetic lossless comparisons and a real short-lived host child watchdog. |
| [Provenance and binding controls](evidence/copied-recovery/provenance-source-controls-20261018T180131Z.json) | 55 + 18 controls and provenance-test syntax; synthetic secret-pattern, chain and isolation guards. |
| [CLI refusal controls](evidence/copied-recovery/drill-source-controls-1792346747884.json) | 8/8 and test syntax; actual CLI with new local file fixtures, zero Docker/core dispatches. |
| [Initial independent review](evidence/copied-recovery/source-review-1792346678612.json) and [additive closure](evidence/copied-recovery/source-review-drill-delta-1792346885191.json) | All 16 final tool/test/readme files closed with no remaining material source findings. The reviewer ran no tests or runtime operations. |

The first CLI control run was 0/8 because its test sentinel also blocked the
permitted local ACL command. Only the sentinel allowlist was corrected; the
failed TAP is retained as `TEST_HARNESS_FAILURE`, separately from the final 8/8.
An earlier six-byte null review draft is retained and classified
`INVALID_REVIEW_DRAFT`; it is not a valid review or product result. Neither
history is silently replaced by a successful result.

## Backup and private provenance

Actual drill ID is `e09d28fa-580f-484a-a7f7-ac8b8a00cee7`. The source was bound
explicitly to 5191; the old default drill targeting 5190 was not used. Source
Viewer frames were closed before the baseline to avoid background session
renewal. No queued or running Path Finder job/model import was present at the
audit boundaries.

The [backup](evidence/copied-recovery/drill-1792346855507-3c0a7ebd.json) PASS ran
from 18:06:07 to 18:07:35 UTC on 18 October 2026. Backup ID is
`b77a1ed0-2fa2-48a3-92f8-207a60b2035e`. Exactly eight payload members total
1,793,208,640 bytes: the PostgreSQL dump, three volume archives and four pinned
image exports. The 26,217-byte manifest has SHA-256
`89b2c63ff10b97e36fab42bed3195d50f9f2d99522d3ee529a98b16fb39f335a`.
Only the owned source web/API/MinIO were cold-stopped as required; source
availability resumed and the recorded source container/image identities were
retained. Their start times may change through this authorized cold backup.

The archive and separate secret runtime companion are retained under
`pathfinder-engine/.scratch/copied-recovery-c8f5c134-d041-45b9-ab20-214ff70d30dc/`.
They remain private and ignored by Git. The companion must accompany a recovery;
credentials are not reproduced in this report.

A separately sealed [host provenance adjunct](evidence/copied-recovery/provenance-1792346857604-8b71ed26.json)
PASS contains 75 allowlisted files, 4,148,668 bytes, including the exact retained
source snapshot, seed plan, source/seed/import receipts, import intent and its
67-event raw-byte chain, plus capture provenance. It is bound to the backup ID
and core manifest SHA. The event chain is 2,414,498 bytes, final SHA
`709f5179b5a76908067300cf5b9c97b07b92bae63cc314a43bf13515f5df818c`;
adjunct manifest SHA is
`19608da12ec0ba9f429ee8a01f78b214a5b252c13a76d1ae97da9306fb618a49`.
Copy readback, original pinned chain and enumerated secret guards PASS.
Authentication material is excluded. This is a fixed allowlist/pattern check,
not a general proof that arbitrary files contain no secrets. The core archive
remains exactly eight members; host provenance is not claimed to be inside it.

## Lossless data and authentication checks

All 27 business/model/Path Finder table projections use PostgreSQL JSONB text
without decoding business numbers into JavaScript numbers. Separate precision
controls distinguish numeric and bigint values that ordinary number decoding
would merge. The two authentication tables and three storage buckets are
reported independently. The storage comparison covers keys, size, ETag,
last-modified and user metadata; it is not raw resource SHA or an atomic
PostgreSQL/MinIO snapshot.

| Phase | Actual result |
| --- | --- |
| [Source before backup](evidence/copied-recovery/audit-1792346766950-f2483ab0.json) → [source after backup](evidence/copied-recovery/audit-1792346860612-83d64f1f.json) | PASS exact equality across 27 tables, both authentication tables and all three bucket inventories. No added, missing or changed row/object metadata. |
| [Restored target before login](evidence/copied-recovery/audit-1792346958413-d6cf53f8.json) | PASS exact 27 tables and bucket inventories. All 19 login and 33 Viewer session rows retained; only two login and six session rows newly revoked. Already revoked rows remain exact. Allowed fence changes are persistent tombstones, with no hash or expiry rewrite. |
| [Controlled fresh target authentication](evidence/copied-recovery/audit-1792346963056-da0df95d.json) | PASS exact 27 tables and bucket inventories; exactly one new owned login binding and one owned Viewer session, pinned to safe actor/project/model/load/expiry/hash metadata. Every prior auth row unchanged from the fenced baseline. |
| [Target after browser use](evidence/copied-recovery/audit-1792350000182-90246b71.json) | PASS exact 27 tables and bucket inventories. Authentication is explicitly `NOT_CHECKED` in this business-only comparison; the earlier strict fence and controlled-auth proofs remain separate. |
| [Retained source after final browser use](evidence/copied-recovery/audit-1792350219641-c8fd4257.json) | PASS exact 27 tables and all three bucket inventories against the source baseline. Authentication is explicitly `NOT_CHECKED` after browser use. |

Normal [source login/session preparation](evidence/copied-recovery/auth-prepare-1792346762405.json)
PASS produced login 200, `/api/users/me` 200, protected Viewer session 201,
descriptor 200 and an actual 997-byte model resource 200. Its session expired at
18:11:03.372 UTC, absolute expiry 18:36:03.372 UTC. The
[same source credentials and session after backup](evidence/copied-recovery/auth-source-1792346855541.json)
still returned 200 while valid, without extending database expiry.

On the restored target, [authentication checks](evidence/copied-recovery/auth-target-1792346958450.json)
PASS proved old source bearer 401 and exact old cookie/session 410
`SESSION_REVOKED` with the target origin. A fresh normal target login and
`/api/users/me` returned 200, Viewer session creation 201, descriptor 200 and the
same actual model resource 200. Its SHA-256 is
`ee4df15128a2ad51a42603ba7a0bbfb52b1bfbf2cee07139af1fac2545fdac57`.
No forged token, browser cookie extraction or direct Viewer global interface
was used.

## Restore, full resource audit and browser demonstration

The [fresh restore](evidence/copied-recovery/drill-1792346955435-e61815c8.json)
PASS ran from 18:07:52 to 18:09:15 UTC. The recorded target has a new owner,
project and container IDs; JWT rotation, persistent session fencing, artifact
SHA equality and restored inventories PASS.

Both the backup's full source audit and the separate
[restored target resource audit](evidence/copied-recovery/drill-1792346971127-2b381af3.json)
PASS read all raw resources in all three ready model versions: 1,026 resources,
1,317,023,409 bytes, size and SHA-256 verified. Each version has 342 resources
and 439,007,803 bytes. Model selection and immutable ready metadata remain
unchanged. The Path Finder artifact inventory contains 30 files, 9,342,710 bytes,
aggregate SHA `46ee2eab5b16ba8de60b934e66dde33c66ccf52739cf05b52b6c2415598a9bc9`.
This raw-resource and artifact proof is separate from storage metadata equality
and the core decoded inventory.

[Computer-use evidence](evidence/copied-recovery/browser-1792349997235.json)
PASS verified the restored copied project through normal admin login: all three
tools, Routes / Path / Path lookup; 2,140 displayed cables; saved preparation
scope of 1,527 names; 438,155 SDK records returned/checked and zero unavailable.
The active 3D model loaded with geometry 664,556, identifiers 438,156 and six
properties. Reload retained the saved 13-object snapshot, counts and missing
locations. Draft Routes rules were not recovered. Details remain 7 m Secondary,
5 m For end connection, 10% bending and approved 1 m Connection gap.

The 13 objects are only the previously prepared diagnostic `/BC022-2` group
(dbId 425797, LV + Control). These observations do not prove complete-plant
network classification. All 1,527 shared names remain missing; no coordinates,
bindings, calculation, proposal, Review or Apply was created for this copied
project during the drill. Existing synthetic/QA records elsewhere in the same
isolated database were preserved, not reclassified as real engineering proof.

The target browser tab 4 was closed before qualification and retirement. Source
tab 3 was retained at that point. Browser-local numeric IDs were reassigned after
heartbeat reconnection: the final source was selected by its exact 5191 URL and
only the exact retired 5192 page was closed. Screenshots were visually inspected:
[restored Routes](evidence/copied-recovery/restored-routes.png) and
[after reload](evidence/copied-recovery/restored-after-reload.png).

The [final source browser check](evidence/copied-recovery/source-browser-final-1792350249313.json)
PASS confirmed the retained 5191 copied project, active model, all three tools,
2,140/2,140 cables and saved 1,527-name / 438,155-record / zero-unavailable scope.
Its [current screenshot](evidence/copied-recovery/source-final.png) was visually
inspected and the browser page marked as the deliverable. No binding,
calculation, Review or Apply was requested.

## Retirement, preservation and remaining work

[Target qualification](evidence/copied-recovery/drill-1792350000961-14ef8ac2.json)
PASS preceded [target retirement](evidence/copied-recovery/drill-1792350020124-d40ce548.json)
PASS at 19:00:20 UTC. The wrapper rejected the source owner/runtime/project/port
as a retirement candidate and required the recorded new target, backup ID and
all qualifying evidence before removal. Exactly the new target's five
containers, four volumes and two networks were removed; its post-retirement
resource inventories are empty. Source metadata remained healthy. Shared image
layers, useful source demonstration, backup, private companions and evidence
were retained; no general Docker prune was used.

The final source business-only audit PASS retains all 27 table projections and
three bucket inventories exactly; its authentication comparison is explicitly
`NOT_CHECKED` after browser use. Final [wider preservation](evidence/worker-reuse/preservation-1792350218341-5dce53ce.json)
is 12 checks PASS: all 18 baseline container identities, image IDs and start
times remain exact (13 original plus five existing 5190 containers), as do the
12 audited 5190 workflow groups and retained snapshot/input hashes. This is not
an original database-content audit. Original checkouts and their existing local
changes remained read-only; no push, PR, merge or deployment occurred.

The [cleanup receipt](evidence/copied-recovery/cleanup-1792350249317.json) PASS
records only the newly verified 5192 fixture removal. Seven previously denied
scratch children and their parents remain untouched; existence-only checks
confirmed all seven remain. Automatic approval review previously rejected their
deletion as `blocked by policy`; no retry, bypass, parent operation or generic
prune was performed. The retained archive, companion, provenance and referenced
private failure/control evidence are still needed. Physical disk space reclaimed
was not measured.

Engineering and user acceptance remain pending. The user has no Navisworks
licence and chose manual engineering review; no native parity, complete-plant
connectivity or accepted real cable length follows from this operational PASS.
The next human step is to prepare and inspect the intended network groups and
resolve real shared From/To locations, then inspect calculation proposals before
explicit Review + Apply. Keep the engineering acceptance gate and preserve
installation lengths. Merge, publication and deployment require the user's
separate decision. No extra autonomous stage is justified solely by these
unresolved human mappings.
