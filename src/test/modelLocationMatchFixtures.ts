import { createHash } from 'node:crypto';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy';
import { modelLocationMatchNamesHashInput, type ModelLocationMatchAssign, type ModelLocationMatchContext } from '../../shared/pathfinderModelLocationMatch';
import type { PreparationDiscoveryPage, PreparationDiscoveryRequest } from '../../viewer-runtime/preparation-input.mjs';
export const modelMatchIds = { project: '11111111-1111-4111-8111-111111111111', model: '22222222-2222-4222-8222-222222222222',
  aggregate: '33333333-3333-4333-8333-333333333333', artifact: '44444444-4444-4444-8444-444444444444', frame: '55555555-5555-4555-8555-555555555555',
  account: '66666666-6666-4666-8666-666666666666', location: '77777777-7777-4777-8777-777777777777', binding: '88888888-8888-4888-8888-888888888888' };
export const modelMatchHash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
export function modelMatchContext(names = ['TAG-1']): ModelLocationMatchContext {
  return { schemaVersion: 'wfc.pf.model-location-match-context.v1', projectId: modelMatchIds.project,
    current: { modelVersionId: modelMatchIds.model, selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: modelMatchIds.aggregate,
      artifactId: modelMatchIds.artifact, projectionSha256: 'b'.repeat(64), captureFrameId: modelMatchIds.frame, geometryRevision: '1', traceId: null },
    registryRevision: '7', names, namesSha256: modelMatchHash(modelLocationMatchNamesHashInput(names)) };
}
export function modelMatchPage(request: PreparationDiscoveryRequest, objectIds = [1]): PreparationDiscoveryPage {
  return { schemaVersion: request.schemaVersion, mode: request.mode, names: request.names, rootObjectId: null, cursor: request.cursor,
    includeAnchors: true, matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v3', visibilityScope: { schemaVersion: 'wfc.pf.sdk-display-visibility.v1',
      basis: 'sdk-display-before-pf-appearance', contentSha256: 'c'.repeat(64) }, indexedObjectCount: 1000,
    propertyScan: { attemptedObjectCount: 1000, returnedObjectCount: 1000, omittedObjectCount: 0, complete: true }, complete: true, nextCursor: null,
    objects: objectIds.map(objectId => ({ objectId, parentId: null, orderIndex: objectId - 1, name: `Equipment ${objectId}`, hasGeometry: true,
      isPhysicalLeaf: true, matchedNames: request.names, bounds: { minimum: [0, 0, 0], maximum: [2, 2, 2] }, bottomCentre: [1, 1, 0] })) };
}
export function modelMatchReceipt(body: ModelLocationMatchAssign, revision = '8') {
  return { schemaVersion: 'wfc.pf.model-location-match-receipt.v1' as const, projectId: modelMatchIds.project, idempotencyKey: body.idempotencyKey,
    commandSha256: modelMatchHash(body), registryRevision: revision, duplicate: false,
    results: body.names.map(name => ({ name, status: 'assigned' as const, candidateObjectIds: [1], locationId: modelMatchIds.location,
      bindingId: modelMatchIds.binding, reasonCode: null })) };
}
