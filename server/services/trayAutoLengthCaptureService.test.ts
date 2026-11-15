// @vitest-environment node
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../pathfinder/geometryTraceStorage.js', async original => ({
  ...await original<typeof import('../pathfinder/geometryTraceStorage.js')>(),
  withFittedExportAllowance: async (_id: string, work: (existing: boolean) => Promise<unknown>) => work(false),
}));
import { createTrayAutoLengthCaptureService, readCapturedTrayAutoLength, readTrayAutoLengthCaptureContext,
  validateTrayAutoLengthCapture } from './trayAutoLengthCaptureService.js';
import { geometryTraceFixture } from '../pathfinder/geometryTraceFixtures.js';
import { modelCaptureScopeBytes } from '../../viewer-runtime/capture-input.mjs';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';

const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
async function fixture() {
  const source = geometryTraceFixture(), projectId = source.plan.projectId, trayId = source.plan.requestedScope.trays[0].projectTrayId;
  const model = { tray_name: 'B001', active_model_version_id: source.plan.modelVersionId, selection_revision: '1',
    content_fingerprint: source.plan.contentFingerprint, state: 'ready', health: 'healthy' };
  const assignment = { resolution: { id: source.traceId, projectTrayId: trayId, mode: 'roots', rootObjectIds: ['dbid:9', 'dbid:2'],
    reason: 'Synthetic explicit tray assignment', actorId: source.createdBy, createdAt: source.createdAt, scope: source.aggregate }, plan: null };
  // Resolution scope is strict and excludes aggregate-only fields.
  assignment.resolution.scope = Object.fromEntries(['modelVersionId','contentFingerprint','selectionRevision','catalogRevision','routingContentSha256',
    'routingPolicyRevision','routingPolicySha256','resolutionRevision','locationRegistryRevision'].map(key => [key, source.aggregate[key as keyof typeof source.aggregate]])) as typeof source.aggregate;
  let cached: { context: unknown; measurement: unknown; proof: unknown; content_sha256: string } | undefined;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('capture-model')) return { rows: [model] };
    if (sql.includes('capture-assignment')) return { rows: [assignment] };
    if (sql.startsWith('SELECT name FROM trays')) return { rows: [{ name: model.tray_name }] };
    if (sql.includes('capture-cache')) return { rows: cached ? [cached] : [] };
    if (sql.includes('capture-store')) { cached = structuredClone({ context: params[2], measurement: params[3], proof: params[4], content_sha256: params[5] as string }); }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() }, pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  const context = await readTrayAutoLengthCaptureContext(pool, projectId, trayId), request = { equipmentNames: [],
    routeRules: [{ id: trayId, objectIds: context.rootObjectIds, allowedCategories: ['MV','LV','Control'] as ('MV'|'LV'|'Control')[] }] };
  const bytes = modelCaptureScopeBytes(request), snapshot = source.snapshot;
  snapshot.objects.pop(); snapshot.capture.adapterVersion = 'wfc.protected-selected-capture.v1'; snapshot.capture.sourceKind = 'converted';
  snapshot.capture.inputScope = { schemaVersion: 'wfc.capture.input.v1', equipmentNameCount: 0, chunkCount: 0,
    inputUtf8Bytes: bytes.length, scopeSha256: createHash('sha256').update(bytes).digest('hex'), equipmentNamesSha256: hash([]),
    propertyScan: { indexedObjectCount: 2, attemptedObjectCount: 0, returnedObjectCount: 0, omittedObjectCount: 0, complete: false } };
  for (const object of snapshot.objects) { object.routeBoundaryId = object.id; delete object.routeName; delete object.shapeName; object.allowedCategories = ['MV','LV','Control']; }
  source.fitted.objects.pop(); source.fitted.counts.objects = 2;
  source.fitted.segments[1].pointsMetres = [[100,0,0],[102,0,0]]; source.fitted.segments[1].geometricLengthMetres = 2; source.fitted.segments[1].geometricLengthRoundTrip = '2';
  source.fitted.segments.forEach(segment => { segment.routeCode = segment.name = '/B001'; });
  const reference = { schemaVersion: 'wfc.pf.fitted-trace-reference.v1' as const, exportId: source.fitted.exportId, sha256: 'a'.repeat(64),
    bytes: 1024, counts: source.fitted.counts, engine: source.fitted.engine, rulesSha256: source.fitted.rulesSha256,
    snapshotSha256: source.fitted.snapshotSha256, preparedKey: source.fitted.preparedKey };
  const engine = { getRuntimeFingerprint: vi.fn(async () => source.runtimeFingerprint), exportFittedTrace: vi.fn(async input => {
    source.fitted.snapshotSha256 = input.snapshotSha256; reference.snapshotSha256 = input.snapshotSha256;
    source.fitted.exportId = reference.exportId = input.exportId; return reference;
  }) };
  const files = { store: vi.fn(async (_id: string, value: unknown) => ({ sha256: hash(value), bytes: 2048 })), discard: vi.fn(async () => undefined),
    readExport: vi.fn(async () => ({ bytes: Buffer.from('{}'), payload: source.fitted, reference })), discardExport: vi.fn(async () => undefined) };
  const service = createTrayAutoLengthCaptureService(pool, engine, files), authorize = vi.fn(async () => undefined);
  return { source, projectId, trayId, model, assignment, context, snapshot, query, pool, engine, files, service, authorize,
    cached: () => cached, capture: () => service.capture(projectId, trayId, { context, snapshot }, authorize, new AbortController().signal) };
}

describe('independent assigned-tray centerline measurement', () => {
  it('fits only the assigned tray without a complete aggregate, sums disconnected polylines and persists a reusable preview', async () => {
    const f = await fixture();
    await expect(f.capture()).resolves.toMatchObject({ source: 'tray-capture', lengthMm: 9000, elementCount: 2, assignmentSha256: f.context.assignmentSha256 });
    expect(f.engine.exportFittedTrace).toHaveBeenCalledTimes(1); expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(f.files.store.mock.calls[0][1]).toMatchObject({ objects: [expect.objectContaining({ routeName: '/B001' }), expect.objectContaining({ routeName: '/B001' })] });
    expect(f.query.mock.calls.some(([sql]) => /(?:INSERT INTO pf_|UPDATE (?:trays|pf_))/.test(sql))).toBe(false);
    await expect(readCapturedTrayAutoLength(f.pool, f.projectId, f.trayId)).resolves.toEqual(f.cached()?.measurement);
    expect(f.engine.exportFittedTrace).toHaveBeenCalledTimes(1);
    expect(f.files.discard).toHaveBeenCalledTimes(1); expect(f.files.discardExport).toHaveBeenCalledTimes(1);
  });

  it.each(['foreign-leaf', 'missing-root', 'equipment', 'wrong-input-scope', 'duplicate-leaf', 'false-completeness'] as const)('refuses %s before engine execution', async kind => {
    const f = await fixture();
    if (kind === 'foreign-leaf') f.snapshot.objects[0].routeBoundaryId = 'dbid:999';
    if (kind === 'missing-root') f.snapshot.objects.pop();
    if (kind === 'equipment') f.snapshot.objects[0].geometryRole = 'object';
    if (kind === 'wrong-input-scope') f.snapshot.capture.inputScope!.scopeSha256 = '0'.repeat(64);
    if (kind === 'duplicate-leaf') f.snapshot.objects.push(f.snapshot.objects[0]);
    if (kind === 'false-completeness') f.snapshot.capture.geometryComplete = true;
    await expect(f.capture()).rejects.toBeInstanceOf(Error);
    expect(f.engine.exportFittedTrace).not.toHaveBeenCalled(); expect(f.cached()).toBeUndefined();
  });

  it('keeps the manual source label independent of arbitrary model object names', async () => {
    const f = await fixture();
    f.snapshot.objects[0].name = 'BEND 90'; f.snapshot.objects[0].leafToRootNames = ['BEND 90'];
    const snapshot = await validateTrayAutoLengthCapture(f.context, f.snapshot, '/B001');
    expect(snapshot.objects[0]).toMatchObject({ routeName: '/B001', shapeName: 'BEND 90' });
    expect(snapshot.objects[0].routeBoundaryId).toBeUndefined();
  });

  it('rejects a model change during fitting and cleans both temporary artifacts without publishing a partial measurement', async () => {
    const f = await fixture(), original = f.engine.exportFittedTrace.getMockImplementation()!;
    f.engine.exportFittedTrace.mockImplementation(async input => { const result = await original(input); f.model.selection_revision = '2'; return result; });
    await expect(f.capture()).rejects.toBeInstanceOf(Error);
    expect(f.cached()).toBeUndefined(); expect(f.files.discard).toHaveBeenCalledTimes(1); expect(f.files.discardExport).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });

  it('rounds only the final total to three decimals of millimetres', async () => {
    const f = await fixture();
    f.source.fitted.segments[0].pointsMetres = [[0,0,0],[0.0000006,0,0]];
    f.source.fitted.segments[0].geometricLengthMetres = 0.0000006;
    f.source.fitted.segments[1].pointsMetres = [[100,0,0],[100.0000006,0,0]];
    f.source.fitted.segments[1].geometricLengthMetres = 100.0000006 - 100;
    await expect(f.capture()).resolves.toMatchObject({ lengthMm: 0.001 });
  });

  it('invalidates only this tray assignment or model, and refuses changed cached evidence', async () => {
    const f = await fixture(); await f.capture();
    f.assignment.resolution.scope.catalogRevision = '999';
    await expect(readCapturedTrayAutoLength(f.pool, f.projectId, f.trayId)).resolves.not.toBeNull();
    f.assignment.resolution.rootObjectIds = ['dbid:9'];
    await expect(readCapturedTrayAutoLength(f.pool, f.projectId, f.trayId)).resolves.toBeNull();
    f.assignment.resolution.rootObjectIds = ['dbid:9','dbid:2'];
    (f.cached()!.measurement as { lengthMm: number }).lengthMm = 1;
    await expect(readCapturedTrayAutoLength(f.pool, f.projectId, f.trayId)).resolves.toBeNull();
  });
});
