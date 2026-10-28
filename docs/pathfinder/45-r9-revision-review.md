# PF-R9 — cable revision results and exact length components

Status: **TECHNICALLY VERIFIED WITH EXPLICIT LIMITATIONS — isolated local delivery; human engineering acceptance remains pending**.

Workspace: `C:/Users/todor.chankov/source/WFC-pathfinder-local`; branch
`pf-r9-revision-review-local-20261019`; inherited handoff
`17c1cfc34ab856feb3785079e82e0d3473a8604d`, technical R8
`21334df6cc57b2c0f141568a5733453e2cdaa1e9`. Follow the finalized
[R9 handoff](handoffs/PF-R9-revision-review.md). The technical commit containing
this report is the delivered revision; inspect Git rather than assuming a
self-referential hash. These checks do not establish human engineering acceptance.

The implementation adds immutable calculation admissions and per-cable baselines,
including all-blocked automatic generations which intentionally have no job. The
baseline records current routing/design/installed lengths as exact SQL text and
separately references the last accepted Apply. An intervening manual/import edit,
including edit then restore, prevents that historical geometry from becoming the
current baseline. Unknown historical values remain unavailable.

New successful calculations request an exact C# component ledger. The observer
calls the existing calculator once, preserves consumed double-to-decimal casts,
SECONDARY replacement, the clamp boundary, spare once, percentage and ceiling.
Raw gaps remain part of geometric length. The eleven pure Routing files,
SavedRouteDesign and the retained-route DTO are unchanged. Historical absent/false
Runner requests retain their old response fields. The server pins the observer's
validators in the actual implementation identity; it does not calculate a second
design formula in JavaScript.

Each new proposal and its baseline-bound revision envelope commit atomically.
Review records the exact envelope/dependency hashes and current human login.
Apply v2 preserves its idempotency, writes routing and designLength together with
history/provenance, and never writes installLength. A changed login requires a new
review. An exact already-applied replay still returns its prior receipt after
current access checks. Grants and producers have no Review/Apply authority.

The new read-only Cable revision results panel has stable admission/cable cursors,
at most 100 rows per page, bounded batch currentness checks, historical/current/new
values and exact component strings. It delegates opening a proposal to the existing
protected Viewer/Review flow. The legacy state response retains only its most
recent 30 proposal summaries; the paged view is the complete calculation-scope
interface. A page is not shifted by arrival of a newer admission.

An independent review identified two additional correctness boundaries. Live cable
deletion must retain engineering history, so live-cable cascade FKs are removed
from proposal/receipt history and omitted from the new baselines; project/job
ownership remains enforced. Lost human COMMIT acknowledgements now have a typed
unknown disposition and discard the transport without a false rollback claim.
The worker reconciles committed proposal/seal/item state instead of terminally
failing valid results. Actual SQL and concurrent controls recorded below verify
these boundaries in the owned 5192 fixture, not the retained 5191 installation.

The final review additionally found that a lost Apply acknowledgement could lose
its local key when polling changed the displayed revision. The implementation now
retains a bounded immutable command in same-origin session storage, without a
bearer or password. An explicit retry sends exactly the original key/body even
after display/currentness changes. New Review/Apply is blocked while it is pending.
An explicit close reconciles an existing receipt or atomically records a server
abandonment which prevents a delayed original request from applying. It never
applies a replacement. This fourth additive table is `pf_apply_abandonments`;
current-admin/login/project/actor and immutable-review checks apply through commit.
The source and actual candidate4 recovery checks below verify this addition in the
owned 5192 fixture. The retained 5191 upgrade and final preservation remain pending.

The actual retained state also exposed historical dependency-v1 proposal summaries.
The frontend now explicitly reads v1 with a null engine identity alongside current
v5 proposals. Current v5 still requires its validated engine identity; unknown
future versions are refused. This read compatibility does not promote historical
proposals to Review/Apply authority or relax any server gate.

## Checks recorded so far

These are overlapping scopes and must not be added together as one total.

| Check | Actual result and scope |
| --- | --- |
| New .NET build, `ledger-build1` | PASS, 0 warnings/errors; root-owned artifacts in private R9 work. |
| New ledger executable | PASS, 35 synthetic direct Core and actual one-shot/session cases. No native/human acceptance. |
| First shared/server contract group | PASS, 30 tests/5 files; earlier snapshot before subsequent focused fixes. |
| Source-only PF regression run46013 | 1,622 PASS / 2 FAIL / 5 optional NOT_RUN, 99 files. Failures were two obsolete acknowledgement assertions after the typed transaction fix. |
| Corrected transaction/recovery/result/identity group | PASS, 110 tests/6 files; includes the two corrected assertions, 17 result cases and human/grant lost-ACK cases. |
| New frontend plus existing calculation boundary | PASS, 28 tests/4 files; API7/hook13/component7/existing boundary1. Includes more than 1,000 logical paged rows and cancellation ownership. |
| Types | PASS after the new schema-test mock typing fix; combined type/lint process10823 also exited0. |
| Lint | PASS process10823; a later narrow worker replay verification branch requires a relevant follow-up check. |
| Original detached Core regression | PASS, all105 checks against a fresh separate Core assembly; new private regression-build1. |
| Frozen parity | PASS,43 golden cases/215 checks; private parity-build1/check1, original expected hashes unchanged. |
| Canonical pure source | PASS,11 files byte-identical to the clean canonical Windows checkout and provenance hashes; Git blobs also match after CRLF/LF normalization. The initial raw-blob byte comparison failed on line endings and is not relabelled as a byte PASS. |
| Candidate3 build / migration | PASS,1551 source files SHA2383b9d21675bd82d8bb5e77268dd6318b59c33ad212054f4632413d29582f8f; fresh owned5192,125 tables. Source5191 unchanged. New recovery table is not yet in this image. |
| Actual PG constraints2 | PASS,19 controls, one outer rollback/19 table multisets exact. Checks include production admission/no-output sealing, tenant/identity FKs, immutability, nullable no-job generation and deleted-cable audit retention. No committed SQL-control writes. |
| Actual normal HTTP diagnostic job/read2 | PASS,3 calculated controlled cables,2-page exact ledgers,12 read/denial requests, unreviewed Apply409/cross-project404. No real engineering Apply. |
| Complete blocked project scope | PASS,2140 cables/22 pages,0 ready/2140 blocked/job:null; six business/Review/Apply table multisets exact, temporary enablement disabled afterwards. This is not2140 calculated engineering routes. |
| Current source PF regression83100 | PASS,99 files/1634 tests; one optional file/5 tests NOT_RUN. |
| Current role4 HTTP control | PASS,6 reads/writes denied403 with unchanged old admin JWT claim; restored actor then read200. Earlier attempts asserted the wrong error-body shape; each restoration is retained. |
| Actual synthetic full/design/Review/Apply | PASS,7 grouped controls/51 HTTP requests: newly published exact synthetic10m aggregate; full18m→Details spare change/design-only19m; two same-key simultaneous requests produce one receipt; other-login review refused; exact later delta−1m; installed length retained; original settings restored. Exactly1 synthetic Apply,0 real-data Apply. |
| Computer-use, candidate3 | PASS at stated scope: exact8m ledger, protected yellow route and filled Ghost; Restore view returns the complete opaque model and disables review; no real Review/Apply. Private screenshots retained. Final recovery UI remains pending. |
| Pending-command / close source tests | PASS,39 frontend tests/2 files and22 backend/schema tests/2 files. Actual candidate4 close/tombstone checks are recorded separately below. |
| Final combined frontend93061 | PASS,4 files/101 tests, including53 existing Tab composition/ownership cases,34 pending recovery,5 results and9 API cases. Tab fixtures now carry actual account/context and matching v2 receipts. |
| Final source PF11994 | PASS,101 files/1656 tests; optional1file/5NOT_RUN. |
| Final types19564 / lint11615 | PASS. Two deferred mock Promise types were corrected; a private AsyncFunction carrier was renamed `.body.txt` with unchanged bytes after the first full lint correctly refused parsing it as a module. |
| Candidate4 recovery build | PASS, recorded candidate prefix `c026b8a…`; this is distinct from candidate3 and the later historical-reader candidate5. |
| Actual recovery HTTP1 | PASS,6 grouped controls/8 requests,126 tables inspected. Six business/Review/Apply table multisets remain exact; exactly1 recovery tombstone and0 new Apply receipts. |
| Actual PG recovery3 | PASS,3 expected refusals with SQLSTATE `P0001`, `P0001` and `23503`; controls rolled back and exact preservation was checked. |
| Actual deleted-history HTTP1 | PASS,5 grouped controls/6 requests. Exactly1 controlled synthetic cable was deleted in owned5192; normal state/proposal/envelope/baseline reads and the committed-receipt replay remain available. No source5191 cable deletion. |
| Historical-v1 reader and recovery regression | PASS,42 tests/4 files: recovery22, deleted-history8 and API12. Includes mixed old/current provenance, v1 with null identity, unknown-version refusal and unchanged v5 identity requirements. |
| Candidate5 build / owned5192 overlay | PASS,1558 source files SHA`80bee9bce6d7f7eaa7c22962ad01ae1b6c9e9fbb5e13c1ef81cc9466a905b5f3`; API image `44d381d077c618d4f8a2128268fab095b51554a2226b9aee20d34e9eba70a0a5`, web image `d6ed5fdaf733c29a4e374612160d02712453fd2717e9b15f87c352056aa5ebbb`. Fresh5192 overlay PASS; retained5191 remains unchanged. Final recovery UI and source5191 acceptance are not inferred from this build. |

Retained failures: the first guessed Vitest config did not exist (startup failure,
no tests); the first frontend component fixture omitted the required false physical
proof flag; an overbroad backend filter included historical compiled scratch tests
and failed in obsolete bundles. None is counted as a current-source success. The
definitive source-only run explicitly excludes all historical scratch directories.
The first type run rejected an untyped mock-call tuple; it was corrected before
the later passing type check. No frozen PF-0 expected data or receipt was rewritten.

Actual PG attempt1 exposed native JavaScript array serialization into the
`observed_events` JSONB column. It failed23514 and fully rolled back with exact
preservation before the production JSON-string binding was corrected; attempt2
then passed19 controls. Deleted-cable normal state reads were independently fixed
and checked with8 focused cases. Candidate1/2 builds, candidate3 computer-use,
candidate4 recovery controls and candidate5 historical-reader build remain distinct
scopes. No later build retrospectively changes an earlier screenshot's revision.

Private R9 work is
`pathfinder-engine/.scratch/tray-catalog-5f489050-d469-4ae0-9972-868b33a4d8e3`.
It retains the parent runtime profile, new .NET artifacts and new synthetic test
files. Secrets, model/business rows and archives remain outside Git.

## Final candidate5 qualification and retained source

On19 October2026 the candidate5 browser loaded the historical-v1 state normally,
including the deleted synthetic cable's immutable baseline/ledger and explicit
missing-currentness warning. A second synthetic cable was calculated, its exact
path displayed through the protected bridge, reviewed, and applied through the
normal UI:18m design,44m installed unchanged. Actual SQL readback confirms exactly
2 new v2 synthetic receipts across the test workflow,0 new real-data v2 receipts,
and0 live jobs. The deliberate target API stop/start did not force a failed Apply:
the original UI command completed after resumption and reconciled one receipt.
No UI-close or lost-network-response success is inferred from that observation.
Actual close/late-request refusal is separately proved by the HTTP/PG controls;
34 pending-command source cases cover remount/unknown acknowledgements.

Candidate5 also displayed the real converted diagnostic path with its yellow line,
original tray colour and filled Ghost. Restore view returned the complete opaque
model and disabled review; Clear completed. Private screenshots
`r9-ui-final-route5.png`, `r9-ui-final-restore5.png`, and `r9-ui-applied2.png`
remain outside Git. No real diagnostic Review/Apply was performed.

Only the exact new R9 restore on5192 was retired after its browser tab closed:
0 remaining containers/volumes/networks and closed port. The source5191 database,
storage, volumes and networks were retained; only its API/web were upgraded to
the tested candidate5 images. Host8 was cooperatively stopped and joined. Fresh
host9 PID6900 was positively reconciled after the launcher transport returned
UNKNOWN, without relaunch. Its actual normal HTTP producer status is ready,
existing grant3 remains enabled, and the copied2140-cable project retains Details
S7/E5/P10/gap1. Source5191 Apply count for this stage is0.

The source's exact SQL-text snapshot before/after upgrade covers122 old tables
and126 resulting tables.117 old tables are byte-exact; existing reviews retain
all values with only3 new nullable seal/login columns. Four operational tables
changed through ordinary grant/resource-session and engine-dirty processing.
All201 prior PF_ROOT files remain byte-exact;5 new managed-preparation recovery
journal files were added, none deleted. These additions are not relabelled as a
whole-database unchanged result. All six business/Review/Apply value sets are
preserved. Original resources pass the existing narrow guard with acknowledged
external lifecycle changes retained as EXTERNAL_CHANGE, not an unchanged claim.

Final follow-up types and narrow API lint61926 PASS; focused42/4 tests include
the historical-reader correction. The broader regression scopes above remain
overlapping, revision-specific evidence. See the sanitized technical receipt.

## Next stage

Prepare and immediately execute PF-R10 using prepare-stage-handoff. Remaining
work includes final current-delivery backup/restore and fencing, drawing-side
integration and actual generated DOCX visual QA, bounded offline demonstration,
source-backed guide/final acceptance matrix, and owned-resource cleanup. Preserve
the5191 demonstration, needed archives/private companions and every original/R8
reference. The R8 archive does not contain this R9 delivery and is not its restore
proof. Manual real locations/routing purposes and engineering acceptance remain
human decisions; diagnostic13 objects are not the wholeplant routing network.

There is no authorization to merge, publish, modify original/5190 resources or
apply real business calculations. Missing real locations and manual engineering
review remain explicit user work; native parity is not performed.
