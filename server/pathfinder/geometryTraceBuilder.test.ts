import { describe, expect, it } from 'vitest';
import { buildGeometryTrace, geometryTraceHash } from './geometryTraceBuilder.js';
import { geometryTraceFixture as fixture } from './geometryTraceFixtures.js';
import { geometryObjectComputationalHashInput, geometryObjectRevisionSchema } from '../../shared/pathfinderGeometryTrace.js';
const id = (n: number) => `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (hex: string) => hex.repeat(64);

describe('immutable geometry trace built from synthetic retained producer evidence', () => {
  it('preserves complete C# axes, ordered ports, exact length strings and source order without mutating inputs', () => {
    const input = fixture(), before = structuredClone(input), built = buildGeometryTrace(input);
    expect(input).toEqual(before); expect(built.summaries.map(o => o.objectId)).toEqual(['dbid:9', 'dbid:2', 'dbid:5']);
    expect(built.records[0].geometry.fitted).toEqual(input.fitted.segments[0]); expect(built.records[1].geometry.fitted).toEqual(input.fitted.segments[1]);
    expect(built.manifest.diagnostics).toEqual(input.fitted.diagnostics.slice(0, 32)); expect(built.manifest.diagnosticsTruncated).toBe(true); expect(built.manifest.fullDiagnostics).toEqual(input.fittedBlob); expect(built.records[0].geometry.fitted?.geometricLengthMetres).toBe(7); expect(built.records[1].geometry.fitted?.geometricLengthRoundTrip).toBe('1.7320508075688772');
  });
  it('records equipment AABB anchor as approximate and keeps missing engineering/source identity explicitly unknown', () => {
    const built = buildGeometryTrace(fixture()), object = built.records[2];
    expect(object.geometry.equipmentAnchor).toEqual({ pointMetres: [21, 3, 1], derivation: 'equipment-bottom-aabb', approximate: true });
    expect(object.identity).toMatchObject({ logicalObjectId: null, sourceDocumentId: null, sourceInstancePath: null, stableExportEntityId: null, basis: 'version-local-only' });
    expect(object.coordinates).toMatchObject({ qualifiedProjectFrame: null, objectLocalToProjectMetres: null, transformsAlreadyApplied: true });
    expect(object.signatures).toMatchObject({ intrinsicShapeSha256: null, placementSha256: null }); expect(built.manifest.engineeringAccepted).toBe(false); expect(built.manifest.nativeParity).toBe('not-performed');
    expect(object.provenance.missingCaptureEvidencePartIds).toHaveLength(1); expect(object.provenance.completedCaptureEvidence).toEqual([]);
  });
  it('keeps project purpose authoritative and observed model purpose as separate history', () => {
    const record = buildGeometryTrace(fixture()).records[0];
    expect(record.catalog.purposeKey).toBe('Control'); expect(record.historicalModel.observedModelPurposes).toEqual(['Historical source purpose']);
  });
  it('retains excluded producer object state without inventing a verified fit', () => {
    const input = fixture(); input.fitted.objects[2].visibility = 'excluded';
    expect(buildGeometryTrace(input).records[2].geometry.equipmentAnchor?.approximate).toBe(true); expect(input.fitted.objects[2].visibility).toBe('excluded');
  });
  it('separates lossless declared length audit from computational signatures and does not sum root/child length', () => {
    const input = fixture(), before = buildGeometryTrace(input); input.declaredLengths[0].valueMm = '123456789.987654321'; input.declaredLengths[0].observedAt = '2026-10-20T00:00:00.000Z';
    const after = buildGeometryTrace(input);
    expect(after.records[0].audit.declaredLength?.valueMm).toBe('123456789.987654321'); expect(after.records[0].geometry.fitted?.geometricLengthMetres).toBe(7);
    expect(after.records[0].signatures).toEqual(before.records[0].signatures); expect(after.summaries[0].computationalSha256).toBe(before.summaries[0].computationalSha256); expect(after.manifest.computationalSha256).toBe(before.manifest.computationalSha256); expect(after.summaries[0].recordSha256).not.toBe(before.summaries[0].recordSha256);
    expect(geometryTraceHash(geometryObjectComputationalHashInput(after.records[0]))).toBe(after.summaries[0].computationalSha256);
  });
  it('detects changed bend/mesh evidence inside an unchanged bbox without claiming physical placement equivalence', () => {
    const input = fixture(), before = buildGeometryTrace(input); input.snapshot.objects[0].fragments[0].vertices[1][1] = 0.25; input.fitted.segments[0].pointsMetres[1][1] = 0.5;
    const after = buildGeometryTrace(input); expect(after.records[0].geometry.bounds).toEqual(before.records[0].geometry.bounds); expect(after.records[0].signatures.worldRepresentationSha256).not.toBe(before.records[0].signatures.worldRepresentationSha256); expect(after.records[0].signatures.intrinsicShapeSha256).toBe(null); expect(after.records[0].signatures.placementSha256).toBe(null);
  });
  it.each(['fitted-project', 'fitted-model', 'fitted-content', 'snapshot-project', 'snapshot-model', 'snapshot-content', 'engine', 'part', 'no-part', 'duplicate-owner', 'foreign-owner', 'swapped-tray', 'foreign-root', 'anchor', 'missing-object', 'object-order', 'segment-order', 'mask', 'route'] as const)('refuses %s identity/order/policy mismatch', kind => {
    const input = fixture(); expect(() => buildGeometryTrace(input)).not.toThrow();
    if (kind === 'fitted-project') input.fitted.projectId = id(99); if (kind === 'fitted-model') input.fitted.modelVersionId = id(99); if (kind === 'fitted-content') input.fitted.contentFingerprint = hash('9');
    if (kind === 'snapshot-project') input.snapshot.model.projectId = id(99); if (kind === 'snapshot-model') input.snapshot.model.modelVersionId = id(99); if (kind === 'snapshot-content') input.snapshot.model.contentSha256 = hash('9');
    if (kind === 'engine') input.fitted.engine.runnerSha256 = hash('9'); if (kind === 'part') input.traceIndex.objects[0].partIds = [id(99)]; if (kind === 'no-part') input.traceIndex.objects[0].partIds = []; if (kind === 'duplicate-owner') input.traceIndex.objects[1].objectId = input.traceIndex.objects[0].objectId; if (kind === 'foreign-owner') input.traceIndex.objects[0].projectTrayId = id(99); if (kind === 'swapped-tray') input.traceIndex.objects[0].projectTrayId = id(11); if (kind === 'foreign-root') input.traceIndex.objects[0].rootObjectId = 'dbid:99'; if (kind === 'anchor') input.fitted.objects[2].bottomCentreMetres[0] = 123;
    if (kind === 'missing-object') { input.fitted.objects.pop(); input.fitted.counts.objects--; } if (kind === 'object-order') { input.fitted.objects.reverse(); input.fitted.objects.forEach((o, i) => { o.orderIndex = i; }); } if (kind === 'segment-order') { input.fitted.segments.reverse(); input.fitted.segments.forEach((o, i) => { o.orderIndex = i; }); }
    if (kind === 'mask') input.fitted.segments[0].allowedCategoryMask = 1; if (kind === 'route') input.fitted.segments[0].name = '/OTHER';
    expect(() => buildGeometryTrace(input)).toThrow();
  });
  it.each(['foreign', 'duplicate'] as const)('refuses %s completed evidence associations instead of silently ignoring or selecting one', kind => {
    const input = fixture(), blob = { payloadRef: id(70), sha256: hash('9'), bytes: 500 }; expect(() => buildGeometryTrace(input)).not.toThrow();
    input.evidence = kind === 'foreign' ? [{ partId: id(99), blob }] : [{ partId: input.plan.partPlan[0].partId, blob }, { partId: input.plan.partPlan[0].partId, blob: { ...blob, payloadRef: id(71) } }];
    expect(() => buildGeometryTrace(input)).toThrow();
  });
  it('refuses invented intrinsic shape, placement and qualified frame assertions in stored records', () => {
    const record = buildGeometryTrace(fixture()).records[0];
    expect(geometryObjectRevisionSchema.safeParse({ ...record, signatures: { ...record.signatures, intrinsicShapeSha256: hash('1') } }).success).toBe(false);
    expect(geometryObjectRevisionSchema.safeParse({ ...record, signatures: { ...record.signatures, placementSha256: hash('1') } }).success).toBe(false);
    expect(geometryObjectRevisionSchema.safeParse({ ...record, coordinates: { ...record.coordinates, qualifiedProjectFrame: id(90) } }).success).toBe(false);
  });
});
