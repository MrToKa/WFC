/** Synthetic only; never qualifies a converted model or supplies production defaults. */
import { ENDPOINT_ATTACHMENT_POLICY, endpointBindingSchema, type EndpointBinding } from './pathfinderEndpointBindings.js';
import type { EndpointMigrationInput } from './pathfinderEndpointAttachment.js';
export const endpointTestId = (n: number): string => `d5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const endpointTestMatrix = (translation: [number, number, number] = [0, 0, 0]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...translation, 1];
export function endpointBindingFixture(): EndpointBinding {
  return endpointBindingSchema.parse({
    schemaVersion: 'wfc.pf.endpoint-binding.v1', id: endpointTestId(1), projectId: endpointTestId(2), locationId: endpointTestId(3), locationRevision: '1', bindingRevision: '1', locationRegistryRevision: '1',
    modelVersionId: endpointTestId(4), aggregateId: endpointTestId(5), artifactId: endpointTestId(6), projectionSha256: 'a'.repeat(64), captureFrameId: endpointTestId(7), qualifiedProjectFrameId: null,
    status: 'confirmed', mode: 'fixed-world', pointProjectMetres: [3, 2, 4], derivation: 'manual-world-point', sourceObject: null, attachment: null, sourceDecisionId: null, supersedesBindingId: null, legacyObservationId: null,
    priorPointProjectMetres: null, priorCaptureFrameId: null, displacementBasis: 'none', displacementVectorMetres: null, displacementMetres: null, confirmedBy: endpointTestId(8), confirmedAt: '2026-10-19T03:00:00.000Z', reason: 'Synthetic explicit point confirmation.', contentSha256: 'b'.repeat(64),
  });
}
export function endpointMigrationFixture(mode: EndpointBinding['mode'] = 'object-attached'): EndpointMigrationInput {
  const source = endpointBindingFixture(), id = endpointTestId, frameId = id(9), oldRef = { traceId: id(10), objectRevisionId: id(11), recordSha256: 'c'.repeat(64) }, newRef = { traceId: id(12), objectRevisionId: id(13), recordSha256: 'd'.repeat(64) };
  const oldEvidence = {
    schemaVersion: 'wfc.pf.qualified-object-attachment-evidence.v1' as const, id: id(14), contentSha256: 'e'.repeat(64), projectId: source.projectId, object: oldRef, modelVersionId: source.modelVersionId, aggregateId: source.aggregateId, captureFrameId: source.captureFrameId, qualifiedProjectFrameId: frameId,
    logicalObjectId: id(15), sourceDocumentId: 'synthetic-document', sourceInstancePath: 'synthetic/instance', stableExportEntityId: 'synthetic-entity', objectLocalToProjectMetres: endpointTestMatrix([1, 0, 0]), intrinsicShapeSha256: 'f'.repeat(64), placementSha256: '1'.repeat(64), deformation: 'rigid' as const, connectors: [{ id: 'terminal-A', localPointMetres: [2, 2, 4] as [number, number, number] }], reviewedBy: id(8), reviewedAt: source.confirmedAt!,
  };
  const target = { modelVersionId: id(16), selectionRevision: '2', contentFingerprint: '2'.repeat(64), aggregateId: id(17), artifactId: id(18), projectionSha256: '3'.repeat(64), captureFrameId: id(19), geometryRevision: '2', traceId: newRef.traceId };
  const newEvidence = { ...structuredClone(oldEvidence), id: id(20), contentSha256: '4'.repeat(64), object: newRef, modelVersionId: target.modelVersionId, aggregateId: target.aggregateId, captureFrameId: target.captureFrameId, objectLocalToProjectMetres: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1], placementSha256: '5'.repeat(64) };
  const binding: EndpointBinding = { ...source, mode, qualifiedProjectFrameId: frameId, sourceObject: mode === 'fixed-world' ? null : oldRef, derivation: mode === 'fixed-world' ? 'manual-world-point' : mode === 'object-derived' ? 'equipment-bottom-aabb.v1' : 'qualified-local-point.v1', attachment: mode === 'object-attached' ? { evidenceId: oldEvidence.id, evidenceSha256: oldEvidence.contentSha256, logicalObjectId: oldEvidence.logicalObjectId, localPointMetres: [2, 2, 4], connectorId: null, sourceShapeSha256: oldEvidence.intrinsicShapeSha256, sourcePlacementSha256: oldEvidence.placementSha256, transformPolicyVersion: ENDPOINT_ATTACHMENT_POLICY, frameDecisionId: id(21) } : null };
  return {
    sourceBinding: binding, targetAggregate: target,
    frameMapping: { schemaVersion: 'wfc.pf.endpoint-frame-mapping.v1', id: id(22), contentSha256: '6'.repeat(64), projectId: source.projectId, sourceAggregateId: source.aggregateId, targetAggregateId: target.aggregateId, sourceCaptureFrameId: source.captureFrameId, targetCaptureFrameId: target.captureFrameId, qualifiedProjectFrameId: frameId, sourceCaptureToTargetCaptureMetres: endpointTestMatrix(), qualification: 'reviewed-rigid', reviewedBy: id(8), reviewedAt: source.confirmedAt },
    objectMapping: { schemaVersion: 'wfc.pf.endpoint-object-mapping.v1', id: id(23), contentSha256: '7'.repeat(64), projectId: source.projectId, sourceAggregateId: source.aggregateId, targetAggregateId: target.aggregateId, sourceObjectRevisionIds: [oldRef.objectRevisionId], targetObjectRevisionIds: [newRef.objectRevisionId], disposition: 'unique', qualification: 'reviewed-identity', reviewedBy: id(8), reviewedAt: source.confirmedAt },
    sourceObject: { reference: oldRef, projectId: source.projectId, modelVersionId: source.modelVersionId, aggregateId: source.aggregateId, captureFrameId: source.captureFrameId, bounds: { minimum: [0, 0, 0], maximum: [10, 10, 10] }, geometryRole: 'object', worldRepresentationSha256: '8'.repeat(64), intrinsicShapeSha256: oldEvidence.intrinsicShapeSha256, qualifiedAttachment: oldEvidence },
    targetObject: { reference: newRef, projectId: source.projectId, modelVersionId: target.modelVersionId, aggregateId: target.aggregateId, captureFrameId: target.captureFrameId, bounds: { minimum: [20, 30, 40], maximum: [30, 40, 50] }, geometryRole: 'object', worldRepresentationSha256: '9'.repeat(64), intrinsicShapeSha256: newEvidence.intrinsicShapeSha256, qualifiedAttachment: newEvidence },
    validationPolicy: { schemaVersion: 'wfc.pf.endpoint-rigid-policy.v1', id: id(24), contentSha256: '0'.repeat(64), version: ENDPOINT_ATTACHMENT_POLICY, numericalTolerance: 1e-10, engineeringToleranceMetres: null },
  };
}
