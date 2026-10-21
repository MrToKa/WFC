# PF-B10 — restore cable search and floating editor (ACTIVE)

The user reported missing search, a verbose fallback cable list and no click
popup on5191 / Path Finder. They explicitly prioritized this repair before saved
obstacle persistence and queued Simplified Preparer work.

Branch pf-b10-cable-workspace-availability-local-20261022 inherits b3f941b.
No earlier UI commit was reverted: direct search/dbf67a2, separate windows/8eed67c,
theme/da95c71 and endpoint display/1e844ed are all retained ancestors. B5/07fe6dd
made exact calculation preferences unavailable until obstacle configuration was
ready, and the older workspace used the same condition to hide all cable reads.
The remaining advanced list only selected rows, without opening the editor.

The fix separates read query preferences from exact calculation preferences.
Current administrator/account/model/viewer ownership still applies to reads,
hover and click opening. Missing, unconfigured, dirty or pending obstacle settings
do not hide cable search/list/detail/editor. Fresh calculation, endpoint Save
with recalculation, new Review/Apply and automatic writes retain their admission
checks. No empty obstacle set or drilling permission is manufactured. Exact
pending command reconciliation retains its original ownership and server checks.

Default rows now contain full-width cable tag buttons with selected state.
Inline endpoint paragraphs, long reasons and technical disclosures were removed
from the list. Hover retains endpoint/reason information; clicking or Alt+Enter
opens the existing separately movable popup. Search/filter/pagination and direct
search remain unchanged. The protected Viewer bridge is unchanged.

## Actual checks

- Three focused component files:84 PASS,0fail/skip,35.75s, current compact list,
  workspace, and real routing panel. Includes hover/click, owner loss, pending
  commands, old/new comparison and disabled unsafe actions.
- Tab composition regression:5 PASS/61 deliberately unselected,28.88s;
  missing/unconfigured/dirty/pending obstacles with drilling off plus ready parity.
- Pure web-only installation contract:16 PASS,0fail/cancel/skip. Exact source,
  existing API/web IDs, current running API/stopped web, candidate ownership and
  Linux/amd64, state/env CAS, BOM/CRLF refusal and private-field conservation.
- Full typecheck after the four initial UI files:PASS with2304MiB heap. Initial
 1024MiB attempt failed from V8 heap exhaustion and remains in private evidence.
  Final frontend check after compact-list edits:PASS (frontend-types-3.log,
  process exit0). No server source changed after the earlier full check.
- An earlier broad four-file run was stopped and joined after source scope
  changed; it completed30panel cases but has no final suite PASS. Counts above
  come from separately completed focused runs; no cancelled result is relabelled.
- Independent source reviews of UI and pure installer:CLEAR. Root is the only
  actual test/build/Docker/HTTP executor.

## Local delivery boundary

Delivery is frontend-only. Keep sourceAPI ac0d16ab in the same running container;
no server/engine build delivery, migration, SQL, models or cable-value writes.
The existing verified B9 backup remains; old aeca web image rollback archive is
55346688bytes/SHA5b80bd656c227968eca7be1daf7adcd599175ad048acd1e36905d95de0e56a60.
Fresh private old state/env copies and exact resource pins were captured by the
read-only preparation. First preparation refused old Docker API network metadata
before any source/evidence mutation; the same validated CLI projection passed.
The installer uses immutable BEGIN/pair intent, exact late CAS, only web service
replacement and nonweb ID/config/start/resource bookends. Half pairs remain
uncertain; no blind retry or rollback. Actual build/install remains NOT_RUN here.

Saved obstacle disappearance is the next separate task. Source review shows the
server retains saved parent selections, while a stale-frame UI branch clears the
editable list and can show it as empty. This is a source finding, not actual SQL
proof of this user's saved row. Retain saved scope and selections visibly without
silently promoting old geometry into a new capture. Do not claim it fixed yet.

Actual browser access, civil/opening routing and engineering acceptance remain
BLOCKED/NOT_RUN under the existing boundary. No browser-refusal bypass or native
oracle claim. Original5180/5190 and all denied scratch paths remain untouched.
