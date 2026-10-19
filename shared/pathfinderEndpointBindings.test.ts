import { describe, expect, it } from 'vitest';
import { endpointBindingContentHashInput, endpointBindingContextSchema, endpointBindingErrorSchema, endpointBindingHistorySchema, endpointBindingReceiptSchema, endpointBindingSchema, endpointBindingWriteSchema, endpointMigrationWriteSchema, endpointPointSchema, normalizeEndpointLocation } from './pathfinderEndpointBindings.js';
import { endpointBindingFixture, endpointTestId } from './pathfinderEndpointFixtures.js';
import { canonicalPurposeJson, parsePurposeJson } from './pathfinderPurposePolicy.js';

function write() {
  const b = endpointBindingFixture(); return { schemaVersion: 'wfc.pf.endpoint-binding-write.v1', expectedRegistryRevision: '1', expectedLocationRevision: null, expectedHeadId: null, expectedSelectionRevision: '1', modelVersionId: b.modelVersionId, aggregateId: b.aggregateId, projectionSha256: b.projectionSha256, captureFrameId: b.captureFrameId, idempotencyKey: endpointTestId(90), reason: 'Synthetic explicit point.', location: { name: 'Equipment =A-001', aliases: ['Room A / equipment 1'] }, mode: 'fixed-world', pointProjectMetres: [0, 0, 0], derivation: 'manual-world-point', provenanceObject: null };
}
describe('strict endpoint wire contracts and legacy separation', () => {
  it('accepts an explicit true zero fixed point for an atomic new location without creating a synthetic missing origin', () => { const request = endpointBindingWriteSchema.parse(write()); expect(request.expectedLocationRevision).toBeNull(); expect(request.expectedHeadId).toBeNull(); expect(request.mode).toBe('fixed-world'); });
  it('normalizes exact shared names with NFC/trim/uppercase while preserving punctuation and zeroes', () => { expect(normalizeEndpointLocation('  e\u0301q-001 /A  ')).toBe('ÉQ-001 /A'); expect(normalizeEndpointLocation('A-001')).not.toBe(normalizeEndpointLocation('A-01')); });
  it.each(['', ' ', '\u0000bad', 'bad\n', '\ud800', 'e\u0301q'])('rejects blank/control/lone-surrogate/non-normalized display name %j', name => { expect(endpointBindingWriteSchema.safeParse({ ...write(), location: { name, aliases: [] } }).success).toBe(false); });
  it('rejects aliases colliding with the name or each other under existing shared lookup semantics', () => {
    expect(endpointBindingWriteSchema.safeParse({ ...write(), location: { name: 'A-001', aliases: ['a-001'] } }).success).toBe(false);
    expect(endpointBindingWriteSchema.safeParse({ ...write(), location: { name: 'A-001', aliases: ['Room 1', 'room 1'] } }).success).toBe(false);
  });
  it.each(['actorId', 'isAdmin', 'qualifiedProjectFrameId', 'objectLocalToProjectMetres', 'locationId', 'path'] as const)('rejects caller-supplied %s authority/paths/qualification', key => { expect(endpointBindingWriteSchema.safeParse({ ...write(), [key]: endpointTestId(99) }).success).toBe(false); });
  it('refuses expected old head on a new UUID location', () => { expect(endpointBindingWriteSchema.safeParse({ ...write(), expectedHeadId: endpointTestId(99) }).success).toBe(false); });
  it.each(['uuid', 'revision', 'hash'] as const)('rejects newline suffixed %s', kind => { const v = write(); if (kind === 'uuid') v.modelVersionId += '\n'; if (kind === 'revision') v.expectedRegistryRevision += '\n'; if (kind === 'hash') v.projectionSha256 += '\n'; expect(endpointBindingWriteSchema.safeParse(v).success).toBe(false); });
  it.each([Infinity, -Infinity, NaN, 1e9 + 1])('rejects nonfinite or out-of-bounds points %s', value => { expect(endpointPointSchema.safeParse([value, 0, 0]).success).toBe(false); });
  it('object-derived requests accept exact immutable object evidence but reject client point overrides', () => {
    const { pointProjectMetres: _point, derivation: _derivation, provenanceObject: _provenance, ...common } = write(), request = { ...common, mode: 'object-derived', object: { traceId: endpointTestId(70), objectRevisionId: endpointTestId(71), recordSha256: 'a'.repeat(64) }, anchorRule: 'equipment-bottom-aabb.v1' };
    expect(endpointBindingWriteSchema.safeParse(request).success).toBe(true); expect(endpointBindingWriteSchema.safeParse({ ...request, pointProjectMetres: [0, 0, 0] }).success).toBe(false);
  });
  it('requires strict server evidence IDs for Follow and refuses matrices supplied with them', () => {
    const { pointProjectMetres: _point, derivation: _derivation, provenanceObject: _provenance, ...common } = write(), request = { ...common, mode: 'object-attached', object: { traceId: endpointTestId(70), objectRevisionId: endpointTestId(71), recordSha256: 'a'.repeat(64) }, attachmentEvidenceId: endpointTestId(72), pickedPointProjectMetres: [1, 2, 3], connectorId: null };
    expect(endpointBindingWriteSchema.safeParse(request).success).toBe(true); expect(endpointBindingWriteSchema.safeParse({ ...request, matrix: [] }).success).toBe(false);
  });
  it('preserves full canonical historical binding proof while content hash excludes only itself', () => {
    const binding = endpointBindingFixture(), input = endpointBindingContentHashInput(binding); expect(input).not.toHaveProperty('contentSha256'); expect(input).toHaveProperty('pointProjectMetres', binding.pointProjectMetres); expect(input).toHaveProperty('qualifiedProjectFrameId', null);
    expect(canonicalPurposeJson(input)).not.toContain('undefined'); expect(endpointBindingSchema.parse(JSON.parse(JSON.stringify(binding)))).toEqual(binding);
  });
  it('a fixed-world record cannot acquire an implicit attachment', () => {
    const b = endpointBindingFixture(); expect(endpointBindingSchema.safeParse({ ...b, mode: 'object-attached' }).success).toBe(false); expect(endpointBindingSchema.safeParse({ ...b, mode: 'object-derived', sourceObject: null }).success).toBe(false); expect(endpointBindingSchema.safeParse({ ...b, confirmedBy: null }).success).toBe(false);
  });
  it('retains exact displacement only when both points share the exact capture frame', () => {
    const b = endpointBindingFixture(), changed = { ...b, priorPointProjectMetres: [1, 2, 3], priorCaptureFrameId: b.captureFrameId, displacementBasis: 'same-capture-frame', displacementVectorMetres: [2, 0, 1], displacementMetres: Math.hypot(2, 0, 1) };
    expect(endpointBindingSchema.safeParse(changed).success).toBe(false); expect(endpointBindingSchema.safeParse({ ...changed, supersedesBindingId: endpointTestId(98) }).success).toBe(true); expect(endpointBindingSchema.safeParse({ ...changed, supersedesBindingId: endpointTestId(98), displacementMetres: null }).success).toBe(false);
    expect(endpointBindingSchema.safeParse({ ...changed, supersedesBindingId: endpointTestId(98), displacementVectorMetres: [0, 0, 0] }).success).toBe(false);
  });
  it('retains first legacy coordinates without inventing their capture frame or a zero displacement', () => {
    const b = endpointBindingFixture(), legacy = { ...b, legacyObservationId: endpointTestId(99), priorPointProjectMetres: [1, 2, 3], priorCaptureFrameId: null, displacementBasis: 'unverified-frames' };
    expect(endpointBindingSchema.safeParse(legacy).success).toBe(true); expect(endpointBindingSchema.safeParse({ ...legacy, legacyObservationId: null }).success).toBe(false);
    expect(endpointBindingSchema.safeParse({ ...legacy, displacementMetres: 0, displacementVectorMetres: [0, 0, 0] }).success).toBe(false);
  });
  it('different-frame history preserves both raw points but never subtracts them as a physical move', () => {
    const b = endpointBindingFixture(), changed = { ...b, supersedesBindingId: endpointTestId(98), priorPointProjectMetres: [3, 2, 4], priorCaptureFrameId: endpointTestId(97), displacementBasis: 'unverified-frames' };
    expect(endpointBindingSchema.safeParse(changed).success).toBe(true);
    expect(endpointBindingSchema.safeParse({ ...changed, displacementMetres: 0, displacementVectorMetres: [0, 0, 0] }).success).toBe(false);
    expect(endpointBindingSchema.safeParse({ ...changed, displacementBasis: 'same-capture-frame' }).success).toBe(false);
  });
  it('receipt and history reject another project/location binding', () => {
    const b = endpointBindingFixture(), receipt = { schemaVersion: 'wfc.pf.endpoint-binding-receipt.v1', projectId: b.projectId, locationId: b.locationId, registryRevision: b.locationRegistryRevision, locationRevision: b.locationRevision, binding: b, duplicate: true };
    expect(endpointBindingReceiptSchema.safeParse(receipt).success).toBe(true); expect(endpointBindingReceiptSchema.safeParse({ ...receipt, locationId: endpointTestId(99) }).success).toBe(false);
    expect(endpointBindingHistorySchema.safeParse({ schemaVersion: 'wfc.pf.endpoint-binding-history.v1', projectId: endpointTestId(99), locationId: b.locationId, bindings: [b], nextBeforeRevision: null }).success).toBe(false);
  });
  it('context refuses calculation-ready history from another aggregate despite identical displayed points', () => {
    const b = endpointBindingFixture(), context = { schemaVersion: 'wfc.pf.endpoint-binding-context.v1', projectId: b.projectId, locationId: b.locationId, registryRevision: '1', location: { id: b.locationId, name: 'A', aliases: [], revision: '1' }, current: { modelVersionId: b.modelVersionId, selectionRevision: '1', contentFingerprint: 'c'.repeat(64), aggregateId: b.aggregateId, artifactId: b.artifactId, projectionSha256: b.projectionSha256, captureFrameId: b.captureFrameId, geometryRevision: '1', traceId: null }, head: b, legacy: null, capabilities: [{ mode: 'fixed-world', supported: true, reasonCodes: [] }, { mode: 'object-derived', supported: false, reasonCodes: ['TRACE_UNAVAILABLE'] }, { mode: 'object-attached', supported: false, reasonCodes: ['QUALIFIED_LOCAL_FRAME_UNAVAILABLE'] }], readiness: { status: 'confirmed', calculationReady: true, reasonCodes: [] }, usage: { fromOccurrences: 2, toOccurrences: 3, distinctCables: 4 } };
    expect(endpointBindingContextSchema.safeParse(context).success).toBe(true); context.current.aggregateId = endpointTestId(99); expect(endpointBindingContextSchema.safeParse(context).success).toBe(false);
  });
  it('migration commands accept only references, never caller-qualified matrices or approval', () => {
    const b = endpointBindingFixture(), command = { schemaVersion: 'wfc.pf.endpoint-migration-write.v1', sourceBindingId: b.id, expectedRegistryRevision: '1', expectedLocationRevision: '1', expectedHeadId: b.id, expectedSelectionRevision: '2', targetModelVersionId: endpointTestId(80), targetAggregateId: endpointTestId(81), targetProjectionSha256: 'd'.repeat(64), targetCaptureFrameId: endpointTestId(82), objectDecisionId: null, frameDecisionId: null, idempotencyKey: endpointTestId(83), reason: 'Explicit synthetic review request.' };
    expect(endpointMigrationWriteSchema.safeParse(command).success).toBe(true); expect(endpointMigrationWriteSchema.safeParse({ ...command, approved: true }).success).toBe(false);
  });
  it('duplicate decoded JSON keys and finite transport remain enforced before wire validation', () => { expect(() => parsePurposeJson('{"mode":"fixed-world","\\u006dode":"object-attached"}')).toThrow('INVALID_POLICY_JSON'); expect(() => parsePurposeJson('{"x":1e999}')).toThrow(); });
  it('typed errors distinguish a definite refusal from an uncertain operation', () => { expect(endpointBindingErrorSchema.parse({ schemaVersion: 'wfc.pf.endpoint-binding-error.v1', code: 'ENDPOINT_COMMIT_OUTCOME_UNKNOWN', message: 'Reconcile the same command.', outcome: 'unknown' }).outcome).toBe('unknown'); });
});
