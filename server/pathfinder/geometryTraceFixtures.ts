/** Synthetic-only corpus shared by isolated geometry trace tests. No runtime data. */
import { buildPreparationPlan } from './preparationPlans.js';
import type { GeometryTraceBuildInput } from './geometryTraceBuilder.js';
import type { PreparationContext, PreparationCreate } from '../../shared/pathfinderPreparation.js';
import type { FittedTraceExport } from '../../shared/pathfinderGeometryTrace.js';
import type { ComputationalSnapshot } from './contracts.js';
const id = (n: number) => `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (hex: string) => hex.repeat(64);
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const createdAt = '2026-10-19T00:00:00.000Z';
export function geometryTraceFixture(): GeometryTraceBuildInput & { snapshot: ComputationalSnapshot; fitted: FittedTraceExport } {
  const context: PreparationContext = {
    schemaVersion: 'wfc.pf.preparation-context.v1', projectId: id(1),
    scope: { modelVersionId: id(2), contentFingerprint: hash('a'), selectionRevision: '1', catalogRevision: '2', routingContentSha256: hash('b'), routingPolicyRevision: '3', routingPolicySha256: hash('c'), locationRegistryRevision: '4', resolutionRevision: '0' },
    trays: [10, 11].map((n, index) => ({ projectTrayId: id(n), rawName: 'B00' + (index + 1), routeName: '/B00' + (index + 1), purposeKey: 'Control', policyState: 'configured', allowedCategories: ['Control'], diagnosticCodes: [] })),
    endpointNames: ['EQ01'], resolutions: [], diagnostics: [], currentAggregate: null,
  };
  const discovery: PreparationCreate['discovery'] = {
    schemaVersion: 'wfc.pf.discovery-report.v1', ...Object.fromEntries(['modelVersionId', 'contentFingerprint', 'selectionRevision'].map(key => [key, context.scope[key as keyof typeof context.scope]])) as Pick<PreparationCreate['discovery'], 'modelVersionId' | 'contentFingerprint' | 'selectionRevision'>,
    matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true,
    propertyScan: { indexedObjectCount: 3, attemptedObjectCount: 3, returnedObjectCount: 3, omittedObjectCount: 0, complete: true },
    objects: [{ objectId: 'dbid:9', parentId: null, name: 'B001', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 0 }, { objectId: 'dbid:2', parentId: null, name: 'B002', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 1 }, { objectId: 'dbid:5', parentId: null, name: 'EQ01', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 2 }],
    trays: [{ projectTrayId: id(10), candidateRootObjectIds: ['dbid:9'] }, { projectTrayId: id(11), candidateRootObjectIds: ['dbid:2'] }], endpointCandidates: [{ name: 'EQ01', objectIds: ['dbid:5'] }],
  };
  const plan = buildPreparationPlan(context, { schemaVersion: 'wfc.pf.preparation-create.v1', expected: context.scope, idempotencyKey: id(3), discovery }, id(4));
  const snapshot: ComputationalSnapshot = {
    schemaVersion: 'pathfinder.model.snapshot.v1', model: { projectId: id(1), modelVersionId: id(2), contentSha256: hash('a') },
    capture: { adapterVersion: 'synthetic-geometry-trace-test', sourceKind: 'synthetic', inventoryComplete: false, geometryComplete: false, unitsVerified: false, transformsVerified: false, planningVisibilityKnown: false, sourceLinkVerified: false, evidenceSha256: [] },
    coordinates: { vertexFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: null, displayToWorldMetres: matrix, globalOffsetMetres: [0, 0, 0] },
    objects: discovery.objects.map((o, index) => {
      const minimum: [number, number, number] = index === 0 ? [0, 0, 0] : index === 1 ? [10, 0, 0] : [20, 2, 1];
      const maximum: [number, number, number] = index === 0 ? [3, 4, 1] : index === 1 ? [11, 1, 1] : [22, 4, 3];
      return { id: o.objectId, parentId: null, dbId: Number(o.objectId.slice(5)), externalId: index === 2 ? 'equipment-export-id' : null, name: o.name, geometryRole: index < 2 ? 'routing-leaf' : 'object', leafToRootNames: [o.name], properties: [{ category: 'Model', name: 'Purpose', value: 'Historical source purpose' }], nativeHidden: null, planningExcluded: false, categoryAssignmentSource: index < 2 ? 'explicit-planning' : 'unassigned', allowedCategories: index < 2 ? ['Control'] : [], ...(index < 2 ? { routeName: context.trays[index].routeName, shapeName: o.name } : {}), bounds: { minimum, maximum }, fragments: index < 2 ? [{ id: 'fragment:' + o.objectId, vertices: [minimum, [maximum[0], minimum[1], minimum[2]], maximum], triangleIndices: [0, 1, 2], fragmentToWorldMetres: matrix, transformAlreadyApplied: true }] : [] };
    }),
  };
  const engine = { version: '45c24bf5f433f13e102600b36f20327c77961d0a', runnerSha256: hash('1'), modelModuleSha256: hash('2'), coreModuleSha256: hash('3'), adapterModuleSha256: hash('4') };
  const fitted: FittedTraceExport = {
    schemaVersion: 'wfc.pf.fitted-trace.v1', exportId: id(20), projectId: id(1), modelVersionId: id(2), contentFingerprint: hash('a'), snapshotSha256: hash('d'), preparedKey: hash('5'), rulesSha256: hash('6'), engine, measurementVersion: 'wfc.pf.fitted-polyline-length.v1', readiness: 'needs_review', engineeringAccepted: false,
    counts: { objects: 3, segments: 2, diagnostics: 2051, points: 5, ports: 2 }, geometryCounts: { validatedBends: 0, fallbackBends: 1, validatedStraights: 0, fallbackStraights: 1, fallbackClearances: 0 },
    objects: snapshot.objects.map((o, orderIndex) => ({ orderIndex, objectId: o.id, dbId: o.dbId!, externalId: o.externalId ?? null, name: o.name, geometryRole: o.geometryRole, resolvedRouteName: o.routeName ?? null, shapeName: o.shapeName ?? o.name, visibility: 'unknown', bottomCentreMetres: [(o.bounds.minimum[0] + o.bounds.maximum[0]) / 2, (o.bounds.minimum[1] + o.bounds.maximum[1]) / 2, o.bounds.minimum[2]] })),
    segments: [{ orderIndex: 0, objectId: 'dbid:9', name: '/B001', routeCode: '/B001', allowedCategoryMask: 4, connectionsAtEndsOnly: true, pointsMetres: [[0, 0, 0], [3, 0, 0], [3, 4, 0]], ports: [{ pointMetres: [0, 0, 0], outward: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], widthMetres: 0.2, heightMetres: 0.1 }, { pointMetres: [3, 4, 0], outward: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], widthMetres: 0.2, heightMetres: 0.1 }], connectionSurfaceCount: 0, geometricLengthMetres: 7, geometricLengthRoundTrip: '7', fitStatus: 'unknown' }, { orderIndex: 1, objectId: 'dbid:2', name: '/B002', routeCode: '/B002', allowedCategoryMask: 4, connectionsAtEndsOnly: false, pointsMetres: [[10, 0, 0], [11, 1, 1]], ports: [], connectionSurfaceCount: 0, geometricLengthMetres: 1.7320508075688772, geometricLengthRoundTrip: '1.7320508075688772', fitStatus: 'unknown' }],
    diagnostics: Array.from({ length: 2051 }, (_, n) => 'Synthetic retained diagnostic ' + n),
  };
  const aggregate = { ...context.scope, schemaVersion: 'wfc.pf.geometry-aggregate.v1' as const, id: id(30), projectId: id(1), sessionId: plan.id, artifactId: id(31), geometryRevision: '1', sourceLocationRegistryRevision: '4', coordinateFrameId: plan.coordinateFrameId, orderedPlanSha256: plan.orderedPlanSha256, orderedScopeSha256: plan.requestedScope.scopeSha256, partReferences: plan.partPlan.map(p => ({ partId: p.partId, partIndex: p.partIndex, payloadSha256: hash('7') })), projection: { schemaVersion: snapshot.schemaVersion, payloadRef: id(32), sha256: hash('d'), bytes: 5000 }, traceIndex: { schemaVersion: 'wfc.pf.preparation-trace-index.v1', payloadRef: id(33), sha256: hash('8'), bytes: 1000 }, counts: { objects: 3, physicalLeaves: 2, fragments: 2, vertices: 6, triangles: 2 }, requestedScopeComplete: true as const, wholePlantGeometry: false as const, engineVersion: 'canonical', rulesVersion: 'pf2.rules.v1/wfc-mto-v1', diagnostics: [], engineeringAccepted: false as const, nativeParity: 'not-performed' as const, publishedAt: createdAt };
  return { traceId: id(40), recordsBlobId: id(41), aggregate, plan, snapshot, fitted, fittedBlob: { payloadRef: id(42), sha256: hash('e'), bytes: 5000 }, runtimeFingerprint: { ...engine, derivationSha256: hash('f') }, traceIndex: { schemaVersion: 'wfc.pf.preparation-trace-index.v1', sessionId: plan.id, coordinateFrameId: plan.coordinateFrameId, objects: snapshot.objects.map((o, index) => ({ objectId: o.id, geometryRole: o.geometryRole, projectTrayId: index < 2 ? context.trays[index].projectTrayId : null, rootObjectId: index < 2 ? o.id : null, partIds: [plan.partPlan[0].partId] })) }, evidence: [], declaredLengths: [{ projectTrayId: id(10), valueMm: '7000.125', status: 'valid', observedAt: createdAt, sourceRevision: null, source: 'trays.length_mm::text' }], createdAt, createdBy: id(50) };
}
