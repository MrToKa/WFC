// @vitest-environment node
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { readCurrentTrayAutoLength, TrayAutoLengthError } from './trayAutoLengthService.js';
import { geometryTraceFixture } from '../pathfinder/geometryTraceFixtures.js';
import { buildGeometryTrace, geometryTraceHash } from '../pathfinder/geometryTraceBuilder.js';
import { preparationPlanHashInput } from '../../shared/pathfinderPreparation.js';

function fixture(points = [[[0, 0, 0], [3, 0, 0], [3, 4, 0]], [[100, 0, 0], [102, 0, 0]]]) {
  const f = geometryTraceFixture(), trayId = f.plan.requestedScope.trays[0].projectTrayId;
  f.plan.requestedScope.trays = [{ ...f.plan.requestedScope.trays[0], orderedRootObjectIds: ['dbid:9', 'dbid:2'] }];
  f.plan.partPlan.forEach(part => part.objects.forEach(object => { object.projectTrayId = trayId; object.routeName = '/B001'; }));
  f.snapshot.objects[1].routeName = '/B001';
  f.traceIndex.objects[1].projectTrayId = trayId;
  f.fitted.segments.forEach((segment, index) => {
    segment.name = segment.routeCode = '/B001'; segment.ports = []; segment.connectionSurfaceCount = 0;
    segment.pointsMetres = points[index] as [number, number, number][];
    segment.geometricLengthMetres = points[index].reduce((sum, point, at) => sum + (at ? Math.hypot(...point.map((value, axis) => value - points[index][at - 1][axis])) : 0), 0);
    segment.geometricLengthRoundTrip = String(segment.geometricLengthMetres);
  });
  f.fitted.counts.points = points.reduce((sum, line) => sum + line.length, 0); f.fitted.counts.ports = 0;
  const { scopeSha256: _scope, ...scope } = f.plan.requestedScope;
  f.plan.requestedScope.scopeSha256 = geometryTraceHash(scope);
  f.plan.orderedPlanSha256 = geometryTraceHash(preparationPlanHashInput(f.plan));
  f.aggregate.orderedPlanSha256 = f.plan.orderedPlanSha256; f.aggregate.orderedScopeSha256 = f.plan.requestedScope.scopeSha256;
  const built = buildGeometryTrace(f), aggregate = f.aggregate;
  const row = {
    tray_name: 'B001', active_model_version_id: aggregate.modelVersionId, selection_revision: aggregate.selectionRevision,
    content_fingerprint: aggregate.contentFingerprint, model_state: 'ready', model_health: 'healthy',
    current_aggregate_id: aggregate.id, current_artifact_id: aggregate.artifactId, geometry_revision: aggregate.geometryRevision,
    resolution_revision: aggregate.resolutionRevision, aggregate_id: aggregate.id, aggregate_model_id: aggregate.modelVersionId,
    session_id: aggregate.sessionId, artifact_id: aggregate.artifactId, aggregate_geometry_revision: aggregate.geometryRevision,
    aggregate_manifest: aggregate, plan: f.plan, session_state: 'published', published_aggregate_id: aggregate.id,
    artifact_model_id: aggregate.modelVersionId, snapshot_sha256: aggregate.projection.sha256, snapshot_bytes: String(aggregate.projection.bytes),
    trace_id: f.traceId as string | null, trace_model_id: aggregate.modelVersionId, trace_manifest: built.manifest,
    resolution: null as unknown, publication_proof: true,
  };
  const rows = built.records.filter(record => record.catalog.projectTrayId === trayId).map(record => ({
    object_id: record.identity.objectId, record, summary: built.summaries.find(summary => summary.id === record.id)!,
  }));
  const modelFence = { active_model_version_id: aggregate.modelVersionId, selection_revision: aggregate.selectionRevision,
    content_fingerprint: aggregate.contentFingerprint, state: 'ready', health: 'healthy' };
  const preparationFence = { current_aggregate_id: aggregate.id, current_artifact_id: aggregate.artifactId,
    geometry_revision: aggregate.geometryRevision, resolution_revision: aggregate.resolutionRevision };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    expect(params[0]).toBe(aggregate.projectId);
    if (sql.includes('tray-auto-length:publication')) { expect(params[1]).toBe(trayId); return { rows: [row] }; }
    if (sql.includes('tray-auto-length:leaves')) {
      expect(params).toEqual([aggregate.projectId, f.traceId, trayId, 3]); return { rows };
    }
    if (sql.includes('tray-auto-length:model-fence')) return { rows: [modelFence] };
    if (sql.includes('tray-auto-length:preparation-fence')) return { rows: [preparationFence] };
    throw Error('Unexpected query: ' + sql);
  });
  const client = { query } as unknown as Pick<PoolClient, 'query'>;
  const read = () => readCurrentTrayAutoLength(client, aggregate.projectId, trayId);
  const resolution = (roots: string[]) => ({ id: f.traceId, projectTrayId: trayId, mode: 'roots', rootObjectIds: roots,
    reason: 'Synthetic current model mapping', actorId: f.createdBy, createdAt: f.createdAt,
    scope: { modelVersionId: aggregate.modelVersionId, contentFingerprint: aggregate.contentFingerprint, selectionRevision: aggregate.selectionRevision,
      catalogRevision: aggregate.catalogRevision, routingContentSha256: aggregate.routingContentSha256, routingPolicyRevision: aggregate.routingPolicyRevision,
      routingPolicySha256: aggregate.routingPolicySha256, locationRegistryRevision: aggregate.locationRegistryRevision, resolutionRevision: aggregate.resolutionRevision } });
  return { f, built, row, rows, modelFence, preparationFence, query, read, client, trayId, resolution };
}

describe('current published tray centerline Auto-length', () => {
  it('adds each independent complete leaf once without connecting the93metre gap or adding cable allowances', async () => {
    const f = fixture();
    await expect(f.read()).resolves.toEqual({ lengthMm: 9000, elementCount: 2, modelVersionId: f.f.aggregate.modelVersionId,
      geometryRevision: '1', aggregateId: f.f.aggregate.id, traceId: f.f.traceId });
    expect(f.query.mock.calls).toHaveLength(4);
    expect(f.query.mock.calls.every(([sql]) => !/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
    expect(f.query.mock.calls[2][0]).toMatch(/FOR SHARE OF sel,ver/);
    expect(f.query.mock.calls[3][0]).toMatch(/FOR SHARE/);
  });

  it('measures the curved source polyline instead of its chord or bounding-box size', async () => {
    const arc = Array.from({ length: 33 }, (_, index) => [Math.cos(index * Math.PI / 64), Math.sin(index * Math.PI / 64), 0]);
    const f = fixture([arc, [[100, 0, 0], [100, 0, 0]]]);
    const expectedMm = Math.round(arc.slice(1).reduce((sum, point, at) => sum + Math.hypot(...point.map((value, axis) => value - arc[at][axis])), 0) * 1_000_000) / 1000;
    const result = await f.read(); expect(result.lengthMm).toBe(expectedMm); expect(result.lengthMm).toBeGreaterThan(1500);
    expect(result.lengthMm).not.toBe(Math.round(Math.sqrt(2) * 1_000_000) / 1000);
  });

  it('rounds only the final millimetre sum to three decimals', async () => {
    const f = fixture([[[0, 0, 0], [0.0000004, 0, 0]], [[0, 0, 0], [0.0000004, 0, 0]]]);
    await expect(f.read()).resolves.toMatchObject({ lengthMm: 0.001, elementCount: 2 });
  });

  it('keeps valid zero-length source elements distinct from unavailable centerline data', async () => {
    const f = fixture([[[0, 0, 0], [0, 0, 0]], [[100, 0, 0], [100, 0, 0]]]);
    await expect(f.read()).resolves.toMatchObject({ lengthMm: 0, elementCount: 2 });
  });

  it('does not depend on the optional geometry-trace UI feature when persisted records exist', async () => {
    vi.stubEnv('PF_GEOMETRY_TRACE_ENABLED', 'false');
    try { await expect(fixture().read()).resolves.toMatchObject({ lengthMm: 9000 }); }
    finally { vi.unstubAllEnvs(); }
  });

  it.each(['trace', 'aggregate'] as const)('gives preparation guidance when there is no current %s instead of manufacturing zero', async kind => {
    const f = fixture(); if (kind === 'trace') f.row.trace_id = null; else f.row.current_aggregate_id = '';
    await expect(f.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_UNAVAILABLE', status: 409, message: expect.stringContaining('centerline data') });
    expect(f.query.mock.calls).toHaveLength(1);
  });

  it.each(['model', 'fingerprint', 'selection', 'health', 'tray-name'] as const)('refuses stale %s evidence', async kind => {
    const f = fixture();
    if (kind === 'model') f.row.active_model_version_id = f.f.traceId;
    if (kind === 'fingerprint') f.row.content_fingerprint = '9'.repeat(64);
    if (kind === 'selection') f.row.selection_revision = '2';
    if (kind === 'health') f.row.model_health = 'unavailable';
    if (kind === 'tray-name') f.row.tray_name = 'B099';
    await expect(f.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_STALE' });
  });

  it('accepts a re-confirmed identical manual root set but refuses a replacement assignment', async () => {
    const same = fixture(); same.row.resolution = same.resolution(['dbid:2', 'dbid:9']);
    await expect(same.read()).resolves.toMatchObject({ lengthMm: 9000 });
    const changed = fixture(); changed.row.resolution = changed.resolution(['dbid:9']);
    await expect(changed.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_STALE' });
  });

  it.each(['missing', 'duplicate', 'foreign-tray', 'nonfinite', 'no-polyline', 'false-length', 'tampered'] as const)('refuses %s leaf data without a partial length', async kind => {
    const f = fixture();
    if (kind === 'missing') f.rows.pop();
    if (kind === 'duplicate') f.rows[1] = f.rows[0];
    if (kind === 'foreign-tray') f.rows[0].record.catalog.projectTrayId = f.f.traceId;
    if (kind === 'nonfinite') f.rows[0].record.geometry.fitted!.pointsMetres[0][0] = NaN;
    if (kind === 'no-polyline') f.rows[0].record.geometry.fitted = null;
    if (kind === 'false-length') {
      f.rows[0].record.geometry.fitted!.geometricLengthMetres = 5;
      f.rows[0].record.geometry.fitted!.geometricLengthRoundTrip = '5'; f.rows[0].summary.geometricLengthMetres = 5;
      f.rows[0].summary.recordSha256 = geometryTraceHash(f.rows[0].record);
    }
    if (kind === 'tampered') f.rows[0].record.historicalModel.name = 'Changed after publication';
    await expect(f.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_INVALID' });
  });

  it('refuses a changed publication or model at the final transaction fences', async () => {
    const model = fixture(); model.modelFence.selection_revision = '2';
    await expect(model.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_STALE' });
    const publication = fixture(); publication.preparationFence.current_aggregate_id = publication.f.traceId;
    await expect(publication.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_STALE' });
    const mapping = fixture(); mapping.preparationFence.resolution_revision = '5';
    await expect(mapping.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_STALE' });
  });

  it('rejects an unsigned trace, absent publication proof and unsupported output length', async () => {
    const trace = fixture(); trace.row.trace_manifest.contentSha256 = '0'.repeat(64);
    await expect(trace.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_INVALID' });
    const unpublished = fixture(); unpublished.row.publication_proof = false;
    await expect(unpublished.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_INVALID' });
    const huge = fixture([[[0, 0, 0], [1001, 0, 0]], [[100, 0, 0], [100, 0, 0]]]);
    await expect(huge.read()).rejects.toMatchObject({ code: 'TRAY_AUTO_LENGTH_LIMIT', status: 413 });
  });

  it('rejects invalid input identifiers without any database reads', async () => {
    const f = fixture(); await expect(readCurrentTrayAutoLength(f.client, 'bad', f.trayId)).rejects.toBeInstanceOf(TrayAutoLengthError);
    expect(f.query).not.toHaveBeenCalled();
  });
});
