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
| New private C# worker and ten frozen saved-design cases | 26/26 PASS; `model-runner-2026-10-18T01-40-33-295Z.json`. Earlier 24/26 run retained; canonical G29 output fixed the two decimal-scale representation differences. Arithmetic/expected fixtures unchanged. |
| Regression after adding the Core support API | Fresh 105/105 original regression and 215/215 parity/boundary PASS; `evidence/pf1/runs/2026-10-18T01-41-17-608Z/` |
| Initial candidate HTTP checks | 12/13 PASS. Unauthenticated/admin/engineer/project-boundary/CAS checks passed; alias-update endpoint returned HTML 404 in the earlier built image. Current source includes the new route; fresh image/runtime retest is required, not a claimed PASS. See `registry-http-2026-10-18T01-46-05-953Z.json`. Own fixture project/user were removed. |
| Real native/converted engineering equivalence | BLOCKED by previously observed native entitlement failure; not retried |

The candidate is separately running on port 5190 with new DB/storage/volumes and
an independently copied/imported model. Original application containers/data and
checkouts are not modified. Runtime/Viewer/jobs changes are being implemented by
separate owners and are not accepted by this PF-3 report. The next independent
task is the PF-4 handoff, followed by PF-5/PF-6; all real-engineering acceptance
and outstanding API checks carry forward explicitly to combined PF-7 checks.
