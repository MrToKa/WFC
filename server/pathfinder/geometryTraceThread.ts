import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { policyUuidSchema as uuid, policyHashSchema as hash, canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { GEOMETRY_TRACE_LIMITS, fittedTraceReferenceSchema, geometryTraceManifestSchema } from '../../shared/pathfinderGeometryTrace.js';
import { preparationCapacity } from '../../shared/pathfinderCapacity.js';
import { preparationPlanHashInput } from '../../shared/pathfinderPreparation.js';
import { buildGeometryTrace, geometryTraceFrozenSchema, geometryTraceHash, objectRevisionId } from './geometryTraceBuilder.js';
import type { PreparationTraceIndex } from '../../shared/preparationMerge.js';
import { parsePolicyJson } from './policyJson.js';
import { snapshotSchema } from './contracts.js';
import { validateCompletedCaptureEvidence, verifyCompletedCaptureEvidence } from '../../viewer-runtime/capture-evidence.mjs';

const blob = z.object({ payloadRef: uuid, sha256: hash, bytes: z.number().int().positive().max(256 * 1024 ** 2) }).strict();
const page = blob.extend({ rowCount: z.number().int().positive().max(100), firstIndex: z.number().int().nonnegative().max(1_000_000) });
const lockBuffer = z.instanceof(SharedArrayBuffer).refine(v => v.byteLength === 4);
export const geometryTraceThreadInputSchema = z.object({ schemaVersion: z.literal('wfc.pf.geometry-trace-thread.v1'), requestId: uuid, projectId: uuid, sessionId: uuid, traceId: uuid, exportId: uuid, frozenBlob: blob.refine(v => v.bytes <= GEOMETRY_TRACE_LIMITS.frozenBytes), exportReference: fittedTraceReferenceSchema.optional(), storageLockBuffer: lockBuffer }).strict();
export const geometryEvidenceThreadInputSchema = z.object({ schemaVersion: z.literal('wfc.pf.geometry-evidence-thread.v1'), requestId: uuid, projectId: uuid, sessionId: uuid, partId: uuid, evidenceBlob: blob.refine(v => v.bytes <= GEOMETRY_TRACE_LIMITS.evidenceBytes), partBlob: blob.refine(v => v.bytes <= 64 * 1024 ** 2), expected: z.object({ modelVersionId: uuid, contentFingerprint: hash, selectionRevision: z.string(), planSha256: hash, coordinateFrameId: uuid }).strict(), storageLockBuffer: lockBuffer }).strict();
export const geometryTraceThreadResultSchema = z.object({ schemaVersion: z.literal('wfc.pf.geometry-trace-build-result.v1'), manifest: blob.refine(v => v.bytes <= GEOMETRY_TRACE_LIMITS.manifestBytes), fittedTrace: blob.refine(v => v.bytes <= GEOMETRY_TRACE_LIMITS.exportBytes), transientExport: fittedTraceReferenceSchema, objectRecords: blob.refine(v => v.bytes <= 32 * 1024 ** 2), indexPages: z.array(page.refine(v => v.bytes <= GEOMETRY_TRACE_LIMITS.pageBytes && v.rowCount <= 50)).min(1).max(4096), diagnosticPages: z.array(page.refine(v => v.bytes <= GEOMETRY_TRACE_LIMITS.pageBytes)).max(1000), objectCount: z.number().int().positive().max(1_000_000), diagnosticCount: z.number().int().nonnegative().max(GEOMETRY_TRACE_LIMITS.diagnostics) }).strict().refine(v => v.indexPages.reduce((n, p) => n + p.rowCount, 0) === v.objectCount && v.diagnosticPages.reduce((n, p) => n + p.rowCount, 0) === v.diagnosticCount);
export const geometryEvidenceThreadResultSchema = z.object({ schemaVersion: z.literal('wfc.pf.geometry-evidence-validated.v1'), partId: uuid, validatedPartSha256: hash, evidenceBlob: blob }).strict();
const taskResult = z.union([geometryTraceThreadResultSchema, geometryEvidenceThreadResultSchema]);
export type GeometryTraceThreadInput = z.infer<typeof geometryTraceThreadInputSchema>;
export type GeometryTraceThreadResult = z.infer<typeof geometryTraceThreadResultSchema>;
export type GeometryEvidenceThreadInput = z.infer<typeof geometryEvidenceThreadInputSchema>;
export type GeometryEvidenceThreadResult = z.infer<typeof geometryEvidenceThreadResultSchema>;
export type GeometryThreadResult = z.infer<typeof taskResult>;
export const geometryTraceThreadMessageSchema = z.discriminatedUnion('type', [z.object({ schemaVersion: z.literal('wfc.pf.geometry-trace-message.v1'), requestId: uuid, type: z.literal('result'), result: taskResult }).strict(), z.object({ schemaVersion: z.literal('wfc.pf.geometry-trace-message.v1'), requestId: uuid, type: z.literal('error'), code: z.enum(['GEOMETRY_TRACE_BUILD_LIMIT', 'GEOMETRY_TRACE_BUILD_INVALID', 'GEOMETRY_TRACE_BUILD_FAILED']) }).strict()]);
type Blob = z.infer<typeof blob>;
export interface GeometryTraceThreadStorage { readPreparationBlob: (project: string, session: string, ref: Blob, limit: number) => Promise<Buffer>; storePreparationBlob: (project: string, session: string, id: string, value: unknown, limit: number) => Promise<Blob>; readFittedExport: typeof import('./geometryTraceStorage.js').readFittedExport; adoptFittedExport: typeof import('./geometryTraceStorage.js').adoptFittedExport; }
const traceIndexSchema = z.object({ schemaVersion: z.literal('wfc.pf.preparation-trace-index.v1'), sessionId: uuid, coordinateFrameId: uuid, objects: z.array(z.object({ objectId: z.string().min(1).max(256), projectTrayId: uuid.nullable(), rootObjectId: z.string().max(256).nullable(), geometryRole: z.enum(['hierarchy', 'object', 'routing-leaf']), partIds: z.array(uuid).min(1).max(4096).refine(v => new Set(v).size === v.length) }).strict()).max(1_000_000) }).strict();
/** All large parse/clone/hash/record staging runs inside the bounded worker. */
export async function executeGeometryTraceThread(input: GeometryTraceThreadInput, storage: GeometryTraceThreadStorage): Promise<GeometryTraceThreadResult> {
  const read = (ref: Blob, limit: number) => storage.readPreparationBlob(input.projectId, input.sessionId, ref, limit);
  const frozen = geometryTraceFrozenSchema.parse(parsePolicyJson(await read(input.frozenBlob, GEOMETRY_TRACE_LIMITS.frozenBytes), { maxBytes: GEOMETRY_TRACE_LIMITS.frozenBytes }));
  // The capacity belongs to the server-frozen, hashed plan. Neither the worker
  // envelope nor an export/client request can select a larger projection bound.
  if (frozen.aggregate.orderedPlanSha256 !== frozen.plan.orderedPlanSha256 || geometryTraceHash(preparationPlanHashInput(frozen.plan)) !== frozen.plan.orderedPlanSha256) throw Error('GEOMETRY_TRACE_BUILD_INVALID');
  const projectionInputBytes = preparationCapacity(frozen.plan.limitsProfile).projectionInputBytes;
  if (frozen.traceId !== input.traceId || frozen.exportId !== input.exportId || frozen.aggregate.projectId !== input.projectId || frozen.aggregate.sessionId !== input.sessionId || frozen.aggregate.projection.bytes > projectionInputBytes || frozen.aggregate.traceIndex.bytes > 16 * 1024 ** 2) throw Error('GEOMETRY_TRACE_BUILD_LIMIT');
  const exported = await storage.readFittedExport(input.exportId, input.exportReference);
  const fittedBlob = await storage.adoptFittedExport(input.projectId, input.sessionId, frozen.fittedBlobId, exported);
  const snapshot = parsePolicyJson(await read(frozen.aggregate.projection, projectionInputBytes), { maxBytes: projectionInputBytes });
  const traceIndex = traceIndexSchema.parse(parsePolicyJson(await read(frozen.aggregate.traceIndex, 16 * 1024 ** 2), { maxBytes: 16 * 1024 ** 2 })) as PreparationTraceIndex;
  for (const e of frozen.evidence) await read(e.blob, GEOMETRY_TRACE_LIMITS.evidenceBytes);
  const built = buildGeometryTrace({ ...frozen, snapshot, traceIndex, fitted: exported.payload, fittedBlob });
  const store = (id: string, value: unknown, limit: number) => storage.storePreparationBlob(input.projectId, input.sessionId, id, value, limit);
  const objectRecords = await store(frozen.recordsBlobId, built.records, 32 * 1024 ** 2);
  if (canonicalPurposeJson(objectRecords) !== canonicalPurposeJson(built.manifest.objectRecords)) throw Error('GEOMETRY_TRACE_BUILD_INVALID');
  const manifest = await store(objectRevisionId(input.traceId, 'manifest-blob'), built.manifest, GEOMETRY_TRACE_LIMITS.manifestBytes);
  const indexPages: z.infer<typeof page>[] = [], diagnosticPages: z.infer<typeof page>[] = [];
  let at = 0;
  while (at < built.records.length) {
    const firstIndex = at, rows: unknown[] = []; let bytes = 2;
    while (at < built.records.length && rows.length < GEOMETRY_TRACE_LIMITS.pageRows) {
      const record = built.records[at], row = { id: record.id, object_id: record.identity.objectId, order_index: at, project_tray_id: record.catalog.projectTrayId, summary: built.summaries[at], record }, rowBytes = Buffer.byteLength(canonicalPurposeJson(row)) + 1;
      if (bytes + rowBytes > GEOMETRY_TRACE_LIMITS.pageBytes) break; rows.push(row); bytes += rowBytes; at++;
    }
    if (!rows.length || indexPages.length >= 4096) throw Error('GEOMETRY_TRACE_BUILD_LIMIT');
    indexPages.push({ ...await store(objectRevisionId(input.traceId, 'index-page:' + indexPages.length), rows, GEOMETRY_TRACE_LIMITS.pageBytes), rowCount: rows.length, firstIndex });
  }
  for (let firstIndex = 0; firstIndex < exported.payload.diagnostics.length; firstIndex += 100) {
    const rows = exported.payload.diagnostics.slice(firstIndex, firstIndex + 100).map((message, i) => ({ order_index: firstIndex + i, message }));
    diagnosticPages.push({ ...await store(objectRevisionId(input.traceId, 'diagnostics-page:' + diagnosticPages.length), rows, GEOMETRY_TRACE_LIMITS.pageBytes), rowCount: rows.length, firstIndex });
  }
  return geometryTraceThreadResultSchema.parse({ schemaVersion: 'wfc.pf.geometry-trace-build-result.v1', manifest, fittedTrace: fittedBlob, transientExport: exported.reference, objectRecords, indexPages, diagnosticPages, objectCount: built.records.length, diagnosticCount: exported.payload.diagnostics.length });
}
export async function executeGeometryEvidenceThread(input: GeometryEvidenceThreadInput, storage: Pick<GeometryTraceThreadStorage, 'readPreparationBlob'>): Promise<GeometryEvidenceThreadResult> {
  const read = (ref: Blob, limit: number) => storage.readPreparationBlob(input.projectId, input.sessionId, ref, limit);
  const evidence = parsePolicyJson(await read(input.evidenceBlob, GEOMETRY_TRACE_LIMITS.evidenceBytes), { maxBytes: GEOMETRY_TRACE_LIMITS.evidenceBytes });
  if (!validateCompletedCaptureEvidence(evidence) || !await verifyCompletedCaptureEvidence(evidence)) throw Error('GEOMETRY_TRACE_BUILD_INVALID');
  const b = evidence.binding, e = input.expected;
  if (b.projectId !== input.projectId || b.sessionId !== input.sessionId || b.partId !== input.partId || b.partPayloadSha256 !== input.partBlob.sha256 || b.modelVersionId !== e.modelVersionId || b.contentFingerprint !== e.contentFingerprint || b.selectionRevision !== e.selectionRevision || b.planSha256 !== e.planSha256 || b.coordinateFrameId !== e.coordinateFrameId || !b.loadId) throw Error('GEOMETRY_TRACE_BUILD_INVALID');
  const payload = snapshotSchema.parse(parsePolicyJson(await read(input.partBlob, 64 * 1024 ** 2), { maxBytes: 64 * 1024 ** 2 }));
  const observations = evidence.observations, coordinates = payload.coordinates;
  for (const [observation, value] of [[observations.sourceUnitLabel, coordinates.sourceUnits], [observations.metresPerDisplayUnit, coordinates.metresPerSourceUnit], [observations.globalOffsetMetres, coordinates.globalOffsetMetres], [observations.displayToWorldMetres, coordinates.displayToWorldMetres], [observations.legacySourceToWorldMetres, coordinates.sourceToWorldMetres]] as const) if (observation.value !== null && canonicalPurposeJson(observation.value) !== canonicalPurposeJson(value)) throw Error('GEOMETRY_TRACE_BUILD_INVALID');
  if (observations.globalOffsetDisplayUnits.value !== null && observations.metresPerDisplayUnit.value !== null && canonicalPurposeJson(observations.globalOffsetDisplayUnits.value.map(v => v * observations.metresPerDisplayUnit.value!)) !== canonicalPurposeJson(coordinates.globalOffsetMetres)) throw Error('GEOMETRY_TRACE_BUILD_INVALID');
  if (observations.upVector.value !== null && canonicalPurposeJson(observations.upVector.value) !== '[0,0,1]') throw Error('GEOMETRY_TRACE_BUILD_INVALID');
  const fragments = new Map(payload.objects.flatMap(o => o.fragments.map(f => [o.id + '\u0000' + f.id, f.fragmentToWorldMetres] as const)));
  if (fragments.size !== evidence.fragments.length || evidence.fragments.some(f => !fragments.has(f.objectId + '\u0000' + f.fragmentId) || canonicalPurposeJson(fragments.get(f.objectId + '\u0000' + f.fragmentId)) !== canonicalPurposeJson(f.canonicalMatrix.value))) throw Error('GEOMETRY_TRACE_BUILD_INVALID');
  return geometryEvidenceThreadResultSchema.parse({ schemaVersion: 'wfc.pf.geometry-evidence-validated.v1', partId: input.partId, validatedPartSha256: input.partBlob.sha256, evidenceBlob: input.evidenceBlob });
}
if (!isMainThread && parentPort && ['wfc.pf.geometry-trace-thread.v1', 'wfc.pf.geometry-evidence-thread.v1'].includes(workerData?.schemaVersion)) {
  const port = parentPort;
  void (async () => { let requestId: string | undefined;
    try { const input = workerData.schemaVersion === 'wfc.pf.geometry-trace-thread.v1' ? geometryTraceThreadInputSchema.parse(workerData) : geometryEvidenceThreadInputSchema.parse(workerData); requestId = input.requestId; (globalThis as typeof globalThis & { __wfcPreparationStorageLock?: SharedArrayBuffer }).__wfcPreparationStorageLock = input.storageLockBuffer;
      const preparation = await import('./preparationStorage.js'), storage = await import('./geometryTraceStorage.js');
      const helpers = { readPreparationBlob: preparation.readPreparationBlob, storePreparationBlob: preparation.storePreparationBlob, readFittedExport: storage.readFittedExport, adoptFittedExport: storage.adoptFittedExport };
      const result = input.schemaVersion === 'wfc.pf.geometry-trace-thread.v1' ? await executeGeometryTraceThread(input, helpers) : await executeGeometryEvidenceThread(input, helpers); port.postMessage({ schemaVersion: 'wfc.pf.geometry-trace-message.v1', requestId, type: 'result', result });
    } catch (error) { const code = error instanceof Error && /LIMIT|QUOTA|BUDGET/.test(error.message) ? 'GEOMETRY_TRACE_BUILD_LIMIT' : error instanceof z.ZodError || (error as { name?: string })?.name === 'PathFinderError' ? 'GEOMETRY_TRACE_BUILD_INVALID' : 'GEOMETRY_TRACE_BUILD_FAILED'; if (requestId) port.postMessage({ schemaVersion: 'wfc.pf.geometry-trace-message.v1', requestId, type: 'error', code }); process.exitCode = 1; } finally { port.close(); }
  })();
}
