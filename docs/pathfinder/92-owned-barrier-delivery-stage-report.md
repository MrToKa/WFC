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

One **valid enabled persistent calculation grant** remains. Its current issuer is
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
source controls, from a fresh backup that includes the user's setting. Target
runtime, final source migration/runtime and browser/HTTP delivery remain NOT_RUN.

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
