# SP-6 — main delivery verification

Main5180 and separate Preparer5193 are technically delivered,24 October2026.
Product revision543ae7a; exact images APIec6fc3cf89dc9fea8ae201e9507655ba6534f608070b79480a81910ae89ff451,
weba9226e283b2bb2810bdf48484cd776d4bb6e6d92aad3706419f6c8724c6543d0,
Preparer3e815754b56d2c4ccbd79d4708ed289cc43e709c69f478ed708b86be9d20c488.
Main local+remote remain96e63f13; canonical source and PF5191 unchanged, no merge.

Fresh clone730f1a8f PASS: cold3-store restoration/recapture, candidate health,
all old rows/schema/global SQL/cluster role context exact, only predefined new
empty archive table/constraints/index/trigger, old-image rollback startup and all8
owned resources removed. Final lock release verified.15 upgrade controls PASS.
Initial553411f6 TEMP-alias contract failure remains FAIL with separate expected-only
replay, cleanup and lock reconciliation. No candidate/data comparison relaxation.

Delivery operation0f257b41 reached healthy Preparer/API but automatic operator
refused web creation because old User='' was materialized as explicit 'root' by
the pinned image. All other actual Config/full HostConfig were exact. Root made
a separate immutable equivalence admission and started only that owned web.
Independent complete-state qualification PASS: all three exact candidates running,
requested settings/mounts/network aliases exact except declared equivalent user,
original API/web preserved stopped+renamed+disconnected, PG/MinIO images/configs/
mounts/processes unchanged. /health5180+5193 HTTP200, session unauthenticated,
protected jobs401, wrong Host403. Lock archived after independent qualification.
The automatic attempt remains FAIL; it was not rewritten to PASS. Root-qualified
rollforward receipt is the delivery authority, not the failed operator marker.

Earlier attemptsdd90/4f84 stopped before original mutations on inherited image
port metadata and native never-started NetworkID. Exact unused containers/volumes
removed with explicit reconciliation; failed plans/sources/ledgers retained.
Future operator now preserves pinned image metadata, recognizes only exact fresh
CREATED network state, and makes implicit root explicit.45/45 controls PASS.
The first shared Windows test fixture run had35 setup failures/2pass; canonical
path repair then39pass, native cases40/44/45pass. All logs retained honestly.

Three new owned persistent Preparer volumes and private durable compose/config
companion retained under deployment operation. Exact old image/config/data backup,
audited recovery and rollback containers retained. Separate exact candidate image
exports3dd1681e PASS (all blob/envelope hashes/platforms checked), no tag/image load.
Owned duplicate failed-operation archives retired only after equality+cleanup
proof;6,426,951,237 bytes freed in total. No prune or denied-path operations.

Actual primary IAB login pages render; current-admin real-user handoff requires
the user's normal login. Full isolated two-admin browser/save/download/restore
proof passed in SP5. No real APS request, upload, translation or real model import
was performed. Production cloud acceptance remains NOT_RUN_BY_USER_REQUIREMENT;
real engineering geometry/render acceptance is not inferred from tiny fixtures.

Rollback compatibility was proved in clone. The retained immutable failed plan's
source closure intentionally refuses a newer operator; do not replay it with a
changed script. Use preserved original configs/images/endpoint records with a
fresh reviewed reconciliation plan, preserving current DB/three Preparer stores.
No automatic restore of an older DB or reversal of unknown intervening edits.
