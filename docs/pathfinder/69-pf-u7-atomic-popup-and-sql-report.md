# PF-U7 — atomic From/To popup and independent integration checks

2026-10-21. Branch `pf-u7-integrated-workflow-local-20261020`, inherited handoff
`b5a12e5ce7877381bcb3c67cab86c6bf6a9fe1ec`. Status:
**TECHNICAL_INDEPENDENT_PASS**. Full PF-U7 acceptance remains open.

The latest user clarification is implemented in Path Finder's existing Needs
routing list and persistent nonmodal cable window. From/To headings contain the
cable's logical names; verified automatic or saved model object names and points
are shown below. Assign From/To reads the current Model Browser selection into a
draft. Save sends one atomic command for the changed ends with both original
contexts. It preserves the cable's logical names and updates shared locations.
Conflicting aliases, a changed opposite end, or a failure saving either end roll
back the entire operation. Existing single-end commands retain their original
semantics and have explicit recovery controls in the new window.

Calculate routing requests only the selected cable. Show/Hide uses the protected
proposal display and From/To foreground; Hide persists across a newer proposal
for that same selected cable until explicit Show. Neither control writes cable
values. Save retains the finite conditional initial-fill policy: both routing
blank and designLength SQL NULL may fill automatically through the existing
pipeline; partial, zero and existing values require human Review and Apply.
Installed length is preserved. This delivery does not claim that the full
production pipeline was newly exercised end to end.

Checks are bound in `evidence/cable-workflow/u7-independent-actual.json`:

- 321/321 final combined TypeScript/component/mock checks in 12 files, root JSON
  receipt; 75/75 complete Results checks after the Hide fix, independently run
  by the assigned agent (direct tool output, not a persisted JSON receipt).
- 102/102 Node controls: 37 streaming inventory comparisons, 12 guarded SQL
  destination controls, 53 cold-backup/restore controls. Total 498 source checks;
  historical and earlier overlapping runs are not added.
- 11/11 actual PostgreSQL command SQL checks: atomic heads, two rollback paths,
  replay/closure, alias dedup/conflict, current role/login authority, shared
  fanout, MV exclusion, observer locking/MVCC and public-row conservation. The
  model-read context is explicitly simulated in a separate owned schema. This
  is not package import, live SDK selection, admission, engine or initial-fill
  end-to-end evidence.
- 6/6 actual dynamic inventory checks over 138 public tables in a fresh full
  production-schema synthetic fixture. Raw SQL text preserves bigint/numeric
  precision and duplicate/no-PK rows. New empty tables and precision changes are
  refused. Actual production restore fencing passed for login/installation
  rows. The second resource-auth group is NOT_RUN because no genuinely imported
  model was seeded; no Ready validation was fabricated.
- Frontend types, backend build, web build, scoped lint and diff checks PASS.
  The web build retains its existing large-chunk advisory.

The first actual inventory query failed with SQL42601; one missing catalog
parenthesis was corrected and a fresh fixture passed. A mocked test assignment
missed the new recovery field and initially failed TypeScript2352; corrected
final types pass. Failed evidence is retained rather than overwritten.

Three precisely owned disposable PG containers were retired, including the
failed bootstrap. Their fixture credentials were removed; evidence was retained.
No original checkout, original containers, 5190 or 5191 data was written or
restarted. Original WFC is clean at `96e63f13fdc2b1d30b8f8ff658dd662f25fac104`.
No push, PR or merge. Cached origin/main comparison is 3 behind / 112 ahead;
live remote and CI were not inspected. Simplified Preparer remains paused.

The user-required Aalborg local reread and real UI functional checks remain
BLOCKED by the saved browser-origin refusal. No alternate browser surface or
indirect reread was used. Native parity and human engineering acceptance remain
NOT_RUN. The genuine import→preparation→admission→engine→initial-fill chain is
also NOT_RUN; independent SQL slices are not relabeled as that chain.

Continue the independent PF-U8 backup/restore and owned5191 delivery work from
its standalone handoff. It must preserve these explicit limits and qualify the
new UI on5191 only after a verified database/model backup. Do not make real cable
Save, Review, Apply or initial-fill decisions on the user's behalf.
