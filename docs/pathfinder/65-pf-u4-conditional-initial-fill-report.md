# PF-U4 — conditional initial fill and ordered comparison

Technical foundation verified on `pf-u4-conditional-initial-fill-local-20261020`,
inheriting `12972001c1f5bc37c72411d6d3b8fd2e06d22749` (U3 source
`00b4bcc0550ec785d8bfc09bc0dd4975a32e0b60`). The containing delivery commit is
recorded by Git; exact checked source hashes are in
`evidence/cable-workflow/u4-actual.json`. This is implementation and isolated
verification, not deployed UI or human engineering acceptance.

## Result

An explicit v3 endpoint command can atomically retain a finite, account/login,
installation and exact impact-scoped mandate for initial fill. Legacy v1/v2
commands remain unchanged in authority. Omission of the new client policy emits
v2; explicit null emits v3 without a write mandate. Existing calculation-only
grants do not gain cable write access.

A separate bounded consumer discovers successful sealed v7 items, retains an
immutable deterministic request and uses a conditional writer. The writer checks
the original affected cable revision and logical endpoints, current actor/admin
revision/login/installation epoch/target generation, exact result and ledger,
current dependencies/engine, and the owned claim through commit. The SQL update
requires routing NULL or the complete JavaScript whitespace set AND SQL NULL
design length in the same update. Zero and either populated/partial pair remain
for manual review. Any intervening manual/import edit invalidates the original
automatic mandate even if both values are still blank.

The transaction writes routing and design length together, demands exactly one
history row, preserves installed length and every unrelated business field, and
records distinct `automatic-initial-fill` provenance. It creates no human Review.
Exact committed receipts can be recognized after the original authority expires;
that recognition never renews permission to make another write. Lost commit
acknowledgement retains the exact key/body. Claims have finite leases, at most
three recovery attempts and an explicit terminal unknown state.

U1 diagnostics and accepted revision readers verify the immutable command,
mandate, impact, enrollment, original member, admission, item, proposal, ledger
and exact revision+1 receipt transition. Invalid latest evidence fails closed.
Historical proof reads have a 32 MiB transaction-local terminal budget.

Explicit proposal selection now independently reads the live cable and displays
exact ordered old/new routing, including repeats and SECONDARY, old/new design
length and exact decimal delta. Admission values remain labelled as historical.
Oversized ordered diffs retain raw strings with an explicit unavailable reason.
A verified current cable revision mismatch disables only that proposal's
Review/Apply; a slow or unavailable comparison does not block Viewer operations.
The existing individual and selected-batch Review/Apply paths remain explicit.

## Checks

- PASS: 846 distinct synthetic checks across 31 files in `u4-test-scope.json`;
  `u4-tests.json` is the root aggregate. A later test-only definite-row type fix
  was rechecked by both owned attempts/producer suites (62/62); these are
  overlapping checks, not additional distinct cases.
- PASS: 12/12 actual PostgreSQL 16 cases in `u4-initialfill-sql.json`, including
  real v3 binding/impact/mandate atomicity, replay/closed command, legacy
  isolation, attempt discovery/claim/fence/finish, whitespace/NULL/zero/partial,
  revision CAS, history rollback, receipt/mandate immutability and current
  login/restore fencing. Shared synthetic source has 20 occurrences: 18 eligible,
  one MV excluded and one unknown category blocked. Admission/engineering
  collector/result seal/artifact/proof adapters are explicitly synthetic. This
  slice does not claim a full real-model engine calculation or concurrency load.
- PASS: frontend/backend TypeScript, all changed source lint and Git whitespace
  check, with final receipts in `u4-actual.json`.
- PASS: independent source review found no concrete write-authority or recovery
  blocker. The full manual Apply authorization remains server controlled.
- NOT_RUN: 5191 schema migration, image build/upgrade, normal HTTP/engine end to
  end, actual browser interaction, direct SECONDARY implementation, native
  parity and human acceptance. These remain U5–U8 responsibilities. Existing
  saved browser-site refusal is not bypassed.

Early backend type checks caught only an in-progress test pool definite
assignment and a mock optional-row narrowing error; both were corrected before
the final check. One draft synthetic producer fixture setup was reset; final
tests passed. The aggregate command preflight also rejected a nonexistent
`apply.test.ts` filename before any tests ran; the final scope uses the actual
transaction and Apply recovery suites. `u4-writer-draft.json` is an overlapping
107-case source check, not a separate manual Apply suite or extra result count.
No failed actual SQL run occurred.

## Resources, remaining work and isolation

Root alone created PostgreSQL fixture owner
`b7b5946e-dfb9-433f-aac6-25319c5ea674`, container
`76d6b99f61d3718febd0c5c6b8d3596708797ab9f2ea26f4a6cbfbf8f7c1c788`, under
`pathfinder-engine/.scratch/initial-fill-u4-b7b5946e-dfb9-433f-aac6-25319c5ea674`.
Its database was memory-backed, localhost ephemeral, 256 MiB/one CPU, without
business data. Exact ownership/image/path checks preceded removal. The fixture
is retired and generated credential files were removed; metadata/operator remain.
No broad prune or historical denied path deletion was attempted.

Eight tables must enter the later explicit backup/restore/lossless inventory:
the five U3 `pf_location_impacts`, `pf_location_impact_items`,
`pf_location_impact_targets`, `pf_location_impact_dispatch`,
`pf_location_impact_enrollments`, plus U4 `pf_initial_fill_mandates`,
`pf_initial_fill_attempts`, `pf_initial_fill_dispatch`. Data survives restore,
while new writes remain fenced by the restored installation epoch.

No SQL/HTTP writes, calculations, Review/Apply, upgrades or restarts occurred on
5191, original 5180 or old 5190 in this stage. Original WFC was observed clean on
main `96e63f13fdc2b1d30b8f8ff658dd662f25fac104`; cached origin/main matched.
Live remote and CI NOT_RUN. Original PathFinder and synced sources remain read
only. No push, PR, merge or deployment. Simplified Preparer remains paused.

Next: finalize the standalone U5 handoff using this delivery, create its inherited
local branch and immediately implement the persistent Needs routing list/popup,
Model Browser endpoint selection, shared progress and bounded refresh behavior.
The Path Finder automation remains active under the user's standing instruction.
