# PF-8 continuation — fresh UI data-preservation investigation

Technically verified scoped delivery on isolated branch `pf-8-ui-preservation-local-20261018`, base
`7aedfe0b0b14b38ba58bc20ef40599403d4114c6`, handoff
`e275dd5ee61adb339649a63cd2695dcabcec10f7`.
The [assignment](handoffs/PF-8-ui-preservation.md) separates automatic cable
proposal publication on entering Path Finder from standalone Path preview and
explicit Review/Apply. This stage investigates a remaining concrete proof gap.

## Historical observation remains unchanged

[Report25](25-private-worker-reuse.md) final disposable-target comparison remains
FAIL_NOT_RETAINED: its mismatch detail was lost before erroneous retirement.
A new successful reproduction cannot recover, explain conclusively or relabel
that historical observation. Existing5190/original preservation passed separately.

Source inspection suggests a testable hypothesis: mounted Results automatically
submits a cable calculation, with deduplication scoped to current actor/login.
A fresh browser login can therefore add a proposal legitimately. A proposal is
not Apply. This is not yet a measured cause; expected and forbidden writes must
be established from actual fresh checkpoints and current causal provenance.

Independent read-only source review at e275dd5 establishes the exact expected
contract, not a new runtime PASS: existing pf_proposals rows are immutable by DB
trigger; stale/canApply are derived DTO fields. A0→A1 may append an automatic
calculate job, items and new proposals. This exact QA already has aliases and
current manual bindings, so registry.match must preserve registry/locations/
aliases/bindings/events. A1→A2 standalone preview writes a preview-kind job and
pf_lookup_results, without cable items/proposals. There is no pf_previews table.
A2→A3 Clear is local/Viewer state only, not SQL cancellation. Quiescence must
observe all project jobs/items and stable snapshots spanning a15second scan.

## Current checks

| Check | Status |
|---|---|
| New helper/diff/ownership/failure-receipt focused controls | PASS34/34; independent source review closed |
| Fresh verified own5191 restore/current source image/session readback | PASS targetf673a0facba3/APIe0a6d742/web5abc6002; exact runner/worker/session bytes match prior qualified artifact |
| A0 before browser/A1 after automatic work/A2 after standalone/A3 after Clear | PASS actual four phases with separate>15s quiescence observations |
| Allowed changes trace to current authorized job; protected business/Review/Apply state preserved | PASS:initial1calculatejob+1item+1proposal; standalone1previewjob+1lookupresult; Clearzerochanges |
| Actual protected browser result/Ghost/Clear screenshot | PASSvisual at originalweb5abc; newweb577e Clear notice/drafts PASS, separate display limitation below |
| Minimal owner-loss notice correction | PASS5selected regressions, frontend types/lint, independent source review and web-only build |
| Additive C0/C1 read-only data preservation after web-only replacement | PASS; one new preview job/result only, same login and fixed API/modules |
| Evidence-before-disposition retirement and final primary preservation | PASS gated retirement, exact3unusedimages, final12primarypreservationchecks |

Only a minimal source correction for the actually reproduced stale Clear caption
is included after the four-phase observation; backend/math/schema changes remain
excluded. No engineering Review/Apply, main integration or original app update.
Native comparison is not mandatory
under the user's decision; engineering route/length acceptance remains human.

## Actual four-phase result

The [34-control/startup receipt](evidence/ui-preservation/startup-1792333377210.json)
and [independent source review](evidence/ui-preservation/independent-review-1792333489169.json)
bind the audit/diff/phase-chain/quiescence/retirement helpers. Source-only findings
were corrected before actual capture; no failing engine execution is invented
from a source review. Quiescence is sampled stable observation across the15second
automatic scan, not a permanent-silence claim.

- [A0](evidence/ui-preservation/A0-1792333406131-a63b7b97.json): before fresh UI
  login/mount, real QA cable1/proposals5/reviews3/Apply0. Twenty terminal jobs;
  no pending work. Raw bytes durably saved before parsing/classification.
- [A1](evidence/ui-preservation/A1-1792333525287-a9aa9160.json): after ordinary
  UI mount and19,910ms stable observation, exactly one calculate job, one cable
  item and one proposal added. This run used valid design reuse. Current role/
  login and exact model/latest artifact/Details/shared bindings/request hashes
  match. All existing proposals and protected business/Review/Apply rows unchanged.
- [A2](evidence/ui-preservation/A2-1792333640071-3c3473c8.json): after one ordinary
  standalone Path and19,578ms stable observation, exactly one preview-kind job
  and one pf_lookup_results row added; zero cable items/proposals/business edits.
  Its exact fresh route is35.30345579516123m/design45,4gaps totaling
  0.9840583861033791m, both approaches0. Both new jobs share the same current
  actor/login fingerprint; authentication records are not exported.
- [A3](evidence/ui-preservation/A3-1792333808133-c3974b4a.json): after one Clear
  and a third stable window, zero changes in all12workflow and6auxiliary groups.
  Clear does not cancel/delete server jobs or mutate the cable/proposal/result.

The [24-check aggregate](evidence/ui-preservation/summary-1792333892454.json)
rereads and verifies saved raw/diff hashes and existing exact qualified binaries.
It is separate from34unit controls. A0→A3 has only the bounded automatic proposal
addition plus standalone job/result; final cleanup/primary preservation are held
until the caption follow-up. This demonstrates a valid explanation shape in a
NEW run; it does not diagnose the old lost comparison conclusively or change its
FAIL_NOT_RETAINED status. A blanket unchanged-proposals assertion across this
automatic-calculation UI visit would be the wrong acceptance predicate.

## Actual UI and caption follow-up

[Computer-use observation](evidence/ui-preservation/browser-observation-20261018T1429Z.json)
records a fresh ordinary login, one mount, one Calculate and one Clear. Filled
Ghost, original route colors, yellow line, exact metrics and opaque whole-model
restoration pass. [Completed route](evidence/ui-preservation/path-result-20261018.jpg),
[stable context](evidence/ui-preservation/path-stable-20261018.jpg) and
[after Clear](evidence/ui-preservation/clear-result-20261018.jpg) are actual images.
A separate full-page shot caught temporary Rendering/incomplete background and
is retained but not used as a Ghost PASS; the normal viewport subsequently
renders completely.

After Clear, the local success notice still says the standalone path is displayed.
Source cause: Preview's displayOwned=false effect resets result/job/generation
but omits its notice reset. The same omission exists in Lookup and Results.
The minimal consistent correction adds notice clearing to these three owner-loss
effects, preserves drafts/options and adds relevant existing-suite regressions.
The [focused verification](evidence/ui-preservation/clear-caption-verification-1792334626800.json)
records five selected Clear regressions PASS (46 unrelated cases filtered),
frontend TypeScript and four-file lint PASS. The pre-fix run has three actual
stale-caption assertion failures; a separate intermediate Fluent accessible-name
test assertion failure remains preserved. Neither is relabelled as engine failure.
Read-only source review found no material issue in the three notice setters;
existing generation/operation fences and drafts remain unchanged.

[Web-only build](evidence/ui-preservation/web-build-1792334544751.json) and
[start](evidence/ui-preservation/web-start-1792334601306.json) bind the exact
three source hashes to new web image577e040f. APIacc437/imagee0a6, PostgreSQL,
MinIO and storage-ready IDs/images/start times/states are unchanged. The browser
caption check and additive read-only data check are recorded separately below.
Original A0–A3 retains web5abc6002; those historical image bindings are not widened.

[C0](evidence/ui-preservation/C0-1792334390995-69802d93.json) is equal to A3
before rebuilding. [C1](evidence/ui-preservation/C1-1792334796719-96a78df3.json)
permits only the declared web image replacement and exactly one further complete
preview job/result, with the same login fingerprint, unchanged API/module bytes,
all existing rows and protected12groups. Raw/diff bytes precede classification.
Five additive binding controls pass; the frozen34original controls were not rerun.

[New-web browser observation](evidence/ui-preservation/caption-browser-observation-20261018T1445Z.json)
records one Calculate while the Viewer was still loading: the correct computation
completed and the defensive retained-result caption appeared. This attempt does
not establish a new-web route/Ghost display PASS. After Viewer readiness, one
Clear removed that caption, result and Reverse button and retained From/To,
Control, trigger2 and vertical preference. The opaque whole model and all three
tabs remain visible in [the fixed Clear screenshot](evidence/ui-preservation/clear-caption-fixed-20261018.jpg).
The source change only clears notices; earlier actual Ghost evidence retains
its exact earlier image scope. No retry, engineering Review or Apply occurred.

The owned temporary browser tab was closed. A [durable parent disposition](evidence/ui-preservation/parent-disposition-20261018T1447Z.json)
releases only the now-unneeded own5191 target after those accepted checks and
saved evidence. The needed5190 demo, verified archive, exact binaries/private
rows/diffs and all seven denied scratch children remain preserved.

## Closure and remaining work

[Gated retirement](evidence/ui-preservation/retirement-1792334898544.json) removed
exactly the own5191 target's5containers,4volumes and2networks after the disposition.
[Image cleanup](evidence/ui-preservation/image-cleanup-1792334959364.json) removed
three exact unreferenced same-owner image IDs, summed logical size294,832,567bytes.
Physical disk reclamation is NOT_MEASURED because image layers can be shared.
No filesystem deletion, generic prune or original/primary lifecycle action occurred.
The seven previously denied scratch children and their parents remain untouched;
the latest406byte child removal was rejected by automatic approval review with
reason `blocked by policy`, not retried or bypassed.

The [final primary/source preservation audit](evidence/worker-reuse/preservation-1792335003878-dfe1b66c.json)
passes12checks after retirement: all18baseline container identities/images/start
times, original checkout pins/dirty-state fingerprints, retained inputs and the
existing5190 twelve workflow group hashes are preserved. Its existing fixed
source5190 read-only audit performs no original database query. No original
application/source/data modification, push, PR, merge or deployment occurred.

This closes the scoped fresh investigation and actual caption correction. It
does not erase stage25's lost comparison or establish engineering acceptance,
whole-plant computational coverage, literal once-prepared graph reuse, or a new
577e Ghost visual result. The retained5190 demonstration remains on its previous
image; this stage's candidate fix is in local source and retained exact web assets.

Next useful authorized work is a separate PF-3 real-input coverage stage. Available
[source/file feasibility](evidence/ui-preservation/next-input-feasibility-20261018T1434Z.json)
does not establish current business data: the template has2027rows but no HPU/MTO
provenance. A minimal original read-only consistent snapshot can verify the actual
HPU project, active model fingerprint and From/To/MTO inputs without importing or
writing anything. Full retained tree/property data can then establish candidate
name coverage separately from geometry/native visibility/category readiness.
No source database access was performed in this completed PF-8 stage. A new
self-contained handoff and inheriting local branch precede any such next action.
