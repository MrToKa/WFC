# PF-B7a — Immediate read-only Path Finder length

Implement the user's 21 October clarification before B8 qualification. On every
exact successful current cable calculation, Auto calculated length [m] updates
immediately and remains read-only. Design length [m] remains manually editable:
existing/partial Routing and Design require explicit Review/Apply; the user
separately reconfirmed automatic initial fill when BOTH are blank after location
Save. Preserve Installed length. Continue B8 afterward without routine pause.

## Baseline, isolation and evidence

Work only in C:/Users/todor.chankov/source/WFC-pathfinder-local. B7 product
34c603c709742e94788077efef54fab7ca37e824, report87, evidence/barriers/b7-writes.json and its source list are
the checked baseline. Read live branch/status/HEAD/agents, automation-progress,
plan78 B7a–B9, matrix79 AL cases and applicable AGENTS before edits. Create a new
inheriting local branch pf-b7a-auto-length-local-20261021; preserve foreign
.pf0-work/.pf2-work and all parallel edits. Root alone executes actual tests,
builds, SQL/HTTP/runtime. Delegate nonoverlapping modules with agreed interfaces.

Original WFC5180/5190, original/canonical PathFinder and sources/ remain read-only.
No push/PR/merge/original deployment. No5191 update until B9 coherent verified
backup/restore. B7 temporary PG55441 was retired, its contexts are not a live DB.
Create new owned fixtures with exact path/ID/owner/project/port verification.
No secrets/business rows in Git. All denied scratch paths/parents remain untouched;
no retry/bypass/prune. Keep demonstration/backups/evidence. Browser5191 refusal
remains: no alternate browser/native/CDP/origin or permission-file bypass.
Actual civil/Aalborg checks are B8 unknown, not replaced by synthetic PASS.
Simplified Preparer remains queued after current PF implementation/checks.

## Source facts and agreed direction

Current Auto is only CableDetails.tsx:1160/1446 → utils/cableLength.ts, a client
tray-list estimate with a different reserve ordering. No Auto DB/API field exists.
It cannot remain a fallback or be backfilled as Path Finder evidence.

Use a separate server-owned derived read model, never a manually writable cable
business column. Publishing Auto must not change cables, cableWriteRevision,
Design, Installed length, history or grant authority. A calculation-only grant
may publish this calculation output; it gains no Review/Apply authority.

1. Define a strict small output contract and new sidecar schema. Retain source
   proposal/seal/dependency/result/ledger/evidence refs privately. Public cable
   readers receive only length and minimal calculation/status/date/drilling
   labels, no meshes, coordinates, model capabilities or authority credentials.
2. Register a total server admission order under the project mutex across manual,
   automatic and location-impact work. Existing timestamp/UUID and per-kind
   generation are insufficient. New sidecar order/target metadata must not rewrite
   immutable old admissions/envelopes or fabricate a historical backfill.
3. Keep latest admitted target separate from last verified success. An older
   completion cannot replace a newer selected request, including a newer failed
   request. Preserve a prior successful value honestly as last-success/pending/
   stale/unavailable; do not claim it is the newest current calculation.
4. Publish atomically inside worker.ts final item transaction (:245–277), AFTER
   exact persisted proposal + seal and successful item completion, BEFORE final
   enrollment/authority/expiry/COMMIT. Require current v8/v3, successful final
   barrier evidence and exact length ledger/design; copy designLengthMeters
   verbatim. Never publish preview, lookup, stale, cancelled or failed output.
   Duplicate/lost-ACK path must use retained existing proposal/result/seal, not a
   newly computed response. Do not wait for all unrelated siblings.
5. Admission seams: revisionResultRepository.persistRevisionAdmission is used by
   jobs.insertCalculationBatch, all-blocked automatic admissions and scoped work.
   Include blocked members in target ordering. Existing per-location supersession
   does not cover competing manual batches. Do not weaken immutable sealed-item
   applicability or fresh write evidence to publish a value.
6. Normal cable list/details are ordinary authorized reads, NOT admin PF/viewer
   reads. Add a bounded set-based compact read projection in models/cable.ts,
   selectCablesQuery/selectCableDetailsQuery in cablesRoutes.ts. Do not call
   cableWorkflowReadTransaction or recollect geometry/identity for2140 cable rows.
   PF schema initialization is unconditional in db.ts; initialize sidecar after
   revision-result schema. Add proper indexes/FKs and backup/restore inventory.
7. Expose Auto as readonly in CableDetails and a separate cable-list column,
   preserving saved column preferences. Keep Design's existing manual editor,
   imports, MTO/report behavior. Keep Auto out of create/update/import input maps;
   reject API injection and ignore/reject readonly import values explicitly.
   Remove old Auto estimate fallback and correct the Details formula explanation
   without changing any C# math or creating default allowances.
8. Full v8 hash includes cableWriteRevision: a Design edit or legitimate Apply
   cannot alter the Auto number or pretend to revalidate its physics. Keep full
   source hashes for provenance and strict Review/Apply. Display freshness must
   conservatively distinguish last success from current write eligibility.

## Checks and reporting

Use meaningful unit/actual owned SQL/API/UI checks for immediate per-item Auto
before Apply, Design/manual divergence, both-blank fill, exact source and failed/
stale/cancel/role/scope/commit failures, current grant boundaries, reverse
completions/newer failure watermark, duplicate/lost ACK, source/history preservation.
Test ordinary authorized nonadmin reads, bounded2140-row projection, no model data
leak, readonly payload/import/inline enforcement, old preference compatibility,
null when no verified PF result, no legacy estimate fallback and zero-length values.
Back up/restore new tables in own resources; restored authority must not revive.
Run applicable types/build/lint and changed regression boundaries, reusing unchanged
B7 evidence honestly. No real-data Apply or native engineering acceptance claim.

Record exact PASS/FAIL/BLOCKED/NOT_RUN, checked source revision/scope and initial
failures, public no-secret evidence and report88. Local commit only. Update durable
progress; apply prepare-stage-handoff, create PF-B8 qualification prompt against
actual code/remote evidence and execute immediately. B8 actual-capture blockers
stop dependent checks only; complete useful independent work without bypass.
