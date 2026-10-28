import { describe, expect, it } from 'vitest';
import { fittedTraceExportSchema, fittedTraceReferenceSchema, geometryTraceCreateSchema, GEOMETRY_TRACE_DERIVATION, GEOMETRY_TRACE_LIMITS, type FittedTraceExport } from './pathfinderGeometryTrace.js';

const id = (n: number) => `d2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = 'a'.repeat(64);
function fixture(): FittedTraceExport {
  return {
    schemaVersion: 'wfc.pf.fitted-trace.v1', exportId: id(1), projectId: id(2), modelVersionId: id(3), contentFingerprint: digest, snapshotSha256: digest, preparedKey: digest, rulesSha256: digest,
    engine: { version: '45c24bf5f433f13e102600b36f20327c77961d0a', runnerSha256: digest, modelModuleSha256: digest, coreModuleSha256: digest, adapterModuleSha256: digest },
    measurementVersion: 'wfc.pf.fitted-polyline-length.v1', readiness: 'needs_review', engineeringAccepted: false,
    counts: { objects: 1, segments: 1, diagnostics: 2, points: 3, ports: 2 }, geometryCounts: { validatedBends: 0, fallbackBends: 1, validatedStraights: 0, fallbackStraights: 0, fallbackClearances: 1 },
    objects: [{ orderIndex: 0, objectId: 'dbid:9', externalId: null, dbId: 9, name: 'Synthetic bend', geometryRole: 'routing-leaf', resolvedRouteName: '/B009', shapeName: 'BEND', visibility: 'unknown', bottomCentreMetres: [0, 0, 0] }],
    segments: [{ orderIndex: 0, objectId: 'dbid:9', name: '/B009', routeCode: '/B009', allowedCategoryMask: 5, connectionsAtEndsOnly: true, pointsMetres: [[3.125, 0, 0], [0, 0, 0], [0, 4.25, 0]], ports: [{ pointMetres: [3.125, 0, 0], outward: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], widthMetres: 0.2, heightMetres: 0.1 }, { pointMetres: [0, 4.25, 0], outward: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], widthMetres: 0.2, heightMetres: 0.1 }], connectionSurfaceCount: 2, geometricLengthMetres: 7.375, geometricLengthRoundTrip: '7.375', fitStatus: 'unknown' }],
    diagnostics: ['Synthetic explicit fallback', 'Synthetic clearance unavailable'],
  };
}

describe('fitted trace immutable producer contract', () => {
  it('preserves exact ordered binary64 coordinates, ports, category mask and C# length string', () => {
    const input = fixture(), parsed = fittedTraceExportSchema.parse(input);
    expect(parsed).toEqual(input); expect(parsed.segments[0].pointsMetres[0][0]).toBe(3.125); expect(parsed.segments[0].geometricLengthRoundTrip).toBe('7.375'); expect(parsed.segments[0].ports.map(p => p.pointMetres)).toEqual([[3.125, 0, 0], [0, 4.25, 0]]);
  });
  it('retains more than2048 full diagnostic records without granting per-object proof', () => {
    const input = fixture(); input.diagnostics = Array.from({ length: 2051 }, (_, n) => 'Synthetic warning ' + n); input.counts.diagnostics = 2051; input.objects[0].visibility = 'excluded';
    const parsed = fittedTraceExportSchema.parse(input); expect(parsed.diagnostics).toHaveLength(2051); expect(parsed.objects[0].visibility).toBe('excluded'); expect(parsed.segments[0].fitStatus).toBe('unknown'); expect(parsed.engineeringAccepted).toBe(false);
  });
  it.each(['object-count', 'segment-count', 'diagnostic-count', 'point-count', 'port-count', 'object-order', 'segment-order', 'length-roundtrip'] as const)('rejects mismatched %s closure', kind => {
    const input = fixture();
    if (kind === 'object-count') input.counts.objects++; if (kind === 'segment-count') input.counts.segments++; if (kind === 'diagnostic-count') input.counts.diagnostics++; if (kind === 'point-count') input.counts.points++; if (kind === 'port-count') input.counts.ports++; if (kind === 'object-order') input.objects[0].orderIndex = 1; if (kind === 'segment-order') input.segments[0].orderIndex = 1; if (kind === 'length-roundtrip') input.segments[0].geometricLengthRoundTrip = '7.374999999999999';
    expect(fittedTraceExportSchema.safeParse(input).success).toBe(false);
  });
  it.each(['object', 'segment'] as const)('rejects duplicate %s identity even with internally updated counts/order', kind => {
    const input = fixture();
    if (kind === 'object') { input.objects.push({ ...structuredClone(input.objects[0]), orderIndex: 1 }); input.counts.objects++; }
    else { input.segments.push({ ...structuredClone(input.segments[0]), orderIndex: 1 }); input.counts.segments++; input.counts.points *= 2; input.counts.ports *= 2; }
    expect(fittedTraceExportSchema.safeParse(input).success).toBe(false);
  });
  it.each(['nonunit', 'nonorthogonal', 'zero-width', 'interior-terminal', 'surface-count'] as const)('rejects malformed physical port evidence %s', kind => {
    const input = fixture(), segment = input.segments[0];
    if (kind === 'nonunit') segment.ports[0].outward = [2, 0, 0]; if (kind === 'nonorthogonal') segment.ports[0].u = [1, 0, 0]; if (kind === 'zero-width') segment.ports[0].widthMetres = 0; if (kind === 'interior-terminal') segment.ports[0].pointMetres = [0, 0, 0]; if (kind === 'surface-count') segment.connectionSurfaceCount = 1;
    expect(fittedTraceExportSchema.safeParse(input).success).toBe(false);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects nonfinite coordinates and measurements %s', value => {
    const input = fixture(); input.segments[0].pointsMetres[0][0] = value; expect(fittedTraceExportSchema.safeParse(input).success).toBe(false);
    const length = fixture(); length.segments[0].geometricLengthMetres = value; expect(fittedTraceExportSchema.safeParse(length).success).toBe(false);
  });
  it('refuses invented approval/fit properties and unsupported schema/measurement versions', () => {
    const input = fixture();
    for (const changed of [{ ...input, schemaVersion: 'foreign' }, { ...input, measurementVersion: 'bbox-diagonal' }, { ...input, engineeringAccepted: true }, { ...input, callerPath: '/foreign' }, { ...input, segments: [{ ...input.segments[0], fitStatus: 'validated' }] }]) expect(fittedTraceExportSchema.safeParse(changed).success).toBe(false);
  });
  it.each(['\n', ' '])('refuses noncanonical hash/identity suffix %j', suffix => {
    const input = fixture(); input.engine.runnerSha256 += suffix; expect(fittedTraceExportSchema.safeParse(input).success).toBe(false);
    const identity = fixture(); identity.exportId += suffix; expect(fittedTraceExportSchema.safeParse(identity).success).toBe(false);
  });
  it('binds the small export reference shape and byte ceiling without accepting caller file paths', () => {
    const input = fixture(), reference = { schemaVersion: 'wfc.pf.fitted-trace-reference.v1', exportId: input.exportId, sha256: digest, bytes: 1024, counts: input.counts, engine: input.engine, rulesSha256: input.rulesSha256, snapshotSha256: input.snapshotSha256, preparedKey: input.preparedKey };
    expect(fittedTraceReferenceSchema.safeParse(reference).success).toBe(true); expect(fittedTraceReferenceSchema.safeParse({ ...reference, bytes: GEOMETRY_TRACE_LIMITS.exportBytes + 1 }).success).toBe(false); expect(fittedTraceReferenceSchema.safeParse({ ...reference, filename: '/private' }).success).toBe(false);
  });
  it('requires a versioned server-owned creation command with no actor/path/approval fields', () => {
    const command = { schemaVersion: 'wfc.pf.geometry-trace-create.v1', aggregateId: id(3), expectedProjectionSha256: digest, derivationVersion: GEOMETRY_TRACE_DERIVATION, idempotencyKey: id(4) };
    expect(geometryTraceCreateSchema.safeParse(command).success).toBe(true); for (const extra of [{ actorId: id(9) }, { path: '/private' }, { engineeringAccepted: true }]) expect(geometryTraceCreateSchema.safeParse({ ...command, ...extra }).success).toBe(false);
  });
});
