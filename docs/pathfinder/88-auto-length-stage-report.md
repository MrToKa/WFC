# PF-B7a — Immediate read-only Path Finder length

Product: `d5cec2b00cb4815add3a9dd4ec8bffef26e13b24`, branch `pf-b7a-auto-length-local-20261021`, inheriting
B7 documentation `d1310b8` and protected-writer product
`34c603c709742e94788077efef54fab7ca37e824`. Technical delivery only; human
engineering acceptance and the actual civil-model checks remain separate.

## Result

Auto calculated length now comes from the exact successful Path Finder result,
including its original C# design-length text, checked barrier execution and length
ledger, immutable proposal and revision seal. It is published with the completed
cable item, before the final transaction authority/cancellation/lease checks,
without waiting for unrelated siblings or human Apply. It changes no cable
business field, cableWriteRevision, history, Design or Installed length.

Three separate tables retain server admission order, latest per-cable target and
last successful value. Manual, automatic, location-impact and all-blocked new
admissions share one order under the existing project mutex. Older completion,
including after a newer failed request, cannot replace the new target. Exact
replays retain their order/source; historical jobs are not backfilled. A legitimate
pre-feature v8 job finishes without a new Auto value. Retained dependencies must
match the original item, and a replay uses the stored result/seal rather than a
fresh engine response. Publication/physical-fence/authority failure rolls back.

The public projection is five small fields: value, last source time, recorded
request state, drilling label and whether the source matches the latest admitted
request. It exposes no model/object/source identifiers, geometry, coordinates or
authority. Ordinary authorized cable readers use bounded set-based SQL, without
PF admin access, geometry collection or an automatic job. They see no invented
value before a checked result. A prior success remains visible through a later
pending/failed/blocked request with an explicit status. Terminal failures are
reported per item while siblings still run.

Freshness is deliberately conservative: a completed value is **last successful**.
Ordinary reads do not revalidate live geometry or implementation files. The UI
instructs recalculation after model/settings changes; latest-request matching does
not claim current Review/Apply eligibility. Strict protected write gates remain
unchanged. Calculation-only authority gains no human Review/Apply authority.

Cable details and Cable list show a separate read-only Auto field/column; the
legacy client tray estimate and fallback were removed. Auto is excluded from
editable payloads/templates/import mapping; injection is rejected by strict cable
validators. Ordinary export can include Auto as output. Design retains its manual
editor/import/MTO behavior. Both-blank Save-triggered initial fill remains; existing
or partial Routing/Design require human Review/Apply together. Installed length
is preserved. Old saved column selections remain intact. Generic cable mapping
stays business-only, preserving drawing v1 input hashes.

The selected Path Finder popup refreshes the normal cable projection once per
exact successful selected result, including an eligible sealed item while its
batch runs. Account/project/cable/proposal changes fence late responses. A15s
client deadline reports unavailability without resubmitting writes or refreshing
the model. The underlying ordinary transport currently has no AbortSignal; its
late response is discarded. An explicit refresh is available. Viewer/From/To,
yellow route, Ghost and the protected bridge are unchanged.

## Actual verification

Root executed every check in the isolated checkout. Groups overlap and must not
be summed as a unique system total. Logs and private archives remain under
`pathfinder-engine/.scratch/barrier-auto-length-20261021-2c5ad8a7-04c2-477d-a186-575c6f5d8899`.

| Scope | Result | Evidence |
| --- | --- | --- |
| Auto contracts/store, ordinary model/API and immutable admission/seal baseline | PASS154 | core-check2.log, before later historical-skip cases |
| Exact store + actual worker control flow + actual owned PostgreSQL | PASS94 | sql-worker-check3.log; includes18 actual SQL cases |
| Actual HTTP/JWT/current roles/project gates + ordinary SQL | PASS12 | http-check8.log |
| Drawing input, historical worker/recovery, baseline downstream regression | PASS126 | regression-check8.log; separate route import failure corrected below |
| Existing Cable route handler regression | PASS12 | cables-regression9.log |
| Personal columns and account preferences | PASS28 | preferences11.log |
| Results / popup / Auto display / normal-read hook UI | PASS105/30/11/5 | ui-check2.log, these four groups passed |
| Cable details/list/Details UI | PASS22 plus two corrected focused passes | ui-affected-check4.log; ui-final-affected9.log; ui-detail-final10.log |
| Tab Auto projection integration seam | PASS1;60 skipped | tab-seam-check8.log; unchanged B7 full60-case evidence reused |
| Server/client type checks | PASS | server-types-check7.log; client-types-final11.log |
| Server build / isolated production web build | PASS | server-build10.log; web-build10.log |
| Changed-source lint / final test lint / whitespace | PASS | lint10.log; test-lint-final11.log; git diff --check |
| Actual owned database archive/restore and admission sequence | PASS | sql-restore6.json/log |
| Browser / actual Aalborg civil capture /2140 real capacity / native parity | NOT_RUN | separate B8 gates; saved browser refusal preserved |
|5191/original update / real-data Apply / push/PR/merge | NOT_RUN | no such operation performed |

SQL18 uses actual production registration/publication/sealer, transactions,
revision trigger and login/admin fences with explicit synthetic geometry/currentness
adapters. Worker tests execute its real control flow over documented mocked database/
authority/engine seams. HTTP12 uses an ephemeral127.0.0.1 server, actual JWT and
current database role/project middleware and real compact Auto SQL, with explicitly
seeded synthetic scalar source metadata. It does not independently prove the engine
producer, civil geometry or a deployed application. Full v8 grant/runtime qualification
remains B8; neither the sidecar nor HTTP grants a new business write capability.

The archive/restore check preserved all17 synthetic fixture tables, including all
three Auto tables and the exact source value. It retained sequence state28 including
gaps; a new restored admission generated29 and fenced the prior value without
changing its number. A restored login binding was explicitly revoked and refused.
This is not the full installation-epoch/grant/JWT/model recovery drill required by
B9. Dynamic all-public-table inventory already discovers the new tables; table
inventory alone does not prove identity sequence state. The owned55442 container
was retired after full ID/owner/stage/image/loopback-port/tmpfs-only checks. Private
dump/configuration/evidence remain; no original/5191 resource was managed.

Initial failures remain recorded: obsolete admission test mocks, a handler test
import requiring unused configuration, accidental discovery of scratch draft tests,
three nullable provenance types, eight5s Fluent/jsdom deadline failures, stale DOM/
dialog accessibility assertions, one saved-selection order assertion, an incorrect
SQL sort alias in the restore helper, and missing reset of minimal HTTP fixture
tables. Corrections preserve production constraints. Affected UI checks used a
bounded20s test deadline; no global timeout/production limit was increased. Build
retains ordinary Vite chunk-size warnings; this is not a browser performance claim.

## Continuation

Original WFC remains clean main `96e63f13fdc2b1d30b8f8ff658dd662f25fac104`, matching
live GitHub main inspected2026-10-21 17:16:22–17:16:23 UTC. Stage PR search returned
no results; CI NOT_RUN. All work is local. No pinned C# or frozen PF0 expected data
was changed. Denied scratch paths/parents, original checkout/data and5191 are preserved.

Prepare and execute PF-B8 immediately using plan78/matrix79 and the new product
revision: full independent numerical/bridge/security qualification and meaningful
bounded production-v2 synthetic workload, then exact actual-capture limitations.
Do not relabel synthetic evidence as the Aalborg counterexample, whole-project
capacity, native parity or human acceptance. B9 delivery/recovery remains gated.
Simplified Preparer remains queued after current PF implementation/checks.
