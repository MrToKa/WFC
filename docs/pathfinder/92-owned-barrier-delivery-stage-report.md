# PF-B9 — owned delivery and conservation qualification

Branch `pf-b9-barrier-delivery-local-20261021`; current source product
`3d86cb2b34baa0dbc7ada8fc93f7979eb4aa34ed`, inheriting B8b product985afcd9 and
documentation `b4c1f56b49a09e3a2be79ba14d3d50c851bc98af`.
Root performs all actual tests, SQL, Docker, builds and HTTP checks. Independent
agents reviewed source and retained proof files without executing runtime work.

## Current delivery result

Fresh operation `1335da29-4a1d-4e2f-9084-8feae288d992` has **PASS** receipts for
all nine phases: init, backup, restore-quarantine, candidate-build,
target-migration, target-runtime, update-source, source-runtime and retire-target.
Source qualification passed at2026-10-21T22:30:57.643Z; the operator resumed the
exact new source images and passed health/conservation checks. Only the exact
fresh target was retired at22:34:59.327Z, with containers, volumes and networks
positively absent. Source5191 is preserved and running the qualified candidate.
Local operational delivery does not close civil geometry or browser acceptance.

The source is port5191, owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, compose
project `wfc-pathfinder-local-0cba87606e9b`, runtime
`.scratch/batched-capture-runtime-20261018-1600`. Its active candidate is:

- API `sha256:ac0d16ab1b0f4c92922c20d1a13a5ea142d4c6e92558de1870daf4db7fd60fcf`.
- Web `sha256:aeca927bc32b4588bbf00c3d67a8519271548c2c189608dc661304a8003385b8`.
- Engine identity `cb8e6a08e33869203b84ead898b3f0b47985082be4c178235a598e0c4102a6c8`.
- Runner `2ba050c323db52636ae6650942ce69ba3226aaba708cbce7d88c69cee838e24c`.

The retired target was owner `701a1cec-bbc4-44bd-8688-fab39c5f0d66`, compose
project `wfc-pathfinder-local-2f9974cf3486`, operation child `restore-5192`, port5192.
The same candidate image IDs were used for pristine schema, target qualification
and source installation. Independent metadata review found all40 prerequisite
file pins,23 frozen source-closure pins and19 additional source-delivery pins
exact. Installed source state/env match the installation receipt. Relative to the
original private pair, only state images/envSha256 and environment
PF_API_IMAGE/PF_WEB_IMAGE changed; credentials and other configuration are retained.

Final public health/assets qualification at22:35:42.451Z passed three HTTP200
checks: /health, / and /assets/index-FplEqPki.js. Exact ID-only linux/amd64 offline
image archives were verified and retained: API185748480bytes,
SHA60c17802a18ff5bc21225ca6bb7e7df1f36a46a8ecabbf8ec6f1c4d8e392972d;
web55346688bytes, SHA5b80bd656c227968eca7be1daf7adcd599175ad048acd1e36905d95de0e56a60.
Archive proof identifies the exact images without a tag-reuse inference.

### Backup, restore and migration

Fresh backup `9ed58095-55a6-4336-acb2-fd6ecae850ef` includes134tables,80850rows
and278070855raw SQL bytes. It retains database dump, MinIO/models, staging,
Path Finder artifacts, four exact images, configuration and separate private
companion. Model audit:5versions,1541resources,1930801055bytes; model selection and
immutable ready metadata unchanged. PF artifact inventory:736625033bytes. Dump
TOC verification, complete marker and the pinned companion passed.

Fresh restore was exact before approved fencing; only declared restore fences
differed afterward. Full schema-only migration preserved134legacy tables,
80850rows, keys, sequences and unmanaged schema. The canonical seven new tables
are the four barrier tables and three Auto length tables; all remained empty and
the new admission ordinal was uncalled. Comparison uses the same candidate's
fresh pristine schema. A second initializer pass was exact and idempotent.

Target runtime qualification covered141tables in18.151seconds, allowing exactly
five engine-observer events in five projects. All other rows, keys, DDL, globals
and sequences were retained. Its API/web were then stopped.

### Normal HTTP and exact fixture delta

The current target's normal HTTP qualification is **PASS_WITH_LIMITATIONS**,
29requests. Fresh admin and basic identities, assigned ordinary model access,
PF403 for basic access, immediate assignment revocation with the same bearer and
cookie, exact protected997B resource SHA, and explicit viewer close followed by
410SESSION_REVOKED passed. A retained unexpired bearer, privately verified under
the unchanged source key, was rejected401 by restored5192. Old expired-cookie
replay is **NOT_RUN**; expiry is not fencing proof.

The exact post-auth comparator passed141tables:138whole tables unchanged; every
existing row/key unchanged in the other three; all DDL/globals/sequences exact.
Only one owned basic user, two login bindings and two closed viewer sessions were
added. Project access returned to its prior state. Password, cookie/JWT identity
and source-derived time attribution were checked privately. Source HTTP/auth
writes were zero; no new calculation, Review, Apply or producer activation ran.
These fixtures remained on the owned target only and were removed with it.

### Source installation and qualification

Before installation, a fresh cold source capture passed exact no-drift comparison
against the backup, including raw SQL/globals and artifacts. Protected-runtime
quiescence found zero enabled current grants and zero runnable jobs, imports,
dispatches, active recalculation or leases. Eight expired human preparation rows
(planned4/collecting4, past the production30-minute deadline, no active validation)
were retained as passive records.

Update-source passed at2026-10-21T22:28:09.810Z. Its bounded18.259second startup
window was followed by a cold capture. A second cold capture was exact before
source qualification. The source-runtime receipt binds backup9ed58095, the same
pristine schema, candidate images and engine identity. It verifies134legacy
tables becoming141 under the reviewed migration, with only five engine events
in five projects and no other legacy-row/key or sequence changes. Artifact audit
remained exact. The pinned qualification file SHA is
`e05889e96ecc5a2907481a39e0b25b1cc32c237664b460c2ad244a2589360318`.
Only after this PASS did the operator resume source API/web and confirm health.

## Implemented controls and actual regression checks

Root's final combined controls: **138PASS**,0fail/cancel/skip. These overlap the
earlier99-case controls and168foundation checks; the counts are not additive.
Coverage includes immutable parent/child attempts and sticky uncertain outcomes,
generated helper syntax, lossless bigint keys, canonical DDL/sequence/view/security
comparison, closed backup/runtime policy modes, exact image installation and the
network observation correction. Independent C source review found no blocker.

Candidate builds occur only on fresh fenced5192. Before source mutation, the
operator revalidates target qualifications and checks fresh cold source drift.
Installation verifies source/candidate state and env CAS pins, stopped source
API/web, candidate labels and final settings. Individual files are fsynced before
rename; the pair is **not atomic or directory-fsynced**. Partial/unknown outcomes
remain sticky and cannot be retried automatically.

Network identity comparison excludes only the two validated nonnegative bounded
integer usage counters per exactly configured subnet: IPsInUse and
DynamicIPsAvailable. Exact subnet binding and all other network identity,
configuration, ownership and security fields remain. Unknown status shapes fail;
raw usage observations are retained separately. Record sorting is canonical.

Actual PostgreSQL18 catalog diagnostic5 passed442relations,59routines,2sequences,
1extension,1view and0unsupported objects. The existing standard_material_catalog
view is preserved with ordered columns, definition, owner and object ACLs. Role
memberships/attributes are not claimed.

## Preserved earlier operations and failures

- Initial operator48PASS/4FAIL concerned the mounted module seed and Windows
  short temp-path fixture. Migration36/2 then38/2FAIL exposed canonical-path and
  synthetic key-array fixtures; production guards were preserved. Catalog
  attempts1–4 retained import/helper, SQL42725 cast and existing-view failures;
  attempt5 passed. No failed receipt was relabelled PASS.
- Operation55c9f2e7-c53d-4ef1-ad92-26f14ed2aa3e reached target migration after a
  134table/80846row backup. One valid persistent calculation grant prevented
  runtime qualification. Grants have no expiry; login age or producer settings
  cannot neutralize them. Closed cold-backup mode could retain it without granting
  source-update authority. The user later disabled that setting in the old
  synthetic PF-R3-UI project. Agents did not alter grants/schedules. Because the
  backup preceded that user change, a new operation was required. Only its owned
  target was retired; backup and proof remain.
- Operationcabe7f1a-568b-43a7-b034-ffcca45b5e39 passed its six prerequisites and
  limited29-request HTTP/auth-delta checks, using historical API29794005/webd9500038
  on target ownerf9bed82e/project4f107ee7. Its update-source phase failed
  B9_DATA_RESOURCES_CHANGED at2026-10-21T21:44:10Z, before an image-install BEGIN.
  Old source images resumed; the failed operation is sticky. A later explicit
  cold diagnostic proved only Docker allocation counter changes: front4→3 and
  65532→65533, backend7→5 and65529→65531. Identity/configuration/data resources
  were retained. No sorting cause was inferred. The narrow reviewed fix was
  committed before fresh operation1335da29. Only the exact old target was retired
  after exact owned-auth delta proof. Its archives, companion and failed evidence
  remain; none became prerequisites for the new operation.

## Installed engine closure and actual planning replay

The current candidate's complete16-file installed engine closure is exactly equal
to the separately qualified first candidate API6d087cc0e3e894d840d93584e44c72ecfef3e6d3678ffce361ad2a5066039767
(historical web82a69eff). Closure SHA:
`0294e63ea309917eeda81faaac79b54bfb0ce47b602f31517ceb65e1fc1f57c7`.
Every file name/size/SHA and engine identity matched, rather than inferring binary
equivalence from a branch or source commit. The runner is209920bytes. Its DLL
differs from B8b's original checked artifact, so root qualified the first image's
own DLLs and compiled adapters without old assembly/dist overlays.

Owned replay7eee550c-75b9-4625-b174-ca367b500b04 passed all five actual planning
modes: cold16.931s, disk13.591s, sessiondisk13.634s, warm1.233s/0.940s. Full DTOs
equal B8b final7, normalizing only requestId and prepared.loadedFromDisk. Exact
snapshot/request/driver and source scope/endpoint/cable bookends were retained.
The512MiB sampled guard remained; maxima were441749504bytes one-shot,
451059712session and80891904Node,100ms sampling,0unavailable; no exact-peak claim.
Exit0/noOOM/timeout. The network-none/read-only/init fixture was retired, with
private inputs/cache/receipts retained. This proves single-cable legacy planning
equivalence; it does not qualify civil geometry, Auto publication or Apply.

## Remaining acceptance and boundaries

Source5191 is preserved even though it is itself an older restore. Only fresh
operation-owned5192 was retired. No original5180/5190 update, real cable Apply,
model import or denied cleanup was performed in B9. Simplified Preparer for main
5180 remains queued after permitted Path Finder work, with its own backup and
qualification requirements.

Actual civil capture/openings remains **BLOCKED**. The user-selected groups are
`3D-Modell_BIS_20260304.rvm` and `DB2401_DESIGN_01-PIPE+GRID_20260304.rvm`.
Their complete descendant triangles/topology/openings/capacity require legitimate
protected capture. No bounding-box solid, explicit-empty or synthetic substitute
qualifies them. Actual SDK/browser and final real Aalborg engineering acceptance
remain **BLOCKED/NOT_RUN**; no saved origin-refusal retry or alternate-origin,
native or CDP bypass was attempted. Operational delivery and planning replay do
not close these acceptance gates.

Read-only remote refresh around2026-10-21T22:35Z recorded live main96e63f13;
local166left/3right against available originmain. The B9 PR connector returned[];
no remote mutation or CI/review approval is inferred.
