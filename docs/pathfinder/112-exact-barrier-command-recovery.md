# PF-B21 — exact recovery of unfinished barrier commands

The source now recovers the retained begin, empty and publication commands that
could leave the barrier panel and Calculate locked after refresh. Historical
inspection does not replay geometry. An explicit Close settles only that exact
command and keeps the published barrier set. This report records checked source;
the separately qualified paired installation is still pending.

## Implemented behavior

- Current project-admin inspection works without a running Viewer or the old
  capture login. Original actor/login, command lane, scope, IDs and hashes remain
  independently checked; a new administrator cannot resume the old capture.
- Exact committed publication or geometry refusal wins. An absent row, null
  observation, timeout or expired lease cannot clear the saved command.
- Explicit Close stores an immutable project/command-SHA fence with a separate
  closer audit. It grants no capture, publication, model frame or calculation.
  Begin, empty publication, lease admission and final success/refusal all check
  that fence under the project lock through COMMIT. A delayed worker cannot
  publish a command after Close.
- Lost Close acknowledgements and restored commands use GET-only inspection.
  The original persisted record stays unchanged. Target/record hashes, current
  auth, local epoch and exact storage CAS protect settlement. The real registry
  and hash-verified manifest must refresh before the local record is cleared.
  The UI exposes only the actions its current state can perform.
- A new closure table and two indexed command-SHA lookups are the sole schema
  additions. The explicit V5 conservation policy admits only their exact pristine
  definitions during target-migration/source-runtime. Target-runtime allows no
  DDL. Old B9/V4 policies stay unchanged. Existing history, raw rows, globals,
  owners/ACLs and sequence state remain protected, including populated closures.
- The existing popup, search, parent assignment and per-cable off-default Drill
  behavior remain. Endpoint Save and exact Review/Apply/auto-length policies are
  unchanged; recovery never declares empty barriers or enables drilling.

## Actual checks

The source receipt is
[b21-exact-command-recovery.json](evidence/barriers/b21-exact-command-recovery.json).
It pins26 affected source files and the retained private check evidence against
the B20 parent4a1bc2bc0563c281132af513ed4963332c0b2de3.

| Scope | Result |
| --- | --- |
| Latest checked version of each selected Vitest file, overlaps counted once |717 PASS,0 failed|
| Fresh PostgreSQL14 + actual recovery/cookie HTTP24 + actual net9 process7 |45 PASS|
| Actual old/current DDL, raw/global inventory, history and sequence conservation |6 PASS|
| V5/V4 delivery selection, conservation and operation guards |160 PASS|
| Full TypeScript, scoped lint, frontend and server builds |PASS|

The Windows host run explicitly leaves21 existing POSIX-only multipart-storage
cases unrun. The targeted Tab regression selects one new Calculate transition;
its72 historical cases are deselected, not counted as passed. The latest-file
selection avoids double-counting renamed or superseded test assertions.

The isolated45-case fixture proves paused success/refusal workers cannot commit
after Close, delayed begin/empty/actual-cookie PUT refuses, prior exact terminals
win, lost COMMIT acknowledgement reconciles, old expired owner identities remain
audited, and current role loss/foreign or ambiguous facts refuse. The actual6-case
conservation fixture retains populated old history and a called bigint sequence,
accepts only the sole table/two indexes, preserves populated closure rows across
reinitialization, and detects immutable-row, isCalled-only and undeclared-index
changes. Both fixtures passed complete applicable source/artifact/copy/generated
bookends, positive child/helper removal and owned network retirement.

Failed fixture attempts are retained. The first SQL assertion counted triggers
from both isolated schemas; the next exposed PostgreSQL18's separate NOT NULL
catalog constraints. The corrected assertion checks the exact public schema,
all six logical constraints and all eight required columns/catalog constraints.
The24 recovery and7 verifier cases passed in both earlier attempts. Lint fixes
preserve unconditional worker release/join and combined failure diagnostics.

## Retained real Aalborg geometry

The exact28 requested dbIds were extracted from the pinned retained package and
all28 emitted GENPRI/VOLMODEL names independently matched the user's list. The
union contains28 physical fragments,4790 original vertices and3789 triangles.
Every original triangle, transform and selected-parent membership is retained.

The actual current source-compiled mixed-v2 verifier accepts that union as
3 original surface components and25 independently qualified closed solids.
Capture SHA is `9dcf2027d175de5a761a582d7be493441458ea9cda7f5449c1f3f058440a7a45`.
Extraction passed source/resource/output bookends under a90s/sampled512MiB guard;
the verifier passed source/artifact/input bookends with positive process close
under60s/sampled512MiB. The first wrapper expected the wrong success literal and
labeled a successful underlying receipt refused; it remains retained. A fresh
run checks the exact `geometry-qualified` contract, capture hash and counts.

This is the actual retained model geometry in an explicit offline package-world
frame. It does not establish current Viewer placement, SDK coverage, protected
live publication or a real project routing result. Report111 retains the separate
Windows/Linux actual-floor contact checks and matching receipt.

## Remaining work

Install the frozen B20+B21 API/web pair through fresh owned5191 backup/restore5192,
V5 migration/runtime conservation, rollback/CAS and retirement checks. Before that
installation5191 still serves the B19 pair recorded by report110.

Authenticated own-object first exit/final entry and whole-model multipart/catalog
capacity remain subsequent work. Existing manual display assignments alone do
not prove parent-equipment/fragment ancestry and grant no own-object exemption.
The current mixed lane explicitly reports ownTerminalExemptionsSupported:false.
The requested final live Aalborg SDK routing test remains required; the saved
browser refusal has not been retried or bypassed. Simplified Preparer follows
completion of PathFinder work. No real cable Apply, original5180/5190 changes,
push, PR or acceptance is claimed.
