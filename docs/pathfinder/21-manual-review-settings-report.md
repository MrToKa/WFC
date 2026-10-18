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
| Frontend before final eligibility guard follow-up |147/147 PASS across8files; TypeScript/targetedESLint PASS; final eligibility follow-up17/17 PASS. Deferred Review selection follow-up in progress, not yet part of this result |
| Runtime cleanup ownership/path controls |17/17 PASS; script syntax/whitespace PASS |
| Coordinated API/SQL at873afeb/e884 image |23/23 PASS and fixture cleanup PASS; [receipt](evidence/manual-settings/live23-20261018T063814Z.json). A later bounded DTO eligibility change will require a new candidate and live run |
| Computer-use at873afeb/e884 +a71 images |PASS: separate default1 card, invalid0 refusal,0.25 persistence/reload, restored1, formula/current allowances, read-only lookup gap, actual manual proposal/Ghost/yellow, explicit Review enables Apply and reload resets it. [Receipt](evidence/manual-settings/computer-use-before-review-fence-20261018T0648Z.json) |
| Replacement backup/restore |NOT_RUN yet; prior verified backup43365396 retained until replacement passes |
| Native comparison |NOT_PERFORMED / NOT_REQUIRED_BY_USER; no native host/licence retry |
| Human manual route/length acceptance |PENDING; technical QA does not impersonate user acceptance |

Final source/image identities, receipts/screenshots, demo and cleanup results
will be added after their actual execution. Original11Core source bytes and
frozen expected fixtures are unchanged; no PF-0 receipt generator is rerun.
Whole-plant capture/capacity and reusable graph preparation remain separately
unimplemented/unverified at the scopes already reported, not implied by this
settings/manual-review revision.

## Real converted demonstration

The own copied project PF-LOCAL-DEMO contains PF-MANUAL-DEMO, a clearly named
QA cable whose shared From/To aliases use actual first/last canonical points
from the recorded selected-network lookup. These are not claimed business
equipment identities. The captured artifact has52objects/26segments, SHA256
df1b67a0c832e9eed426d4f00741373616b4738f0520b65eb3ff3898c9fd2640.

Current explicit example settings are gap1m, SECONDARY3m, end reserve5m and
bending10%. Only gap1m is the newly requested general default. Actual route
length35.30345579516123m,90points, four measured gaps, design45m; no SECONDARY
replacement is needed for its zero-length endpoint approaches. The measured
gap total0.9840583861033791m is already represented in route geometry and is
not another additive allowance. See the [actual seeding/calculation receipt](evidence/manual-settings/real-demo-1792305637264.json)
and [user guide](08-local-user-guide.md).

The first QA seeding attempt received400 because project cable types require
a linked material catalogue type. The helper was corrected to create/link its
own clearly named local QA type before the cable. The successful retry revoked
its own login and recorded no credentials. That failure was not an application
routing failure and is not reported as a passing attempt. The helper change is
test tooling, outside production image inputs. No Apply was performed on this
real demonstration; the actual23-case disposable fixture separately exercises
the manual-review write/provenance/idempotency path.

## Final review follow-ups in progress

A deferred frontend Review response was shown to restore an old cable's panel
after selecting another cable. In that reproduced case Apply remained disabled;
there was no observed Apply authorization bypass. The assigned fix fences the
completion by current selection/proposal/dependencies and prevents late success
messages appearing under another selection.

Read-only review also found DTO canApply could invite review for a design above
the existing WFC1,000,000m write limit; Apply already rejected it safely. The
assigned bounded correction makes proposal eligibility display the same limit.
Both follow-ups require their affected tests, one coordinated rebuild, repeated
live fixture controls and brief final UI verification before the operational
replacement backup and cleanup. No final completion is claimed by this draft.
