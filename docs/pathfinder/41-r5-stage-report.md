# PF-R5 — durable shared endpoint bindings

Status: **TECHNICAL_PASS at the scope below; qualified real cross-revision carry remains unavailable pending evidence**.

Worktree: C:/Users/todor.chankov/source/WFC-pathfinder-local.
Branch: pf-r5-endpoint-attachments-local-20261019; inherited handoff
c7adcab176058331c75c352eaf1f39e51b6e10d9 and R4technical403504d4763efb97fabc1f4cc2f137ae0e3be370.

The implementation adds immutable shared binding revisions/history, atomic
location/name/aliases confirmation, one current head and exact-command receipts.
Fixed world points are confirmed for an exact current capture. Object-derived
equipment bottom-AABB points are approximate and server-derived. Follow model
object requires independently qualified object/frame evidence; current converted
R4 captures cannot supply it. Synthetic rigid-move evaluator checks do not grant
real identity or engineering acceptance.

New v3 cable/preview wrappers freeze endpoint IDs/revisions/content hashes,
mode/frame/object/decision references and exact preparation identity. Legacy
bindings remain history and cannot authorize new project calculations. Updating
bindings invalidates proposals and route reuse; it does not require recapture.
Standalone explicit manual-point previews remain transient and cannot Apply.
Core C# inputs, calculations and Details allowances remain unchanged.

Before any R5 migration a fresh95table/63PF_ROOT-file baseline and cold checkpoint
were retained. Backup a5a2afa6-8333-4b09-a7dd-b1625d004010 has8hashedmembers/4images,
dump TOC59193bytes and full rawSHA scan of4models/1368resources/1756031212bytes.
Private runtime companion is separate. Full restore NOT_RUN. See
[checkpoint](evidence/endpoint-bindings/checkpoint.json).

History calculates raw displacement only within an identical capture frame.
Legacy/different frames retain prior coordinates with NULL distance and explicit
unverified basis. Qualified pure migration normalizes the old point into the
target frame before comparison. Equal unqualified coordinates never fabricate
zero physical movement. Additive immutable proof tables enforce tenant/location/
aggregate/exact trace-object membership; current admin/login and CAS checks cover
atomic location/name/aliases/point confirmation and exact-command reconciliation.

## Verification at the recorded scope

| Check | Result | Evidence / limits |
| --- | --- | --- |
| Combined regression | PASS |75files,1234PASS,0FAIL;5optional dedicated lookup-worker tests NOT_RUN because that separate override was unset. [Receipt](evidence/endpoint-bindings/combined-tests.json). |
| Types/lint/reference pins | PASS | Both TypeScript projects, changed-source lint,24frozen references/11Core files with established drawing-wrapper reconciliation. [Receipt](evidence/endpoint-bindings/source-checks.json). |
| Frozen build/owned runtime | PASS |1338contextfiles SHAab3a4e732c8703da09513ac27cefe36f0bdb64696ac838c1ce0a4a8619460b2b; explicit api/web-only5191 upgrade;18outside containers and PG/MinIO/volumes/networks unchanged. [Receipt](evidence/endpoint-bindings/runtime-candidate.json). |
| Normal endpoint HTTP | PASS | Two confirmations/replays, Aalias used by3cables/2From/2To, history/legacy refusal/routing-not-equipment/Follow unavailable; no recapture. [Receipt](evidence/endpoint-bindings/actual-http-confirmation.json). |
| Production repository/PostgreSQL | PASS |16bounded phases: replay/no-op/conflict/old-key, usage/legacy observation/immutability/exact FK, rollback after actual INSERT, expired principal, unqualified migration refusal and fences. Fences prove the production transaction primitive, not a paused full HTTP-write race. [Receipt](evidence/endpoint-bindings/actual-controls.json). |
| Simultaneous HTTP writes | PASS | Same key gives200/200 and one new binding; competing commands sharing CAS give200/409 and one new binding. [Receipt](evidence/endpoint-bindings/actual-http-concurrency.json). |
| Job/core/staleness | PASS | Three explicitly synthetic cables calculate successfully with immutable v3 endpoint/preparation dependencies, Instrumentation→Control. One shared point update stales all three; Review refuses all three. No routing/design/install/write revision changes. [Receipt](evidence/endpoint-bindings/actual-v3-staleness.json). |
| Normal transport | PASS |10host nginx/API controls, including2header-only auth/body-limit refusals; strict duplicate/finite/UTF-8/encoding/method/query/case handling. [Receipt](evidence/endpoint-bindings/actual-http-edges.json). |
| Computer-use | PASS |11observed checks: picking/save/manual restore/history/unknown legacy displacement/shared named preview/original colors/yellow/filled Ghost/Clear. [Receipt](evidence/endpoint-bindings/computer-use.json). |
| Actual equipment-derived positive / real qualified Follow | NOT_RUN | Current13-object capture has no eligible equipment or qualified object-local/common-frame evidence. Pure/mock positive mechanics remain separate. |
| Native parity / human engineering review | NOT_RUN | No license; converted comparison/manual review remain the accepted path. No real cable Apply. |
| Final preservation | PASS |95old tables/80exact;13strict test-input/PF deltas plus2ordinary-auth tables;5new tables limited to the owned3locations. [Reconciled receipt](evidence/endpoint-bindings/final-table-preservation-reconciled.json). |
| Files/storage/source preservation | PASS |63PF_ROOT files/13834192bytes exact;1374MinIO object metadata exact;1175non-document build files unchanged. Original repository branches/HEAD/status/tracked patch hashes match prior recorded baseline. [PF_ROOT](evidence/endpoint-bindings/final-pf-root-preservation.json), [storage](evidence/endpoint-bindings/final-storage-preservation.json), [source/runtime](evidence/endpoint-bindings/final-source-runtime-preservation.json). |

Counts overlap; do not add them. The first combined run had7historical mock
failures missing the new preparation/context/head reads. The fixture was adapted,
with3additional authority regressions; production did not change after that run.

Two root control assertions required correction: PostgreSQL inet::text included
its host mask, and frozen initial cable write revision was0, not assumed1. The
first failed before mutation phases; the second was reconciled against retained
exact post-seed reads after successful operations. No job or binding command was
blindly repeated. Failed evidence remains private and retained.

The first preservation classifier refused4unclassified seed drawing events,
their state revision and4calculation principals. Independent source/row review
proved exactly1type+3cable inserts in the seed transaction caused drawing-input
revision1→5; catalog/routing/drawing-policy tokens stayed exact. There were
1explicit root-principal calculation,4normal-UI automatic calculations and
1normal-UI preview, each pinned to its recorded IDs/principal and test inputs.
All3complete control-cable rows equal their post-seed snapshot. The initial
[FAIL receipt](evidence/endpoint-bindings/final-table-preservation.json) remains;
the reconciled receipt reclassifies the same retained bytes without data changes.

## Runtime/data scope and remaining work

Only retained synthetic UI project56eadef6-8382-49f8-a652-c8f12026602e received
1explicit test type,3cables and3locations. Existing model/aggregate/traces were
reused. Its test Details stay gap1/S0/E0/P0; the primary copied business project
retains its own7/5/10/gap1 and has no new real endpoint confirmations.

The browser selected an actual model surface as a synthetic fixed point, then
restored the previous explicit control point manually. The picked object was
outside the13-object immutable trace: coordinates/picking derivation are retained,
with no invented object attachment/provenance record. A separate successful named
preview was7.478969923197742m/design8m under the test Details; this is a diagnostic
result, not engineering acceptance of a real cable length.

Current approvedprofile3 pins API9d41a53a3b759f0819ea9f13cde326376542e03a19bd717fdd6a3abe34ae5c81
and web3928914e878f7721595c3a2f93aa3a80c9c335eec5b0ed210b26ee388f214371.
API image2b0b42dbef7002e4b40396a44a394d2093d8bb07cbd4745d7dc56d1425969fc7;
web image08722057996e4a2479af51c88c787a16ba9f23c2592ba0d7447c6424e40530d2.
Private root evidence/checkpoint/companion stay under owned ignored
.scratch/tray-catalog-45f60132-cc3f-4710-aaed-4aa7e988bf89.

No original WFC/PathFinder/synced sources/5190 mutation or restart, push, PR,
merge, deployment, real engineering Apply or invented identity/qualification.
Required demo/archive/private companion/evidence remain. Denied historical paths
and parents stay untouched; no generic Docker prune.

Next: local technical commit, prepare detailed R6 comparison/readiness handoff
from current evidence and execute on a new inherited branch.
R6–R10 remain authorized independent work; no routine pause.
