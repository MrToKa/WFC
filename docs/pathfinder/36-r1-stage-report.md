# PF-R1 — actual project tray catalog and drawing dependencies

Status: **TECHNICALLY COMPLETE / PASS**. Actual source capture, owned file
staging, transactional copy, exact replay, read-only verification and computer-use
inspection passed. This is a local delivery, separate from human engineering acceptance.

Working copy: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-r1-tray-catalog-local-20261019`, inherited HEAD
`9c5fa34646016d670dc1c30a4704375ef5591010`. New uncommitted modules are identified
by exact source hashes in the receipts. R0 technical delivery remains
`09f0e1dbdded9abca35b493db6eda7e9df9b94e4`.

## Observed inputs and authorized decisions

The fresh original metadata guard passed with the expected clean WFC main,
backend/PostgreSQL/MinIO identities and local endpoints. Source PostgreSQL reads
use raw pg in bounded repeatable-read **READ ONLY** transactions; there is no
application bootstrap, migration, source write or original-container restart.

The exact previously authorized original project has330trays and51types.
The existing owned 5191 project has2140cables and50 minimal mapped types.
One additional referenced type is therefore a new local record. The two other
pre-existing target types belong to unrelated input and remain protected.

| Source closure | Rows |
| --- | ---: |
| Trays / cable types / default materials | 330 / 51 / 9 |
| Material trays / project support distances / material supports | 15 / 14 / 5 |
| Load curves / points | 3 / 803 |
| Purpose report mappings | 6 |
| Project file headers / versions | 2 / 1 |
| Template headers / versions | 3 / 0 |

These are actual captured rows, not routing geometry or engineering results.
The immutable plan covers1242source rows:1192insertions and50expected-state type
enrichments. The45-table independent audit additionally covers the earlier
27business/model/Path Finder tables and the complete new catalog closure.

Four required source drawing preferences were NONNULL while the local seed had
NULL values: `support_distance`, `support_weight`, `tray_load_safety_factor`,
`cable_layout_settings`. As a necessary routine completeness decision, the
transfer now includes **only these four fields**, under initial-NULL/full-row CAS
in the same transaction. Raw NUMERIC/nested JSON pass through PostgreSQL without
host reconstruction. Project identity, S/E/P, approved1m gap, model and project
timestamps remain protected. This is copying drawing inputs, not implementing
new Left/Right rules or changing an engineering cable length.

## Actual checks and exact scope

- Fresh source metadata inspection: **PASS**.
- Consistent source before/copy projections: **PASS**, hash
  `16b02722a2fe96f754d593963018e8a93524e3b71a7521cf647262a186a9b23c`.
- Actual source file HEAD/GET/HEAD and private byte hashes: **PASS**,6files,
  872680bytes. No original storage write is available in that code path.
- Owned file staging/readback: **PASS**,6newkeys/872680bytes; old1026model
  objects unchanged,3project and3template objects added as planned.
- Final combined synthetic controls: **192/192 PASS**, separate from real
  checks. Source40, transfer76, guard30, preservation12, operator5, diagnostics29.
  Final source hashes and raw evidence are retained; earlier189-control proof
  remains historical evidence rather than being relabelled as the final run.
- Catalog diagnostics:330distinct names/6purposes, no observed missing names,
  purposes/types, unsupported route codes or normalization/SDK-key ambiguities.
  Pure material type comparisons are candidates; PostgreSQL collation remains
  explicitly **NOT_VERIFIED**, not invented SQL proof.
- Relational copy and complete typed readback: **PASS**,1192insertions,
  50type enrichments and one project row with only the four drawing fields.
  All2143target cables (2140selected plus3unrelated) are byte-for-byte unchanged.
- Same immutable plan replay: **PASS**, `already_transferred`, no further rows
  changed/added. Read-only final reconciliation: **PASS**.
- Independent45-table exact allowed-change audit, before/copy/after original
  projection and model storage preservation: **PASS**. Two other projects/types,
  existing PF records, routing/design/install values and active model are protected.
- Actual computer-use Trays list, tray detail/material/support/load curve,
  Path Finder Routes/Path/Path lookup, protected model rendering and Details
  allowances1/7/5/10: **PASS**. No route calculation, binding or engineering Apply.

The first writer attempt **FAILED** before business writes/COMMIT and rolled
back. Its private result and public FAIL/UNCERTAIN transport remain retained.
An independent read-only45-table comparison proved the entire initial state
unchanged. A real PostgreSQL read-only control confirmed SQLSTATE22023:
subtracting keys from JSON scalar `null` fails. The unused INSERT comparison
operand was corrected to `{}`. Corrected same-plan read-only verification then
completed the entire typed projection and reached the expected
`TRANSFER_VERIFY_NOT_FINAL` without writes; only afterwards was the same plan
applied successfully. This was explicit reconciliation and correction, not an
unconditional retry or a discarded failed check.

Evidence: [capture](evidence/tray-catalog/operator-1792360720690-8e9f1173.json),
[controls](evidence/tray-catalog/controls-1792361143444.json),
[file staging and immutable plan](evidence/tray-catalog/operator-1792361207244-a3ea05ac.json),
[catalog diagnostics](evidence/tray-catalog/diagnostics-1792361085437.json).
Final evidence:
[192controls](evidence/tray-catalog/final-controls-1792361864308.json),
[failed attempt](evidence/tray-catalog/operator-1792361378114-dd620ad1.json),
[rollback reconciliation](evidence/tray-catalog/rollback-reconciliation-1792361445541.json),
[PostgreSQL control](evidence/tray-catalog/postgresql-jsonb-control-1792361473333.json),
[corrected read-only preflight](evidence/tray-catalog/corrected-plan-reconciliation-1792361522861.json),
[actual copy](evidence/tray-catalog/operator-1792361561541-c4524e45.json),
[exact replay](evidence/tray-catalog/operator-1792361615735-eb7c64dc.json),
[read-only verification](evidence/tray-catalog/operator-1792361791842-2672b4a9.json),
[computer-use inspection](evidence/tray-catalog/computer-use-1792361908753.json).
Business rows, source-to-local maps and file bytes remain in the owned ignored
private work; public evidence contains counts, hashes and statuses only.

## Implemented transfer contract and limits

The implemented private `wfc.pf.catalog-copy-projection.v1` has exact top-level
`schemaVersion,project,groups,files,transaction,source`; the19closed groups retain
key/column metadata and unchanged PostgreSQL row strings. This is the finalized
lossless transfer shape. R0's simplified private per-tray example is descriptive,
not this parser's strict wire fixture. The public normalized R2 catalog remains
a separate contract and is not replaced by these private business records.

The operator has a fixed local Docker binding, private immutable work,35s child
watchdog/45s host transport,90MiB input envelope/64MiB output,512files/64MiB per
file/256MiB total. The actual plan is1313111bytes. A tiny bootstrap starts its
watchdog before reading the bounded stdin packet; reviewed code is not placed in
Windows command arguments. Package imports resolve inside the fixed backend
working directory. Raw private transport evidence is durable before acceptance.

The target writer uses one serializable transaction, project/table locks,
current-admin and active-model checks, exact source/seed mapping, type CAS and
whole selected-table final fidelity. Shared global reuse requires exact business
facts and complete unchanged child semantics. Lost COMMIT acknowledgement
requires same-plan reconciliation. File staging uses conditional new owned keys
and exact SHA readback. Interrupted staging and missing local descriptor recovery
preserve the original IDs/plan; they do not regenerate or blindly retry writes.

## Preserved boundaries and next stage

Original WFC/PathFinder checkouts and `sources/` are reference-only. No push, PR,
merge, deployment, original/5190 write or restart is performed. No model is
reimported/replaced, no location is invented and no engineering Review→Apply is
performed. R2purpose permissions, R2aLeft/Right, R3full network, later revision
comparison, native parity and human engineering acceptance are outside this R1
delivery and remain unclaimed. The active diagnostic network still has13objects;
330copied tray rows do not prove330captured route objects or a full graph.

No new containers were created. Required5191demo, model packages and private
evidence are retained. The seven historically denied scratch paths remain
untouched. One new empty diagnostic directory under Windows Temp has an ACL
failure; its removal was not retried:
`C:/Users/todor.chankov/AppData/Local/Temp/wfc-pfr1-acl-ef400acb-021d-4166-afd1-7760a5cf2dcd`.

The original WFC and canonical PF are still clean on their exact expected
commits; the old dirty PF checkout retains its existing three change entries.
Fresh [remote observations](evidence/tray-catalog/remote-observations.json) match
WFC main and canonical PF master. R1 has no remote ref/PR; published candidate
CI/review is NOT_ESTABLISHED. Local cached upstream counts are not live remote proof.

Independent source/evidence reviews closed the reported material findings.
The [operator guide](../../scripts/pathfinder-tray-catalog/README.md) describes
the finalized contracts and recovery boundary. No app/server/Viewer feature code
or container image changes were needed for this catalog-only stage; data writes
were confined to the authorized owned5191installation.

Next: scoped final safety/link checks and local commit, detailed PF-R2 handoff
through prepare-stage-handoff, then immediately execute R2 on a new inherited
local branch. The user has already authorized this continuation. R2 must use
this existing catalog, preserve the report mappings/drawing inputs, and must not
repeat seed, file transfer or model conversion/import.
