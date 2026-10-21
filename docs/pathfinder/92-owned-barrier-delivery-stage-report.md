# PF-B9 — owned delivery and conservation qualification (ACTIVE)

Branch `pf-b9-barrier-delivery-local-20261021`, inherited
`b4c1f56b49a09e3a2be79ba14d3d50c851bc98af` / B8b product985afcd9.
This is an implementation/checkpoint report, not completed delivery or engineering
acceptance. Root performs all actual tests, SQL, Docker, build and HTTP work.

## Implemented controls and actual checks

- New v3 operator has immutable parent/child attempts, sticky uncertain outcomes,
  fresh owned5192 quarantine/pristine migration, exact candidate image reuse,
  bounded runtime windows and late cold source-drift refusal. No v2 acceptance
  gate is disabled. A owns four new operator/test files; B owns the two new
  qualifier/test files; root owns shared image-install/global-SQL foundations.
  C independently reviewed source, without executing tests or runtime actions.
- Root final combined controls3: **99 PASS**, no fail/cancel/skip. This includes
  actual private synthetic file readers and journal tests, generated-body syntax,
  lexical bigint keys, canonical DDL/sequence/view/security comparisons,
  restricted runtime controls and backup/runtime mode separation.
  Earlier foundations168PASS overlap these counts. They are not additive coverage.
- Actual read-only PostgreSQL18 catalog diagnostic5 **PASS**:442relations,
  59routines,2sequences,1extension,1view,0unsupported objects; owned source
  resources unchanged. This proves SQL syntax/projection against the active
  source, not cold backup, migration, runtime conservation or browser behavior.
  `standard_material_catalog` is preserved explicitly with ordered columns,
  definition, owner and object ACLs. Role memberships/attributes are not claimed.
- Image installation is restricted to the exact source5191 and operation-linked
  candidate5192, with both state/env CAS pins, stopped source API/web, actual
  candidate image labels, unchanged credentials/producer/capacity settings and
  final pair/read-settings verification. Each file is fsynced before its rename;
  the two renames are **not an atomic or directory-fsynced pair**. Any partial or
  uncertain outcome requires inspecting the immutable BEGIN; no automatic retry.

Failures retained privately: initial operator48PASS/4FAIL (mounted module seed and
Windows short temp-path fixture); migration36/2 then38/2FAIL (canonical temp path,
then synthetic key fixture not matching PostgreSQL text-cast key arrays). Production
path/precision guards were preserved. Catalog import attempt1 did not execute SQL;
attempt2 returned an invalid helper response; instrumented3 identified SQL42725
(`unknown || char`), fixed with explicit casts;4 identified the existing view;
5 passed with explicit view coverage. No failed receipt is relabelled PASS.

## Fresh operation and live startup gate

Planned fresh operation:
`.scratch/barrier-delivery-55c9f2e7-c53d-4ef1-ad92-26f14ed2aa3e`.
No operation is inferred from the separate diagnostic scratch
`.scratch/barrier-delivery-20261021-9f5058f3-8408-4a36-8592-dd46d90e6742`.

Actual read-only quiescence: no queued/running jobs, imports/orphan imports,
location/initial-fill dispatches, active recalculation or current execution lease.
Eight historical human preparation rows are planned4/collecting4, all past the
production30-minute hard deadline and with no active validation. They are passive
HTTP workflow records, not a startup queue, and remain byte-for-byte retained.

At the superseded55c9f2e7 checkpoint, one **valid enabled persistent calculation grant** remained. Its then-current issuer was
still admin at the matching admin revision; it has no expiry. Producer settings,
old login timestamps or completed generations cannot make it harmless. Original
strict quiescence refusal is retained. The independently reviewed closed
`cold-backup` mode permits retaining this grant only while owned API/web are cold
and the inventory proves no other DB client; it cannot authorize source update
or either runtime-start gate. Actual backup-mode diagnostic2 PASS records
`sourceUpgradeAuthorized:false`. No grant/schedule row was changed or renewed.

Operation55c9f2e7 checkpoint: init, fresh backup, restore-quarantine, candidate
build and target-migration **PASS**. Backup has134tables/80846rows and278067273raw
SQL bytes, all model/staging/PF files and four exact images. Before-fence data and
globals are exact; only the declared restore fences differ afterward. Source5191
resumed and healthpassed. Fresh target owner89567827-65e0-4def-9e26-d4f80fe48e8f,
composewfc-pathfinder-local-833787c05627, port5192. Full schema-only migration and
second idempotent pass preserve every old row/key/sequence; canonical new seven
tables remain empty and the new ordinal uncalled. Runtime/source delivery was
not attempted in this operation.

The user explicitly disabled the persistent setting in old synthetic project
PF-R3-UI-56eadef6-8382-49f8-a652-c8f12026602e. Root read-only protected-runtime
preflight confirms0current enabled grants and0runnable work/leases; the eight
passive rows remain. The agent did not change grant/schedule rows. This change
occurred **after** the first backup. Operation55c9f2e7 is therefore superseded,
not failed/retried or relabelled completed. Its backup/evidence remain. Root
separately retired only its verified new5192 fixture, positively checked resource
absence and source health/conservation. No controller prerequisite was forged.

Continue with fresh operationcabe7f1a-568b-43a7-b034-ffcca45b5e39 under the SAME
source controls, from a fresh backup that includes the user's setting. Its init,
backup, restore-quarantine, candidate-build, target-migration and target-runtime
are now **PASS**. Backup134tables/80850rows/278070855rawSQLbytes. Fresh target
ownerf9bed82e-b294-41c8-a450-4067466c27e8, composewfc-pathfinder-local-4f107ee7fae2,
port5192. Migration preserves134oldtables/80850rows/keys/sequences; canonical
seven new tables empty, ordinal uncalled and second initializer exact. Runtime
comparison covers141tables and permits only5engine-observer events in5projects;
no other row changes. TargetAPI/web are stopped after its bounded qualification.
Final source migration/runtime and normal HTTP qualification remain NOT_RUN.

### Subsequent normal HTTP checks and source-delivery refusal

Normal5192 operational qualification **PASS_WITH_LIMITATIONS**,29requests: exact
fresh admin and basic identities; ordinary assigned model access but PF403;
immediate assignment revocation using the same bearer/cookie; protected997B
resource exact SHA; explicit close followed by410SESSION_REVOKED. An actual retained
unexpired bearer has a verified signature under the unchanged source key and is
rejected401 by restored5192. Old expired cookie replay is **NOT_RUN**, never expiry
as fencing proof. Existing full raw restore-fence evidence remains separate.
Only new owned auth fixtures were written; sourceHTTPrequests/authwrites0, source
configuration/resource bookends exact, targetAPI/web stopped. Root captured all141
tables afterward for a separate exact owned-row delta qualification.

The source-update attempt then **FAILED B9_DATA_RESOURCES_CHANGED** at
2026-10-21T21:44:10Z, with no image-install BEGIN. Its sticky failure/lock and all
earlier receipts remain; it must not be rerun or called a completed delivery.
Old5191state/env/images remain, with oldAPI/web running. A subsequent explicit
owned-source cold metadata diagnostic records only dynamic Docker network IPAM
usage changes: frontIPsInUse4→3/DynamicIPsAvailable65532→65533, backend7→5/
65529→65531. All identity/configuration/IDs/images/data resources are retained;
the same old containers resumed and health200. This proves the counter-comparison
defect, not permission to waive immutable configuration checks. Add narrowly
validated allocation observation handling, independent review/regressions, local
commit and a **fresh** source-pinned operation. Retain this target/archives/evidence
until exact scoped retirement; no failed operation receipt or source pin is edited.

Root's operational auth delta comparator subsequently **PASS** across141tables:
138whole-table contents exact; every existing row/key exact in the other three;
all DDL/globals/sequences exact. Only the expected one basic user, two login
bindings and two closed viewer sessions were added; project access returns to its
prior state. Exact password/cookie/JWT identity and source-derived time rules were
checked privately. The first forward-slash CLI launch refused setup before any
capture/result; native exact canonical-path launch passed. Both logs remain.

The diagnosed network fix excludes only the two strictly validated bounded integer
usage observations per exactly configured subnet. All other network identity,
configuration, ownership and security fields remain in equality; unknown status
shapes fail. Raw allocation observations remain separately retained, and record
sorting is canonical. Root combined **138PASS**,0fail/cancel/skip, overlaps the
earlier99. Independent C source review is clear. No calculation/engineering guard
is weakened and no DLL/source arithmetic changed.

Only the exact cabe7f1a5192 fixture has now been retired after this proof, with
positive resource absence and unchanged healthy old5191. Its failed controller,
backup, private companion, inputs and all evidence remain. Next is a new operation
1335da29-4a1d-4e2f-9084-8feae288d992 after the local fix commit; previous PASS or
FAIL records are not rewritten or replayed as a new source-delivery success.

Current frozen candidateAPI297940057e6a047b1e05786df5e291285ee5e508bebca96e6b2f94616d55c3ca,
webd95000381daabe12f7ef264c97652ede08d198441c14750d0eea181e118fb535.
Root independently inspected all16installed engine files: closureSHA0294e63ea309917eeda81faaac79b54bfb0ce47b602f31517ceb65e1fc1f57c7,
engineidentitycb8e6a08 and runner2ba050c3 exactly match the separately actual-qualified
first candidate below. Image IDs differ; binary qualification is reused only for
the proven identical complete engine closure, not inferred from branch/source.

## Fresh built-image actual planning replay

First candidate API6d087cc0e3e894d840d93584e44c72ecfef3e6d3678ffce361ad2a5066039767,
web82a69effc3f780bdb50ad128d9c7b96795602b2f38b604df839aa4e31b8fb27c;
engineidentitycb8e6a08e33869203b84ead898b3f0b47985082be4c178235a598e0c4102a6c8.
Its installed runner209920bytes SHA2ba050c323db52636ae6650942ce69ba3226aaba708cbce7d88c69cee838e24c
differs from B8b's checked artifact, so root qualified the actual image's own DLLs
and compiled server adapters, with no old assembly/dist overlays.

Fresh owned replay7eee550c-75b9-4625-b174-ca367b500b04 **PASS all five modes**:
cold16.931s/disk13.591s/sessiondisk13.634s/warm1.233s/0.940s. Full DTOs equal B8b
final7, normalizing ONLY requestId and prepared.loadedFromDisk. The exact actual
snapshot/request/driver and source scope/endpoints/cable bookends are unchanged.
Engine512MiB sampled guard remains; maxsampleone-shot441749504/session451059712,
Node80891904bytes,100ms sampling,0unavailable; no exact-peak claim. Exit0/noOOM/
timeout. Bounded network-none/readonly/init fixture retired through tracked own
cleanup; private inputs/cache/receipts retained. This is single actual cable
legacy planning equivalence, not protected civil/native/Auto/Apply acceptance.

## Protected scope and remaining acceptance

Source5191 owner8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46, compose
wfc-pathfinder-local-0cba87606e9b, runtime
`.scratch/batched-capture-runtime-20261018-1600`; preserve source independently of
the fact it is itself an old restore. Only fresh exact5192 may be retired.
No original5180/5190 mutation, real cable Apply, model import or denied cleanup.

Actual civil capture/openings remains **BLOCKED**: user-selected groups are
`3D-Modell_BIS_20260304.rvm` and `DB2401_DESIGN_01-PIPE+GRID_20260304.rvm`.
Their complete descendant triangles/topology/openings/capacity need legitimate
protected capture. No bbox solid, explicit-empty or synthetic substitute, native
oracle claim, saved browser-refusal retry or alternate-origin/native/CDP bypass.
Final real Aalborg routing checks remain separate from B8b's actual planning replay.

Read-only refresh2026-10-21T20:34Z: original cleanmain/liveoriginmain96e63f13,
canonicalPF clean45c24bf5. Local B9 base163left/3right versus availableoriginmain.
No PR returned for B9 head, no combined statuses or PR-triggered first-page runs
returned for main; no CI/review approval inferred. No remote mutation.
