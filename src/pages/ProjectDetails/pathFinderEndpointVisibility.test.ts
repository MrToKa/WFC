// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePathFinderProposal, type PathFinderPreview, type PathFinderState } from '@/api/pathfinder';
import { EndpointBindingApiError, fetchEndpointBinding } from '@/api/pathfinderEndpointBindings';
import { GeometryTraceApiError, fetchGeometryObjectRevision } from '@/api/pathfinderGeometryTrace';
import { endpointBindingFixture, endpointIds as ids } from '@/test/endpointBindingFixtures';
import { geometryTraceFixture } from '@/test/geometryTraceFixtures';
import { canonicalPurposeJson } from '../../../shared/pathfinderPurposePolicy';
import { endpointBindingContentHashInput } from '../../../shared/pathfinderEndpointBindings';
import { computedPathObjectIds, previewEndpointObjectIds, proposalEndpointObjectIds, ENDPOINT_VISIBILITY_DEADLINE_MS } from './pathFinderEndpointVisibility';

vi.mock('@/api/pathfinderEndpointBindings', async importOriginal => ({ ...await importOriginal<typeof import('@/api/pathfinderEndpointBindings')>(), fetchEndpointBinding: vi.fn() }));
vi.mock('@/api/pathfinderGeometryTrace', async importOriginal => ({ ...await importOriginal<typeof import('@/api/pathfinderGeometryTrace')>(), fetchGeometryObjectRevision: vi.fn() }));
const key = (n: number) => `74000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
function fixture() {
  const { binding, context } = endpointBindingFixture(), record = geometryTraceFixture().record;
  record.id = ids.object; record.traceId = ids.trace; record.projectId = ids.project; record.modelVersionId = ids.model;
  record.aggregateId = ids.aggregate; record.coordinates.captureFrameId = ids.frame;
  record.provenance.projectionSha256 = 'a'.repeat(64); record.provenance.contentFingerprint = 'b'.repeat(64);
  record.identity.objectId = 'dbid:73'; record.identity.dbId = 73; record.geometry.mesh.objectId = 'dbid:73';
  record.geometry.role = 'object'; record.geometry.fitted = null;
  binding.sourceObject = { traceId: ids.trace, objectRevisionId: ids.object, recordSha256: hash(record) };
  binding.mode = 'object-derived'; binding.derivation = 'equipment-bottom-aabb.v1';
  binding.contentSha256 = hash(endpointBindingContentHashInput(binding)); context.head = binding;
  const bound = { locationId: binding.locationId, locationRevision: binding.locationRevision, bindingRevision: binding.bindingRevision,
    point: binding.pointProjectMetres, bindingId: binding.id, bindingContentSha256: binding.contentSha256, mode: binding.mode,
    captureFrameId: binding.captureFrameId, qualifiedProjectFrameId: binding.qualifiedProjectFrameId, aggregateId: binding.aggregateId,
    projectionSha256: binding.projectionSha256, sourceObjectRevisionId: ids.object, migrationDecisionId: null };
  const automatic = { kind: 'automatic-equipment-anchor' as const, locationId: key(1), locationRevision: '1', point: [1, 2, 3],
    modelVersionId: ids.model, artifactId: ids.artifact, aggregateId: ids.aggregate, captureFrameId: ids.frame,
    projectionSha256: 'a'.repeat(64), traceId: ids.trace, sourceObjectRevisionId: key(2), sourceObjectId: 'dbid:74',
    sourceObjectRecordSha256: 'c'.repeat(64), contentSha256: 'd'.repeat(64) };
  const raw = { id: key(3), projectId: ids.project, jobId: key(4), cableId: key(5), status: 'calculated', proposalHash: 'c'.repeat(64),
    cableWriteRevision: '1', stale: false, synthetic: false, engineeringAccepted: false, acceptanceScope: 'manual-review', canApply: true,
    compatibilityIssue: null, message: 'Synthetic proposal.', engineeringMessage: 'Synthetic endpoint visibility only.', routingPreferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true },
    createdAt: '2026-10-20T00:00:00Z', design: { lengthBeforePercentageMeters: '10', unroundedLengthMeters: '11', designLengthMeters: '11' },
    route: { success: true, message: 'Synthetic path.', routeText: '/TEST', routeCodes: ['/TEST'], segmentIds: ['dbid:1'], points: [[0, 0, 0], [1, 2, 3]],
      objectIds: ['dbid:1'], lengthMeters: 10, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 },
    dependencies: { schemaVersion: 'pathfinder.dependencies.v6', projectId: ids.project,
      model: { id: ids.model, selectionRevision: '1', contentFingerprint: 'b'.repeat(64) }, artifact: { id: ids.artifact, sha256: 'a'.repeat(64) },
      preparation: { aggregateId: ids.aggregate, captureFrameId: ids.frame, projectionSha256: 'a'.repeat(64) }, from: automatic, to: bound,
      excludedPrivateField: 'must not be retained' } };
  const state: PathFinderState = { schemaVersion: 1, projectId: ids.project, registryRevision: '2',
    activeModel: { modelVersionId: ids.model, selectionRevision: '1', contentFingerprint: 'b'.repeat(64) },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' },
    cables: [], locations: [], artifacts: [{ id: ids.artifact, modelVersionId: ids.model, snapshotSha256: 'a'.repeat(64), objectCount: 2,
      engineeringAccepted: false, readiness: 'needs_review', capture: {}, coordinates: {}, createdAt: '2026-10-20T00:00:00Z' }], jobs: [], proposals: [] };
  const access = { projectId: ids.project, token: 'synthetic-current-access' };
  const preview: PathFinderPreview = { id: key(6), projectId: ids.project, kind: 'preview', status: 'complete', total: 1, completed: 1,
    cancelRequested: false, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', failure: null,
    input: { from: { name: 'Synthetic From' }, to: { name: 'Synthetic To' }, category: 'Control', reverse: false, artifactId: ids.artifact,
      expectedSelectionRevision: '1', expectedRegistryRevision: '2', expectedSettingsRevision: '1' },
    result: { status: 'calculated', message: 'Synthetic preview.', route: raw.route as NonNullable<PathFinderPreview['result']>['route'], design: raw.design,
      prepared: null, effectiveCategory: 'Control', settings: state.settings,
      from: { name: 'Synthetic From', point: [1, 2, 3], source: 'equipment-bottom-aabb', objectId: 'dbid:74', locationId: null, bindingRevision: null },
      to: { name: 'Synthetic To', point: [3, 2, 1], source: 'manual-world-point', objectId: 'dbid:999', locationId: null, bindingRevision: null },
      stale: false, engineeringAccepted: false, acceptanceScope: 'standalone-preview', canApply: false } };
  return { binding, context, record, bound, automatic, raw, state, access, preview };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Path Finder endpoint foreground evidence', () => {
  it('retains only the optional whitelisted display projection and keeps malformed/legacy proposals readable', () => {
    const f = fixture(), parsed = parsePathFinderProposal(f.raw);
    expect(parsed.dependencies).toBeDefined(); expect(parsed.dependencies).not.toHaveProperty('excludedPrivateField');
    expect(parsed.route).toEqual(f.raw.route); expect(parsed.design).toEqual(f.raw.design);
    for (const dependencies of [undefined, null, {}, { ...f.raw.dependencies, schemaVersion: 'future' },
      { ...f.raw.dependencies, from: { ...f.automatic, sourceObjectId: 'dbid:0\n' } }]) {
      const proposal = parsePathFinderProposal({ ...f.raw, dependencies }); expect(proposal.dependencies).toBeUndefined(); expect(proposal.id).toBe(f.raw.id);
    }
  });
  it('uses two exact automatic endpoint objects without issuing extra requests', async () => {
    const f = fixture(), proposal = parsePathFinderProposal({ ...f.raw, dependencies: { ...f.raw.dependencies, to: { ...f.automatic, sourceObjectId: 'dbid:75' } } });
    expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual(['dbid:74', 'dbid:75']);
    expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it.each(['project', 'selection', 'model', 'fingerprint', 'artifact', 'projection', 'stale'])(
    'omits all display references when the proposal %s differs from the active model', async field => {
      const f = fixture(), proposal = parsePathFinderProposal(f.raw);
      if (field === 'project') f.access.projectId = key(99);
      if (field === 'selection') f.state.activeModel.selectionRevision = '2';
      if (field === 'model') f.state.activeModel.modelVersionId = key(99);
      if (field === 'fingerprint') f.state.activeModel.contentFingerprint = 'f'.repeat(64);
      if (field === 'artifact') f.state.artifacts[0].id = key(99);
      if (field === 'projection') f.state.artifacts[0].snapshotSha256 = 'f'.repeat(64);
      if (field === 'stale') proposal.stale = true;
      expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual([]);
      expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
    });
  it('resolves a confirmed binding through its exact current immutable object chain while retaining the automatic end', async () => {
    const f = fixture(); vi.mocked(fetchEndpointBinding).mockResolvedValue(f.context); vi.mocked(fetchGeometryObjectRevision).mockResolvedValue(f.record);
    const proposal = parsePathFinderProposal(f.raw), before = structuredClone(proposal);
    expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual(['dbid:74', 'dbid:73']);
    expect(fetchEndpointBinding).toHaveBeenCalledOnce(); expect(fetchGeometryObjectRevision).toHaveBeenCalledOnce();
    expect(fetchGeometryObjectRevision).toHaveBeenCalledWith(ids.project, f.access.token, ids.trace, ids.object, expect.any(AbortSignal));
    expect(proposal).toEqual(before);
  });
  it('never guesses equipment for fixed-world manual coordinates', async () => {
    const f = fixture(), proposal = parsePathFinderProposal({ ...f.raw, dependencies: { ...f.raw.dependencies,
      to: { ...f.bound, mode: 'fixed-world', sourceObjectRevisionId: null } } });
    expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual(['dbid:74']);
    expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it.each(['binding-id', 'binding-hash', 'binding-point', 'binding-model', 'binding-frame', 'unconfirmed', 'object-hash', 'object-model', 'object-frame', 'object-dbId'])(
    'omits an inconsistent confirmed %s and preserves the valid automatic end', async field => {
      const f = fixture();
      if (field === 'binding-id') f.context.head!.id = key(99);
      if (field === 'binding-hash') f.context.head!.contentSha256 = 'f'.repeat(64);
      if (field === 'binding-point') f.context.head!.pointProjectMetres = [999, 2, 3];
      if (field === 'binding-model') f.context.current!.modelVersionId = key(99);
      if (field === 'binding-frame') f.context.current!.captureFrameId = key(99);
      if (field === 'unconfirmed') f.context.readiness.calculationReady = false;
      if (field === 'object-hash') f.record.historicalModel.name = 'Synthetic altered record';
      if (field === 'object-model') f.record.modelVersionId = key(99);
      if (field === 'object-frame') f.record.coordinates.captureFrameId = key(99);
      if (field === 'object-dbId') { f.record.identity.dbId = 72; f.context.head!.sourceObject!.recordSha256 = hash(f.record); }
      vi.mocked(fetchEndpointBinding).mockResolvedValue(f.context); vi.mocked(fetchGeometryObjectRevision).mockResolvedValue(f.record);
      expect(await proposalEndpointObjectIds(parsePathFinderProposal(f.raw), f.state, f.access)).toEqual(['dbid:74']);
    });
  it.each([401, 403])('propagates current authority error %i without converting it to missing equipment', async status => {
    const f = fixture(), error = new EndpointBindingApiError('ADMIN_REQUIRED', status, 'Current access was refused.');
    vi.mocked(fetchEndpointBinding).mockRejectedValue(error);
    await expect(proposalEndpointObjectIds(parsePathFinderProposal(f.raw), f.state, f.access)).rejects.toBe(error);
    expect(fetchGeometryObjectRevision).not.toHaveBeenCalled(); expect(error.message).not.toContain(f.access.token);
  });
  it('omits a missing object but never swallows its protected API authority error', async () => {
    const f = fixture(); vi.mocked(fetchEndpointBinding).mockResolvedValue(f.context);
    vi.mocked(fetchGeometryObjectRevision).mockRejectedValueOnce(new GeometryTraceApiError('NOT_FOUND', 404, 'Unavailable.'));
    expect(await proposalEndpointObjectIds(parsePathFinderProposal(f.raw), f.state, f.access)).toEqual(['dbid:74']);
    const denied = new GeometryTraceApiError('ADMIN_REQUIRED', 403, 'Current access was refused.'); vi.mocked(fetchGeometryObjectRevision).mockRejectedValueOnce(denied);
    await expect(proposalEndpointObjectIds(parsePathFinderProposal(f.raw), f.state, f.access)).rejects.toBe(denied);
  });
  it('bounds two confirmed ends to at most four GETs and deduplicates the resulting object', async () => {
    const f = fixture(); vi.mocked(fetchEndpointBinding).mockResolvedValue(f.context); vi.mocked(fetchGeometryObjectRevision).mockResolvedValue(f.record);
    const proposal = parsePathFinderProposal({ ...f.raw, dependencies: { ...f.raw.dependencies, schemaVersion: 'pathfinder.dependencies.v5', from: f.bound, to: f.bound } });
    expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual(['dbid:73']);
    expect(fetchEndpointBinding).toHaveBeenCalledTimes(2); expect(fetchGeometryObjectRevision).toHaveBeenCalledTimes(2);
  });
  it('uses one total deadline for optional display lookups and propagates deliberate cancellation', async () => {
    vi.useFakeTimers(); const f = fixture();
    vi.mocked(fetchEndpointBinding).mockImplementation((_project, _token, _location, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
    }));
    const proposal = parsePathFinderProposal(f.raw), pending = proposalEndpointObjectIds(proposal, f.state, f.access);
    await vi.advanceTimersByTimeAsync(ENDPOINT_VISIBILITY_DEADLINE_MS);
    expect(await pending).toEqual(['dbid:74']); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
    const controller = new AbortController(), cancelled = proposalEndpointObjectIds(proposal, f.state, f.access, controller.signal);
    controller.abort(); await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('uses legacy binding IDs only for an exact current confirmed model, revision and point', async () => {
    const f = fixture(), legacy = { locationId: ids.location, bindingRevision: '1', point: [1.25, 2, 3] };
    f.state.locations = [{ id: ids.location, name: 'Synthetic saved location', aliases: [], revision: '2',
      binding: { modelVersionId: ids.model, revision: '1', point: [1.25, 2, 3], objectId: 'dbid:73', externalId: null, source: 'manual', status: 'confirmed' } }];
    const proposal = parsePathFinderProposal({ ...f.raw, dependencies: { ...f.raw.dependencies, schemaVersion: 'pathfinder.dependencies.v2', from: legacy, to: legacy } });
    expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual(['dbid:73']);
    f.state.locations[0].binding!.status = 'stale'; expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual([]);
    expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it('uses preview object references without inferring an object from manual point/name and rejects stale model scope', () => {
    const f = fixture(); expect(previewEndpointObjectIds(f.preview, f.state)).toEqual(['dbid:74']);
    f.preview.result!.stale = true; expect(previewEndpointObjectIds(f.preview, f.state)).toEqual([]);
    f.preview.result!.stale = false; f.preview.input.expectedSelectionRevision = '2'; expect(previewEndpointObjectIds(f.preview, f.state)).toEqual([]);
    expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it('preserves all route objects, filters unsupported IDs, deduplicates equipment and refuses over-budget unions', () => {
    expect(computedPathObjectIds(['dbid:1', 'dbid:2', 'dbid:0', 'dbid:1\n', 'dbid:2147483648'], ['dbid:2', 'dbid:73', 'unknown'])).toEqual([1, 2, 73]);
    const route = Array.from({ length: 512 }, (_, index) => `dbid:${index + 1}`);
    expect(computedPathObjectIds(route, ['dbid:1'])?.length).toBe(512);
    expect(computedPathObjectIds(route, ['dbid:513'])).toBeNull(); expect(route).toHaveLength(512);
  });
});
