import { describe, expect, it } from 'vitest';
import { preparationScopeSchema, preparationDiscoverySchema, preparationPartUploadSchema, preparationMutationSchema, preparationResolutionWriteSchema } from './pathfinderPreparation.js';
const id = '10000000-0000-4000-8000-000000000001';
const scope = { modelVersionId: id, contentFingerprint: 'a'.repeat(64), selectionRevision: '1', catalogRevision: '2', routingContentSha256: 'b'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'c'.repeat(64), locationRegistryRevision: '4', resolutionRevision: '0' };
describe('strict preparation transport', () => {
  it.each(['catalogRevision', 'selectionRevision', 'locationRegistryRevision', 'resolutionRevision'] as const)('rejects unsafe %s scalars', key => { for (const bad of ['1\n', '01', '-1', '9223372036854775808', 1]) expect(preparationScopeSchema.safeParse({ ...scope, [key]: bad }).success).toBe(false); });
  it('never accepts drawing-domain fields or caller authority/masks in common transport', () => { expect(preparationScopeSchema.safeParse({ ...scope, drawingPolicyRevision: '9' }).success).toBe(false); expect(preparationPartUploadSchema.safeParse({ schemaVersion: 'wfc.pf.preparation-part.upload.v1', sessionPlanSha256: 'd'.repeat(64), payload: {}, actorId: id }).success).toBe(false); });
  it('requires the payload member explicitly even though its nested version is parsed by the server validator', () => { expect(preparationPartUploadSchema.safeParse({ schemaVersion: 'wfc.pf.preparation-part.upload.v1', sessionPlanSha256: 'd'.repeat(64) }).success).toBe(false); });
  it.each(['idempotencyKey', 'expectedSessionRevision'] as const)('requires exact mutation %s', key => { const mutation = { schemaVersion: 'wfc.pf.preparation-mutation.v1', idempotencyKey: id, expectedSessionRevision: '1', reason: 'Synthetic request' }; expect(preparationMutationSchema.safeParse(mutation).success).toBe(true); expect(preparationMutationSchema.safeParse({ ...mutation, [key]: String(mutation[key]) + '\n' }).success).toBe(false); });
  it('distinguishes roots/exclusion/reset and requires an audited reason', () => { const command = { schemaVersion: 'wfc.pf.preparation-resolution.write.v1', expected: scope, idempotencyKey: id, projectTrayId: id, mode: 'roots', rootObjectIds: ['dbid:7'], reason: 'Operator evidence' }; expect(preparationResolutionWriteSchema.safeParse(command).success).toBe(true); for (const changed of [{ rootObjectIds: [] }, { reason: '' }, { mode: 'exclude' }, { rootObjectIds: ['dbid:7', 'dbid:7'] }, { rootObjectIds: ['dbid:07'] }]) expect(preparationResolutionWriteSchema.safeParse({ ...command, ...changed }).success).toBe(false); });
  it('rejects missing, duplicate and internally inconsistent discovery evidence', () => { const discovery = { schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId: id, contentFingerprint: 'a'.repeat(64), selectionRevision: '1', matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true, propertyScan: { indexedObjectCount: 2, attemptedObjectCount: 2, returnedObjectCount: 1, omittedObjectCount: 1, complete: true }, objects: [], trays: [], endpointCandidates: [] }; expect(preparationDiscoverySchema.safeParse(discovery).success).toBe(false); expect(preparationDiscoverySchema.safeParse({ ...discovery, propertyScan: null }).success).toBe(true); });
  it('records an explicit unrequested endpoint scope without accepting empty-match or scan evidence', () => {
    const endpointScope = { schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1', mode: 'not-requested' };
    const legacy = { schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId: id, contentFingerprint: 'a'.repeat(64), selectionRevision: '1',
      matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', complete: true, propertyScan: null, objects: [], trays: [], endpointCandidates: [] };
    expect(preparationDiscoverySchema.parse(legacy)).toEqual(legacy);
    const marked = { ...legacy, endpointScope }; expect(preparationDiscoverySchema.parse(marked)).toEqual(marked);
    for (const invalid of [
      { ...marked, endpointCandidates: [{ name: 'Not searched', objectIds: [] }] },
      { ...marked, propertyScan: { indexedObjectCount: 2, attemptedObjectCount: 2, returnedObjectCount: 2, omittedObjectCount: 0, complete: true } },
      { ...marked, endpointScope: { ...endpointScope, mode: 'complete' } },
      { ...marked, endpointScope: { ...endpointScope, schemaVersion: 'wfc.pf.endpoint-discovery-scope.v2' } },
    ]) expect(preparationDiscoverySchema.safeParse(invalid).success).toBe(false);
  });
});
