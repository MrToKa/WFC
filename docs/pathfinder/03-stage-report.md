# PF-3 — Shared location registry implementation checkpoint

The registry is implemented in the isolated worktree and its contract/SQL checks
pass. Final refreshed-runtime and combined integration acceptance remains open;
this report does not complete PF-2 native validation or grant engineering Apply.
The user resumed independent all-stage implementation on 18 October 2026; see
`18-execution-resume.md`. Branch `pf-3-locations-local-20261018` inherits `3c51a00`.

## Implemented

- One project location identity with confirmed aliases serves both endpoint
  directions. NFC/trim/invariant-case normalization preserves punctuation and
  significant zeroes; duplicate model matches and missing/stale bindings are
  explicit. Manual bindings have precedence and are model-version-specific.
- Strict current-admin API, protected cookie-bound runtime authorization,
  transactional role/project/model/registry checks, private immutable snapshot
  storage, version-local object inventory and bounded canonical contracts.
- Server-owned `cable_write_revision` detects relevant manual/import edits and
  A→B→A changes without reusing the user's engineering revision field.
- Separate C# ModelRunner supervises a bounded private worker, fits immutable
  hash-bound snapshots, calculates using the unchanged Core and recalculates
  design allowances with a narrow new support API calling original math. No
  original routing source or constructor visibility changed.

## Actual verification

| Scope | Result |
|---|---|
| Matching, aliases, hierarchy, finite contracts | 20/20 PASS; `evidence/pf3/registry-20261018T014420Z.json` |
| Actual own PostgreSQL registry/revision invariants | 10/10 PASS, entire fixture rolled back; same receipt includes exact owned container/database and source hashes |
| Server TypeScript | PASS at the recorded PF-3 source milestone |
| New private C# worker, ordered lookup/reverse and ten frozen saved-design cases | Latest 38/38 PASS; `evidence/pf3/model-runner-2026-10-18T02-26-42-960Z.json`. Includes the native single-point zero-length result. Added controls ensure unassigned native-hidden, hidden-ancestor and planning-rule-excluded objects do not block eligible geometry; unknown visible planning categories still require resolution. Earlier decimal-scale failures were fixed by canonical fixed decimal output; the 32/34 run exposed two test setup mistakes (adjacent labels coalesce; native node guard is at least two), corrected without changing expected fixtures or native arithmetic. Build: zero warnings/errors. |
| Regression after adding the Core support API | Fresh 105/105 original regression and 215/215 parity/boundary PASS; `evidence/pf1/runs/2026-10-18T01-41-17-608Z/` |
| Refreshed candidate HTTP checks | 13/13 PASS; `evidence/pf3/registry-http-2026-10-18T02-03-37-380Z.json`. The initial 12/13 run's old-image alias-update 404 is resolved in the fresh image. Own fixture project/user were removed in both runs. |
| Production Node-to-C# client | 30/30 matching/engine/dependency checks PASS at the backend owner's recorded source scope; actual DLL, fixed smallest decimal, cancellation/deadline, failed zero-exit response and stable dependency hashes exercised. |
| Actual protected UI snapshot and saved point | 52-object/26-segment selected capture accepted by the strict C# reader/fitter; exact lookup/reverse and real point/alias save/reload observed. `evidence/pf7/actual-capture-1792289114650.json` and `actual-model-shared-pick.png`. This is converted diagnostic evidence, not native engineering acceptance. |
| Real native/converted engineering equivalence | BLOCKED by previously observed native entitlement failure; not retried |

The candidate is separately running on port 5190 with new DB/storage/volumes and
an independently copied/imported model. Original application containers/data and
checkouts are not modified. Runtime/Viewer/jobs changes are being implemented by
separate owners and are not accepted by this PF-3 report. The next independent
task is the PF-4 handoff, followed by PF-5/PF-6; all real-engineering acceptance
and outstanding API checks carry forward explicitly to combined PF-7 checks.
