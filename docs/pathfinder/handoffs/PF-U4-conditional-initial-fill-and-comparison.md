# PF-U4 — conditional initial fill and ordered routing comparison

**READY / executing under the user's standing authorization.** Baseline observed
2026-10-20: U3 source `00b4bcc0550ec785d8bfc09bc0dd4975a32e0b60`, branch
`pf-u3-scoped-location-recalculation-local-20261020`, report64 and
`evidence/cable-workflow/u3-actual.json`. Final872synthetic42files +20actualPG2files
PASS, frontend/backendtypes/allchangedlint/diffPASS. All agents frozen. OwnU3
fixture retired and generated credentials removed. 5191/fullengine/visual/native/
humanacceptanceNOT_RUN. OriginalWFC cleanmain96e63f13 at prior observation;
cachedorigin/main is not live remote proof, liveremote/CI NOT_RUN.

## Goal and boundary

Continue the accepted plan60 immediately on a new inherited local branch in
`C:/Users/todor.chankov/source/WFC-pathfinder-local`. U2 delivery69cad721 and
U3 handoff83dd2c3 are prior evidence; final U3 is00b4bcc. Preserve its current
code. Only owned5191 later runtime is in
scope. Original5180/old5190/checkouts/sources remain unchanged; no push/PR/merge/
deployment. Simplified Preparer stays paused. Root alone runs actualruntime/
SQL/HTTP/Docker; editing agents use disjointfiles and preserve concurrent edits.

After explicit shared endpoint assignment and successful affected non-MV
calculation, automatically fill the cable list ONLY when routing is NULL or
whitespace AND design_length is SQL NULL. Zero, empty-string legacy length,
defined values, and either partially populated pair require human review.
Preserve installed length. Existing values get exact old/new ordered routing,
old/new design length and signed delta, with explicit individual/batch Review
and Apply. New results do not silently overwrite old engineering decisions.

## Source-backed implementation direction

1. Keep calculation authority separate from an explicit initial-fill mandate.
   U3 commandv2 authorizes calculation only. Add a deliberate versioned command/
   mandate tied to the current admin/login, exact impact/eligible cable scope,
   installationepoch, finite expiry and conditional-both-empty policy. Retain
   legacy v1/v2 exact replay unchanged; never promote LevelB calculation grants.
   The U5 endpoint action will clearly describe automatic initial fill; this
   stage implements its safe backend/client contract, not the full popup yet.
2. Persist the mandate atomically with the binding/impact. Recover after browser
   closure or worker restart using immutable exact commands. Never extend scope
   or renew expired authority without a new explicit authorized action. A failed/
   closed save authorizes no write. Existing no_path/timeout inputs are terminal
   until relevant input changes or explicit retry; no automatic retry storm.
3. Reuse/factor the existing `apply.ts` atomic pair/history/receipt mechanisms
   deliberately. For each successful sealed v7 result check current admin/login,
   mandate/installationepoch/target generation, current engine/dependencyhash,
   exact immutable result/baseline/ledger, compatible route/design, and current
   cableWriteRevision through commit. Conditional SQL must require BOTH blank
   values in the same UPDATE. Concurrent manual/import changes take precedence.
   Preserve installLength and all other business fields.
4. Do not insert a fake human review. Record a distinct initial-fill validation
   method, explicit mandate and impact provenance, exact pre/post snapshots,
   proposal/dependency/result/ledger hashes and idempotency key. Human engineering
   acceptance/nativeparity remain notperformed. Lost acknowledgement retries the
   same immutable key/body; no replacement result may occupy that key.
5. Preserve calculation output even if an initial fill is blocked. A separate
   bounded recoverable writer/consumer is preferable to rolling back a completed
   engine result because a later cable edit requires manual review. Keep the
   original current-login mandate boundary; no secret/bearer persistence or broad
   grant escalation. Explicitly classify written/alreadywritten/reviewrequired/
   stale/authorityexpired/refused/unknown states.
6. Update U1 accepted-result proof and revision baseline readers to recognize
   genuine receipt-backed initial fill without requiring a nonexistent review.
   Prove only the exact own revision+1 transition, preserved installLength and
   current remaining math inputs. Historical expired login does not erase a
   genuinely current accepted write; it does block new automatic writes.
7. Add a bounded display comparison retaining exact route text and ordered token
   occurrences, including repeated identifiers and SECONDARY. Do not compare
   routes as sets or hide order changes. Use exact decimal length subtraction;
   distinguish missing/partial/unchanged and retain baseline provenance. Existing
   explicit batch Review/Apply must re-read each selected proposal and preserve
   exact per-cable atomicity, idempotency and current authority.

## Exact source constraints and coordination

`pf_apply_receipts` has no review FK. Keep manual `pathfinder.apply.v2` and
reviewId-based Apply/recovery untouched; a new initialfill discriminator can use
the same immutable receipt/history tables with no fabricated `pf_reviews` row.
Current U1accepted proof is strict manual receipt linkage; add a separate proven
branch. `revisionResultRepository.acceptedBaselines` is metadata-only today, so
do not present its projection as a newly validated automatic mandate receipt.

Default PostgreSQL btrim handles fewer characters than JavaScript trim. Use one
fixed explicit ECMAScript whitespace set in final SQL and tests (tabs/newlines/
NBSP/BOM included). Null current designlength is the only blank numeric value.
Assert returned revision increments exactlyonce and installed/unrelated fields
remain identical before recording a receipt. Once COMMIT starts, expiry/abort/
lost acknowledgement is unknown and requires exact receipt reconciliation.

Retain strict commandv1/v2 bodies and durable pending bytes. Only explicit newv3
initialfill input creates a mandate; absence stays v2 calculation-only. Server
derives actor/login/epoch/expiry/target scope. Add a verified mandate reference to
v3 receipts; changes in current editor policy never rewrite a retained command.
Legacy LevelB grants gain no write rights. Historical mandate evidence proves
the past committed write without pretending its expired login still allows new
writes. Invalid newest receipts fail closed rather than searching older success.

Use a current cable snapshot from U1detail for comparison; frozen revision
baseline must remain labelled atadmission. Viewer route parsing drops SECONDARY
and is unsuitable for ordered comparison. Bound diff work separately; above its
capacity show exact raw old/new strings plus explicit diffunavailable rather
than truncation/setequality. Decimal subtraction uses the existing exact helper.

Designate disjoint writers before edits: sharedv3/mandates/schema +narrowbinding
commandhook; receiptproof/acceptedreaders; clientv3/orderedcomparison; rootatomic
writer/consumer/runtime/history/sharedintegration/docs. Agree reference/receipt
interfaces first, preserve all parallel changes, rootsoleactualexecutor. U3has
noactivefixture now. Seven denied historical children/parents remain untouched.

## Acceptance and checks

Prove both-empty success; zero/existing/partial refusal; manual/import race;
preserved installLength/all unrelated fields; replay/lostcommit recovery; no
fake review; calculation-grant-only refusal; role/login/mandate expiry, restore,
newer binding target and late completion fencing. Check one shared location
across20cables and both endpoints; only eligible affected cables enter automatic
initialfill. Prove older existing values remain until explicit Review/Apply.
Check ordered repeated-token deltas and exact decimal length deltas.

Run focused meaningful source/mock checks plus actual owned SQL where justified;
record exact revision/PASS/FAIL/BLOCKED/NOT_RUN without calling synthetic checks
real-model acceptance. Full deployed/visual/engineering checks remain U7/U8.
Before any later5191upgrade create the approved database/model backup. Include
all five new U3 impact tables in explicit backup/restore/lossless inventories:
pf_location_impacts/items/targets/dispatch/enrollments. Installation restore
must retain data while fencing original automatic write authority.

Deliver local report/evidence/commit, retire only new owned unneeded fixtures,
apply prepare-stage-handoff for U5 persistent Needs routing list/popup integration
and execute immediately under standing authorization. Preserve needed models,
backups and historically denied paths. No broad prune or bypass of browser-site
permission refusal. Final complete workflow remains pending U5–U8 and explicit
human review where required; do not stop merely after preparing the next prompt.
