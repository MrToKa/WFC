import { createHash } from 'node:crypto';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy';
import {
  REVISION_COMPARISON_POLICY,
  revisionComparisonContextSchema,
  revisionComparisonCreateSchema,
  revisionComparisonManifestSchema,
  revisionComparisonChangesPageSchema,
  revisionComparisonReceiptSchema,
  revisionComparisonListSchema,
  revisionComparisonDecisionWriteSchema,
  revisionComparisonDecisionSchema,
  revisionComparisonDecisionReceiptSchema,
  revisionComparisonDecisionHistorySchema,
  revisionComparisonDecisionHeadSchema,
} from '../../shared/pathfinderRevisionComparison';
export const revisionIds = {
  project: '11111111-1111-1111-1111-111111111111',
  sourceAggregate: '22222222-2222-2222-2222-222222222222',
  targetAggregate: '33333333-3333-3333-3333-333333333333',
  sourceTrace: '44444444-4444-4444-4444-444444444444',
  targetTrace: '55555555-5555-5555-5555-555555555555',
  comparison: '66666666-6666-6666-6666-666666666666',
  sourceObject: '77777777-7777-7777-7777-777777777777',
  targetObject: '88888888-8888-8888-8888-888888888888',
  actor: '99999999-9999-9999-9999-999999999999',
  key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  sourceFrame: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  targetFrame: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  sourceModel: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  targetModel: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
};
export const revisionHash = (value: unknown) =>
  createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
export function revisionComparisonFixture() {
  const id = revisionIds,
    stamp = '2026-10-19T00:00:00Z';
  const coverage = {
    requestedScopeSha256: 'a'.repeat(64),
    comparableScopeSha256: null,
    requestedScopeComplete: true,
    includedObjects: 1,
    excludedObjects: 0,
    basis: 'prepared-requested-scope' as const,
  };
  const routing = {
    catalogRevision: '1',
    routingContentSha256: 'b'.repeat(64),
    routingPolicyRevision: '1',
    routingPolicySha256: 'c'.repeat(64),
  };
  const source = {
    aggregateId: id.sourceAggregate,
    traceId: id.sourceTrace,
    projectionSha256: 'd'.repeat(64),
    traceContentSha256: 'e'.repeat(64),
    modelVersionId: id.sourceModel,
    captureFrameId: id.sourceFrame,
    geometryRevision: '1',
    coverage,
    routing,
  };
  const target = {
    ...source,
    aggregateId: id.targetAggregate,
    traceId: id.targetTrace,
    modelVersionId: id.targetModel,
    captureFrameId: id.targetFrame,
    geometryRevision: '2',
  };
  const context = revisionComparisonContextSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-context.v1',
    projectId: id.project,
    comparisonRevision: '1',
    current: null,
    activeModelVersionId: id.targetModel,
    choices: [
      { ...source, modelLabel: 'Synthetic old model', createdAt: stamp },
      { ...target, modelLabel: 'Synthetic new model', createdAt: stamp },
    ],
    choicesTruncated: false,
    capabilities: {
      compare: true,
      reviewedObjectMapping: true,
      reviewedFrameMapping: true,
      bindingFrameQualification: true,
      reasonCodes: [],
    },
  });
  const change = {
    rowIndex: 0,
    sourceObjectRevisionIds: [id.sourceObject],
    targetObjectRevisionIds: [id.targetObject],
    relation: { basis: 'admin-reviewed-correspondence', disposition: 'unique', decisionId: id.key },
    flags: [
      'representation-changed',
      'observed-fitted-length-changed',
      'coordinate-frame-unverified',
    ],
    candidates: [{ objectRevisionId: id.targetObject, reasonCodes: ['NAME_CANDIDATE_ONLY'] }],
    measurements: {
      sourceFittedLengthMetres: 1,
      targetFittedLengthMetres: 2,
      fittedLengthDeltaMetres: 1,
      sourceDeclaredLengthMm: '1000.000',
      targetDeclaredLengthMm: '9999.00',
      displacementVectorMetres: null,
      displacementMetres: null,
    },
    evidenceReferences: [],
    reasonCodes: ['COMMON_FRAME_UNVERIFIED'],
    automaticBindingCarryEligible: false,
    requiresReview: true,
  };
  const manifest = revisionComparisonManifestSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison.v1',
    id: id.comparison,
    projectId: id.project,
    comparisonRevision: '1',
    source,
    target,
    policyVersion: REVISION_COMPARISON_POLICY,
    decisionSetSha256: 'f'.repeat(64),
    changesSha256: revisionHash([change]),
    contentSha256: '0'.repeat(64),
    counts: {
      sourceObjects: 1,
      targetObjects: 1,
      changes: 1,
      candidateEdges: 1,
      matched: 1,
      unresolved: 1,
    },
    readiness: {
      package: 'historical',
      geometry: 'ready',
      frame: 'unverified',
      mappings: 'requires-review',
      endpoints: 'blocked',
      calculation: 'blocked',
      review: 'required-per-proposal',
      apply: 'requires-fresh-human-review',
      reasonCodes: ['COMMON_FRAME_UNVERIFIED'],
    },
    createdBy: id.actor,
    createdAt: stamp,
    reason: 'Synthetic comparison fixture',
    engineeringAccepted: false,
  });
  const { contentSha256: _sha, ...manifestInput } = manifest;
  manifest.contentSha256 = revisionHash(manifestInput);
  const pair = (input: typeof source) => ({
    aggregateId: input.aggregateId,
    traceId: input.traceId,
    projectionSha256: input.projectionSha256,
    traceContentSha256: input.traceContentSha256,
  });
  const create = revisionComparisonCreateSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-create.v1',
    source: pair(source),
    target: pair(target),
    expectedComparisonRevision: '0',
    idempotencyKey: id.key,
    reason: manifest.reason,
  });
  const page = revisionComparisonChangesPageSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-changes.v1',
    projectId: id.project,
    comparisonId: id.comparison,
    contentSha256: manifest.contentSha256,
    offset: 0,
    limit: 25,
    total: 1,
    nextOffset: null,
    changes: [change],
  });
  const receipt = revisionComparisonReceiptSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-receipt.v1',
    comparison: manifest,
    duplicate: false,
  });
  const list = revisionComparisonListSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-list.v1',
    projectId: id.project,
    comparisonRevision: '1',
    current: null,
    offset: 0,
    nextOffset: null,
    comparisons: [manifest],
  });
  const write = revisionComparisonDecisionWriteSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-decision-write.v1',
    expectedComparisonRevision: '1',
    expectedHeadId: null,
    idempotencyKey: id.key,
    reason: 'Synthetic explicit correspondence review',
    kind: 'object-mapping',
    body: {
      sourceObjectRevisionIds: [id.sourceObject],
      targetObjectRevisionIds: [id.targetObject],
      disposition: 'unique',
      evidenceText: 'Synthetic administrator-reviewed association; no local frame proof.',
    },
  });
  const decision = revisionComparisonDecisionSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-decision.v1',
    id: id.key,
    projectId: id.project,
    comparisonId: id.comparison,
    comparisonRevision: '2',
    subjectKey: 'synthetic-subject',
    decisionRevision: '1',
    previousDecisionId: null,
    createdBy: id.actor,
    createdAt: stamp,
    reason: write.reason,
    contentSha256: '0'.repeat(64),
    kind: 'object-mapping',
    body: write.body,
    qualification: 'admin-reviewed-correspondence',
  });
  const { contentSha256: _decisionSha, ...decisionInput } = decision;
  decision.contentSha256 = revisionHash(decisionInput);
  const decisionReceipt = revisionComparisonDecisionReceiptSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-decision-receipt.v1',
    projectId: id.project,
    comparisonId: id.comparison,
    comparisonRevision: '2',
    decisionSetSha256: 'a'.repeat(64),
    decision,
    duplicate: false,
  });
  const history = revisionComparisonDecisionHistorySchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-decisions.v1',
    projectId: id.project,
    comparisonId: id.comparison,
    comparisonRevision: '2',
    decisionSetSha256: 'a'.repeat(64),
    decisions: [decision],
    nextBeforeRevision: null,
  });
  const head = revisionComparisonDecisionHeadSchema.parse({
    schemaVersion: 'wfc.pf.revision-comparison-decision-head.v1',
    projectId: id.project,
    comparisonId: id.comparison,
    comparisonRevision: '1',
    decisionSetSha256: manifest.decisionSetSha256,
    subjectKey: 'synthetic-subject',
    head: null,
  });
  return {
    context,
    manifest,
    page,
    receipt,
    create,
    list,
    write,
    decision,
    decisionReceipt,
    history,
    head,
  };
}
