# PF-3 — Shared project locations and model-version bindings

## Baseline and authority

Continue automatically in `C:/Users/todor.chankov/source/WFC-pathfinder-local`,
branch `pf-3-locations-local-20261018`, inheriting `3c51a00`. Read
`18-execution-resume.md`, PF-0 specification/contracts/matrix and PF-2 report.
The user resumed full local implementation on 18 October. PF-2 native parity
remains BLOCKED; this is independent contract-driven implementation, not a
successful PF-2 acceptance handoff. No original app/data changes or publication.

## Scope and direction

Implement one project location registry serving both From and To and all cables.
Use conservative NFC/trim/invariant-case lookup preserving punctuation, zeroes
and separators. Confirmed aliases belong to the same identity; collisions,
missing strings, duplicate model matches and stale bindings remain explicit.
Manual confirmed bindings take precedence. Keep identity separate from the
versioned model/object or explicit canonical-world-metre point binding.

Add independent idempotent schema installation under `server/pathfinder/`,
following the existing transactional/advisory-lock schema pattern. Use composite
project FKs, server-owned revisions and attributable audit. Revalidate on active
model/version/content/selection changes. Settings/cables are read from existing
project tables; numeric Details values remain exact decimal strings.

Every PF route/read/write uses current-role `requireAdmin`, beyond project ACL.
Writes protect project/model/dependencies and current admin through commit.
Snapshot/index ingestion is bounded and uses private server-owned files under
explicit `PF_ROOT`; callers cannot choose paths or assert engineering proof.
Imported real artifacts remain unaccepted. The dedicated cable write revision
must be server-owned and cover all manual/import writes, including A→B→A.

Coordinate stable HTTP DTOs with the frontend writer before UI integration.
Parent owns the early authenticated large JSON parser in `server/app.ts`.
Backend writer owns the new route/schema/project mount and module tests.

## Validation and reporting

Meaningful tests cover normalization/alias collisions, cross-project isolation,
manual precedence/reuse across directions, ambiguity/missing/stale/new model,
finite coordinates, concurrency/CAS, current role and denied non-admins. Run SQL
checks only against the separately created database. No synthetic test may clear
the real native gate. Record PASS/FAIL/BLOCKED/NOT_RUN and changed files in
`03-stage-report.md` and `automation-progress.md`; commit locally. Then prepare
PF-4 using the inspected implemented interfaces and continue automatically.
