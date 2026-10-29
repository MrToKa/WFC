# 135 — Saved obstacles, 2048 selections and stored popup routing

Status: installed on 5191; paired delivery and independent final checks passed.
Completed 2026-10-24. User testing is released.

## User-visible behavior

- A verified, current and unchanged published set shows `Barrier set saved`, its
  saved object count and revision. Save is disabled until the selection changes.
  Capture and publication have distinct progress labels. Refusal, unknown outcome
  and stale model/frame never claim a new successful save.
- The direct obstacle authoring lane allows 2048 selected parent objects and
  2048 geometry components. The caption reads the shared limit. Adding object
  2049 leaves the existing draft intact. This is a parent/component limit; the
  independent geometry, work, byte and memory ceilings remain enforced.
- Opening a cable immediately displays its stored Cable list route and design
  length while the fresh calculation lookup is pending or unavailable. Stored
  text is labelled `Cable list routing`; during a replacement it is labelled
  `Previous Cable list routing`. A verified new calculation takes priority.
  Stored text does not grant geometric Show, Review or Apply authority. No
  calculation is submitted merely by opening the popup.

## Capacity implementation and compatibility

New mixed runtime profile v4 retains the opening search and changes only the
explicit parent/component allowance to 2048. Historical execution profiles
v1/v2/v3 retain their original 128-parent/256-component and small-message bounds.
The existing multipart/catalog format retains its 128-bit membership encoding;
it is separate from the direct authoring lane used by this UI.

The direct command, manifest and new mixed verification receipt have bounded
4 MiB representations. Only a fully validated `START_BARRIER_CAPTURE` envelope
receives the larger transfer allowance; other Viewer messages remain 64 KiB.
Completed/cancelled replay records release the full selection array while
retaining replay identity and preserving the asynchronous SDK command.

The verifier's explicit `--mixed-v2-2048` mode and runtime v4 use matching limits.
The 32 MiB capture, 250000 triangles, 500000 vertices, 128 MiB kernel estimate,
finite work/deadline and process memory guards remain. The estimate also charges
fragment-parent and distinct component-parent memberships, including amplified
overlapping parent sets. No triangles are simplified or omitted to meet a limit.
Routing algorithms, wall-opening semantics and cable write ownership are unchanged.

## Source verification

- 446 distinct UI regressions passed across six files, including the corrected
  2048/2049 authoring boundary rerun. The initial combined run exposed the old
  128-limit test expectation; it was updated and its complete 75-test hook suite
  passed. Other 371 UI tests passed unchanged in the combined run.
- 423 shared/server checks and 139 Viewer checks passed. Viewer coverage includes
  capture and assembly of 2048 separate walls and cancelled/late large requests.
- 140 final native checks passed: 53 mixed kernel/verifier/CLI, 37 real ModelRunner
  runtime and 50 legacy verifier cases. The v4 runtime requalifies an actual
  synthetic 2048-component manifest; historical profiles refuse the larger set.
- Client/server types, builds, scoped lint and diff checks passed. The client
  build completed in 58.67 seconds. Existing bundle-size/test-theme warnings are
  not application timing measurements.

The synthetic fixture has 2048 parents/fragments/components, 8196 vertices and
4102 triangles. Its exact capture is 1420181 bytes, SHA256
`d242ce8fd511b2a04e4f2bdd299833d9b4a1ec28eb0a1570341bb67db288695f`.
The complete verification receipt is 520568 bytes; the kernel estimate is
11214848 bytes. Its genuine opening is clear and adjacent wall material blocks.
2049 parents/components and amplified membership resource exhaustion refuse.
This is synthetic capacity evidence, not a recapture of 2048 Aalborg objects.

## Delivery and acceptance

Owned operation: `b8406be0-f1d4-4fce-bf22-1c645f733863`.
The paired operator backs up and restores the current project, verifies the new
candidate and qualifies schema/data conservation before installation. Unlike B33,
this stage changes native capacity/profile identity; identity equality to B33 is
not expected or claimed. Recorded raw v6 windows must qualify any legitimate
engine observer changes.

All nine owned phases passed, including backup/restore, candidate build,
target migration/runtime, source installation/runtime and target retirement.
Migration checked 144 legacy tables and 84003 rows with no new tables or managed
changes. Target and source runtime each recorded exactly five qualified engine
observer changes/events; other managed data changes were empty.

Installed immutable images:

- API: `sha256:c816963a588074000bddc176869af7ab67cdff64f8946088657d31dae615fdf2`
- Web: `sha256:ac927d23213253c8765aa80e9d0814532c178f467b03fdabf135f2349e792e57`
- Engine identity: `b11b0cb346e89bcd3b5dd92c5c680d31e75c7f80416c374fde5c601c171defc1`

The actual candidate Linux CLI accepted all 2048 parents/components with an
exact receipt matching the Windows fixture. Both 2049 parents in the new mode
and 2048 parents in the historical mode refused with `ARRAY_COUNT_LIMIT` for
`selectedParents`. Initial root test-harness attempts expected the wrong refusal
code; the harness was corrected from the parser's actual diagnostic. No product
change, business write or uncertain helper cleanup resulted from those attempts.

The final independent verifier requalified all three retained raw v6 windows,
matched sixteen served files to immutable image bytes, checked source health,
executable paths, image/resource bookends and the retired target. Two immutable
API identity helpers and one never-started web reader were positively removed;
commands and scopes joined with no unknown remote execution or Docker mutation.
Identity hashes were forced in immutable candidate image helpers, not asserted
as a separate hash of the running container writable filesystem. Running API
image, executable environment and code-mount checks bind that image to 5191.
The final helper has 23 passing pure guards in addition to its actual live PASS.

The private final receipt SHA256 is
`96c814b174a0835165c9195ddb1fce616bbf842c3d096c31508400aafb649b5b`.
The sanitized [installed delivery receipt](evidence/barrier-selection-2048-20261024/b34-installed-paired-delivery.json)
records the installed pair and final checks.

No live browser was accessed, no real cable Apply was performed, and no change
to Save-to-Show timing is claimed. The new first-open behavior is verified in
the actual component integration suite; the user's browser acceptance remains
their follow-up test. Existing route-selection mathematics are preserved.
