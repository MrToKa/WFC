import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../pathfinder-local/runtime-lib.mjs';
import { readHttp, projectionProgram, journalAt } from './import.mjs';
import { IMPORT_PINS, IMPORT_LIMITS, digest, validateImportInputs, assertProjectProjection, assertImportJob, assertReadyImport, selectionDisposition, executeNormalImport } from './import-lib.mjs';

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const bytes = value => Buffer.from(JSON.stringify(value));
function inputs() {
  const resources = Array.from({ length: 5 }, (_, i) => ({ path: 'resources/property-' + i + '.json.gz', bytes: i + 1, sha256: String(i + 1).repeat(64) }));
  const source = { schemaVersion: 'pathfinder.current-inputs.snapshot.v1', project: { id: uuid(1), name: 'Synthetic input', secondaryTrayLength: '3.10000000000000001', endConnectionLength: '6.20000000000000001', additionalBendingPercent: '10' }, model: { id: uuid(2), contentFingerprint: 'b'.repeat(64), propertyResources: resources } };
  const sourceBytes = bytes(source), sourceReceipt = { status: 'PASS', checkedModelFingerprint: source.model.contentFingerprint, privateSnapshot: { sha256: digest(sourceBytes) }, preservation: { status: 'PASS' } }, sourceReceiptBytes = bytes(sourceReceipt);
  const pins = { ...IMPORT_PINS, sourceSnapshotSha256: digest(sourceBytes), sourceReceiptSha256: digest(sourceReceiptBytes), sourceProjectId: source.project.id, fingerprint: source.model.contentFingerprint };
  const plan = { schemaVersion: 'pathfinder.copied-project.seed-plan.v1', id: uuid(100), target: { runtime: 'pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600', owner: pins.owner, project: pins.project, port: pins.port, apiImage: pins.apiImage, webImage: pins.webImage }, source: { snapshot: { path: 'pathfinder-engine/.scratch/synthetic/source.json', bytes: sourceBytes.length, sha256: pins.sourceSnapshotSha256 }, receipt: { path: 'docs/pathfinder/evidence/synthetic-source.json', sha256: pins.sourceReceiptSha256 }, projectId: source.project.id, modelVersionId: source.model.id, contentFingerprint: source.model.contentFingerprint }, newProject: { id: uuid(100), projectNumber: 'PF-COPY-' + uuid(100).replaceAll('-', '').slice(0, 12), name: source.project.name + ' — copied engineering inputs', description: 'Isolated engineering review copy. Original cable routes and lengths were not copied. Calculated proposals require manual review.', secondaryTrayLength: source.project.secondaryTrayLength, endConnectionLength: source.project.endConnectionLength, additionalBendingPercent: source.project.additionalBendingPercent, connectionGap: '1' }, types: Array(50).fill({}), cables: Array(2140).fill({}) };
  const receipt = { schemaVersion: 'pathfinder.copied-project.seed-receipt.v1', status: 'PASS', operation: 'created', syntheticMarker: false, projectId: plan.newProject.id, target: { ...plan.target }, plan: { path: 'pathfinder-engine/.scratch/synthetic/plan.private.json' }, source: { snapshotSha256: pins.sourceSnapshotSha256, receiptSha256: pins.sourceReceiptSha256 }, counts: { projects: 1, types: 50, cables: 2140, selections: 1, pathfinderStates: 1 } };
  const archiveReport = { status: 'PASS', operation: 'verify', package: { bytes: pins.archiveBytes, sha256: pins.archiveSha256 }, contentFingerprint: source.model.contentFingerprint, resourceCount: 5, totalRawBytes: 15, manifest: { packageId: uuid(70), contentFingerprint: source.model.contentFingerprint, supportProfile: 'svf-local-7.130.0-v1', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', source: { name: 'Synthetic model', bytes: 17, sha256: 'a'.repeat(64), identityBasis: 'observed-local-file' }, resources } };
  const x = { plan, receipt, pins, sourceBytes, sourceReceiptBytes, archiveReport, actorId: uuid(10) };
  x.args = () => { const planBytes = bytes(plan); receipt.plan.sha256 = digest(planBytes); receipt.plan.bytes = planBytes.length; const receiptBytes = bytes(receipt); return { planBytes, planSha256: digest(planBytes), receiptBytes, receiptSha256: digest(receiptBytes), sourceBytes, sourceReceiptBytes, archiveReport, actorId: x.actorId }; };
  x.context = () => validateImportInputs(x.args(), { pins }); return x;
}
function workflow() {
  const context = inputs().context(), events = [], counts = { uploads: 0, selections: 0, logins: 0, polls: 0, observations: 0 };
  const binding = { ...context.target, apiId: 'a'.repeat(64), pgId: 'b'.repeat(64), webId: 'c'.repeat(64), serverAddress: '172.25.0.2' };
  const intent = { schemaVersion: 'pathfinder.copied-project.import-intent.v1', idempotencyKey: uuid(200), planSha256: context.planSha256, receiptSha256: context.receiptSha256, projectId: context.project.id, actorId: context.actorId, archiveSha256: context.archive.sha256, target: binding };
  const projection = { identity: { database: 'wfc_pathfinder_local', address: binding.serverAddress, port: 5432, readOnly: true }, expectedServerAddress: binding.serverAddress, project: structuredClone(context.project), counts: { types: 50, cables: 2140, syntheticMarkers: 0 }, selection: { projectId: context.project.id, activeModelVersionId: null, selectionRevision: '0' }, jobs: [], versions: [], ownership: [], reservations: [], aliases: [], validations: [] };
  function complete() {
    projection.jobs = [{ id: uuid(300), projectId: context.project.id, requestedBy: context.actorId, idempotencyKey: intent.idempotencyKey, archiveSha256: context.archive.sha256, expectedBytes: String(context.archive.bytes), receivedBytes: String(context.archive.bytes), state: 'complete', modelVersionId: uuid(400), failureCode: null, duplicate: false }];
    projection.versions = [{ id: uuid(400), projectId: context.project.id, packageId: context.archive.packageId, ownerImportId: uuid(300), importedBy: context.actorId, contentFingerprint: context.archive.fingerprint, state: 'ready', health: 'healthy', supportProfile: 'svf-local-7.130.0-v1', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', storagePrefix: 'projects/' + context.project.id + '/versions/' + uuid(400) + '/', resourceCount: context.archive.resourceCount, totalBytes: context.archive.totalBytes, source: structuredClone(context.archive.source), resources: structuredClone(context.archive.resources), validationReportId: uuid(500) }];
    projection.ownership = [{ importId: uuid(300), projectId: context.project.id, modelVersionId: uuid(400), storagePrefix: projection.versions[0].storagePrefix, published: true, cleanedAt: null }];
    projection.aliases = [{ projectId: context.project.id, modelVersionId: uuid(400), packageId: context.archive.packageId }];
    projection.validations = [{ id: uuid(500), status: 'PASS', contentFingerprint: context.archive.fingerprint, archiveSha256: context.archive.sha256, archiveBytes: String(context.archive.bytes), resourceCount: context.archive.resourceCount, totalRawBytes: context.archive.totalBytes, storageReadback: { status: 'PASS', algorithm: 'SHA-256', resourceCount: context.archive.resourceCount, totalBytes: Number(context.archive.totalBytes) } }];
    projection.validations[0].report = { reportSchemaVersion: 1, operation: 'verify', status: 'PASS', checks: Object.fromEntries(['portableManifest', 'safeArchive', 'rawInventory', 'fingerprint', 'supportedProfile', 'nestedReferences'].map(key => [key, 'PASS'])), contentFingerprint: context.archive.fingerprint, package: { sha256: context.archive.sha256, bytes: context.archive.bytes }, manifest: { packageId: context.archive.packageId, contentFingerprint: context.archive.fingerprint, source: structuredClone(context.archive.source), resources: structuredClone(context.archive.resources) }, resources: context.archive.resources.map(resource => ({ ...resource, verifiedSha256: resource.sha256 })) };
  }
  const io = { now: () => 1000000, guard: async () => structuredClone(binding), observe: async () => { counts.observations++; return structuredClone(projection); }, append: async (type, value) => events.push({ type, value: structuredClone(value) }), login: async () => { counts.logins++; return { status: 200, user: { id: context.actorId, isAdmin: true }, token: 'synthetic-token-not-a-real-credential' }; }, upload: async () => { counts.uploads++; assert.ok(events.some(e => e.type === 'upload_will_start')); complete(); return { status: 202, value: { importId: uuid(300), job: structuredClone(projection.jobs[0]) } }; }, poll: async () => { counts.polls++; complete(); return { status: 200, value: { job: structuredClone(projection.jobs[0]) } }; }, listVersions: async () => ({ status: 200, value: { versions: structuredClone(projection.versions) } }), select: async body => { counts.selections++; assert.equal(body.expectedSelectionRevision, 0); assert.ok(events.some(e => e.type === 'selection_will_start')); projection.selection = { projectId: context.project.id, activeModelVersionId: uuid(400), selectionRevision: '1' }; return { status: 200, value: { selection: structuredClone(projection.selection) } }; }, sleep: async () => {} };
  return { context, intent, io, projection, events, counts, complete, binding, run: history => executeNormalImport({ context, intent, io, history }) };
}

test('synthetic seed/source/package pins and exact decimal allowance linkage produce an import context', () => { const x = inputs(), c = x.context(); assert.equal(c.project.endConnectionLength, '6.20000000000000001'); assert.equal(c.archive.resources.length, 5); assert.equal(c.project.id, x.plan.id); });
for (const [name, mutate, code] of [
  ['non-PASS seed', x => { x.receipt.status = 'FAIL'; }, 'IMPORT_SEED_NOT_VERIFIED'],
  ['synthetic engineering bypass', x => { x.receipt.syntheticMarker = true; }, 'IMPORT_SEED_NOT_VERIFIED'],
  ['5190 target', x => { x.plan.target.port = 5190; }, 'IMPORT_TARGET_REFUSED'],
  ['foreign owner', x => { x.plan.target.owner = uuid(999); }, 'IMPORT_TARGET_REFUSED'],
  ['wrong image', x => { x.plan.target.apiImage = 'sha256:' + 'a'.repeat(64); }, 'IMPORT_TARGET_REFUSED'],
  ['wrong receipt project', x => { x.receipt.projectId = uuid(999); }, 'IMPORT_SEED_PLAN_LINK'],
  ['wrong source receipt pin', x => { x.receipt.source.receiptSha256 = 'a'.repeat(64); }, 'IMPORT_SEED_SOURCE_LINK'],
  ['original project reuse', x => { x.plan.newProject.id = x.plan.source.projectId; x.receipt.projectId = x.plan.source.projectId; }, 'IMPORT_PROJECT_MARKER'],
  ['missing connection allowance', x => { x.plan.newProject.endConnectionLength = null; }, 'IMPORT_PROJECT_DETAILS_LINK'],
  ['rounded allowance', x => { x.plan.newProject.secondaryTrayLength = '3.10000000000000002'; }, 'IMPORT_PROJECT_DETAILS_LINK'],
  ['archive hash mismatch', x => { x.archiveReport.package.sha256 = 'a'.repeat(64); }, 'IMPORT_ARCHIVE_PIN'],
  ['full model fingerprint mismatch', x => { x.archiveReport.contentFingerprint = 'a'.repeat(64); }, 'IMPORT_ARCHIVE_PIN'],
  ['property resource mismatch', x => { x.archiveReport.manifest.resources[0].sha256 = 'a'.repeat(64); }, 'IMPORT_ARCHIVE_RESOURCE_LINK'],
  ['resource total mismatch', x => { x.archiveReport.totalRawBytes++; }, 'IMPORT_ARCHIVE_RESOURCE_LINK'],
]) test('input contract refuses ' + name, () => { const x = inputs(); mutate(x); assert.throws(() => x.context(), { code }); });
test('raw provided plan SHA is checked before trusting its fields', () => { const x = inputs(), a = x.args(); a.planSha256 = 'f'.repeat(64); assert.throws(() => validateImportInputs(a, { pins: x.pins }), { code: 'IMPORT_INPUT_PIN' }); });
test('normal workflow persists mutation intent first and imports/selects exactly once with no engineering gate bypass', async () => { const w = workflow(), result = await w.run(); assert.equal(result.status, 'PASS'); assert.equal(result.engineeringAccepted, false); assert.equal(result.syntheticMarker, false); assert.equal(w.counts.uploads, 1); assert.equal(w.counts.selections, 1); assert.equal(w.events.some(e => JSON.stringify(e).includes('synthetic-token-not-a-real-credential')), false); });
test('lost accepted upload reply reconciles the same persisted request without a second upload', async () => { const w = workflow(); w.io.upload = async () => { w.counts.uploads++; w.complete(); throw Error('wire lost'); }; const result = await w.run(); assert.equal(result.status, 'PASS'); assert.equal(w.counts.uploads, 1); assert.ok(w.events.some(e => e.type === 'upload_transport_failure')); });
test('unknown acceptance is durable and a resumed invocation never blindly uploads', async () => { const w = workflow(); w.io.upload = async () => { w.counts.uploads++; throw Error('wire lost'); }; await assert.rejects(w.run(), { code: 'IMPORT_UNCERTAIN_ACCEPTANCE' }); assert.ok(w.events.some(e => e.type === 'upload_will_start')); const prior = [...w.events]; await assert.rejects(w.run(prior), { code: 'IMPORT_UNCERTAIN_ACCEPTANCE' }); assert.equal(w.counts.uploads, 1); });
test('persisted accepted pending job resumes by GET and same-key SQL reconciliation only', async () => { const w = workflow(); w.complete(); w.projection.jobs[0].state = 'validating'; w.projection.jobs[0].receivedBytes = '100'; const result = await w.run([{ type: 'upload_will_start' }]); assert.equal(result.status, 'PASS'); assert.equal(w.counts.uploads, 0); assert.equal(w.counts.polls, 1); });
test('successful selection readback resumes without incrementing revision or PATCHing again', async () => { const w = workflow(); w.complete(); w.projection.selection = { projectId: w.context.project.id, activeModelVersionId: uuid(400), selectionRevision: '1' }; assert.equal((await w.run([{ type: 'upload_will_start' }, { type: 'selection_will_start' }])).selectionDisposition, 'already_selected'); assert.equal(w.counts.uploads, 0); assert.equal(w.counts.selections, 0); });
test('lost selection reply is accepted only by exact CAS readback and is never retried', async () => { const w = workflow(), select = w.io.select; w.io.select = async body => { await select(body); throw Error('lost commit response'); }; assert.equal((await w.run()).selectionDisposition, 'reconciled_selected'); assert.equal(w.counts.selections, 1); });
test('uncertain selection with unchanged baseline refuses a second PATCH on resume', async () => { const w = workflow(); w.complete(); await assert.rejects(w.run([{ type: 'upload_will_start' }, { type: 'selection_will_start' }]), { code: 'IMPORT_SELECTION_UNCERTAIN' }); assert.equal(w.counts.selections, 0); });
test('a competing selection revision is retained and never overwritten', async () => { const w = workflow(); w.complete(); w.projection.selection.selectionRevision = '2'; await assert.rejects(w.run([{ type: 'upload_will_start' }]), { code: 'IMPORT_SELECTION_CONFLICT' }); assert.equal(w.counts.selections, 0); assert.ok(w.events.some(e => e.type === 'projection_ready')); });
test('target replacement between intent and mutation refuses the request', async () => { const w = workflow(); w.io.guard = async () => ({ ...w.binding, apiId: 'd'.repeat(64) }); await assert.rejects(w.run(), { code: 'IMPORT_TARGET_CHANGED' }); assert.equal(w.counts.uploads, 0); });
test('self-consistent wrong DB-address claims cannot bypass the immutable target binding', async () => { const w = workflow(); w.projection.identity.address = w.projection.expectedServerAddress = '172.25.0.99'; await assert.rejects(w.run(), { code: 'IMPORT_DATABASE_BINDING' }); assert.ok(w.events.some(e => e.type === 'projection_initial')); assert.equal(w.counts.logins, 0); });
for (const field of ['projectId', 'requestedBy', 'idempotencyKey', 'archiveSha256']) test('reconciliation refuses foreign job ' + field, async () => { const w = workflow(); w.complete(); w.projection.jobs[0][field] = field === 'archiveSha256' ? 'a'.repeat(64) : uuid(999); await assert.rejects(w.run([{ type: 'upload_will_start' }]), { code: 'IMPORT_JOB_BINDING' }); assert.equal(w.counts.uploads, 0); });
for (const [name, mutate, code] of [
  ['foreign storage prefix', p => { p.versions[0].storagePrefix = 'projects/' + uuid(999) + '/versions/' + uuid(400) + '/'; }, 'IMPORT_READY_MODEL'],
  ['unpublished storage', p => { p.ownership[0].published = false; }, 'IMPORT_STORAGE_OWNERSHIP'],
  ['resource bytes changed', p => { p.versions[0].resources[0].bytes++; }, 'IMPORT_READY_MODEL'],
  ['bad full validation report', p => { p.validations[0].archiveSha256 = 'f'.repeat(64); }, 'IMPORT_READBACK_PROOF'],
  ['readback resource mismatch', p => { p.validations[0].storageReadback.resourceCount++; }, 'IMPORT_READBACK_PROOF'],
  ['foreign package alias', p => { p.aliases[0].projectId = uuid(999); }, 'IMPORT_ALIAS_OWNERSHIP'],
  ['contradictory full report check', p => { p.validations[0].report.checks.nestedReferences = 'FAIL'; }, 'IMPORT_FULL_VALIDATION_REPORT'],
  ['contradictory verified resource hash', p => { p.validations[0].report.resources[0].verifiedSha256 = 'f'.repeat(64); }, 'IMPORT_FULL_VALIDATION_REPORT'],
]) test('ready gate refuses ' + name + ' before selection', async () => { const w = workflow(); w.complete(); mutate(w.projection); await assert.rejects(w.run([{ type: 'upload_will_start' }]), { code }); assert.equal(w.counts.selections, 0); assert.ok(w.events.some(e => e.type === 'projection_ready')); });
test('failed accepted job is retained and cannot trigger another upload/login', async () => { const w = workflow(); w.complete(); w.projection.jobs[0].state = 'failed'; w.projection.jobs[0].failureCode = 'VERIFICATION_FAILED'; await assert.rejects(w.run([{ type: 'upload_will_start' }]), { code: 'IMPORT_JOB_FAILED' }); assert.equal(w.counts.uploads, 0); assert.equal(w.counts.logins, 0); assert.ok(w.events[0].value.jobs[0].failureCode); });
test('row budget is enforced before any authenticated mutation', async () => { const w = workflow(); w.projection.jobs = Array(5).fill({}); await assert.rejects(w.run(), { code: 'IMPORT_REGISTRY_ROW_BUDGET' }); assert.equal(w.counts.logins, 0); });
test('late upload result remains journaled when the overall deadline expires', async () => { const w = workflow(); let now = 1000; w.io.now = () => now; const upload = w.io.upload; w.io.upload = async args => { const value = await upload(args); now += IMPORT_LIMITS.totalMilliseconds; return value; }; await assert.rejects(w.run(), { code: 'IMPORT_TOTAL_TIMEOUT' }); assert.ok(w.events.some(e => e.type === 'upload_http')); assert.equal(w.counts.selections, 0); });
test('cancellation after accepted upload retains uncertainty and suppresses selection', async () => { const w = workflow(), abort = new AbortController(), upload = w.io.upload; w.io.signal = abort.signal; w.io.upload = async args => { const value = await upload(args); abort.abort(); return value; }; await assert.rejects(w.run(), { code: 'IMPORT_INTERRUPTED' }); assert.ok(w.events.some(e => e.type === 'upload_http')); assert.equal(w.counts.selections, 0); });
test('non-admin or another actor login is retained without upload', async () => { const w = workflow(); w.io.login = async () => ({ status: 200, user: { id: uuid(999), isAdmin: true }, token: 'synthetic-only-not-a-real-secret' }); await assert.rejects(w.run(), { code: 'IMPORT_LOGIN_REFUSED' }); assert.equal(w.counts.uploads, 0); assert.ok(w.events.some(e => e.type === 'login_observation')); });
test('journal and immutable intent guards run before any I/O', async () => { const w = workflow(); w.intent.archiveSha256 = 'a'.repeat(64); await assert.rejects(w.run(), { code: 'IMPORT_INTENT_CONFLICT' }); assert.equal(w.events.length, 0); });
test('owned archive stream is destroyed even if fetch rejects before response headers', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw Error('synthetic network failure'); }); const stream = Readable.from(['synthetic bytes']);
  await assert.rejects(readHttp('http://127.0.0.1:5191', '/synthetic-no-real-request', { stream })); assert.equal(stream.destroyed, true);
});
test('malformed non-login HTTP body is privately retained before JSON validation fails', async t => {
  const events = []; t.mock.method(globalThis, 'fetch', async () => new Response('{invalid-synthetic-json', { status: 202 }));
  await assert.rejects(readHttp('http://127.0.0.1:5191', '/synthetic-no-real-request', { operation: 'upload', journal: { append: async (type, value) => events.push({ type, value }) } }), { code: 'IMPORT_HTTP_JSON' });
  assert.equal(events[0].type, 'http_raw_upload'); assert.equal(events[0].value.status, 202); assert.equal(events[0].value.raw, '{invalid-synthetic-json');
});
test('login HTTP reply never enters the private raw event journal', async t => {
  const events = []; t.mock.method(globalThis, 'fetch', async () => Response.json({ token: 'synthetic-not-an-actual-token', user: { isAdmin: true } }));
  const reply = await readHttp('http://127.0.0.1:5191', '/synthetic-no-real-request', { privateLogin: true, journal: { append: async (...value) => events.push(value) } });
  assert.equal(reply.status, 200); assert.equal(events.length, 0);
});
test('an oversized HTTP response is refused and its owned reader is closed', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(IMPORT_LIMITS.responseBytes + 1))); const stream = Readable.from(['synthetic']);
  await assert.rejects(readHttp('http://127.0.0.1:5191', '/synthetic-no-real-request', { stream }), { code: 'IMPORT_HTTP_LIMIT' }); assert.equal(stream.destroyed, true);
});
test('the actual serialized helper watchdog exits while stdin remains open before any SQL import', { timeout: 5000 }, async t => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', projectionProgram({ watchdogMilliseconds: 20 })], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); child.stdin.destroy(); });
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  assert.deepEqual(result, { code: 2, signal: null });
});
test('resume acquires ownership before loading history and observes the last prior uncertain upload', async () => {
  const directory = path.join(ROOT, 'pathfinder-engine/.scratch/copied-import-journal-control-' + randomUUID()); await fs.mkdir(directory);
  const w = workflow(), marker = { syntheticControl: true }, intent = { ...w.intent, contextSha256: digest(w.context) }, rawIntent = bytes(intent);
  await fs.writeFile(path.join(directory, 'owner.private.json'), bytes(marker), { flag: 'wx' }); await fs.writeFile(path.join(directory, 'intent.private.json'), rawIntent, { flag: 'wx' });
  const event = { schemaVersion: 'pathfinder.copied-project.import-event.v1', sequence: 0, previousSha256: digest(rawIntent), type: 'upload_will_start', value: { syntheticControl: true } };
  const loaded = await journalAt(directory, intent, marker, { acquireLock: async () => { await fs.writeFile(path.join(directory, 'event-0000.private.json'), bytes(event), { flag: 'wx' }); } });
  assert.equal(loaded.history.length, 1); assert.equal(loaded.history[0].type, 'upload_will_start');
  await assert.rejects(w.run(loaded.history), { code: 'IMPORT_UNCERTAIN_ACCEPTANCE' }); assert.equal(w.counts.uploads, 0);
  await assert.rejects(journalAt(directory, intent, marker, { acquireLock: async () => { throw Object.assign(Error('synthetic busy'), { code: 'IMPORT_BUSY' }); } }), { code: 'IMPORT_BUSY' });
  // Retain only these tiny, explicitly synthetic proof files; no recursive cleanup is performed.
});
