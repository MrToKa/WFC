import { createHash } from 'node:crypto';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import {
  preparationPlanHashInput,
  preparationPartScopeHashInput,
  type PreparationContext,
  type PreparationPlan,
  type PreparationSession,
  type PreparationPart,
} from '../../shared/pathfinderPreparation.js';
export const preparationIds = {
  project: '11111111-1111-1111-1111-111111111111',
  model: '22222222-2222-2222-2222-222222222222',
  tray: '33333333-3333-3333-3333-333333333333',
  session: '44444444-4444-4444-4444-444444444444',
  part: '55555555-5555-5555-5555-555555555555',
  actor: '66666666-6666-6666-6666-666666666666',
  login: '77777777-7777-7777-7777-777777777777',
};
const digest = (value: unknown) =>
  createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
export function preparationFixture() {
  const ids = preparationIds;
  const scope = {
    modelVersionId: ids.model,
    contentFingerprint: 'a'.repeat(64),
    selectionRevision: '1',
    catalogRevision: '1',
    routingContentSha256: 'b'.repeat(64),
    routingPolicyRevision: '1',
    routingPolicySha256: 'c'.repeat(64),
    locationRegistryRevision: '1',
    resolutionRevision: '0',
  };
  const context: PreparationContext = {
    schemaVersion: 'wfc.pf.preparation-context.v1',
    projectId: ids.project,
    scope,
    trays: [
      {
        projectTrayId: ids.tray,
        rawName: 'Tray 01',
        purposeKey: 'Synthetic purpose',
        routeName: '/01',
        allowedCategories: ['Control'],
        policyState: 'configured',
        diagnosticCodes: [],
      },
    ],
    endpointNames: [],
    resolutions: [],
    diagnostics: [],
    currentAggregate: null,
  };
  const part = {
    partId: ids.part,
    partIndex: 0,
    physicalLeafIds: ['dbid:2'],
    equipmentObjectIds: [],
    ancestorObjectIds: ['dbid:1'],
    objects: [
      {
        objectId: 2,
        rootObjectId: 1,
        projectTrayId: ids.tray,
        routeName: '/01',
        shapeName: 'Synthetic shape',
        allowedCategories: ['Control'] as ('MV' | 'LV' | 'Control')[],
      },
    ],
    equipmentNames: [],
    scopeSha256: '0'.repeat(64),
  };
  part.scopeSha256 = digest(preparationPartScopeHashInput(part));
  const objectManifest = [
    {
      objectId: 'dbid:1',
      parentId: null,
      name: 'Tray 01',
      hasGeometry: false,
      isPhysicalLeaf: false,
      orderIndex: 0,
    },
    {
      objectId: 'dbid:2',
      parentId: 'dbid:1',
      name: 'Leaf',
      hasGeometry: true,
      isPhysicalLeaf: true,
      orderIndex: 1,
    },
  ];
  const plan: PreparationPlan = {
    ...scope,
    schemaVersion: 'wfc.pf.preparation-plan.v1',
    id: ids.session,
    projectId: ids.project,
    coordinateFrameId: ids.model,
    matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1',
    partitionAlgorithmVersion: 'wfc.pf.ordered-partition.v1',
    limitsProfile: 'wfc.pf.current-bounded-capture-and-model.v1',
    requestedScope: {
      scopeKind: 'server-requested-project-routing-and-endpoints',
      wholePlantGeometry: false,
      trays: [
        {
          projectTrayId: ids.tray,
          rawName: 'Tray 01',
          purposeKey: 'Synthetic purpose',
          routeName: '/01',
          allowedCategories: ['Control'],
          ownershipDecisionId: null,
          orderedRootObjectIds: ['dbid:1'],
        },
      ],
      endpointNames: [],
      endpointEvidence: [],
      excludedProjectTrayIds: [],
      orderedPhysicalLeafIds: ['dbid:2'],
      orderedEquipmentObjectIds: [],
      scopeSha256: 'd'.repeat(64),
    },
    partPlan: [part],
    objectManifest,
    objectOrder: [1, 2],
    diagnostics: [],
    orderedPlanSha256: '0'.repeat(64),
  };
  plan.orderedPlanSha256 = digest(preparationPlanHashInput(plan));
  const session: PreparationSession = {
    schemaVersion: 'wfc.pf.preparation-session.v1',
    id: ids.session,
    projectId: ids.project,
    state: 'planned',
    recovery: null,
    sessionRevision: '1',
    createdAt: '2026-10-19T00:00:00Z',
    updatedAt: '2026-10-19T00:00:00Z',
    principal: { kind: 'current-login-admin', actorId: ids.actor, loginId: ids.login },
    plan,
    parts: [],
    coverage: {
      expectedParts: 1,
      committedParts: 0,
      requestedScopeComplete: false,
      missingPartIds: [ids.part],
    },
    failure: null,
    publishedAggregateId: null,
  };
  const committed: PreparationPart = {
    schemaVersion: 'wfc.pf.preparation-part.v1',
    sessionId: ids.session,
    partId: ids.part,
    partIndex: 0,
    sessionPlanSha256: plan.orderedPlanSha256,
    modelVersionId: ids.model,
    contentFingerprint: scope.contentFingerprint,
    coordinateFrameId: plan.coordinateFrameId,
    scopeSha256: part.scopeSha256,
    payloadEncoding: 'pathfinder.model.snapshot.v1-json-utf8',
    payloadSha256: 'e'.repeat(64),
    payloadBytes: 1,
    payloadRef: ids.part,
    counts: { objects: 2, physicalLeaves: 1, fragments: 1, vertices: 3, triangles: 1 },
    coverage: { partScopeComplete: true, missingObjectIds: [], ambiguousObjectIds: [] },
    producer: { level: 'A', adapterVersion: 'synthetic', sourceKind: 'synthetic' },
    completedAt: '2026-10-19T00:00:01Z',
  };
  return { context, session, committed };
}
