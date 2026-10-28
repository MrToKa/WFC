# PF-7 — Local integration verification

The independent application workflow is implemented and checked in the isolated
local installation. Native engineering acceptance and whole-plant capacity are
still open gates. This report distinguishes them from actual local technical
passes. The final candidate derives from c95ad56 on
`pf-4-viewer-local-20261018`; the local delivery commits/progress record bind
the completed source and later operations evidence.

## Final observed results

| Scope | Actual result and evidence |
|---|---|
| Unchanged eleven-source Core | Fresh105/105 original regression +215/215 parity/boundary PASS;43 frozen cases unchanged; PF-1 run `2026-10-18T01-41-17-608Z` |
| Strict ModelRunner |38/38 PASS, zero-warning Release build; `evidence/pf3/model-runner-2026-10-18T02-26-42-960Z.json`; exact decimal/lookup/Reverse/design/cancellation and one-point result |
| Registry HTTP |13/13 PASS; `evidence/pf3/registry-http-2026-10-18T02-03-37-380Z.json`; disposable project/user removed |
| Backend process/registry checks |34/34 PASS; `evidence/pf5/engine-registry-20261018T022600Z.json`; legacy cables40/40 PASS, server TypeScript PASS at recorded source |
| Final live SQL/HTTP |20/20 PASS on API562e8073; cleanup PASS; `evidence/pf5/verification-final-20261018T023201Z.json`, detailed jobs/Apply receipt same timestamp |
| Final frontend |71/71 PASS: API4,hook6,PFtab14,controller17,legacyRoutings30; frontend TypeScript and targeted ESLint PASS; [PF-4 report](04-stage-report.md) |
| Protected runtime |104/104 PASS including exact overlays, one-point protocol, zero-ID Ghost, restoration, picking and capture; separate runtime ownership safety9/9 PASS |
| Browser authorization/workflow |Actual admin/non-admin engineer deep links; protected capture/pick/manual save/reload; shared missing identity resolves both directions; automatic2/2, explicit review/Apply/history PASS in initial computer-use receipt |
| Final browser rendering |Real selected-network lookup/Reverse, bright yellow exact path, original tray colors, filled Ghost; synthetic zero-ID Ghost, readable review, one-point0m/design7m, restored10m/design18m and Clear PASS; `computer-use-final-20261018T0237Z.json` |
| Details-only recalculation |UI reserve6→7→6 yields18→19→18 from retained10m geometry; server calculationMode design, previously applied cable18 unchanged; `settings-reuse-1792289459485.json` and `settings-reuse-1792289487640.json` |
| Actual converted capture |52 objects/26 fitted segments; strict C# lookup35.30345579516123m,4 gaps/0.9840583861033791m with explicit1.0m diagnostic tolerance; `actual-capture-1792289114650.json`; diagnostic scope only |
| Large artifact transport |Final-image4controls PASS: current-admin204, body-free unauthenticated401, over256MiB413, actual11MiB invalid snapshot reaches backend400; `runtime/artifact-transport-1792290628158.json` |
| Offline scope |`offline-scope-1792290651968.json` PASS: local assets, CSP self, local/offline Viewer, analytics disabled, API only internal Docker network; host network disconnect NOT_RUN |
| Preservation |`isolation-1792289542491.json` PASS on its source scope: pins/frozen fixtures, three original checkouts/dirty files and13 original container identities/images/start times. Final PF-8 audit follows |
| Operational recovery |Final combined cold backup/restore, session fencing and actual .NET-child crash/recovery recorded separately in [PF-8 report](08-stage-report.md); do not infer PASS from prepared tools |

Evidence filenames without prefixes above are under `evidence/pf7/`.
Historical failures remain in their original receipts: first-image empty-ID
Ghost/text spacing, weak yellow line, earlier test setup/old-image alias issues.
Fresh final checks resolve their stated scopes; they do not alter history.

Final actual candidate images:
API `sha256:562e80739ed2c105f280a8f460ba449b26aaa6a7a63bcb9b311ff58345407a01`;
web `sha256:81bb13b4c3370c903e364503f99ef28341fa840e6c451adf9b5163281fd345cb`.
The source manifest `sources-1792290715644.json` binds805 nonignored source
files at SHA256630817060c5bee1e7701fa03b8c82f05129715ba12c5464dcd7d81d45606e6f6.
Later documentation/operations changes require their own commit/audit evidence.

## Transaction and review findings resolved

An independent review found project-row FOR UPDATE could deadlock with mixed
cable imports/user assignment through project foreign-key KEY SHARE locks.
All PF project mutexes now use FOR NO KEY UPDATE. Actual two-connection
concurrency controls pass. Current role/login expiry, model health and input
dependencies remain fenced through Apply commit. Receipt insertion failure
rolls back the cable write; distinct same-value Apply advances the server-owned
write revision while idempotent replay does not.

Twenty live controls cover shared From/To matching, Instrumentation→Control,
10m/design18m, installed99 preservation, atomic history, idempotency/mismatch,
manual/settings/model-selection A→B→A staleness, current-role and login denial,
cancelled-job persistence, expired-owner recovery, rollback, auth/model-health
serialization, late login expiry, synthetic-proof spoof refusal and native
ordered lookup/reverse/manual retry. The PF-8 crash drill separately tests a
real worker death; expired-lease SQL controls alone are not that proof.

## Remaining engineering and scale gates

Native Automation failed0x80080005. The separately started Manage2027 CLI exited2
with NOT Authorized / entitlement not found before producing an oracle.
No licence, account, registry or installed-plugin changes/repeated retries were
made. Same-source full-precision native/converted identity, visibility,
categories, fitting, topology and full calculation parity remain **BLOCKED**.
HTTP cannot mark a captured artifact accepted. Only an exact trusted synthetic
CLI fixture may exercise local Apply.

Captured mesh is a selected network, not a full plant. Explicit diagnostic
Control assignment is not established engineering classification. The fitted
cache is reused, but the endpoint-dependent graph is rebuilt for each query;
reusable graph preparation remains **NOT_IMPLEMENTED**. The reviewed source
constraint and possible next approaches are in
[19-graph-preparation-review.md](19-graph-preparation-review.md). Whole-plant
completeness/performance and representative paired path/design parity are
**NOT_RUN/BLOCKED**, not inferred from synthetic checks.

Ceilings include64MiB capture/3000events,256MiB snapshot,10000cables/job,
120s private calculation,32MiB response,20000Viewerpoints/512objects and
Apply compatibility8000characters/100ordinarysegments. Oversized outputs are
rejected rather than truncated; these bounds do not establish production scale.

No push, PR, merge, deployment or original application/data update occurred.
Local technical delivery and explicit user acceptance remain separate.
