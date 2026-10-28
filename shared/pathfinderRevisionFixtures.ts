/** Synthetic data only. These facts never qualify a converted model. */
import type { GeometryObjectRevision } from './pathfinderGeometryTrace.js';
import type { RevisionComparatorInput, RevisionQualifiedObject } from './pathfinderRevisionComparator.js';
import type { RevisionComparisonDecision } from './pathfinderRevisionComparison.js';
export const revisionTestId = (n: number): string => `d6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const revisionTestHash = (hex: string) => hex.repeat(64);
export const revisionTestMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const id = revisionTestId, h = revisionTestHash, at = '2026-10-19T05:00:00.000Z';
export function revisionComparisonFixture(): RevisionComparatorInput {
  const input = (side: number) => ({ aggregateId: id(10 + side), traceId: id(20 + side), projectionSha256: h(side ? 'b' : 'a'), traceContentSha256: h('c'), modelVersionId: id(30 + side), captureFrameId: id(40 + side), geometryRevision: '1', coverage: { requestedScopeSha256: h('d'), comparableScopeSha256: h('e'), requestedScopeComplete: true, includedObjects: 1, excludedObjects: 0, basis: 'prepared-requested-scope' as const }, routing: { catalogRevision: '1', routingContentSha256: h('f'), routingPolicyRevision: '1', routingPolicySha256: h('0') } });
  const engine = { version: 'synthetic', runnerSha256: h('1'), modelModuleSha256: h('2'), coreModuleSha256: h('3'), adapterModuleSha256: h('4') };
  const object = (side: number): GeometryObjectRevision => ({ schemaVersion: 'wfc.pf.object-revision.v1', id: id(50 + side), traceId: input(side).traceId, projectId: id(1), modelVersionId: input(side).modelVersionId, aggregateId: input(side).aggregateId,
    identity: { objectId: 'dbid:7', dbId: 7, externalId: 'same-unscoped-id', logicalObjectId: null, sourceDocumentId: null, sourceInstancePath: null, stableExportEntityId: null, basis: 'version-local-only' },
    catalog: { projectTrayId: id(60), rootObjectId: 'dbid:7', rawName: 'TRAY-A', purposeKey: 'Control', allowedCategories: ['Control'], routing: input(side).routing },
    historicalModel: { name: 'TRAY-A', leafToRootNames: ['TRAY-A'], properties: [], observedModelPurposes: ['Control'] },
    coordinates: { schemaVersion: 'wfc.pf.coordinate-frame-evidence.v1', captureFrameId: input(side).captureFrameId, qualifiedProjectFrame: null, vertexFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: null, displayToWorldMetres: [...revisionTestMatrix], globalOffsetMetres: [0, 0, 0], objectLocalToProjectMetres: null, transformsAlreadyApplied: true, qualificationReason: 'capture-frame-is-not-cross-revision-engineering-qualification' },
    geometry: { role: 'routing-leaf', bounds: { minimum: [0, 0, 0], maximum: [2, 2, 2] }, mesh: { projection: { payloadRef: id(70 + side), sha256: input(side).projectionSha256, bytes: 2000 }, objectId: 'dbid:7', sha256: h('5'), fragments: 1 }, fitted: { orderIndex: 0, objectId: 'dbid:7', name: 'TRAY-A', routeCode: '/TRAY-A', allowedCategoryMask: 4, connectionsAtEndsOnly: true, pointsMetres: [[0, 0, 0], [2, 0, 0]], ports: [], connectionSurfaceCount: 0, geometricLengthMetres: 2, geometricLengthRoundTrip: '2', fitStatus: 'unknown' }, equipmentAnchor: null },
    signatures: { policyVersion: 'wfc.pf.geometry-signatures.v1', identityEvidenceSha256: h('6'), worldRepresentationSha256: h('7'), intrinsicShapeSha256: null, placementSha256: null, portsSha256: h('8'), policySha256: h('9') },
    provenance: { sessionId: id(80 + side), partIds: [id(90 + side)], projectionSha256: input(side).projectionSha256, fittedTraceSha256: h('a'), contentFingerprint: h('b'), producerLevel: 'A', sourceKind: 'synthetic', adapterVersion: 'synthetic', engine, rulesSha256: h('c'), completedCaptureEvidence: [], missingCaptureEvidencePartIds: [] },
    audit: { declaredLength: { projectTrayId: id(60), valueMm: '2000', status: 'valid', observedAt: at, sourceRevision: null, source: 'trays.length_mm::text' } }, diagnostics: [],
  });
  return { projectId: id(1), source: { input: input(0), objects: [object(0)], qualifications: [] }, target: { input: input(1), objects: [object(1)], qualifications: [] }, decisions: [], frame: null, validationPolicy: null };
}
export function revisionObjectMappingFixture(input: RevisionComparatorInput): RevisionComparisonDecision {
  return { schemaVersion: 'wfc.pf.revision-comparison-decision.v1', id: id(100), projectId: input.projectId, comparisonId: id(101), comparisonRevision: '2', subjectKey: 'synthetic-subject', decisionRevision: '1', previousDecisionId: null, createdBy: id(2), createdAt: at, reason: 'Synthetic reviewed correspondence only.', contentSha256: h('d'), kind: 'object-mapping', qualification: 'admin-reviewed-correspondence', body: { sourceObjectRevisionIds: [input.source.objects[0].id], targetObjectRevisionIds: [input.target.objects[0].id], disposition: 'unique', evidenceText: 'Synthetic mapping is not source/local-frame proof.' } };
}
export function qualifyRevisionFixture(input: RevisionComparatorInput, hash: (value: unknown) => string): void {
  for (const dataset of [input.source, input.target]) {
    dataset.qualifications = dataset.objects.map((o, index): RevisionQualifiedObject => {
      const value: RevisionQualifiedObject = { schemaVersion: 'wfc.pf.revision-qualified-object.v1', id: id(200 + (dataset === input.target ? 100 : 0) + index), contentSha256: h('0'), projectId: input.projectId, objectRevisionId: o.id, recordSha256: hash(o), aggregateId: o.aggregateId, captureFrameId: dataset.input.captureFrameId, logicalObjectId: id(400 + index), sourceDocumentId: 'synthetic-document', sourceInstancePath: 'synthetic/instance', stableExportEntityId: 'synthetic-entity-' + index, qualifiedProjectFrameId: id(500), intrinsicShapeSha256: h('e'), placementSha256: h('f'), originInCommonFrameMetres: [0, 0, 0], physicalLengthMetres: o.geometry.fitted?.geometricLengthMetres ?? null, connectivitySha256: h('1'), connectivityContextSha256: h('2') };
      value.contentSha256 = hash((({ contentSha256: _hash, ...rest }) => rest)(value)); return value;
    });
  }
  input.frame = { schemaVersion: 'wfc.pf.endpoint-frame-mapping.v1', id: id(600), contentSha256: h('3'), projectId: input.projectId, sourceAggregateId: input.source.input.aggregateId, targetAggregateId: input.target.input.aggregateId, sourceCaptureFrameId: input.source.input.captureFrameId, targetCaptureFrameId: input.target.input.captureFrameId, qualifiedProjectFrameId: id(500), sourceCaptureToTargetCaptureMetres: [...revisionTestMatrix], qualification: 'reviewed-rigid', reviewedBy: id(2), reviewedAt: at };
  input.validationPolicy = { schemaVersion: 'wfc.pf.endpoint-rigid-policy.v1', id: id(601), contentSha256: h('4'), version: 'wfc.pf.endpoint-attachment-policy.v1', numericalTolerance: 1e-10, engineeringToleranceMetres: 0.001 };
}
