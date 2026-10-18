# Project Details gap and manual real-result review — technical report

Status: implementation landed, coordinated verification/demonstration in progress.
Branch pf-manual-validation-settings-20261018 inherits5485283. Work is confined
to the isolated local checkout and own5190 runtime; no main merge/push/deployment.

The user's latest criteria are in
[20-manual-review-and-project-gap.md](20-manual-review-and-project-gap.md).
Required native-oracle acceptance has been replaced by manual per-proposal
review. Native comparison is not performed; it is not reported as a passing
engineering check. Human review of the new result remains pending.

## Implemented changes

- Persistent Project.connectionGap, default1metre for new and existing projects,
  finite>0<=100 validation, independent Details card with3decimal input precision.
- Current project gap overrides caller/old-job tolerance in automatic routing,
  explicit calculation and ordered lookup. Gap changes participate in effective
  options/geometry dependencies and force rerouting/stale old proposals.
  The three design allowances stay authoritative in Details; allowance-only
  changes reuse successful geometry and recalculate design length.
- Existing Automatic cable length calculation card distinguishes the old
  tray-list estimate and exact PathFinder formula/current3allowances. Actual
  gaps are already included in geometry and are not added again.
- Existing strict-admin Confirm review + Apply now supports real-model manual
  review. Real engineeringAccepted remains false; provenance records actual
  review actor/time/hash and acceptanceScope manual-review/nativeParity not-performed.
  Legacy unclassified reviews cannot silently authorize this new acceptance path.
- Existing current-role/login/project/model/artifact/registry/cable revision
  fences, cancellation, atomic history/receipt, idempotency and installLength
  preservation remain. No blanket model-acceptance flag was introduced.
- Cleanup helper supports only a fully verified older same-owner/project backup
  after its verified replacement, exact regular payload files only, preserving
  manifests/markers and refusing root/sibling/escaped/junction paths. Historical
  denied children and original resources remain untouched.

## Verification at the current source milestone

| Scope | Actual observation |
|---|---|
| Backend process/settings/registry |51/51 PASS:20matching,15settings,16actualNode/.NET; gap0.5m disconnects at0.25 and connects at1; original formula remains exercised |
| Server build |PASS, TypeScript0errors |
| Existing server project/access/cable regressions |191/191 PASS:10projectRoutes,4projectChangeLog,137middlewareaccess,40cable/history/export/length |
| Frontend before final eligibility guard follow-up |147/147 PASS across8files; TypeScript/targetedESLint PASS; follow-up eligibility guard is checked separately before image build |
| Runtime cleanup ownership/path controls |17/17 PASS; script syntax/whitespace PASS |
| Coordinated final API/SQL |NOT_RUN yet; expanded23-case own fixture driver waits for new image |
| Computer-use final UI |NOT_RUN yet; existing UI inspected before rebuild, new card not yet deployed |
| Replacement backup/restore |NOT_RUN yet; prior verified backup43365396 retained until replacement passes |
| Native comparison |NOT_PERFORMED / NOT_REQUIRED_BY_USER; no native host/licence retry |
| Human manual route/length acceptance |PENDING; technical QA does not impersonate user acceptance |

Final source/image identities, receipts/screenshots, demo and cleanup results
will be added after their actual execution. Original11Core source bytes and
frozen expected fixtures are unchanged; no PF-0 receipt generator is rerun.
Whole-plant capture/capacity and reusable graph preparation remain separately
unimplemented/unverified at the scopes already reported, not implied by this
settings/manual-review revision.
