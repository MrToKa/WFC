# Proposal preview reliability and explicit batch Review → Apply

Date: 2026-10-20. Local worktree: `C:/Users/todor.chankov/source/WFC-pathfinder-local`.
Branch: `pf-review-batch-preview-local-20261020`, inherited from
`efe9fc0b7358ed2397d4850eb770335be676b890`.

## Scope and observed diagnosis

The user requested batch approval/application of selected calculated proposals
and reported slow selection, disappearing geometry and disabled controls. The
separate primary-WFC Preparer integration remains paused.

Source inspection found redundant full-project state refreshes after proposal
and job GETs and after Review. The recent-proposal state projection revalidated
30 proposals sequentially, under the existing project transaction boundary.
There were also two overlapping polling paths. A specific proposal/job 404 was
previously treated as terminal Viewer access loss. Appearance restoration and
computed-path commit shared the ordinary 10-second command timeout; the SDK's
visibility and material operations traverse model fragments synchronously.

These are demonstrated source failure modes, not a browser reproduction of the
user's exact disappearing-frame event. Browser access was refused by the tool's
saved-permission gate despite the user's enabled Browser/Browsing settings and
computer restart. No alternative browser, CDP, token extraction from the browser
or indirect page-content read was used to bypass that refusal.

After the restart the root started only the existing owned 5191 installation.
Two earlier full-project calculations were still queued/running. Following
explicit user approval, both were cancelled through the normal authenticated
Path Finder DELETE operation. The first read-only identification attempt matched
zero rows because JavaScript timestamps truncate PostgreSQL microseconds; it
failed before any mutation. The corrected millisecond identity check selected
exactly the two previously observed jobs. Final verification: zero active jobs,
all 2140 project cable rows unchanged, Apply receipt count unchanged, all 412
existing proposals retained. CPU observations fell from approximately one busy
core to an idle 1–2% after cancellation; this is not a controlled performance
benchmark of the code changes.

## Delivered behavior

- Proposal/job reads are independently bounded and abort superseded reads, without
  holding project-wide UI busy state or waiting for another full state refresh.
- One completion-scheduled poll and coalesced state reads replace overlapping
  polling. Explicit post-write refresh still reads after an earlier in-flight poll.
- Only the five most recent proposals are in the lightweight state preview.
  Every calculation's complete results remain available through the existing
  immutable admission pages of up to 100 cables.
- Opening a proposal retains the current appearance while fetching its data.
  Computed-path rendering waits for acknowledged Clear before Begin. Clear,
  computed-path commit and transparency changes have a bounded 60-second
  appearance allowance; Begin/Append remain bounded at 10 seconds. Current access
  checks and immediate revocation handling are unchanged.
- Viewer failure has a visible reload action. Ineligible recent results say
  `Review blocked` instead of promising an applicable review.
- Page checkboxes select current LV, Control and Instrumentation proposals;
  MV remains excluded. Selection persists across cable pages of the same
  calculation, with a maximum of 1000 records. Changing calculation clears
  unprocessed selections. Known incomplete/cancelled jobs cannot be selected.
- `Confirm review for selected cables` verifies the exact immutable identities
  and routing preferences and records explicit reviews through the existing
  server endpoint. Selection alone never reviews or writes a cable.
- `Apply reviewed selection` applies one approved cable at a time, sharing the
  existing exact-key pending-command recovery with individual Apply. It checks
  current applicability again before each request. Stop/cancellation and unknown
  outcomes prevent dispatch of later items. Confirmed partial success is retained.
  A batch is atomic per cable, not across all selected cables.
- Existing server admin/login/dependency/cable-write-revision, idempotency,
  history and provenance checks remain in place. Routing and design length commit
  together; installed length is preserved. No real engineering Review or Apply
  was performed by this delivery.

## Verification

Targeted suites: 228 distinct tests passed across the following scopes:

| Scope | Tests | Executor |
| --- | ---: | --- |
| Path Finder tab, result preview, paged selection and batch controls | 74 | Root |
| Batch hook, including real pending-hook sequential/lost-response cases | 26 | Root |
| Pending Apply recovery | 34 | Root |
| Path Finder lifecycle/read/poll hook | 36 | Delegated isolated test worker |
| Viewer controller/appearance acknowledgement/timeout/revocation | 47 | Delegated isolated test worker |
| Recent state window and deleted proposal history | 11 | Delegated isolated test worker |

The earlier full Tab run failed five tests because newly separated action mocks
and the revised blocked label had not been updated. Those fixtures were corrected;
the final combined 74-test run passed. React act warnings from existing endpoint
test composition were observed in the earlier run; they are not browser evidence.
Final frontend/backend typecheck and scoped ESLint passed. Docker API/web builds
passed, including web/server production build commands. No C# algorithm or
calculation projection source was changed.

## Runtime and remaining acceptance

Runtime upgrade is **PASS** at 2026-10-20T14:43:11.855Z; final readback is **PASS**
at 14:45:52.217Z. The sanitized receipt is
[actual.json](evidence/review-batch/actual.json). Private operator work, DB backup, old runtime
configuration and raw observations stay outside Git under the owned ignored work
directory `pathfinder-engine/.scratch/tray-catalog-48e496e3-b4b3-4f6f-bc6c-cc595d8da8ad`.
The existing separately verified full model archive is retained. A new DB dump
does not constitute a new full model archive.

Only the exact owned 5191 API/web containers were replaced. Final images:

- API: `sha256:78536ccdf8050ccd732f383d09da56456e3fc9b10d9312568238577eea976f9c`.
- Web: `sha256:4f6acddc21724b8c3d62d74bcb810576a4c4d317fb6509c5995cde7c829a5f1c`.

Two private 13,759,262-byte cold PostgreSQL dumps were retained. The successful
case2 dump SHA256 is `6251f2e5accf5f398cc0cba83d0459825e9303c7df8a74028024f5a5aa44906c`;
mounted-file `pg_restore --list` passed with 84,447 TOC bytes. Final byte readback
verified both retained dumps. This is dump/TOC verification, not a new restore drill.
Calculation engine identity, all **2153 database cable rows** and the **2 existing
database Apply receipts** were unchanged across the upgrade. These database-wide
counts differ from the 2140-cable Aalborg project cancellation check. No new
engineering Review or Apply was dispatched. PostgreSQL/MinIO IDs and start times,
owned volumes/networks and outside configuration were preserved; no outside
running/start transition was observed during case2. Health returned 200.

The first upgrade attempt remains **FAIL** with its original rollback status
**UNCONFIRMED**. Its strict bookend compared the ordering of identical mounts on
an unrelated stopped container. Root subsequently verified all mount fields
semantically, original image restoration, exact configuration/data and health:
separate reconciliation **PASS**. The new case2 operator then used fresh receipts
and a fresh backup; it did not overwrite or relabel the first failure. No database
restore was performed. Case2 operator SHA256:
`84d2b302d604c0a20289daafa317676dec9254eda7fe423f3bb917ca517bec96`.

The initial final-cleanup readback also stopped before any write: the candidate
image provenance label identified the retained API/web containers as well as
potential helpers. After excluding only their exact verified runtime IDs, the
corrected readback proved **zero owned temporary helper containers remaining**.
No deletion was attempted. Retain the demonstration, both database backups,
rollback images and failure evidence; no disposable test installation was created.

The build operator's ignored script was edited by its author around launch;
the already running Node process used its previously parsed version. The completed
build receipt proves successful bounded transports and immutable image IDs, but
a later script hash/source-closure addition is not retroactively attributed to
that execution. Production sources were frozen before build and were not edited
during it. Before/after byte-level source closure by that original operator is
**NOT_MEASURED**. The executed upgrade separately proved exact calculation engine
identity and full cable-row/Apply-count invariance.

Use the existing administrator login at http://127.0.0.1:5191 and reload the page
with Ctrl+F5. In Path Finder → Path → Cable revision results, choose a completed
calculation, inspect the routes and length components, select eligible non-MV
rows across its pages, then explicitly choose `Confirm review for selected
cables` and `Apply reviewed selection`. Stale/ineligible results require their
actual dependency issue to be resolved before recalculation; the historical 230
calculated proposals are not a current applicability guarantee. The two cancelled
full-project jobs were not relaunched. Pending Apply Retry/Close confirmations
appear through the normal idle poll; ordinary Apply and batch completion force a
fresh state read.

Live browser interaction and visual acceptance remain **BLOCKED** by browser-tool
policy. Automated component tests do not establish live filled-Ghost rendering
or human engineering acceptance. The user must inspect and explicitly approve
actual proposals before using Apply. The underlying engineering locations and
cross-revision manual decisions from report 55 remain outstanding.

Original WFC/5180, the older isolated 5190 installation, original PathFinder,
synced sources and historically refused cleanup paths are outside this change.
No push, PR, merge, primary deployment or Preparer resume is authorized here.
Read-only Git checks confirmed the original WFC clean on main
`96e63f13fdc2b1d30b8f8ff658dd662f25fac104`; live `ls-remote` returned the same
remote main. Before this delivery commit the local development branch was 90
ahead/3 behind the cached main reference. Remote CI was NOT_RUN. The next bounded
prompt is [PF-Review-batch-acceptance.md](handoffs/PF-Review-batch-acceptance.md).
