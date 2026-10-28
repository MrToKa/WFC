# Graph preparation reuse and interactive execution

Date: 2026-10-25. Status: implementation, isolated qualification, owned 5191
delivery and qualified cleanup complete.

Subsequent delivery: the [saved exact-route display fix](136-saved-exact-route-display.md)
is now installed on 5191. Its API/web images supersede the G2 pair recorded below;
the six native modules, 48 protected compiled files and both engine identities
remain exactly equal. The old G2 backup payloads and 6.53 GB of old raw audit
payloads were retired after verified G3 delivery. G2 metadata/PASS attestations
remain; full old G2 raw replay has intentionally ended. The complete current G3
audit and latest verified recovery backup are retained.

## Accepted boundary

The user authorized automatic execution of the staged plan, including bounded
cleanup after each stage. Existing project data, original routing semantics,
barriers/openings, grouped endpoint reuse, automatic/manual cable ownership and
capacity policy are preserved. No Rust rewrite or database graph table is added.
The upstream source revision remains 45c24bf5f433f13e102600b36f20327c77961d0a;
the derived source contract is explicitly recorded in source-provenance.json.
Exact original RouteCalculator and TrayMeshClearance files are retained under
reference/original-routing, with their original SHA256 identities.

## Implemented layers

- Core: a bounded request-scoped contact-preparation cache stores ordered
  candidate recipes and conclusive surface observations. Exact geometry,
  clipped triangles, ports, tolerance, eligible geometry and relative surface
  creation order bind admission. Endpoint stations, parallel attachments,
  adjacency, search state, dynamic load/capacity and opening edits remain local.
- Import: checksummed, versioned and byte/count bounded. Restored contact and
  surface claims are independently checked against current geometry before use;
  current restrictive caller limits select the original early-refusal path.
- Runner: one 16 MiB/four-entry cache owner per session, discarded on source/model
  change. Durable identity also binds actual Core DLL SHA256 and format version.
- Storage: one atomic envelope per identity in PF_ROOT/cache/graph-v1, maximum
  16 MiB payload, four entries and 64 MiB total stable files, including envelope
  bytes. Nonblocking publisher lock, regular-path checks, corruption fallback,
  cancellation and format-owned eviction are explicit. A temporary publication
  can coexist with its replaced entry until atomic rename.
- Opt-in: PF_ENGINE_GRAPH_CACHE=1 enables the new cache; absence or 0 runs the
  original construction. Optional diagnostics use a fixed bounded file sink,
  not a business response field or reusable engineering proof.
- Runtime configuration records execution mode, cache selection and the bounded
  session profile across image installation and rollback. Interactive profile
  retains idle sessions for five minutes; default bounded profile remains 30 s.
  Both retain 64 requests, ten-minute total lifetime and the same memory guards.
  Ready-handshake idle values must match before dispatch; legacy missing values
  are accepted only for the original 30-second profile.
- Scheduling: waiting current popup origins receive priority within the selected
  fair project's next safe quantum. An active native call is not interrupted.
  Popup readiness already follows its own result rather than sibling completion.

## Evidence and performance interpretation

Before changes, installed 5191 used one-shot execution. The same current frozen
Aalborg model and 31 published parents were measured independently from any live
business writes. Existing immutable installed binaries were retained as oracle.

On private Linux storage the old one-shot engine needed about 7.8–8.5 s for
subsequent changed endpoints. The old existing session mode needed roughly
0.12–0.52 s warm. Thus most of the expected production improvement comes from
retaining the already prepared model and physical mesh caches, not from choosing
a different shortest-path algorithm. Cold model preparation remains separate.

Windows host-bind measurements of the 114 MB source were materially slower
than Linux-volume measurements and are not mixed into the production comparison.
Unbuffered graph preparation regressed the real warm case slightly and added
about one second of initial fingerprint work. 64 KiB hashing buffers preserve
byte-identical fingerprints/artifacts and reduced first fingerprinting to about
116 ms. Nevertheless final buffered warm timings did not establish an additional
Aalborg benefit: cache OFF 0.122–0.420 s, ON 0.127–0.525 s. The selected 5191
configuration is session + interactive profile + graph cache OFF. The new contact
cache remains opt-in for workloads where its measured benefit is established.
No full immutable-adjacency or additional collision-cache refactor is justified
by a remaining warm graph build of approximately 5–10 ms.

The actual native ready handshake reported 300000 ms idle retention. Following
a real 31000 ms idle gap, changed-endpoint calculation reused the same prepared
model and completed in about 0.420 s. Cold model loading still took about ten
seconds; these native timings do not include API settlement or live popup work.

Thirty isolated warm reads of the representative 178833-byte artifact found
file+SHA median 0.362 ms/p95 0.513 ms, PostgreSQL bytea+SHA 1.288/2.034 ms. These
exclude native semantic decoding and application latency. No database storage
advantage was established, so storage stays in a bounded derived-file cache.

## Verification recorded so far

| Check | Result and scope |
|---|---|
| Original routing regression | 105 PASS |
| Frozen comparison | 43 golden cases, 215 checks PASS |
| Graph reuse | 42 Release checks PASS; full result/binary64 parity, limits, invalid imports, ordering and cancellation |
| Hash buffering | Plain and physical-surface fingerprints, payload SHA and route SHA identical before/after |
| Runner session/store | 467 PASS including idle-profile mapping and handshake refusal |
| Byte quota | 30 dedicated checks PASS, including full 16 MiB payloads and 64 MiB total with header overhead |
| Capacity | 16 PASS |
| Original inter-tray openings | 33 PASS |
| Mixed runner transport | 46 PASS with final handshake |
| Popup components | 274 PASS across Results, Workspace and SaveDisplayFlow; synthetic transport |
| Scheduling | 52 focused checks and 18 isolated actual PostgreSQL cases PASS |
| Real-model final buffered matrix | All tested routes/design match immutable baseline; same binary hashes before/after; cold and warm measured separately |
| Interactive retention | Actual 31-second gap PASS, same prepared model retained |
| Packaged candidate API image | Six full mathematical result bodies identical to the immutable old-session baseline; /BC175 retained; first call 10.10 s, subsequent calls 464/171/334/299/125 ms |
| Installed paired delivery | All nine phases PASS; three full inventory/conservation windows independently requalified; 16 served static files identical to the candidate image |
| Project conservation | PASS: original and clean Aalborg copy each retain 2140 cables and 31 barrier parents; all compared project/model/prepared/barrier metadata unchanged |
| Live browser Save-to-Show | NOT_RUN: browser origin authority gate rejected 127.0.0.1:5191 |

The user-provided Box55 route includes /BC175. Final model checks must use real
wall/floor opening geometry, not the hidden penetration-reference equipment.
The retained fixture uses the user's exact Box55 From point and original To.
Unchanged capacity settings and manual cable values are not overwritten merely
to benchmark. The isolated qualification is not whole-plant engineering acceptance.

## Installed delivery

Operation: `ac242230-e183-4459-abbd-a2fc1c712545`. The final independent verifier
passed at 2026-10-25T13:33:28Z. The root agent then independently observed both
API and web containers running and healthy, web bound to 127.0.0.1:5191, and the
actual API environment set to session / interactive / graph cache 0. PostgreSQL
was healthy and MinIO was running. No live project writes were made for testing.

Immutable installed identities:

| Component | SHA256 |
|---|---|
| API image | `48533681e26e8e7a41468cd28e9f60eee3cfe709946312774b6b6053e8e7580f` |
| Web image | `1ffddd0b4fe366431b71e8f6748e735ed95bf8e5d5417fa42b56aa69c17d006f` |
| Forced engine identity | `1775e210ae86bc59d6550c58ab3be75907168f6a7ef399aade78e049577a3c9a` |
| Packaged Core module | `242bba027da1ba5a11f00bbd29122201da8468fcef751656f83a01c78e1fe020` |
| Packaged Runner | `1b1fbfb1c60c19527f955049fdbf5e6c6e73279feb11d8626e73c1089d9a9263` |

The installed source project retains barrier revision 12 (31 parents); the clean
Aalborg copy retains revision 1 (31 parents). Both retain 2140 cables. The
independent whole-project metadata comparison passed without project writes.

The first backup attempt reached the unchanged 120-second inventory deadline
because each of roughly 102000 rows caused a Windows-bound file write. A bounded
64 KiB batching correction preserves the exact NDJSON bytes, framed hashes,
quotas, cancellation and refusal behavior. Nineteen inventory checks and 105
provider/operator checks passed, with independent review. A fresh operation
using the SHA-pinned qualified module then completed full captures in about
24–27 seconds. The failed operation was not retried or reclassified as success.

Local evidence:

- `D:/Codex-test-output/graph-reuse-20261025/deployment-buffered/final-verification.json`
- `D:/Codex-test-output/graph-reuse-20261025/deployment-buffered/final-project-conservation.json`
- `C:/Users/todor.chankov/source/WFC-pathfinder-local/pathfinder-engine/.scratch/barrier-delivery-ac242230-e183-4459-abbd-a2fc1c712545`

## Cleanup

Stage helpers, PostgreSQL instances and anonymous Linux storage were removed.
Hash-verified deduplication inside the owned baseline reclaimed 684668346 bytes
(about 653 MiB). Recursive deletion of several small completed Windows test
folders was rejected by automatic review, even after path/link checks; those
folders and their inventories are retained. No policy workaround is used.

The owned restored 5192 target and all delivery helpers were retired after
verification. The latest complete backup (4109065202 bytes, approximately
3.83 GiB), original rollback configuration, old API/web image pins, original
native binaries and small receipts are retained for recovery.

Three older complete same-owner backups are eligible for payload retirement.
The separate strict schema-v2 guard passed 76 checks and independent review;
24 mount/ancestor normalization checks passed. It permits only the eight exact
payload files per approved older backup, with fresh canonical path, regular-file,
single-link, byte-count and SHA checks. It preserves every qualified inspector,
manifest, receipt, the latest backup and all Docker image pins. No recursive
deletion, audit hardlink deduplication or broad Docker prune is used.

Execution passed: exactly 24 older payload files were removed, totalling
10445416347 bytes (10.45 GB / 9.73 GiB). The root agent independently confirmed
all 24 paths absent and the byte sum equal to the receipt. Post-cleanup source
health and verification of the retained complete backup passed. The observed
free space on C: was 89925709824 bytes (89.93 GB / 83.75 GiB); this is an actual
drive reading, not a claim that Docker's virtual disk shrank by that amount.
The earlier 684668346-byte fixture deduplication was on D:, separately.

The first failed operation's diagnostic captures remain (1273610637 bytes): the
qualified complete-backup retirement guard does not authorize retiring failed
captures. Small
Windows test folders whose recursive deletion was rejected by automatic review
also remain, with their inventories. No alternate deletion method was attempted
against those rejected targets.

Cleanup evidence:

- `D:/Codex-test-output/graph-reuse-20261025/cleanup-v2/guard-tests-receipt.json`
- `D:/Codex-test-output/graph-reuse-20261025/cleanup-v2-execution.json`
- `D:/Codex-test-output/graph-reuse-20261025/cleanup-v2-parent-observation.json`
