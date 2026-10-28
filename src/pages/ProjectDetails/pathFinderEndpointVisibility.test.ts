// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePathFinderProposal, type PathFinderPreview, type PathFinderState } from '@/api/pathfinder';
import { EndpointBindingApiError, fetchEndpointBinding } from '@/api/pathfinderEndpointBindings';
import { GeometryTraceApiError, fetchGeometryObjectRevision } from '@/api/pathfinderGeometryTrace';
import { CableEndpointApiError, fetchCableEndpointContext, type CableEndpointContext } from '@/api/pathfinderCableEndpoints';
import { endpointBindingFixture, endpointIds as ids } from '@/test/endpointBindingFixtures';
import { geometryTraceFixture } from '@/test/geometryTraceFixtures';
import { canonicalPurposeJson } from '../../../shared/pathfinderPurposePolicy';
import { endpointBindingContentHashInput } from '../../../shared/pathfinderEndpointBindings';
import { computedPathObjectIds, previewEndpointObjectIds, proposalEndpointObjectIds, proposalEndpointObjectIdsFromContexts, ENDPOINT_VISIBILITY_DEADLINE_MS } from './pathFinderEndpointVisibility';

vi.mock('@/api/pathfinderEndpointBindings', async importOriginal => ({ ...await importOriginal<typeof import('@/api/pathfinderEndpointBindings')>(), fetchEndpointBinding: vi.fn() }));
vi.mock('@/api/pathfinderGeometryTrace', async importOriginal => ({ ...await importOriginal<typeof import('@/api/pathfinderGeometryTrace')>(), fetchGeometryObjectRevision: vi.fn() }));
vi.mock('@/api/pathfinderCableEndpoints', async importOriginal => ({ ...await importOriginal<typeof import('@/api/pathfinderCableEndpoints')>(), fetchCableEndpointContext: vi.fn() }));
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
function fixedDisplayFixture() {
  const f = fixture(), head = structuredClone(f.binding);
  head.mode = 'fixed-world'; head.derivation = 'manual-world-point'; head.sourceObject = null;
  head.contentSha256 = hash(endpointBindingContentHashInput(head));
  const bound = { ...f.bound, mode: 'fixed-world', bindingContentSha256: head.contentSha256, sourceObjectRevisionId: null };
  const context: CableEndpointContext = { schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId: ids.project, cableId: f.raw.cableId,
    end: 'to', cableWriteRevision: f.raw.cableWriteRevision, logicalName: 'Synthetic equipment', logicalKey: 'SYNTHETIC EQUIPMENT',
    mto: 'LV', canBind: true, reasonCodes: [], registryRevision: '2', location: structuredClone(f.context.location), head,
    current: structuredClone(f.context.current), contextSha256: 'e'.repeat(64), confirmedDisplaySelection: {
      source: 'confirmed-display-only', mode: 'fixed-world', sdkObjectId: 901, name: '/Selected parent', pointProjectMetres: [...head.pointProjectMetres],
      current: structuredClone(f.context.current!), bindingId: head.id, bindingContentSha256: head.contentSha256, commandSha256: 'd'.repeat(64),
    } };
  const proposal = parsePathFinderProposal({ ...f.raw, dependencies: { ...f.raw.dependencies, to: bound } });
  return { ...f, context, proposal };
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
  it.each(['project', 'selection', 'model', 'fingerprint', 'artifact', 'projection'])(
    'omits all display references when the proposal %s differs from the active model', async field => {
      const f = fixture(), proposal = parsePathFinderProposal(f.raw);
      if (field === 'project') f.access.projectId = key(99);
      if (field === 'selection') f.state.activeModel.selectionRevision = '2';
      if (field === 'model') f.state.activeModel.modelVersionId = key(99);
      if (field === 'fingerprint') f.state.activeModel.contentFingerprint = 'f'.repeat(64);
      if (field === 'artifact') f.state.artifacts[0].id = key(99);
      if (field === 'projection') f.state.artifacts[0].snapshotSha256 = 'f'.repeat(64);
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
    const f = fixedDisplayFixture(); f.context.confirmedDisplaySelection = null;
    vi.mocked(fetchCableEndpointContext).mockResolvedValue(f.context);
    expect(await proposalEndpointObjectIds(f.proposal, f.state, f.access)).toEqual(['dbid:74']);
    expect(fetchCableEndpointContext).toHaveBeenCalledOnce();
    expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it('keeps the explicitly assigned parent object visible using display-only evidence from the exact saved endpoint', async () => {
    const f = fixedDisplayFixture(); vi.mocked(fetchCableEndpointContext).mockResolvedValue(f.context);
    const before = structuredClone(f.proposal);
    expect(await proposalEndpointObjectIds(f.proposal, f.state, f.access)).toEqual(['dbid:74', 'dbid:901']);
    expect(fetchCableEndpointContext).toHaveBeenCalledExactlyOnceWith(ids.project, f.access.token, f.proposal.cableId, 'to', expect.any(AbortSignal));
    expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
    expect(f.proposal).toEqual(before); expect(f.context.head?.sourceObject).toBe(null); expect(f.context.head?.attachment).toBe(null);
  });
  it('reuses the exact verified popup binding without another endpoint or geometry request', async () => {
    const f = fixedDisplayFixture(), contexts = { from: f.context, to: f.context };
    expect(proposalEndpointObjectIdsFromContexts(f.proposal, f.state, f.access, contexts)).toEqual(['dbid:901']);
    expect(await proposalEndpointObjectIds(f.proposal, f.state, f.access, undefined, contexts)).toEqual(['dbid:74', 'dbid:901']);
    expect(fetchCableEndpointContext).not.toHaveBeenCalled(); expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it('starts both fixed-world endpoint reads before either one finishes and retains their independent exact evidence', async () => {
    const f = fixedDisplayFixture(), finish = new Map<string, (context: CableEndpointContext) => void>();
    const proposal = parsePathFinderProposal({ ...f.raw, dependencies: { ...f.raw.dependencies, from: f.proposal.dependencies!.to, to: f.proposal.dependencies!.to } });
    vi.mocked(fetchCableEndpointContext).mockImplementation((_project, _token, _cable, end) => new Promise(resolve => { finish.set(end, resolve); }));
    const pending = proposalEndpointObjectIds(proposal, f.state, f.access);
    await Promise.resolve();
    expect(fetchCableEndpointContext).toHaveBeenCalledTimes(2);
    expect([...finish.keys()]).toEqual(['from', 'to']);
    finish.get('to')!({ ...f.context, end: 'to' });
    finish.get('from')!({ ...f.context, end: 'from' });
    expect(await pending).toEqual(['dbid:901']);
    expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it('aborts and joins a concurrent endpoint peer while retaining the original authority refusal', async () => {
    const f = fixedDisplayFixture(), refused = new CableEndpointApiError('ADMIN_REQUIRED', 403, 'Current access was refused.');
    const proposal = parsePathFinderProposal({ ...f.raw, dependencies: { ...f.raw.dependencies, from: f.proposal.dependencies!.to, to: f.proposal.dependencies!.to } });
    let peerAborted = false;
    vi.mocked(fetchCableEndpointContext).mockImplementation((_project, _token, _cable, end, signal) => end === 'to'
      ? Promise.reject(refused)
      : new Promise((_resolve, reject) => { signal!.addEventListener('abort', () => { peerAborted = true; reject(new DOMException('Peer stopped.', 'AbortError')); }, { once: true }); }));
    await expect(proposalEndpointObjectIds(proposal, f.state, f.access)).rejects.toBe(refused);
    expect(peerAborted).toBe(true); expect(fetchCableEndpointContext).toHaveBeenCalledTimes(2);
    expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it('retains a saved fixed-world parent after a cable-list fill stales only the proposal write revision', async () => {
    const f = fixedDisplayFixture(); f.proposal.stale = true; f.proposal.canApply = false;
    f.context.cableWriteRevision = '2';
    vi.mocked(fetchCableEndpointContext).mockResolvedValue(f.context);
    const before = structuredClone(f.proposal), contextBefore = structuredClone(f.context);
    expect(await proposalEndpointObjectIds(f.proposal, f.state, f.access)).toEqual(['dbid:74', 'dbid:901']);
    expect(fetchCableEndpointContext).toHaveBeenCalledExactlyOnceWith(ids.project, f.access.token, f.proposal.cableId, 'to', expect.any(AbortSignal));
    expect(f.proposal).toEqual(before); expect(f.context).toEqual(contextBefore);
    expect(f.proposal.stale).toBe(true); expect(f.proposal.canApply).toBe(false);
  });
  it('retains exact current object-derived equipment for an already-written historical proposal', async () => {
    const f = fixture(), proposal = parsePathFinderProposal({ ...f.raw, stale: true, canApply: false });
    vi.mocked(fetchEndpointBinding).mockResolvedValue(f.context); vi.mocked(fetchGeometryObjectRevision).mockResolvedValue(f.record);
    const before = structuredClone(proposal);
    expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual(['dbid:74', 'dbid:73']);
    expect(proposal).toEqual(before); expect(proposal.stale).toBe(true); expect(proposal.canApply).toBe(false);
  });
  it.each(['head', 'point', 'model'])(
    'still omits a stale proposal fixed-world endpoint when its current %s changed', async field => {
      const f = fixedDisplayFixture(); f.proposal.stale = true; f.proposal.canApply = false;
      if (field === 'head') f.context.head!.id = key(99);
      if (field === 'point') f.context.head!.pointProjectMetres = [999, 2, 3];
      if (field === 'model') f.context.current!.modelVersionId = key(99);
      vi.mocked(fetchCableEndpointContext).mockResolvedValue(f.context);
      expect(await proposalEndpointObjectIds(f.proposal, f.state, f.access)).toEqual(['dbid:74']);
      expect(fetchGeometryObjectRevision).not.toHaveBeenCalled(); expect(f.proposal.canApply).toBe(false);
    });
  it.each(['head', 'point', 'model'])(
    'still omits a stale proposal object-derived endpoint when its current %s changed', async field => {
      const f = fixture(), proposal = parsePathFinderProposal({ ...f.raw, stale: true, canApply: false });
      if (field === 'head') f.context.head!.id = key(99);
      if (field === 'point') f.context.head!.pointProjectMetres = [999, 2, 3];
      if (field === 'model') f.context.current!.modelVersionId = key(99);
      vi.mocked(fetchEndpointBinding).mockResolvedValue(f.context); vi.mocked(fetchGeometryObjectRevision).mockResolvedValue(f.record);
      expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual(['dbid:74']);
      expect(fetchGeometryObjectRevision).not.toHaveBeenCalled(); expect(proposal.canApply).toBe(false);
    });
  it.each(['missing', 'unavailable', 'cable', 'end', 'location', 'location-revision', 'head', 'hash', 'point', 'unconfirmed', 'model', 'selection', 'fingerprint', 'artifact', 'aggregate', 'frame', 'projection', 'display-head', 'display-hash', 'display-point', 'display-model', 'attachment'])(
    'omits stale or invalid fixed-world %s display evidence without changing the route', async field => {
      const f = fixedDisplayFixture();
      if (field === 'missing') f.context.confirmedDisplaySelection = null;
      if (field === 'unavailable') f.context.canBind = false;
      if (field === 'cable') f.context.cableId = key(99);
      if (field === 'end') f.context.end = 'from';
      if (field === 'location') f.context.location!.id = key(99);
      if (field === 'location-revision') f.context.location!.revision = '999';
      if (field === 'head') f.context.head!.id = key(99);
      if (field === 'hash') f.context.head!.contentSha256 = 'f'.repeat(64);
      if (field === 'point') f.context.head!.pointProjectMetres = [999, 2, 3];
      if (field === 'unconfirmed') f.context.head!.status = 'stale';
      if (field === 'model') f.context.current!.modelVersionId = key(99);
      if (field === 'selection') f.context.current!.selectionRevision = '999';
      if (field === 'fingerprint') f.context.current!.contentFingerprint = 'f'.repeat(64);
      if (field === 'artifact') f.context.current!.artifactId = key(99);
      if (field === 'aggregate') f.context.current!.aggregateId = key(99);
      if (field === 'frame') f.context.current!.captureFrameId = key(99);
      if (field === 'projection') f.context.current!.projectionSha256 = 'f'.repeat(64);
      if (field === 'display-head') f.context.confirmedDisplaySelection!.bindingId = key(99);
      if (field === 'display-hash') f.context.confirmedDisplaySelection!.bindingContentSha256 = 'f'.repeat(64);
      if (field === 'display-point') f.context.confirmedDisplaySelection!.pointProjectMetres = [999, 2, 3];
      if (field === 'display-model') f.context.confirmedDisplaySelection!.current.modelVersionId = key(99);
      if (field === 'attachment') Object.assign(f.context.head!, { sourceObject: f.binding.sourceObject });
      expect(proposalEndpointObjectIdsFromContexts(f.proposal, f.state, f.access, { from: f.context, to: f.context })).toEqual([]);
      vi.mocked(fetchCableEndpointContext).mockResolvedValue(f.context);
      expect(await proposalEndpointObjectIds(f.proposal, f.state, f.access)).toEqual(['dbid:74']); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
    });
  it.each([401, 403])('propagates fixed-world current authority failure %i', async status => {
    const f = fixedDisplayFixture(), error = new CableEndpointApiError('ADMIN_REQUIRED', status, 'Current access was refused.');
    vi.mocked(fetchCableEndpointContext).mockRejectedValue(error);
    await expect(proposalEndpointObjectIds(f.proposal, f.state, f.access)).rejects.toBe(error);
  });
  it.each([404, 409, 503])('does not silently drop a saved parent after an endpoint display read fails with %i', async status => {
    const f = fixedDisplayFixture(), error = new CableEndpointApiError('UNAVAILABLE', status, 'Endpoint display lookup is unavailable.');
    vi.mocked(fetchCableEndpointContext).mockRejectedValue(error);
    const before = structuredClone(f.proposal);
    await expect(proposalEndpointObjectIds(f.proposal, f.state, f.access)).rejects.toBe(error);
    expect(f.proposal).toEqual(before); expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it('propagates a transport failure instead of presenting a successful route-only foreground', async () => {
    const f = fixture(), error = new TypeError('Network request failed.');
    vi.mocked(fetchEndpointBinding).mockRejectedValue(error);
    await expect(proposalEndpointObjectIds(parsePathFinderProposal(f.raw), f.state, f.access)).rejects.toBe(error);
    expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
  });
  it('bounds fixed-world display to the existing total deadline and honors explicit cancellation', async () => {
    vi.useFakeTimers(); const f = fixedDisplayFixture();
    vi.mocked(fetchCableEndpointContext).mockImplementation((_project, _token, _cable, _end, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
    }));
    const pending = expect(proposalEndpointObjectIds(f.proposal, f.state, f.access)).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(ENDPOINT_VISIBILITY_DEADLINE_MS); await pending;
    const stop = new AbortController(), cancelled = proposalEndpointObjectIds(f.proposal, f.state, f.access, stop.signal);
    stop.abort(); await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
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
  it('never treats an unreadable object as verified absent or swallows its protected API authority error', async () => {
    const f = fixture(); vi.mocked(fetchEndpointBinding).mockResolvedValue(f.context);
    const missing = new GeometryTraceApiError('NOT_FOUND', 404, 'Unavailable.'); vi.mocked(fetchGeometryObjectRevision).mockRejectedValueOnce(missing);
    await expect(proposalEndpointObjectIds(parsePathFinderProposal(f.raw), f.state, f.access)).rejects.toBe(missing);
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
    const proposal = parsePathFinderProposal(f.raw), pending = expect(proposalEndpointObjectIds(proposal, f.state, f.access)).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(ENDPOINT_VISIBILITY_DEADLINE_MS); await pending; expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
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
  it('retains a stale legacy proposal display only while its current confirmed binding still matches exactly', async () => {
    const f = fixture(), legacy = { locationId: ids.location, bindingRevision: '1', point: [1.25, 2, 3] };
    f.state.locations = [{ id: ids.location, name: 'Synthetic saved location', aliases: [], revision: '2',
      binding: { modelVersionId: ids.model, revision: '1', point: [1.25, 2, 3], objectId: 'dbid:73', externalId: null, source: 'manual', status: 'confirmed' } }];
    const proposal = parsePathFinderProposal({ ...f.raw, stale: true, canApply: false,
      dependencies: { ...f.raw.dependencies, schemaVersion: 'pathfinder.dependencies.v2', from: legacy, to: legacy } });
    const before = structuredClone(proposal);
    expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual(['dbid:73']);
    f.state.locations[0].binding!.revision = '2'; expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual([]);
    f.state.locations[0].binding!.revision = '1'; f.state.locations[0].binding!.point = [9, 2, 3];
    expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual([]);
    f.state.locations[0].binding!.point = [...legacy.point] as [number, number, number]; f.state.locations[0].binding!.modelVersionId = key(99);
    expect(await proposalEndpointObjectIds(proposal, f.state, f.access)).toEqual([]);
    expect(proposal).toEqual(before); expect(proposal.canApply).toBe(false);
    expect(fetchCableEndpointContext).not.toHaveBeenCalled(); expect(fetchEndpointBinding).not.toHaveBeenCalled(); expect(fetchGeometryObjectRevision).not.toHaveBeenCalled();
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
