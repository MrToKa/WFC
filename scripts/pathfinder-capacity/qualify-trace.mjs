/** Private, unpublished capacity qualification using actual converted geometry.
 * The host must supply a read-only successful publisher trial at /union, copied
 * immutable inputs at /inputs, and a fresh bounded /work with no database/network.
 * This exercises production export/trace workers; it never invokes SQL publication.
 */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

const COMPILED = '/app/server/dist', INPUT = '/inputs', UNION = '/union', WORK = '/work';
const MIB = 1024 ** 2, DEADLINE = 140_000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(Error(code), { code }); };
const safeCode = error => error?.name === 'ZodError' ? 'QUALIFICATION_SCHEMA_REFUSED'
  : typeof (error?.code ?? error?.message) === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code ?? error.message) ? error.code ?? error.message : 'QUALIFICATION_TRACE_FAILED';
const result = { schemaVersion: 'wfc.pf.full-network-trace-qualification.v1', status: 'FAIL', code: null, phase: 'setup',
  scope: { inputKind: 'copied-real-converted', aggregateEnvelope: 'unpublished-capacity-only', geometryRevision: '0',
    registryPublication: 'not-performed', sqlTracePublication: 'not-performed', engineeringAccepted: false, nativeParity: 'not-performed',
    declaredLengthAudit: 'not-included', actorProvenance: 'exact-root-staged-session-actor',
    evidenceValidation: 'exact-byte-hash-and-capture-binding; individual meshes were already validated by the normal API' },
  timings: [], counts: {}, hashes: {}, publicationInvoked: false,
  sampling: { intervalMilliseconds: 100, samples: 0, observedNodeRssBytes: 0,
    interpretation: 'Whole Node process RSS includes worker threads; main-event-loop samples miss synchronous parse/clone peaks. External sampling and Docker ceilings remain required; no exact peak or separate parent/worker RSS is claimed.' } };
const started = performance.now(), controller = new AbortController();
let phaseStarted = started, progressIndex = 0, timer, sampler, executor, workReady = false, deadlineFired = false;
function sample() { const bytes = process.memoryUsage.rss(); if (!Number.isFinite(bytes) || bytes < 0) fail('QUALIFICATION_RSS_UNAVAILABLE'); result.sampling.samples++; result.sampling.observedNodeRssBytes = Math.max(result.sampling.observedNodeRssBytes, bytes); }
function current() { if (performance.now() - started >= DEADLINE) { deadlineFired = true; controller.abort(); } controller.signal.throwIfAborted(); }
async function writeBytes(filename, bytes) { const handle = await fs.open(filename, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } }
async function writeJson(filename, value) { const bytes = Buffer.from(JSON.stringify(value)); if (bytes.length > 65536) fail('QUALIFICATION_RECEIPT_LIMIT'); await writeBytes(filename, bytes); }
async function phase(name) { const now = performance.now(); result.timings.push({ phase: result.phase, milliseconds: now - phaseStarted }); result.phase = name; phaseStarted = now; sample(); if (++progressIndex > 32) fail('QUALIFICATION_PROGRESS_LIMIT'); await writeJson(path.join(WORK, `progress-${String(progressIndex).padStart(4, '0')}.json`), { schemaVersion: 'wfc.pf.qualification-progress.v1', phase: name, elapsedMilliseconds: now - started, observedNodeRssBytes: result.sampling.observedNodeRssBytes }); }
async function directory(filename) { const stat = await fs.lstat(filename); if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(filename) !== filename) fail('QUALIFICATION_DIRECTORY_INVALID'); }
async function regular(filename, maximum, expected) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > maximum || await fs.realpath(filename) !== filename || expected && stat.size !== expected.bytes) fail('QUALIFICATION_INPUT_FILE_INVALID');
  return stat;
}
async function read(filename, maximum, expected) { const stat = await regular(filename, maximum, expected), bytes = await fs.readFile(filename); if (bytes.length !== stat.size || expected && hash(bytes) !== expected.sha256) fail('QUALIFICATION_INPUT_IDENTITY'); return bytes; }
async function verifyStream(filename, maximum, expected) { await regular(filename, maximum, expected); const digest = createHash('sha256'); let bytes = 0; for await (const chunk of createReadStream(filename)) { current(); bytes += chunk.length; if (bytes > expected.bytes) fail('QUALIFICATION_INPUT_IDENTITY'); digest.update(chunk); } if (bytes !== expected.bytes || digest.digest('hex') !== expected.sha256) fail('QUALIFICATION_INPUT_IDENTITY'); }
const module = relative => import(COMPILED + '/' + relative);

async function main() {
  const { values } = parseArgs({ strict: true, options: { manifest: { type: 'string', default: INPUT + '/manifest.json' } } });
  if (process.platform !== 'linux' || values.manifest !== INPUT + '/manifest.json' || process.env.PF_ROOT !== WORK || process.env.PF_ENGINE_DLL !== '/opt/pathfinder/PathFinder.ModelRunner.dll') fail('QUALIFICATION_CONFIGURATION');
  for (const name of [INPUT, UNION, WORK]) await directory(name);
  for (const name of ['result.json', 'progress-0001.json']) { try { await fs.lstat(path.join(WORK, name)); fail('QUALIFICATION_OUTPUT_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  workReady = true;
  timer = setTimeout(() => { deadlineFired = true; controller.abort(); }, DEADLINE);
  sampler = setInterval(() => { try { sample(); } catch { controller.abort(); } }, 100);
  await phase('manifest');
  const [preparation, purpose, capacityModule, json, builder, traceContract, storage, traceStorage, worker, engine, evidenceModule] = await Promise.all([
    module('shared/pathfinderPreparation.js'), module('shared/pathfinderPurposePolicy.js'), module('shared/pathfinderCapacity.js'),
    module('server/pathfinder/policyJson.js'), module('server/pathfinder/geometryTraceBuilder.js'), module('shared/pathfinderGeometryTrace.js'),
    module('server/pathfinder/preparationStorage.js'), module('server/pathfinder/geometryTraceStorage.js'), module('server/pathfinder/geometryTraceWorker.js'),
    module('server/pathfinder/geometryTraceEngine.js'), module('viewer-runtime/capture-evidence.mjs'),
  ]);
  const { PREPARATION_LIMITS, preparationPlanSchema, preparationPlanHashInput, preparationPartSchema, preparationAggregateSchema, preparationBlobSchema, preparationCountsSchema } = preparation;
  const { canonicalPurposeJson, policyUuidSchema } = purpose, { GEOMETRY_TRACE_LIMITS } = traceContract;
  const manifestBytes = await read(values.manifest, PREPARATION_LIMITS.controlBytes + 8 * MIB), manifest = json.parsePolicyJson(manifestBytes, { maxBytes: PREPARATION_LIMITS.controlBytes + 8 * MIB });
  if (!manifest || Array.isArray(manifest) || Object.keys(manifest).sort().join(',') !== 'plan,receipts' || !Array.isArray(manifest.receipts) || manifest.receipts.length < 1 || manifest.receipts.length > PREPARATION_LIMITS.parts) fail('QUALIFICATION_MANIFEST_INVALID');
  const plan = preparationPlanSchema.parse(manifest.plan), receipts = manifest.receipts.map(value => preparationPartSchema.parse(value));
  const { scopeSha256, ...scopeBody } = plan.requestedScope;
  if (Buffer.byteLength(JSON.stringify(plan)) > PREPARATION_LIMITS.controlBytes || plan.diagnostics.length || receipts.length !== plan.partPlan.length || hash(canonicalPurposeJson(preparationPlanHashInput(plan))) !== plan.orderedPlanSha256 || hash(canonicalPurposeJson(scopeBody)) !== scopeSha256) fail('QUALIFICATION_PLAN_IDENTITY');
  const receiptIds = new Set(); let inputBytes = 0;
  for (let index = 0; index < receipts.length; index++) {
    const receipt = receipts[index], part = plan.partPlan[index];
    if (receiptIds.has(receipt.partId) || receipt.partIndex !== index || receipt.partId !== part.partId || receipt.sessionId !== plan.id || receipt.sessionPlanSha256 !== plan.orderedPlanSha256 || receipt.modelVersionId !== plan.modelVersionId || receipt.contentFingerprint !== plan.contentFingerprint || receipt.coordinateFrameId !== plan.coordinateFrameId || receipt.scopeSha256 !== part.scopeSha256) fail('QUALIFICATION_PART_IDENTITY');
    receiptIds.add(receipt.partId); inputBytes += receipt.payloadBytes;
  }
  const capacity = capacityModule.preparationCapacity(plan.limitsProfile);
  if (inputBytes > capacity.validationInputBytes) fail('PREPARATION_VALIDATION_INPUT_LIMIT');
  const unionResultBytes = await read(UNION + '/result.json', 65536), unionResult = json.parsePolicyJson(unionResultBytes, { maxBytes: 65536 });
  const receiptHash = hash(canonicalPurposeJson(receipts.map(r => ({ partId: r.partId, partIndex: r.partIndex, payloadRef: r.payloadRef, bytes: r.payloadBytes, sha256: r.payloadSha256 }))));
  if (unionResult?.schemaVersion !== 'wfc.pf.full-network-qualification.v1' || unionResult.status !== 'PASS' || unionResult.mode !== 'publisher' || unionResult.code !== 'COMPLETED' || unionResult.publicationInvoked !== false || unionResult.hashes?.manifestSha256 !== hash(manifestBytes) || unionResult.hashes?.orderedPlanSha256 !== plan.orderedPlanSha256 || unionResult.hashes?.orderedReceiptSha256 !== receiptHash) fail('QUALIFICATION_UNION_NOT_PROVEN');
  const references = unionResult.references;
  if (!references || Object.keys(references).sort().join(',') !== 'counts,projection,snapshotId,traceIndex') fail('QUALIFICATION_UNION_NOT_PROVEN');
  const projection = preparationBlobSchema.parse(references.projection), traceIndex = preparationBlobSchema.parse(references.traceIndex), counts = preparationCountsSchema.parse(references.counts);
  policyUuidSchema.parse(references.snapshotId);
  if (references.snapshotId !== projection.payloadRef || projection.schemaVersion !== 'pathfinder.model.snapshot.v1' || traceIndex.schemaVersion !== 'wfc.pf.preparation-trace-index.v1' || projection.payloadRef === traceIndex.payloadRef || projection.bytes > capacity.projectionInputBytes || traceIndex.bytes > 16 * MIB || projection.sha256 !== unionResult.hashes.projectionSha256 || traceIndex.sha256 !== unionResult.hashes.traceIndexSha256 || counts.physicalLeaves !== plan.requestedScope.orderedPhysicalLeafIds.length || Object.entries(counts).some(([key, value]) => unionResult.counts?.[key] !== value)) fail('QUALIFICATION_UNION_IDENTITY');
  result.counts = { parts: receipts.length, totalInputBytes: inputBytes, ...counts };
  result.hashes = { manifestSha256: hash(manifestBytes), orderedPlanSha256: plan.orderedPlanSha256, orderedReceiptSha256: receiptHash,
    unionResultSha256: hash(unionResultBytes), projectionSha256: projection.sha256, traceIndexSha256: traceIndex.sha256 };
  result.capacity = { profile: plan.limitsProfile, projectionBytes: capacity.projectionInputBytes };
  current(); await phase('copy-union');
  const sourceBlobPath = ref => UNION + '/preparations/' + plan.projectId + '/' + plan.id + '/' + ref.payloadRef + '.json';
  const stageUnionBlob = async (ref, maximum, cache) => {
    const data = await read(sourceBlobPath(ref), maximum, ref);
    const saved = await storage.storePreparationBytes(plan.projectId, plan.id, ref.payloadRef, data, maximum);
    if (saved.sha256 !== ref.sha256 || saved.bytes !== ref.bytes) fail('QUALIFICATION_COPY_IDENTITY');
    if (cache) {
      await verifyStream(UNION + '/snapshots/' + ref.payloadRef + '.json', maximum, ref);
      await fs.mkdir(WORK + '/snapshots', { mode: 0o700 }); await directory(WORK + '/snapshots');
      await writeBytes(WORK + '/snapshots/' + ref.payloadRef + '.json', data);
      const dir = await fs.open(WORK + '/snapshots', 'r'); try { await dir.sync(); } finally { await dir.close(); }
      await verifyStream(WORK + '/snapshots/' + ref.payloadRef + '.json', maximum, ref);
    }
  };
  await stageUnionBlob(projection, capacity.projectionInputBytes, true); await stageUnionBlob(traceIndex, 16 * MIB, false);
  current(); await phase('capture-evidence');
  const sidecarBytes = await read(INPUT + '/trace-input.json', 4 * MIB), sidecar = json.parsePolicyJson(sidecarBytes, { maxBytes: 4 * MIB });
  if (!sidecar || Array.isArray(sidecar) || Object.keys(sidecar).sort().join(',') !== 'actorId,evidence,schemaVersion' || sidecar.schemaVersion !== 'wfc.pf.qualification-trace-input.v1' || !Array.isArray(sidecar.evidence) || sidecar.evidence.length > receipts.length) fail('QUALIFICATION_TRACE_INPUT_INVALID');
  const actorId = policyUuidSchema.parse(sidecar.actorId); if (actorId !== sidecar.actorId) fail('QUALIFICATION_ACTOR_IDENTITY');
  const evidence = [], evidencePartIds = new Set(), evidenceBlobIds = new Set();
  for (const item of sidecar.evidence) {
    current();
    if (!item || Object.keys(item).sort().join(',') !== 'blob,partId' || !item.blob || Object.keys(item.blob).sort().join(',') !== 'bytes,payloadRef,sha256') fail('QUALIFICATION_EVIDENCE_IDENTITY');
    policyUuidSchema.parse(item.partId); const blob = preparationBlobSchema.omit({ schemaVersion: true }).parse(item.blob);
    const receipt = receipts.find(receipt => receipt.partId === item.partId);
    if (!receipt || evidencePartIds.has(item.partId) || evidenceBlobIds.has(blob.payloadRef) || blob.bytes > GEOMETRY_TRACE_LIMITS.evidenceBytes) fail('QUALIFICATION_EVIDENCE_IDENTITY');
    const data = await read(INPUT + '/' + blob.payloadRef + '.json', GEOMETRY_TRACE_LIMITS.evidenceBytes, blob), payload = json.parsePolicyJson(data, { maxBytes: GEOMETRY_TRACE_LIMITS.evidenceBytes });
    if (!evidenceModule.validateCompletedCaptureEvidence(payload) || !await evidenceModule.verifyCompletedCaptureEvidence(payload)) fail('QUALIFICATION_EVIDENCE_IDENTITY');
    const binding = payload.binding;
    if (binding.projectId !== plan.projectId || binding.sessionId !== plan.id || binding.partId !== receipt.partId || binding.partPayloadSha256 !== receipt.payloadSha256 || binding.modelVersionId !== plan.modelVersionId || binding.contentFingerprint !== plan.contentFingerprint || binding.selectionRevision !== plan.selectionRevision || binding.planSha256 !== plan.orderedPlanSha256 || binding.coordinateFrameId !== plan.coordinateFrameId || !binding.loadId) fail('QUALIFICATION_EVIDENCE_BINDING');
    const stored = await storage.storePreparationBytes(plan.projectId, plan.id, blob.payloadRef, data, GEOMETRY_TRACE_LIMITS.evidenceBytes);
    if (stored.sha256 !== blob.sha256 || stored.bytes !== blob.bytes) fail('QUALIFICATION_COPY_IDENTITY');
    evidencePartIds.add(item.partId); evidenceBlobIds.add(blob.payloadRef); evidence.push({ partId: item.partId, blob });
  }
  result.hashes.traceInputSha256 = hash(sidecarBytes); result.counts.captureEvidenceParts = evidence.length; result.counts.missingCaptureEvidenceParts = receipts.length - evidence.length;
  current(); await phase('fitted-export');
  const { createConfiguredEngineExecutor } = await module('server/pathfinder/engineSession.js');
  executor = createConfiguredEngineExecutor(); let actualDiagnostics = null;
  const adapters = engine.createGeometryTraceEngine(async (request, signal) => {
    const response = await executor.execute(request, signal); actualDiagnostics = response.prepared?.diagnostics; return response;
  });
  const fingerprint = await adapters.getRuntimeFingerprint(), exportId = randomUUID();
  const built = await traceStorage.withFittedExportAllowance(exportId, async () => {
    const reference = await adapters.exportFittedTrace({ projectId: plan.projectId, modelVersionId: plan.modelVersionId, snapshotId: projection.payloadRef, snapshotSha256: projection.sha256, exportId, maxBytes: GEOMETRY_TRACE_LIMITS.exportBytes }, controller.signal);
    if (!Array.isArray(actualDiagnostics) || actualDiagnostics.some(value => typeof value !== 'string') || reference.counts.objects !== counts.objects || reference.counts.segments !== counts.physicalLeaves) fail('QUALIFICATION_FITTED_IDENTITY');
    const createdAt = new Date().toISOString();
    // Revision 0 and this timestamp are schema-required PRIVATE TRIAL metadata.
    // They do not assert that a registry revision or aggregate was published.
    const aggregate = preparationAggregateSchema.parse({
      schemaVersion: 'wfc.pf.geometry-aggregate.v1', id: randomUUID(), projectId: plan.projectId, sessionId: plan.id, artifactId: projection.payloadRef,
      modelVersionId: plan.modelVersionId, contentFingerprint: plan.contentFingerprint, selectionRevision: plan.selectionRevision,
      catalogRevision: plan.catalogRevision, routingContentSha256: plan.routingContentSha256, routingPolicyRevision: plan.routingPolicyRevision,
      routingPolicySha256: plan.routingPolicySha256, resolutionRevision: plan.resolutionRevision, locationRegistryRevision: plan.locationRegistryRevision,
      geometryRevision: '0', sourceLocationRegistryRevision: plan.locationRegistryRevision, coordinateFrameId: plan.coordinateFrameId,
      orderedPlanSha256: plan.orderedPlanSha256, orderedScopeSha256: scopeSha256,
      partReferences: receipts.map(receipt => ({ partId: receipt.partId, partIndex: receipt.partIndex, payloadSha256: receipt.payloadSha256 })),
      projection, traceIndex, counts, requestedScopeComplete: true, wholePlantGeometry: false,
      engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', rulesVersion: 'pf2.rules.v1/wfc-mto-v1', diagnostics: actualDiagnostics,
      engineeringAccepted: false, nativeParity: 'not-performed', publishedAt: createdAt,
    });
    const frozen = builder.geometryTraceFrozenSchema.parse({ traceId: randomUUID(), exportId, fittedBlobId: randomUUID(), recordsBlobId: randomUUID(), frozenBlobId: randomUUID(), aggregate, plan, runtimeFingerprint: fingerprint, evidence, declaredLengths: [], createdAt, createdBy: actorId });
    current(); await phase('trace-worker');
    const frozenBlob = await storage.storePreparationBlob(plan.projectId, plan.id, frozen.frozenBlobId, frozen, GEOMETRY_TRACE_LIMITS.frozenBytes);
    const output = await worker.runGeometryTraceWorker({ projectId: plan.projectId, sessionId: plan.id, traceId: frozen.traceId, exportId, frozenBlob, exportReference: reference }, controller.signal);
    return { output, frozen, reference };
  });
  current(); await phase('verify-output');
  const readOutput = (ref, maximum) => storage.readPreparationBlob(plan.projectId, plan.id, ref, maximum);
  const manifestOutput = traceContract.geometryTraceManifestSchema.parse(json.parsePolicyJson(await readOutput(built.output.manifest, GEOMETRY_TRACE_LIMITS.manifestBytes), { maxBytes: GEOMETRY_TRACE_LIMITS.manifestBytes }));
  const records = json.parsePolicyJson(await readOutput(built.output.objectRecords, 32 * MIB), { maxBytes: 32 * MIB });
  const { contentSha256, ...manifestBody } = manifestOutput;
  if (builder.geometryTraceHash(manifestBody) !== contentSha256 || manifestOutput.id !== built.frozen.traceId || manifestOutput.aggregateId !== built.frozen.aggregate.id || manifestOutput.projectId !== plan.projectId || manifestOutput.modelVersionId !== plan.modelVersionId || manifestOutput.sessionId !== plan.id || !Array.isArray(records) || records.length !== counts.objects || built.output.objectCount !== counts.objects || canonicalPurposeJson(manifestOutput.runtimeFingerprint) !== canonicalPurposeJson(fingerprint) || manifestOutput.objectRecords.sha256 !== built.output.objectRecords.sha256 || manifestOutput.fittedTrace.sha256 !== built.reference.sha256 || manifestOutput.fullDiagnostics.sha256 !== built.reference.sha256) fail('QUALIFICATION_TRACE_OUTPUT_IDENTITY');
  const summaries = []; let next = 0;
  for (const page of built.output.indexPages) {
    current(); const rows = json.parsePolicyJson(await readOutput(page, GEOMETRY_TRACE_LIMITS.pageBytes), { maxBytes: GEOMETRY_TRACE_LIMITS.pageBytes });
    if (!Array.isArray(rows) || rows.length !== page.rowCount || page.firstIndex !== next) fail('QUALIFICATION_TRACE_PAGE_IDENTITY');
    for (const row of rows) {
      const record = records[next];
      if (row.order_index !== next || row.object_id !== record?.identity?.objectId || row.summary?.objectId !== record?.identity?.objectId || row.summary?.recordSha256 !== builder.geometryTraceHash(record) || builder.geometryTraceHash(row.record) !== builder.geometryTraceHash(record)) fail('QUALIFICATION_TRACE_PAGE_IDENTITY');
      summaries.push(row.summary); next++;
    }
  }
  if (next !== records.length || builder.geometryTraceHash(summaries) !== manifestOutput.objectIndexSha256) fail('QUALIFICATION_TRACE_PAGE_IDENTITY');
  next = 0;
  for (const page of built.output.diagnosticPages) {
    current(); const rows = json.parsePolicyJson(await readOutput(page, GEOMETRY_TRACE_LIMITS.pageBytes), { maxBytes: GEOMETRY_TRACE_LIMITS.pageBytes });
    if (!Array.isArray(rows) || rows.length !== page.rowCount || page.firstIndex !== next || rows.some((row, index) => row.order_index !== next + index || typeof row.message !== 'string')) fail('QUALIFICATION_TRACE_PAGE_IDENTITY');
    next += rows.length;
  }
  if (next !== built.reference.counts.diagnostics || built.output.diagnosticCount !== next) fail('QUALIFICATION_TRACE_PAGE_IDENTITY');
  if (canonicalPurposeJson(await adapters.getRuntimeFingerprint()) !== canonicalPurposeJson(fingerprint)) fail('GEOMETRY_TRACE_IMPLEMENTATION_CHANGED');
  result.counts = { ...result.counts, traceObjects: records.length, fittedSegments: built.reference.counts.segments, diagnostics: next,
    indexPages: built.output.indexPages.length, diagnosticPages: built.output.diagnosticPages.length,
    fittedTraceBytes: built.reference.bytes, objectRecordsBytes: built.output.objectRecords.bytes };
  result.hashes = { ...result.hashes, derivationSha256: fingerprint.derivationSha256, runnerSha256: fingerprint.runnerSha256,
    fittedTraceSha256: built.reference.sha256, traceManifestBlobSha256: built.output.manifest.sha256, traceManifestContentSha256: contentSha256,
    objectRecordsSha256: built.output.objectRecords.sha256, objectIndexSha256: manifestOutput.objectIndexSha256,
    objectOrderSha256: builder.geometryTraceHash(records.map(record => record.identity.objectId)) };
  if (result.hashes.objectOrderSha256 !== unionResult.hashes.objectOrderSha256) fail('QUALIFICATION_TRACE_ORDER_CHANGED');
  result.references = { manifest: built.output.manifest, fittedTrace: built.output.fittedTrace, objectRecords: built.output.objectRecords };
  current(); result.status = 'PASS'; result.code = 'COMPLETED';
}

try { await main(); }
catch (error) { result.status = 'FAIL'; result.code = deadlineFired ? 'QUALIFICATION_DEADLINE' : safeCode(error); }
finally {
  clearTimeout(timer); clearInterval(sampler);
  if (executor) try { await executor.close(); } catch (error) { result.status = 'FAIL'; result.code = safeCode(error); }
  result.timings.push({ phase: result.phase, milliseconds: performance.now() - phaseStarted }); result.totalMilliseconds = performance.now() - started;
  try { sample(); } catch { result.status = 'FAIL'; result.code = 'QUALIFICATION_RSS_UNAVAILABLE'; }
  if (workReady) try { await writeJson(WORK + '/result.json', result); } catch { result.status = 'FAIL'; result.code = 'QUALIFICATION_RECEIPT_WRITE_FAILED'; }
  process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = result.status === 'PASS' ? 0 : 1;
}
