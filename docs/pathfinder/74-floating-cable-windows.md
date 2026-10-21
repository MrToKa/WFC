# Separate cable windows and explicit route display

Status: SOURCE_CHECKS_PASS / STATIC_WEB_DELIVERED / REAL_BROWSER_CHECK_BLOCKED.
Branch: pf-floating-cable-windows-local-20261021. Product source: 8eed67c996352ece4ef207b039328aa1d2166fc0.
Baseline: 0ac3f044819f29aa56a5bc18060b190a5cb0067f (report73).

## Delivered behavior

Clicking a cable in Path Finder or Routing Viewer synchronously requests a real
browser popup and retains it. Its native title bar can be dragged to another
monitor. A single window per workflow is reused for cable switches. Hover remains
a temporary in-page preview after one second; leaving closes it after a short
grace period. Path Finder hover is read-only and does not replace an editing draft.

The editor is rendered through a React portal into the same-origin blank window.
There is no second login, duplicate model, credential copy, storage transfer or
new Viewer API. Assign From/To, bottom-centre drafts, atomic explicit Save, shared
reuse and affected non-MV recalculation keep their existing contracts. Returning
to the page or closing the native window retains current editor state inline.
Scope loss, logout, inactive workflow or opener exit closes the owned window.
Browser popup refusal gives an inline fallback with an explicit retry control.
Inline panels also support header drag, arrow keys and Reset position.

Styles and Fluent theme ancestors are mirrored. A bounded existing lifecycle
timer detects new CSSOM rules from descendant-only updates without reserializing
unchanged styles. No calculation, proposal or database polling is added for hover.

Selecting a cable reads verified proposal/comparison metadata without claiming
the Viewer or enabling Ghost. Only Show/Reopen renders its protected exact route.
Show intent belongs to the exact job/proposal/hash/cable revision; a new result
after Save cannot inherit the old intent. Hide retains restoration behavior.
Parent selection, original route colours, yellow line, filled Ghost on explicit
Show, and all Review/Apply authorization/currentness checks remain intact.

## Verification

PASS:399 tests across11 files at exact source 8eed67c996352ece4ef207b039328aa1d2166fc0, in
pathfinder-engine/.scratch/floating-cable-windows-tests-20261021/final-resumed.json. Includes native-window preopening/reuse, blocked fallback, lifecycle
and role fences, CSSOM updates, draft retention, hover/click, both endpoint hooks,
Path Finder/ Routing UI, explicit Show/Hide and historical-calculation recovery.
PASS: client TypeScript, strict lint on changed files, diff, independent review,
and production Docker web build including Vite and server TypeScript.
An intermediate title accessibility regression and history-to-Show regression
were corrected before final checks. Intermediate receipts remain private.

Actual Aalborg reread, browser popup appearance and second-monitor movement:
BLOCKED/NOT_RUN by the existing saved origin refusal. No unchanged retry or
alternate browser/native/CDP bypass was attempted. Mock window/portal tests are
not real SDK/UI or engineering acceptance. No real Assign Save/Review/Apply,
new calculation/grant, SQL mutation or model write was performed by this task.

## Actual local delivery and preservation

PASS 2026-10-21T06:24:09.481Z. Only the existing owned5191 web service was recreated.
New image: sha256:a6f80c989013aab71bc4a653470266d4a19c4845bd43fa82aa83f1c1fabcf8ac; container: 68ed8cb9a2ccf20260e48e2f16b12f450ec2b816445aed93e601543865e3c680.
API sha256:3476333e9163d1f251f0eb5ddee67d4fe776af6c73e4f3c57e1ebd85ca443166, PostgreSQL and MinIO retain identity/configuration/start.
HTTP /health: 200. New popup and existing assignment bundle
markers are present in ProjectDetails-Fao1jYGd.js. Runtime pathfinder.mjs remains
bf4c8f76e63a04d6f08c0a618238bb5a417219433df1fc7700072363340e06a8; adapter.mjs remains 21469bc088a33d3a3fb28a5a2d9e25b8b07cada9d5f7ff3894d877c7fd8eaadc.
The computational closure and API engine identity did not change.

Prior web image sha256:1e52058136d3500488d48e3dd253b12cd56d1ebdb337281abf81510b5486756d, private env/state and rollback tar
55297024 bytes, SHA256 f2e75bea8e10c5b1656f214322bca9025441fd013de8bb855dd8e49a9e87c998, are retained
under pathfinder-engine/.scratch/floating-cable-windows-web-20261021-8eed67c.
Existing U8 database/model archives remain. No fresh DB/model archive was required
or made for this static-only update. Rollback execution: NOT_RUN (activation passed).

Original5180/5190/checkouts/synced sources were not updated. Original main was clean
at96e63f13fdc2b1d30b8f8ff658dd662f25fac104; its externally restarting backend was
observed and not managed. Outside container configuration/identity hashes are
preserved; externally changing process state is not claimed globally unchanged.
No push/PR/merge. Connector main observed this turn also96e63f13, no open PR for
this local branch; remote CI for the unpublished feature is NOT_RUN.

No disposable test container or volume was created. Own test output files were
moved out of a new root scratch folder into ignored engine evidence and that
empty folder removed. Active/rollback images, demo and required evidence remain;
historical denied scratch children/parents were untouched and no prune was used.

Next prompt: handoffs/PF-U7-floating-cable-windows-browser-check.md. The conditional
next task remains Simplified-Preparer-WFC on main5180 after required PF technical
checks, with recovered existing work and fresh verified DB/model backup.
