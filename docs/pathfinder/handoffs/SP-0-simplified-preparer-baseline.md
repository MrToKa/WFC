# SP-0 — Simplified Preparer baseline and staged implementation

Prepared with prepare-stage-handoff at 2026-10-21T22:38:44.869Z.
PF-B9 technical delivery is committed locally in a3892cc (product3d86cb2b34baa0dbc7ada8fc93f7979eb4aa34ed).
All nine operation1335 phases PASS; source5191 healthy on ac0d16ab/aeca927b;
backup9ed58095 and new offline images retained; only owned5192 retired.
Report92/evidence/barriers/b9-checkpoint.json define exact scope. Actual civil
geometry/openings and protected browser/SDK/manual acceptance remain BLOCKED,
not substituted by legacy replay or HTTP checks. Independent Preparer work is
explicitly authorized now. Current user's latest instruction: Continue.

Fresh read-only remote main96e63f13 at2026-10-21T22:35Z; original main clean.
Preparer local96e63f13,0ahead/0behind availableorigin/main,17trackedchanges.
PR connector searches for B9 and Preparer head returned none; no review/CI
approval inferred. PF source166ahead/3behind availableorigin/main before docs.
Private pre-edit preservation complete2026-10-21T22:37Z in Preparer
.preparer-work/sp0-77acb9b9-3cad-4bdb-a04f-fabb783f8861:17trackedchanges,119files.
Historical paused checkpoint retained; later explicit resume authorizes work.

The user explicitly resumed queued Preparer work after PF checks and selected
MAIN WFC http://127.0.0.1:5180. Implement browser-only daily work: WFC sign-in →
personal Autodesk check → select/upload NWD → Generate → save model into WFC and
download original ZIP. Current WFC administrators only. Each administrator enters
their own Autodesk credentials once; no cross-owner/admin override or implicit
global/environment credential use. UI English. Preserve local source changes and
back up full database/models/private configuration before any runtime update.
User authorizes sequential local stages and immediate next handoffs/execution;
no push/PR/merge or publishing beyond the specifically authorized main local update.

## Source-backed baseline

Worktree C:/Users/todor.chankov/source/WFC-preparer-local-20261020,
branch preparer-admin-workspace-20261020, HEAD96e63f13fdc2b1d30b8f8ff658dd662f25fac104.
Dirty17tracked paths plus model-preparer/, retained-package docs and two new tests
are the existing authorized package integration; preserve them. Inspect live state
again, read applicable AGENTS, active agents/processes and pause checkpoint before
changes. The old PAUSED_BY_USER checkpoint is historical; later explicit user
resume and instruction to continue after PF supersede it. It proves no main runtime
update or database/models backup had yet happened, not current completion.

Input C:/Users/todor.chankov/Downloads/Simplified-Preparer-WFC-20261020.zip,
SHA8b9f5c9d8b387f5eab70fa3b16d220b3a4dc07c8aa334ba67ae90f47a7a4f491.
Retained baseline evidence at project mirror work/simplified-preparer-20261020-baseline/evidence;
mirror sources/ read-only. Package173/174 FAIL is retained: CLI child.stdout is
undefined because the historical isolation preload lost execFile's custom
promisification. Preparer was CANCELLED by explicit pause, with partial TAP17;
neither is a fresh complete verification. Original verification135inputs/123source
is historical. Read exact retained files, never overwrite them.

Read-only21:35Z refresh: original WFC cleanmain/liveoriginmain96e63f13; canonicalPF
clean45c24bf5 (no available origin/main in that canonical checkout). Connector
returns no PR for B9 or Preparer heads, no combined statuses or PR-triggered
first-page workflow runs for inspected main. No CI/review acceptance inferred.
Refresh only relevant facts before stage completion; do not mutate originals.

PF5191/demo, backups, all historical denied scratch children/parents and current
PF evidence remain untouched by Preparer. No reuse of PF credentials: the user's
specific historical credential authorization was only restored5192 tests. No APS
keys may be copied from another user/global PoC file. Do not repeat already
converted older-model upload/submit; no fresh cloud success without actual proof.

## Sequential stages and checks

SP-0 — Preserve current dirty source with private patch/source hashes and a local
checkpoint; add durable plan/progress. Create an inheriting local stage branch.
Fix only test dependency topology and a NEW owned baseline supervisor/preload.
Seven test files need ../../server/vendor/routings-model-package/index.mjs:
test/helpers, aps-provider, package-adapter; app-test/service, web-request,
workspace-live, workspace-service. Production supports an explicit module path;
do not add a fallback. Retain historical FAIL/CANCELLED logs. In the new guarded
execFile wrapper preserve safe custom promisification ({stdout,stderr}, rejection
streams and child) without attaching an unguarded original. Run Node24 serial
bounded package full tests from a new owned package copy pinned to current vendored
runtime, then all Preparer test/*.test.mjs and app-test/*.test.mjs. A PASS requires
positive terminal TAP totals, fail/cancel0, exit0 and joined child, not exit alone.
Record actual failures and fix authorized product defects in the appropriate stage.

SP-1 — Main topology and recoverable backup BEFORE main runtime changes. Source
docker-compose.app.yml is wfc-app backend/frontend5180 on external application
network; DATABASE_URL and MinIO endpoints are external, not full-stack5173 defaults.
Root alone resolves actual identities/endpoints/labels/paths/ports and all writers.
Reuse generic operations foundations only after closing precision and side-effect
gaps: all-public lossless raw rows/keys/catalog, global routines/views/sequence
state/ownership/ACLs; read-only model+original-ZIP archive verification; refuse
unknown DB writers rather than terminate them. Include all DB, MinIO, staging,
model_package_archives if present, exact images and separate private config/key
companion. Restore to NEW owned loopback test resources with rotated/fenced auth;
prove exact before-fence, declared fencing and only canonical migration deltas.
Never confuse main5180 with PF5191/default5190 or operate original PF resources.

SP-2 — Fresh administrator authorization and per-user encrypted credential store.
Own workspace-security.mjs/tests. Current /api/users/me reads current WFC role;
require admin on admission/every protected use and bind settings to trusted WFC
userId/configuration revision. Preserve legacy encrypted/global settings UNCLAIMED,
never assign to the first admin. WFC passwords only transient login exchange;
tokens/APS secrets never URL/browser storage/log/Git. Support the existing WFC
login flow through a bounded freshly verified same-origin session handoff where
needed; no WFC authentication redesign or role trust from stale JWT. Tests two
admins, same entered keypair, rotation/restart/logout/demotion/expiry/WFC outage.

SP-3 — Owner-bound upload/jobs/provider/storage/generation lifecycle. Separate
writer workspace-service.mjs/tests; agree opaque security binding with SP-2 first.
Bind upload, job, token cache, execution, resume/import-only retry and ZIP to exact
owner/configuration; remove administrator cross-owner bypass. Partition data/work/
output and provider instances by trusted identity even if two users enter the same
keys. Preserve global single-active operation bound, durable uncertain-submit
reconciliation and idempotency. engineer-cost-provider authorization and APS final
mutation guard are SYNCHRONOUS; fresh authority happens asynchronously before the
operation boundary and invalidates the scoped synchronous capability on refusal.
No await gap between final guard and opening a cloud mutation. Test foreign IDs,
uploads/jobs/ZIPs, live config changes, restart recovery and zero disclosure.

SP-4 — WFC retained ZIP and English browser workflow. Existing dirty patch adds
model_package_archives, original archives/<project>/<import>/package.zip and
download UI/API. Qualify archive count/SHA readback, transaction/provenance/import
retry and controlled 2GiB streaming; enforce current-admin on new Preparer/ZIP
operations and exact owner at the gateway. Preserve ordinary existing Viewer
access and the established project import transaction boundary. Add an admin-only
WFC entry and chosen protected same-origin route/connection, with clear personal
Autodesk settings and actionable errors. No implementation details in user flows.

SP-5 — Isolated full app verification. New exact owned compose/ports/volumes,
bounded resources and no startup APS submission; choose ports only after actual
checks. Do NOT use standalone fixed routings-preparer/default global PoC env.
Set trusted server WFC origin separately from browser public origin. Back up and
restore Preparer workspace-private keys/encrypted settings/cost key/journal/WAL
and all owner data/work/output stores; existing standalone ops only understand
closed/simulation/live and must not omit new workspace directories. Fence restored
sessions/authority/provider reuse. Run relevant WFC type/UI/server/integration,
security, archive and two-admin tests; use legitimate browser access where allowed.
Saved PF5191 browser refusal is not bypassed by another origin to capture civil.

SP-6 — Deliver MAIN5180 only after exact candidate, verified backup/restore,
canonical migration/operational checks and late source no-drift. Use the exact
verified image IDs, preserve DB/storage/keys and original non-target resources.
Stock update-local-app.ps1 image switches alone do not establish these gates.
Keep rollback archive and private companion. Prove health, actual routes/assets,
strict current-admin and owner separation after update without changing real
engineering data or submitting a new APS task merely for startup. Actual own-user
APS keys may require human entry through the finished browser page; never invent
credentials, reuse global keys or label simulated/reused-package checks fresh APS.

SP-7 — Full honest acceptance and daily instructions. Verify browser sequence,
WFC save+same original ZIP download, fresh own-user APS check/generation where
actually authorized and configured, backup/restore/recovery/offline limits and
explicit statuses for any missing live proof. Give working browser URL and simple
daily steps. Retire only proved-owned unnecessary test fixtures; keep main/PF
demos/backups/private evidence and denied paths. Separate technical completion
from human engineering acceptance. Stop heartbeat only when no useful independent
work remains or completed, explaining exact human step still needed.

## Execution discipline

Root sole actual build/test/Docker/SQL/HTTP executor; non-overlapping source-only
agents, one writer per shared interface, independent review, preserve others' work.
No external messages or secret/business-row Git publication. After each technically
finished stage: exact report/evidence/status/revision/local commit, apply
prepare-stage-handoff, write next self-contained prompt and EXECUTE immediately.
Maintain short durable docs/preparer/automation-progress.md and cross-reference
PF progress. Do not stop for routine decisions or call a budget limit completion.
