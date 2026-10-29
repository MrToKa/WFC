# PF-B13e — durable producer completion and selected-object identity repair

Status: **TECHNICAL SOURCE PASS** on branch
`pf-b13e-producer-completion-local-20261022`, parent
`9685d2e99d0b4f76241c8d0d53da66d30af9b811`. The accompanying sanitized
`evidence/barriers/b13e-completion-and-identity.json` pins checked source.
No application router/schema initialization, 5191 installation, barrier head or
real cable write occurred during these source checks.

## User-priority repair

The user showed a visible loaded model while obstacle saving said to wait for
loading. Source inspection found a concrete SDK API/filter defect: legacy
Model.getBulkProperties discards needsExternalId, while propFilter:[] excludes
externalId in the property worker. Parent identity rows can consequently be
missing before geometry capture starts. Capture now requires getBulkProperties2
with `{propFilter:['externalId'],ignoreHidden:false,needsExternalId:true}`.
There is no legacy fallback that silently drops the identity guarantee.

This is backed by exact pinned SDK7.130.0 source: viewer3D.min.js line55,
SHA2562833d5c53d250f56a59b86f22491a972486b30fd90a103bce8310dcaa970fa5b;
lmvworker.min.js line2,
SHA2569637ed11308c549b6dbd290d6270e53587122ebb5ffd7f87987ea9a8f897f46a.
Tests independently check these anchors and require the correct call/options.
This is not actual SDK execution or proof of which branch failed in the user's
specific browser attempt.

The prior GEOMETRY_NOT_READY message also conflated several causes. New closed
diagnostics distinguish unavailable tree, unavailable external identity, empty
selected parent, initially nonresident mesh and mesh loss during verification.
The legacy message no longer assumes loading or promises that waiting/retrying
will fix it. SDK error text remains private. Caps, completeness, selected hidden
geometry policy and all currentness checks remain intact.

The user explicitly reprioritized: deliver this repair for testing first, then
fix the cable popup's changed-location Save/recalculation flow. The next stage
follows that order. The full large-parent barrier task remains unfinished.

## Producer completion foundation

Doc102 freezes a separate producer-reported witness. Native terminal evidence
can only follow the final post-part-ACK hierarchy/frame checks and cleanup.
Runtime waits for clean iterator EOF, rejects premature/duplicate/trailing
events and then awaits the exact durable receipt. Four seals and part counters
alone cannot complete the process.

Native transport and server independently compute a bounded ordered chain of
exact stored part receipts. Server completion checks current cookie/admin/login,
Viewer/model/load/frame/head, immutable context/deadline, four seals, exact plan
and contiguous original part revisions/receipts. An immutable completion row and
command receipt advance session revision once without quota/lease renewal.
Session/status stay staging / NOT_VALIDATED / NOT_MEASURED / authority none.
Cancellation invalidates current retrieval; historical exact reconciliation
remains separately fenced. Generic repositories lacking a protected context
adapter cannot complete. Reconciliation now explicitly discriminates completion
from cancellation. Native reconcile also sends the schemaVersion required by
the existing server reader; that guard was not relaxed.

## Actual checks

| Root-executed check | Result |
| --- | --- |
| Shared session/completion contracts | PASS22 |
| Context/routes/repository units | PASS63 (25/27/11) |
| Final native/diagnostic/bridge/closure cohort | PASS212, zero skips |
| ViewerController and barrier hook | PASS143 (94/49) |
| Exact frontend installer guards | PASS16 against current814475f9 baseline |
| Fresh Linux/PostgreSQL and cookie HTTP | PASS34 (repository24 + actual cookieHTTP10) |
| SQL fixture source/copy bookends | PASS53; own helpers and network positively removed |
| Complete types, scoped lint, server/frontend builds | PASS; existing large frontend chunk advisory retained |
| Independent source review | CLEAR |

The HTTP lane uses a real bounded loopback listener, PostgreSQL, current scope,
cookie login/admin guards and actual storage over synthetic prepared metadata,
with no principal/current-scope mocks. It exercises full four-stream staging,
an opaque part, completion/refresh/replay/reconcile, wrong roots/chain and actual
role/login loss. Its completion receipt is not a mesh-validation receipt.

Retained failures: first native205/209 failed because four old adapter fixtures
omitted the now-required model descriptor; repaired fixtures pass without
weakening production checks. First typecheck found eight nullable/union narrowing
diagnostics; explicit return-fail guards and a stable binding fixed them.
First SQL33/34 failed while physically staging101 parts exceeded the60s fixture
ceiling. No timeout was raised. The corrected101-row keyset case explicitly seeds
bounded synthetic allocation/receipt metadata in one joined isolated transaction
and invokes the real completion reader. It demonstrates keyset traversal, not
101 uploads/fsyncs or storage/full-model capacity. Physical staging remains
covered by the other cases. Both actual fixture attempts positively cleaned up.

Private operation6d9b964c-5161-493f-ae85-e00377e324da retains source snapshots,
all logs and failures. The dependency image was reused from its recorded prior
owner/build; no new dependency build is claimed. Frontend inventory236files /
83426037bytes includes unchanged206SDKfiles /82552768bytes.

## Still required

The server cannot independently attest SDK bookends from a same-cookie report.
Completion provenance remains protected-producer-reported; sdkSourceBytesVerified
is false. Full cross-part geometry/coverage/catalog and surface/solid policy,
512MiB cold/warm queries, exact-own-endpoint first exit/final entry, atomic
publication, result/write-proof/UI integration and actual Aalborg qualification
remain required by plan96. No whole-RVM or bounding-box self-exemption is added.

Actual browser/SDK/Aalborg verification remains BLOCKED by the saved browser
refusal, with no retry/bypass. The reported specific browser failure is not
independently attributed. Whole-parent v1 capacity is still insufficient.
Current runtime remains web814475f9/APIac0d16ab until separately owned frontend
delivery. Main5180/5190 and original databases/models were not operated.

Next: apply prepare-stage-handoff, deliver the verified SDK identity/diagnostic
repair to5191 first with exact ownership/rollback/unchanged API checks, then
repair the popup's endpoint-only Save coupling. Do not enable unverified route
calculation or Apply as a shortcut. Resume remaining global obstacle stages and
the separate Simplified Preparer queue afterward under the existing authorization.
