# Direct cable search without manual scan continuation

Product `dbf67a2bb0380a1852f2d2098ccf4194cec7b32f`, local branch
`pf-direct-cable-search-local-20261021`, inherits `0a3cd4f` and report75.
Evidence: `evidence/cable-workflow/direct-cable-search-actual.json`.

## Result

Submitting a tag, From or To search now finds matching cables without repeated
Continue scan clicks. The selected Cable state still applies and MV remains
excluded. Choose All non-MV cables when searching across workflow states. Search
does not automatically select a cable or change a route, binding or cable value.
Use Search cables or Enter. Reload the opener with Ctrl+F5 after the update.

Previously the server read its first201 project candidates before applying the
text filter to200 rows. A matching later cable therefore required manual scans.
The server now excludes proven printable-ASCII nonmatches before that limit.
Literal percent, underscore and backslash remain literal. Unicode/control fields
and oversized records are retained for the existing exact JavaScript matcher and
input refusal; normalization/case behavior is preserved rather than delegated to
database collation. All project/admin/MV/cursor and response limits remain.

The client skips empty filtered portions automatically for a submitted text
search. It keeps one owned request chain with a30-second total deadline and
51-portion bound, rejecting changed contexts, authorization loss and repeated or
nonadvancing cursors. A bound reports an error rather than a false empty result.
History contains visible result pages only. Further nonempty pages use Next
results. Blank browsing retains its existing manual Continue scan behavior.

## Checks at the product revision

- PASS367 regression tests across12 files, including exact client/server query
  contracts, cancellation/deadline, visible page history, state and role checks.
- PASS9 actual PostgreSQL18 read/auth/cursor tests in a newly owned tmpfs database:
  a405th cable is returned directly, literal special characters, From/To keyset
  pagination, Unicode behavior, oversize refusal, foreign-project and MV exclusion.
  Engineering proof adapters in that fixture remain mocked.
- PASS client/server TypeScript, changed-file strict lint, diff check, independent
  hook source review and production API/web builds.
- PASS actual computer-use on an independent no-account/API/model fixture5193:
  one Search click traversed two empty portions to CABLE-LATE-405; no automatic
  selection. This checks the real component/hook/parser with synthetic responses.
- PASS current Aalborg read-only candidate SQL:2 candidates,1 exact searched tag,
 7.594ms query execution. This is not the entire HTTP classification or browser flow.
- NOT_RUN actual Aalborg browser/SDK acceptance because the existing saved origin
  refusal has not changed. No retry, native/CDP/alternate-origin bypass or invented
  engineering acceptance. Prior popup/parent/model reread checks remain pending.

## Delivery and preservation

Owned5191 API/web updated at2026-10-21T09:20:18.341Z; HTTP200 and both health checks
passed. API `c5f12fb2685d169527da50586ee45614d6a2bbc28a6f976b309be72a2a77da44`,
web `c111ff208fffc832871d3eb0f1dc64263c912886bdbf20c95ff383e4ea17a0da`.
Owner `8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46`, compose
`wfc-pathfinder-local-0cba87606e9b`, runtime
`pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600`.
Project `1af0f807-7653-40ea-8391-7eea6c54e7d4` remains on5191.

Fresh complete cold archive `c388f3f6-dada-4f05-9faf-6b0b9f628907` is retained at
`pathfinder-engine/.scratch/direct-cable-search-update-20261021/cold-backup`, with
3159728840 bytes of manifest members and a separate private companion. Database,
model storage, staging, PF artifacts, four image archives and readback/audit checks
passed. No restore was executed for this correction. Only owned services were
temporarily stopped/resumed for this archive; PostgreSQL was not restarted.

Actual engine identity remains
`ebb19973d052848e544e5d75e382f599498453375a6478ef84000c306836021d`;
served computational runtime/adapter hashes are unchanged. PostgreSQL/MinIO and
outside container identities/configuration were preserved. Post-update read-only
hashes match the archive for cables/types/projects/trays/model versions/selection,
locations/aliases/binding heads/revisions/commands, jobs/items/proposals. Counts
cover the whole isolated database, not just Aalborg. No Save/calculation/grant/
Review/Apply or new migration was issued. No original5180/5190 data or resources,
original checkouts or synced sources were changed.

The exact new SQL fixture was retired. Fixture5193 tab/server and its two generated
files were removed. Needed backup, private receipts, evidence and rollback images
remain. Foreign `.pf0-work/`, `.pf2-work/` and historically refused paths remain
untouched. No global prune, push, PR or merge.

Original main remains clean96e63f13fdc2b1d30b8f8ff658dd662f25fac104; live GitHub
main was read at the same revision2026-10-21T09:18:55.180Z. No PR was returned for
this branch. Cached origin/main3behind/136ahead at the product revision is not
remote parity. Local unpublished feature CI is NOT_RUN.

Next procedure: `handoffs/PF-U7-direct-search-browser-check.md`. It retains the
actual PF browser gate before the queued Simplified Preparer task on main5180.

Synthetic browser evidence, not an actual Aalborg result:

![Synthetic direct search check](C:/Users/todor.chankov/.codex/.chatgpt-projects/g-p-6ad0a317833c8191bf8e4e8c824a1056/work/pf-popup-theme-endpoints/direct-search-browser.png)
