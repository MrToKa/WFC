/** Container-only qualification of the actual compiled production union path.
 * Inputs are copied immutable files; all new artifacts belong to /work.
 * The host owns Docker isolation, hard resource ceilings and an external deadline.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

const COMPILED = '/app/server/dist', INPUT = '/inputs', WORK = '/work';
const DEADLINE = 120_000, MIB = 1024 ** 2;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(Error(code), { code }); };
const safeCode = error => {
  if (error?.name === 'ZodError') return 'QUALIFICATION_SCHEMA_REFUSED';
  const value = error?.code ?? error?.message;
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value) ? value : 'QUALIFICATION_FAILED';
};
const result = { schemaVersion: 'wfc.pf.full-network-qualification.v1', status: 'FAIL', code: null, phase: 'setup',
  timings: [], counts: {}, hashes: {}, publicationInvoked: false,
  sampling: { intervalMilliseconds: 100, samples: 0, observedNodeRssBytes: 0,
    interpretation: 'Whole Node process RSS includes worker threads. Main-event-loop samples can miss synchronous parse/clone peaks; external sampling and container limits are required. No exact peak or separate parent/worker RSS is claimed.' } };
const started = performance.now(), controller = new AbortController();
let phaseStarted = started, progressIndex = 0, timer, sampler, executor, workReady = false;
let deadlineFired = false, expectedCancellation = false;
function sample() {
  const bytes = process.memoryUsage.rss();
  if (!Number.isFinite(bytes) || bytes < 0) fail('QUALIFICATION_RSS_UNAVAILABLE');
  result.sampling.samples++; result.sampling.observedNodeRssBytes = Math.max(result.sampling.observedNodeRssBytes, bytes);
}
function current() {
  if (performance.now() - started >= DEADLINE) { deadlineFired = true; controller.abort(); }
  controller.signal.throwIfAborted();
}
async function writeNew(filename, value) {
  const encoded = Buffer.from(JSON.stringify(value));
  if (encoded.length > 65536) fail('QUALIFICATION_RECEIPT_LIMIT');
  const handle = await fs.open(filename, 'wx', 0o600);
  try { await handle.writeFile(encoded); await handle.sync(); } finally { await handle.close(); }
}
async function phase(name) {
  const at = performance.now();
  result.timings.push({ phase: result.phase, milliseconds: at - phaseStarted });
  result.phase = name; phaseStarted = at; sample();
  if (++progressIndex > 32) fail('QUALIFICATION_PROGRESS_LIMIT');
  await writeNew(path.join(WORK, `progress-${String(progressIndex).padStart(4, '0')}.json`), {
    schemaVersion: 'wfc.pf.qualification-progress.v1', phase: name,
    elapsedMilliseconds: at - started, observedNodeRssBytes: result.sampling.observedNodeRssBytes,
  });
}
async function regular(filename, maximum) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > maximum || await fs.realpath(filename) !== filename) fail('QUALIFICATION_INPUT_FILE_INVALID');
  return stat;
}
async function bytes(filename, maximum, expected) {
  const stat = await regular(filename, maximum);
  if (expected && (stat.size !== expected.bytes || !/^[a-f0-9]{64}$/.test(expected.sha256))) fail('QUALIFICATION_INPUT_IDENTITY');
  const value = await fs.readFile(filename);
  if (value.length !== stat.size || expected && hash(value) !== expected.sha256) fail('QUALIFICATION_INPUT_IDENTITY');
  return value;
}
async function fixedModule(relative) { return import(COMPILED + '/' + relative); }

async function main() {
  const { values } = parseArgs({ strict: true, options: { mode: { type: 'string' }, manifest: { type: 'string' }, reverse: { type: 'boolean', default: false } } });
  if (process.platform !== 'linux' || !['union', 'publisher', 'cancel'].includes(values.mode) || values.manifest !== INPUT + '/manifest.json' || process.env.PF_ROOT !== WORK) fail('QUALIFICATION_CONFIGURATION');
  for (const directory of [INPUT, WORK]) { const stat = await fs.lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) fail('QUALIFICATION_DIRECTORY_INVALID'); }
  // Neither an existing receipt nor an existing progress sequence is overwritten.
  for (const name of ['result.json', 'progress-0001.json']) { try { await fs.lstat(path.join(WORK, name)); fail('QUALIFICATION_OUTPUT_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  workReady = true; result.mode = values.mode; result.reversedArrival = values.reverse;
  timer = setTimeout(() => { deadlineFired = true; controller.abort(); }, DEADLINE);
  sampler = setInterval(() => { try { sample(); } catch { controller.abort(); } }, 100);
  await phase('manifest');
  const [{ PREPARATION_LIMITS, preparationPlanSchema, preparationPlanHashInput, preparationPartSchema },
    { canonicalPurposeJson }, { preparationCapacity }, { parsePolicyJson }, { snapshotSchema }, workerModule, storage] = await Promise.all([
    fixedModule('shared/pathfinderPreparation.js'), fixedModule('shared/pathfinderPurposePolicy.js'),
    fixedModule('shared/pathfinderCapacity.js'), fixedModule('server/pathfinder/policyJson.js'),
    fixedModule('server/pathfinder/contracts.js'), fixedModule('server/pathfinder/preparationUnionWorker.js'),
    fixedModule('server/pathfinder/preparationStorage.js'),
  ]);
  const manifestBytes = await bytes(values.manifest, PREPARATION_LIMITS.controlBytes + 8 * MIB);
  const manifest = parsePolicyJson(manifestBytes, { maxBytes: PREPARATION_LIMITS.controlBytes + 8 * MIB });
  if (!manifest || Array.isArray(manifest) || Object.keys(manifest).sort().join(',') !== 'plan,receipts' || !Array.isArray(manifest.receipts) || manifest.receipts.length < 1 || manifest.receipts.length > PREPARATION_LIMITS.parts) fail('QUALIFICATION_MANIFEST_INVALID');
  const plan = preparationPlanSchema.parse(manifest.plan), receipts = manifest.receipts.map(value => preparationPartSchema.parse(value));
  if (Buffer.byteLength(JSON.stringify(plan)) > PREPARATION_LIMITS.controlBytes || plan.diagnostics.length || receipts.length !== plan.partPlan.length ||
      hash(canonicalPurposeJson(preparationPlanHashInput(plan))) !== plan.orderedPlanSha256) fail('QUALIFICATION_PLAN_IDENTITY');
  const { scopeSha256, ...scope } = plan.requestedScope;
  if (hash(canonicalPurposeJson(scope)) !== scopeSha256) fail('QUALIFICATION_PLAN_IDENTITY');
  const payloadRefs = new Set(), partIds = new Set(); let inputBytes = 0;
  for (let index = 0; index < receipts.length; index++) {
    const receipt = receipts[index], part = plan.partPlan[index];
    if (receipt.partId !== part.partId || receipt.partIndex !== index || receipt.sessionId !== plan.id || receipt.sessionPlanSha256 !== plan.orderedPlanSha256 ||
        receipt.modelVersionId !== plan.modelVersionId || receipt.contentFingerprint !== plan.contentFingerprint || receipt.coordinateFrameId !== plan.coordinateFrameId ||
        receipt.scopeSha256 !== part.scopeSha256 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(receipt.payloadRef) ||
        payloadRefs.has(receipt.payloadRef) || partIds.has(receipt.partId)) fail('QUALIFICATION_PART_IDENTITY');
    payloadRefs.add(receipt.payloadRef); partIds.add(receipt.partId); inputBytes += receipt.payloadBytes;
  }
  const capacity = preparationCapacity(plan.limitsProfile);
  if (inputBytes > capacity.validationInputBytes) fail('PREPARATION_VALIDATION_INPUT_LIMIT');
  result.capacity = { profile: plan.limitsProfile, inputBytes: capacity.validationInputBytes, projectionBytes: capacity.projectionInputBytes };
  result.counts = { parts: receipts.length, totalInputBytes: inputBytes,
    expectedPhysicalLeaves: plan.requestedScope.orderedPhysicalLeafIds.length,
    expectedEquipmentObjects: plan.requestedScope.orderedEquipmentObjectIds.length };
  result.hashes = { manifestSha256: hash(manifestBytes), orderedPlanSha256: plan.orderedPlanSha256, orderedScopeSha256: scopeSha256,
    orderedReceiptSha256: hash(canonicalPurposeJson(receipts.map(r => ({ partId: r.partId, partIndex: r.partIndex, payloadRef: r.payloadRef, bytes: r.payloadBytes, sha256: r.payloadSha256 })))) };
  const referencesOnly = plan.limitsProfile === 'wfc.pf.bounded-128m-capture-and-model.v2';
  result.inputMode = referencesOnly ? 'immutable-references' : 'legacy-inline';
  current(); await phase(referencesOnly ? 'reference-stage' : 'parent-load');
  const parts = [];
  // Mirror production: the larger profile passes immutable server references;
  // the worker performs every strict DTO/hash/scope check on its private lane.
  // Preserve legacy inline admission for its unchanged frozen profile.
  // No read source volume or original checkout is mounted by this runner.
  for (const receipt of receipts) {
    current();
    const data = await bytes(INPUT + '/' + receipt.payloadRef + '.json', PREPARATION_LIMITS.partBytes, { bytes: receipt.payloadBytes, sha256: receipt.payloadSha256 });
    if (referencesOnly) {
      const saved = await storage.storePreparationBytes(plan.projectId,plan.id,receipt.payloadRef,data,PREPARATION_LIMITS.partBytes);
      if (saved.bytes !== receipt.payloadBytes || saved.sha256 !== receipt.payloadSha256) fail('QUALIFICATION_PART_IDENTITY');
      parts.push({ partId:receipt.partId,reference:{payloadRef:saved.payloadRef,sha256:saved.sha256,bytes:saved.bytes} });
    } else parts.push({ partId: receipt.partId, payload: snapshotSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))) });
  }
  if (values.reverse) parts.reverse();
  current(); await phase('runner');
  let output;
  if (values.mode === 'cancel') {
    const cancellation = { spawned: false, online: false, abortRequested: false, joined: false, released: false };
    let cancelTimer;
    const run = workerModule.createPreparationUnionRunner({
      target: workerModule.resolvePreparationUnionWorkerTarget,
      spawn: (filename, options) => {
        const worker = new Worker(filename, options); cancellation.spawned = true;
        worker.once('online', () => { cancellation.online = true; cancelTimer = setTimeout(() => { cancellation.abortRequested = true; expectedCancellation = true; controller.abort(); }, 25); });
        worker.once('exit', () => { cancellation.joined = true; });
        return worker;
      },
      residentBytes: () => process.memoryUsage.rss(), storageLockBuffer: storage.preparationStorageLockBuffer,
      releaseStorageOwner: threadId => { storage.releasePreparationStorageOwner(threadId); cancellation.released = true; },
    });
    try { await run(plan, parts, controller.signal); fail('QUALIFICATION_CANCELLATION_NOT_OBSERVED'); }
    catch (error) {
      if (!expectedCancellation || deadlineFired || error?.name !== 'AbortError' || !Object.values(cancellation).every(Boolean)) throw error;
      result.cancellation = cancellation; result.code = 'EXPECTED_CANCELLATION';
    } finally { clearTimeout(cancelTimer); }
  } else if (values.mode === 'publisher') {
    const [{ createConfiguredEngineExecutor }, { createPreparationPublisher, preparedUnionResponseSchema }, { preparationEngineObservation }] = await Promise.all([
      fixedModule('server/pathfinder/engineSession.js'), fixedModule('server/pathfinder/preparationPublisher.js'), fixedModule('server/pathfinder/engineResources.js'),
    ]);
    if (process.env.PF_ENGINE_DLL !== '/opt/pathfinder/PathFinder.ModelRunner.dll') fail('QUALIFICATION_ENGINE_CONFIGURATION');
    await regular(process.env.PF_ENGINE_DLL, 64 * MIB);
    result.hashes.runnerSha256 = hash(await fs.readFile(process.env.PF_ENGINE_DLL));
    executor = createConfiguredEngineExecutor();
    const publisher = createPreparationPublisher(async (request, signal) => {
      await phase('fitting'); current();
      const response = preparedUnionResponseSchema.parse(await executor.execute(request, signal));
      const observed = preparationEngineObservation(request.requestId);
      if (observed) result.engineObservation = observed;
      if (response?.prepared) result.counts.fittingDiagnostics = response.prepared.diagnosticCount;
      result.fitting = { readiness: response.prepared.readiness, counts: response.prepared.counts,
        objectCount: response.prepared.objectCount, segmentCount: response.prepared.segmentCount,
        diagnosticCount: response.prepared.diagnosticCount, engineeringAccepted: false };
      return response;
    });
    // Deliberately call validation only. publish() would require a SQL principal.
    output = await publisher.validateUnion(plan, parts, controller.signal);
  } else output = await workerModule.runPreparationUnion(plan, parts, controller.signal);
  if (output) {
    current(); await phase('verify-output');
    const projection = await storage.readPreparationBlob(plan.projectId, plan.id, output.projection, capacity.projectionInputBytes);
    const indexBytes = await storage.readPreparationBlob(plan.projectId, plan.id, output.traceIndex, 16 * MIB);
    const projected = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(projection));
    const trace = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(indexBytes));
    const expected = new Set(plan.partPlan.flatMap(part => [...part.physicalLeafIds, ...part.equipmentObjectIds, ...part.ancestorObjectIds]));
    const expectedOrder = plan.objectOrder.map(id => 'dbid:' + id).filter(id => expected.has(id));
    const physicalLeaves = new Set(plan.requestedScope.orderedPhysicalLeafIds);
    const actualOrder = projected.objects?.map(object => object.id), traceOrder = trace.objects?.map(object => object.objectId);
    if (canonicalPurposeJson(expectedOrder) !== canonicalPurposeJson(actualOrder) || canonicalPurposeJson(actualOrder) !== canonicalPurposeJson(traceOrder) ||
        projected.model?.projectId !== plan.projectId || projected.model?.modelVersionId !== plan.modelVersionId || projected.model?.contentSha256 !== plan.contentFingerprint ||
        trace.sessionId !== plan.id || trace.coordinateFrameId !== plan.coordinateFrameId || output.counts.physicalLeaves !== expectedOrder.filter(id => physicalLeaves.has(id)).length) fail('QUALIFICATION_OUTPUT_IDENTITY');
    result.counts = { ...result.counts, ...output.counts, projectionBytes: projection.length, traceIndexBytes: indexBytes.length };
    result.hashes = { ...result.hashes, projectionSha256: hash(projection), traceIndexSha256: hash(indexBytes), objectOrderSha256: hash(canonicalPurposeJson(actualOrder)) };
    if (result.hashes.projectionSha256 !== output.projection.sha256 || result.hashes.traceIndexSha256 !== output.traceIndex.sha256) fail('QUALIFICATION_OUTPUT_IDENTITY');
    // Private follow-up only: immutable server-owned refs, never business rows.
    result.references = { snapshotId: output.projection.payloadRef, projection: output.projection, traceIndex: output.traceIndex, counts: output.counts };
  }
  if (!expectedCancellation) current();
  result.status = 'PASS'; result.code ??= 'COMPLETED';
}

try { await main(); }
catch (error) { result.status = 'FAIL'; result.code = deadlineFired ? 'QUALIFICATION_DEADLINE' : safeCode(error); }
finally {
  clearTimeout(timer); clearInterval(sampler);
  if (executor) try { await executor.close(); } catch (error) { result.status = 'FAIL'; result.code = safeCode(error); }
  result.timings.push({ phase: result.phase, milliseconds: performance.now() - phaseStarted });
  result.totalMilliseconds = performance.now() - started;
  try { sample(); } catch { result.status = 'FAIL'; result.code = 'QUALIFICATION_RSS_UNAVAILABLE'; }
  if (workReady) try { await writeNew(path.join(WORK, 'result.json'), result); } catch { result.status = 'FAIL'; result.code = 'QUALIFICATION_RECEIPT_WRITE_FAILED'; }
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}
