import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { barrierCanonicalJson, barrierCaptureSchema, type BarrierModelScope } from '../../shared/pathfinderBarriers.js';
import { GEOMETRY_TRACE_LIMITS } from '../../shared/pathfinderGeometryTrace.js';
import { barrierEnumerationHashInput, barrierFrameObservationHashInput, type BarrierFrameObservation } from '../../viewer-runtime/barrier-capture.mjs';
import { barrierCaptureAdapters, type BarrierViewerContext } from './barrierCaptureAuthority.js';
import { barrierFrameProjectionHash, currentBarrierScope } from './barrierScope.js';
import { barrierVerifierResultSchema, type runBarrierVerifier } from './barrierVerifier.js';
import { barrierRegistryTransaction, type BarrierCaptureIntent } from './barrierRegistryRepository.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';

const id = (value: number) => `81000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hash = (value: unknown) => createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
const bytesHash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

/** Synthetic SQL result rows and a mocked geometry executor. These tests verify
 * authority/fences only; the one-triangle capture is not a qualified solid. */
function fixture() {
  const sample = geometryTraceFixture(), built = buildGeometryTrace(sample);
  const projection = { coordinateFrame: 'canonical-world-metres' as const,
    displayToWorldMetres: [...sample.snapshot.coordinates.displayToWorldMetres],
    globalOffsetMetres: [...sample.snapshot.coordinates.globalOffsetMetres] as [number, number, number] };
  const scope: BarrierModelScope = { projectId: sample.aggregate.projectId, modelVersionId: sample.aggregate.modelVersionId,
    contentFingerprint: sample.aggregate.contentFingerprint, selectionRevision: sample.aggregate.selectionRevision,
    captureFrameId: sample.aggregate.coordinateFrameId, captureFrameSha256: barrierFrameProjectionHash(projection), coordinateFrame: 'canonical-world-metres' };
  const row = { model_version_id: scope.modelVersionId, selection_revision: scope.selectionRevision, content_fingerprint: scope.contentFingerprint,
    state: 'ready', health: 'healthy', aggregate: structuredClone(sample.aggregate), trace: structuredClone(built.manifest),
    artifact_id: sample.aggregate.artifactId, snapshot_sha256: sample.aggregate.projection.sha256 };
  const who = { userId: id(1), loginId: id(2), loginExpiresAt: Date.now() + 120_000 };
  const frameBody = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1' as const,
    projectId: scope.projectId, modelVersionId: scope.modelVersionId, contentFingerprint: scope.contentFingerprint, loadId: id(3),
    sdkVersion: '7.130.0' as const, matrixPrecision: 'binary64' as const, coordinateFrame: 'canonical-world-metres' as const,
    sourceUnits: 'm', metresPerDisplayUnit: 1, upVector: [0, 0, 1] as [number, number, number],
    globalOffsetDisplayUnits: [0, 0, 0] as [number, number, number], globalOffsetMetres: projection.globalOffsetMetres,
    displayToWorldMetres: projection.displayToWorldMetres, modelTransform: null, placementTransform: null };
  const frame: BarrierFrameObservation = { ...frameBody, contentSha256: hash(frameBody) };
  const context: BarrierViewerContext = { sessionId: id(4), cookieSecret: 'synthetic-barrier-viewer-cookie', who, frame };
  const selectedParents = [{ selectionId: id(5), kind: 'wall' as const, objectId: 'dbid:10', dbId: 10, externalId: null,
    name: 'Synthetic selected wall', identityBasis: 'version-local-only' as const, inclusion: 'own-and-all-descendant-fragments' as const }];
  const intent: BarrierCaptureIntent = { id: id(6), snapshotId: id(7), captureBlobId: id(8), manifestBlobId: id(9),
    command: { schemaVersion: 'wfc.pf.barrier-capture-command.v1', scope, expectedRegistryRevision: '0', idempotencyKey: id(10), selectedParents },
    createdBy: who.userId, loginId: who.loginId };
  const capture = barrierCaptureSchema.parse({ schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: intent.id, scope, selectedParents,
    fragments: [{ source: { fragmentId: 1, ownerObjectId: 'dbid:10', parentSelectionIds: [selectedParents[0].selectionId], sourceUnits: 'm',
      metresPerSourceUnit: 1, sourceToWorldMetres: projection.displayToWorldMetres, transformSha256: hash(projection.displayToWorldMetres) },
    bounds: { minimum: [0, 0, 0], maximum: [1, 1, 0] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangleIndices: [0, 1, 2] }],
    observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [1], unavailableFragmentIds: [], enumerationSha256: 'a'.repeat(64) } });
  capture.observation.enumerationSha256 = hash(barrierEnumerationHashInput(capture));
  const captureBytes = Buffer.from(barrierCanonicalJson(capture)), captureSha256 = bytesHash(captureBytes);
  const result = barrierVerifierResultSchema.parse({ schemaVersion: 'wfc.pf.barrier-verification-result.v1', producerVersion: 'wfc.pf.barrier-verifier.v1',
    status: 'geometry-qualified', captureSha256, evidence: { captureId: capture.captureId, scope, computationalMeshes: 1,
      fragmentCount: 1, vertexCount: 3, triangleCount: 1, decompositionSha256: 'b'.repeat(64), verificationSha256: 'c'.repeat(64),
      topology: 'qualified-closed-consistent-two-manifold', selfIntersection: 'bounded-verification-passed', numericToleranceMetres: 1e-7,
      coverage: 'provided-fragments-only', sdkCoverageVerified: false, engineeringAccepted: false }, diagnostics: [] });
  const record = structuredClone(built.records[0]);
  const state = { rows: [row], frames: [{ frame: projection, record, record_sha256: hash(record) }],
    viewerRows: [{ expires_at: new Date(Date.now() + 60_000), absolute_expires_at: new Date(Date.now() + 90_000),
      selection_revision: Number(scope.selectionRevision), revoked_at: null as Date | null }], result, implementationSha256: 'd'.repeat(64) };
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.includes('barrier:current-scope')) return { rows: state.rows };
    if (sql.includes('barrier:current-frame')) return { rows: state.frames };
    if (sql.includes('barrier:viewer-context')) return { rows: state.viewerRows };
    throw new Error('Unexpected synthetic authority SQL: ' + sql);
  });
  const client = { query } as unknown as PoolClient;
  const execute = vi.fn<typeof runBarrierVerifier>(async () => ({ result: structuredClone(state.result), implementationSha256: state.implementationSha256 }));
  const adapters = barrierCaptureAdapters(context, execute);
  const input = { intent, capture, captureBytes, captureSha256 };
  return { sample, built, scope, row, who, frame, context, intent, capture, input, state, query, client, execute, adapters };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('current server model and common barrier frame authority', () => {
  it('uses locked current model/aggregate/trace/artifact and exactly one common frame', async () => {
    const f = fixture(); expect(await currentBarrierScope(f.client, f.scope.projectId)).toEqual(f.scope);
    const sql = f.query.mock.calls[0][0]; expect(sql).toContain('FOR SHARE OF s,v,p,a,f,t');
    expect(f.query.mock.calls[0][1]).toEqual([f.scope.projectId]);
    expect(f.query.mock.calls[1][1]).toEqual([f.scope.projectId, f.built.manifest.id, GEOMETRY_TRACE_LIMITS.objectBytes]);
    expect(f.query.mock.calls[1][0]).toContain('SELECT DISTINCT ON');
    expect(f.query.mock.calls[1][0]).toContain('CASE WHEN octet_length(record::text)<=$3 THEN record ELSE NULL END');
  });
  it.each(['missing', 'duplicate'] as const)('refuses %s authoritative model rows', async kind => {
    const f = fixture(); f.state.rows = kind === 'missing' ? [] : [f.row, structuredClone(f.row)];
    await expect(currentBarrierScope(f.client, f.scope.projectId)).rejects.toMatchObject({ code: 'BARRIER_CURRENT_FRAME_UNAVAILABLE' });
  });
  it.each(['state', 'health', 'selection', 'fingerprint', 'artifact', 'snapshot', 'trace-hash'] as const)('refuses changed %s', async kind => {
    const f = fixture();
    if (kind === 'state') f.row.state = 'processing'; if (kind === 'health') f.row.health = 'invalid';
    if (kind === 'selection') f.row.selection_revision = '99'; if (kind === 'fingerprint') f.row.content_fingerprint = 'e'.repeat(64);
    if (kind === 'artifact') f.row.artifact_id = id(99); if (kind === 'snapshot') f.row.snapshot_sha256 = 'e'.repeat(64);
    if (kind === 'trace-hash') f.row.trace.contentSha256 = 'f'.repeat(64);
    await expect(currentBarrierScope(f.client, f.scope.projectId)).rejects.toMatchObject({ code: 'BARRIER_CURRENT_FRAME_UNAVAILABLE' });
  });
  it.each(['missing', 'two-frames', 'singular', 'unknown-frame'] as const)('refuses %s coordinate evidence', async kind => {
    const f = fixture(); if (kind === 'missing') f.state.frames = [];
    if (kind === 'two-frames') f.state.frames.push(structuredClone(f.state.frames[0]));
    if (kind === 'singular') f.state.frames[0].frame.displayToWorldMetres[0] = 0;
    if (kind === 'unknown-frame') f.state.frames[0].frame = { ...f.state.frames[0].frame, coordinateFrame: 'viewer-display' } as unknown as typeof f.state.frames[0]['frame'];
    await expect(currentBarrierScope(f.client, f.scope.projectId)).rejects.toMatchObject({ code: 'BARRIER_CURRENT_FRAME_UNAVAILABLE' });
  });
  it.each(['missing-record', 'unknown-member', 'record-hash', 'unhashed-mutation'] as const)('refuses %s common-frame record integrity', async kind => {
    const f = fixture(), entry = f.state.frames[0];
    if (kind === 'missing-record') entry.record = null as unknown as typeof entry.record;
    if (kind === 'unknown-member') {
      entry.record = { ...entry.record, forgedFrameAuthority: true } as unknown as typeof entry.record;
      entry.record_sha256 = hash(entry.record);
    }
    if (kind === 'record-hash') entry.record_sha256 = 'e'.repeat(64);
    if (kind === 'unhashed-mutation') entry.record.coordinates.globalOffsetMetres[0] += 1;
    await expect(currentBarrierScope(f.client, f.scope.projectId)).rejects.toMatchObject({ code: 'BARRIER_CURRENT_FRAME_UNAVAILABLE' });
  });
  it.each(['project', 'model', 'trace', 'aggregate', 'capture-frame', 'fingerprint', 'display-projection', 'offset-projection'] as const)
    ('refuses a correctly hashed representative record from a different %s scope', async kind => {
      const f = fixture(), entry = f.state.frames[0], record = entry.record;
      if (kind === 'project') record.projectId = id(91);
      if (kind === 'model') record.modelVersionId = id(92);
      if (kind === 'trace') record.traceId = id(93);
      if (kind === 'aggregate') record.aggregateId = id(94);
      if (kind === 'capture-frame') record.coordinates.captureFrameId = id(95);
      if (kind === 'fingerprint') record.provenance.contentFingerprint = 'e'.repeat(64);
      if (kind === 'display-projection') record.coordinates.displayToWorldMetres[12] += 1;
      if (kind === 'offset-projection') record.coordinates.globalOffsetMetres[0] += 1;
      entry.record_sha256 = hash(record); // Hash validity alone cannot authorize another prepared frame.
      await expect(currentBarrierScope(f.client, f.scope.projectId)).rejects.toMatchObject({ code: 'BARRIER_CURRENT_FRAME_UNAVAILABLE' });
    });
  it('keeps current administrator role enforcement before invoking the frame collector', async () => {
    const f = fixture(), release = vi.fn();
    const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT id FROM projects') ? [{ id: f.scope.projectId }]
      : sql.startsWith('SELECT is_admin') ? [{ is_admin: false }] : [] }));
    const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
    await expect(barrierRegistryTransaction(pool, f.scope.projectId, f.who, client => f.adapters.currentScope(client, f.scope.projectId)))
      .rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(f.query).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
  });
});

describe('protected human viewer observation and final expiry fencing', () => {
  it('binds the exact user/login/model/load and hashed HttpOnly viewer cookie', async () => {
    const f = fixture(); expect(await f.adapters.currentScope(f.client, f.scope.projectId)).toEqual(f.scope);
    const query = f.query.mock.calls.find(([sql]) => sql.includes('barrier:viewer-context'))!;
    expect(query[0]).toContain('FOR SHARE'); expect(query[0]).toContain('login_id=$5 AND load_id=$6 AND secret_hash=$7');
    expect(query[1]).toEqual([f.context.sessionId, f.scope.projectId, f.scope.modelVersionId, f.who.userId, f.who.loginId, f.frame.loadId,
      createHash('sha256').update(f.context.cookieSecret).digest('hex')]);
  });
  it.each(['missing', 'revoked', 'selection', 'idle-expired', 'absolute-expired', 'login-expired'] as const)('refuses %s viewer binding', async kind => {
    const f = fixture(); if (kind === 'missing') f.state.viewerRows = [];
    if (kind === 'revoked') f.state.viewerRows[0].revoked_at = new Date();
    if (kind === 'selection') f.state.viewerRows[0].selection_revision = 99;
    if (kind === 'idle-expired') f.state.viewerRows[0].expires_at = new Date(Date.now() - 1);
    if (kind === 'absolute-expired') f.state.viewerRows[0].absolute_expires_at = new Date(Date.now() - 1);
    if (kind === 'login-expired') {
      const context = { ...f.context, who: { ...f.who, loginExpiresAt: Date.now() - 1 } };
      await expect(barrierCaptureAdapters(context, f.execute).currentScope(f.client, f.scope.projectId)).rejects.toMatchObject({ code: 'BARRIER_CAPTURE_VIEWER_CHANGED' }); return;
    }
    await expect(f.adapters.currentScope(f.client, f.scope.projectId)).rejects.toMatchObject({ code: 'BARRIER_CAPTURE_VIEWER_CHANGED' });
  });
  it.each(['hash', 'model', 'load', 'frame'] as const)('refuses stale or unsupported %s observation before using the cookie', async kind => {
    const f = fixture(), frame = structuredClone(f.frame);
    if (kind === 'hash') frame.contentSha256 = 'e'.repeat(64);
    if (kind === 'model') frame.modelVersionId = id(99);
    if (kind === 'load') frame.loadId = 'invalid';
    if (kind === 'frame') frame.displayToWorldMetres[12] = 10;
    if (kind !== 'hash') frame.contentSha256 = hash(barrierFrameObservationHashInput(frame));
    await expect(barrierCaptureAdapters({ ...f.context, frame }, f.execute).currentScope(f.client, f.scope.projectId))
      .rejects.toMatchObject({ code: 'BARRIER_CAPTURE_FRAME_CHANGED' });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('barrier:viewer-context'))).toBe(false);
  });
  it('detaches caller frame and principal mutations before its first await', async () => {
    const f = fixture(), expectedUser = f.who.userId, expectedLoad = f.frame.loadId;
    f.frame.loadId = id(99); f.context.who.userId = id(98);
    await f.adapters.currentScope(f.client, f.scope.projectId);
    const values = f.query.mock.calls.find(([sql]) => sql.includes('barrier:viewer-context'))![1]!;
    expect(values[3]).toBe(expectedUser); expect(values[5]).toBe(expectedLoad);
  });
  it('checks viewer expiry again synchronously immediately before COMMIT', async () => {
    const f = fixture(); await f.adapters.currentScope(f.client, f.scope.projectId);
    vi.spyOn(Date, 'now').mockReturnValue(f.state.viewerRows[0].expires_at.getTime());
    expect(() => f.adapters.assertBeforeCommit!()).toThrow(expect.objectContaining({ code: 'BARRIER_CAPTURE_VIEWER_EXPIRED' }));
  });
  it('cannot authorize a context before its live viewer session was locked', () => {
    const f = fixture(); expect(() => f.adapters.assertBeforeCommit!()).toThrow(expect.objectContaining({ code: 'BARRIER_CAPTURE_VIEWER_EXPIRED' }));
  });
});

describe('geometry qualification receipt and runtime-observed provenance', () => {
  it('combines the exact geometry receipt, implementation and protected observation without claiming independent SDK enumeration', async () => {
    const f = fixture(); await f.adapters.currentScope(f.client, f.scope.projectId);
    const value = await f.adapters.qualifyCapture(f.input, new AbortController().signal);
    expect(value).toEqual({ producerVersion: 'wfc.pf.barrier-verifier.v1', computationalMeshes: 1, verificationSha256: hash({
      geometryVerificationSha256: f.state.result.evidence!.verificationSha256, implementationSha256: f.state.implementationSha256,
      frameObservation: f.frame, captureSha256: f.input.captureSha256, enumerationSha256: f.capture.observation.enumerationSha256,
      authority: 'current-admin-protected-runtime-observation', independentSdkReenumeration: false }) });
    expect(f.execute).toHaveBeenCalledWith(f.input.captureBytes, expect.any(AbortSignal));
  });
  it('refuses a geometry-only call without a protected viewer observation', async () => {
    const f = fixture(); await expect(barrierCaptureAdapters(undefined, f.execute).qualifyCapture(f.input, new AbortController().signal))
      .rejects.toMatchObject({ code: 'BARRIER_PROTECTED_CAPTURE_REQUIRED' }); expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(['actor', 'login'] as const)('refuses cross-%s capture takeover before executing geometry', async kind => {
    const f = fixture(); if (kind === 'actor') f.intent.createdBy = id(99); else f.intent.loginId = id(99);
    await expect(f.adapters.qualifyCapture(f.input, new AbortController().signal)).rejects.toMatchObject({ code: 'BARRIER_CAPTURE_PRINCIPAL_CHANGED' });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(['capture-id', 'partial', 'verification', 'unavailable', 'enumeration-hash', 'transform-hash'] as const)('refuses %s closure mismatch before executing geometry', async kind => {
    const f = fixture();
    if (kind === 'capture-id') f.capture.captureId = id(99); if (kind === 'partial') f.capture.observation.state = 'partial';
    if (kind === 'verification') (f.capture.observation as { verification: string }).verification = 'verified';
    if (kind === 'unavailable') f.capture.observation.unavailableFragmentIds = [2];
    if (kind === 'enumeration-hash') f.capture.observation.enumerationSha256 = 'e'.repeat(64);
    if (kind === 'transform-hash') f.capture.fragments[0].source.sourceToWorldMetres[12] = 20;
    await expect(f.adapters.qualifyCapture(f.input, new AbortController().signal)).rejects.toMatchObject({ code: 'BARRIER_CAPTURE_CLOSURE_INVALID' });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(['status', 'hash', 'scope', 'capture-id', 'fragments', 'vertices', 'triangles', 'no-evidence'] as const)('refuses verifier %s mismatches', async kind => {
    const f = fixture(); if (kind === 'status') f.state.result.status = 'refused';
    if (kind === 'hash') f.state.result.captureSha256 = 'f'.repeat(64);
    if (kind === 'scope') f.state.result.evidence!.scope.modelVersionId = id(99);
    if (kind === 'capture-id') f.state.result.evidence!.captureId = id(99);
    if (kind === 'fragments') f.state.result.evidence!.fragmentCount = 2;
    if (kind === 'vertices') f.state.result.evidence!.vertexCount = 4;
    if (kind === 'triangles') f.state.result.evidence!.triangleCount = 2;
    if (kind === 'no-evidence') f.state.result.evidence = null;
    await expect(f.adapters.qualifyCapture(f.input, new AbortController().signal)).rejects.toMatchObject({ code: 'BARRIER_VERIFIER_CAPTURE_MISMATCH' });
  });
  it('propagates unavailable verifier without producing a publication assertion', async () => {
    const f = fixture(); f.execute.mockRejectedValue(new Error('bounded verifier unavailable'));
    await expect(f.adapters.qualifyCapture(f.input, new AbortController().signal)).rejects.toThrow('bounded verifier unavailable');
  });
  it('honors cancellation before and after slow geometry execution', async () => {
    const f = fixture(), cancelled = new AbortController(); cancelled.abort();
    await expect(f.adapters.qualifyCapture(f.input, cancelled.signal)).rejects.toThrow(); expect(f.execute).not.toHaveBeenCalled();
    const later = new AbortController(); f.execute.mockImplementationOnce(async () => { later.abort(); return { result: f.state.result, implementationSha256: f.state.implementationSha256 }; });
    await expect(f.adapters.qualifyCapture(f.input, later.signal)).rejects.toThrow();
  });
  it('strictly refuses receipt authority inflation and unknown output fields', () => {
    const f = fixture(); expect(barrierVerifierResultSchema.safeParse({ ...f.state.result, ready: true }).success).toBe(false);
    expect(barrierVerifierResultSchema.safeParse({ ...f.state.result, evidence: { ...f.state.result.evidence!, sdkCoverageVerified: true } }).success).toBe(false);
    expect(barrierVerifierResultSchema.safeParse({ ...f.state.result, evidence: { ...f.state.result.evidence!, engineeringAccepted: true } }).success).toBe(false);
  });
});
