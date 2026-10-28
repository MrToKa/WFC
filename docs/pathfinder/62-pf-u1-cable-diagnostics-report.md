# PF-U1 — bounded cable diagnostics

## Baseline and delivery

Worktree `C:/Users/todor.chankov/source/WFC-pathfinder-local`, inherited local
branch `pf-u1-cable-diagnostics-local-20261020`, parent
`5f0119a7939e0e144cfec13966103207a81fc580`. Read Git for the containing delivery
commit. U0 contracts72df1d5 remain unchanged. **TECHNICAL_FOUNDATION_PASS**;
the complete workflow and user acceptance remain pending later stages.

Implemented two protected GET reads for the complete cable workflow, independent
of `/state` and its five recent proposals. Pages scan at most200candidates and
return at most100matches, stopping at the requested match limit. Empty filtered
pages can continue. MV is excluded; unknown categories remain actionable.
Literal search preserves `%`, `_`, backslash and Unicode normalization.

The server reads the newest admission containing each cable, its exact job/item
and proposal. Waiting/running/blocked items remain distinct. Review-ready requires
current supported dependencies, immutable seal/ledger, compatible output,
uncancelled completed job and current automatic enrollment where applicable.
Accepted-result display proves the exact receipt-backed own-write revision
transition, current cable pair and preserved installed length before comparing
all remaining engineering inputs. This display evidence authorizes no writes.

Current administrator role and an existing exact unrevoked login are checked in
a bounded transaction through completion. GET does not initialize schema/login,
invoke the engine, modify cable values or call whole-project state collection.
Signed cursors bind project/account/login/expiry/query/context. Common engineering
inputs/options and exact proposal proofs are cached within one read. A per-cable
baseline lookup index is added only through normal schema initialization.

New English UI/client/hook foundation offers filter/search, reasons, explicit
selection and bounded navigation. It hides old owner data immediately, resets
owner-specific form drafts and rejects late or malformed responses. This stage
does not mount the list in PathFinderTab; the persistent popup integration is U5.

## Actual checks

Final combined run: **212/212 PASS,11files**, with JSON receipt
`evidence/cable-workflow/u1-tests.json`.

| Scope | Result |
| --- | --- |
| Shared queries/literal search |19synthetic PASS|
| Read transaction/cursor |74synthetic PASS|
| Positive proposal/accepted-receipt boundaries |42synthetic PASS; actual ledger validator, seal/scope/enrollment adapters mocked|
| Repository/routes |19synthetic PASS|
| API/hook/list |47synthetic PASS|
| Existing changed schema initialization checks |5synthetic PASS|
| Actual PostgreSQL read slice |6PASS in a fresh owned disposable PG16 database|
| Scoped ESLint on21source files |PASS (last3changed files checked again)|
| Frontend/backend types |PASS on final source bytes|
| Whitespace/source review |PASS, including final staged check|
| 5191 runtime migration/build/HTTP/visual check |NOT_RUN; integrated runtime delivery is later|
| Native engineering parity/user acceptance |NOT_RUN; no Navisworks license or invented acceptance|

Real SQL checks cover a match beyond400candidates after empty pages, literal
search, requested10match boundaries, MV/unknown categories, newer waiting/blocked
admissions overriding old successes, backdated admission cursor invalidation and
current role/login revocation. GET query capture contains no DML/DDL. They use
real transaction/query/cursor/metadata code with explicitly mocked common
engineering/endpoint/proposal-proof adapters; they do not establish full engine
integration, real-model calculations or production throughput.

Validation found and repaired: missing native select label association; active
item/common-context outcome contradiction; unbounded waits during read callbacks,
auth setup or rollback; commit-time expiry/abort; swallowed cumulative read-budget
overflow; initial TypeScript nullable metadata guard. An earlier draft also had
a syntax error detected by the reader tests. Final PASS supersedes those drafts;
none is represented as a successful prior check.

## Limits and remaining work

Pages are coherent live observations. Item progress can change between pages;
Refresh revisits earlier rows. Engineering context/new admissions invalidate the
cursor. Retained admissions are explicitly capped at10000; proof input at256KiB,
response8MiB, cumulative reads32MiB and collection15seconds. Oversized/unavailable
proof cannot produce a positive Review state. Existing whole-job completion and
v5/v6 global registry staleness remain strict until U3. No fabricated structured
engine error code is inferred from historical free text.

U2 adds exact selected-object lookup and shared cable endpoint commands/recovery;
U3 adds scoped currentness/targeted jobs, U4 conditional initial fill/manual delta,
U5 the persistent popup, U6 the accepted direct SECONDARY rule, U7/U8 integrated
verification/local delivery. The PF-U heartbeat stays ACTIVE; Preparer is PAUSED.

## Isolation and cleanup

Only a new disposable SQL fixture was started, with memory-backed data, private
generated credentials and exact owner/image/path/container checks. Owner
`cbc1a2b3-08f4-4533-83fb-fd42f7235361`, container
`bd714c1a5a2800f6a49afce2673e317d82f3d94cbfd9d578f7547446b72a1355`
was retired after tests; its credentials were removed. Small reproduction/retire
metadata remains under the owned ignored scratch child. No generic prune.

No SQL/HTTP writes, restart, upgrade, Review, Apply, calculation or initial fill
targeted5191, original5180 or old5190. No original checkout/source/model data was
edited. Original WFC was observed clean on main96e63f13; cached origin/main same,
live remote/CI NOT_RUN. Isolated branch at entry was97ahead/3behind its cached
origin/main, not a claim about the current remote. Existing backups/models and
historically denied scratch paths remain retained. No push/PR/merge/deployment.
