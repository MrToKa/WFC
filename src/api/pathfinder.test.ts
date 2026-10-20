import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPathFinderState, fetchPathFinderProposal, fetchPathFinderLookup, fetchPathFinderLookupPlan, fetchPathFinderPreview, pathFinderRequest } from './pathfinder';
import { createHash } from 'node:crypto';
import { ENGINE_IDENTITY_POLICY_VERSIONS, ENGINE_IDENTITY_VERSION, engineIdentityCanonicalBody } from '../../shared/pathfinderEngineIdentity';
import { notEvaluatedCalculationAvailability } from '../../shared/pathfinderCalculationAvailability';

const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222', cableId = '33333333-3333-4333-8333-333333333333';
afterEach(() => vi.restoreAllMocks());
function state() { return { schemaVersion: 1, projectId, registryRevision: '3', activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
  settings: { revision: '1', connectionGap: '1', secondaryTrayLength: null, endConnectionLength: '2', additionalBendingPercent: '5' },
  cables: [{ id: cableId, cableId: 17, tag: '=CABLE-17', fromLocation: 'EQ-001', toLocation: 'EQ-002', mto: 'Instrumentation', routing: null, designLength: '42', installLength: '37', cableWriteRevision: '9007199254740993', fromMatch: { status: 'missing', locationId: null, candidates: [] }, toMatch: { status: 'missing', locationId: null, candidates: [] } }],
  locations: [], artifacts: [], jobs: [], proposals: [] }; }
function recordedProposal(dependencyVersion: string) {
  const body = { schemaVersion: 'wfc.pf.engine-identity.v1' as const, version: ENGINE_IDENTITY_VERSION,
    runnerSha256: '1'.repeat(64), modelModuleSha256: '2'.repeat(64), coreModuleSha256: '3'.repeat(64),
    adapterModuleSha256: '4'.repeat(64), derivationSha256: '5'.repeat(64), policyVersions: { ...ENGINE_IDENTITY_POLICY_VERSIONS } };
  return { schemaVersion: 'wfc.pf.proposal.v2', id: '44444444-4444-4444-8444-444444444444', projectId, jobId: modelId, cableId,
    status: 'stale', proposalHash: 'f'.repeat(64), cableWriteRevision: '2', stale: true, synthetic: false,
    engineeringAccepted: false, acceptanceScope: 'unaccepted-model', canApply: false, compatibilityIssue: null,
    message: 'Recorded historical proposal.', engineeringMessage: 'Calculate and review a current result.', route: null, design: null,
    routingPreferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, createdAt: '2026-10-18T00:00:00Z',
    provenance: { dependencyVersion, dependencyHash: 'a'.repeat(64), automatic: null,
      engineIdentity: ['pathfinder.dependencies.v5','pathfinder.dependencies.v6'].includes(dependencyVersion)
        ? { ...body, contentSha256: createHash('sha256').update(engineIdentityCanonicalBody(body)).digest('hex') } : null,
      ...(dependencyVersion==='pathfinder.dependencies.v6'?{endpointSources:{from:'automatic-model-candidate',to:'confirmed-shared-location'}}:{}) } };
}
describe('PathFinder API contract', () => {
  it('retains confirmed and approximate automatic point availability separately from legacy bindings without granting acceptance', async () => {
    const automatic = { status: 'automatic-ready', pointAvailable: true, source: 'automatic-model-candidate', approximate: true, candidateObjectIds: ['dbid:23'], reasonCode: null, engineeringAccepted: false };
    const confirmed = { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
    const base = { id: modelId, name: 'EQ-001', aliases: [], revision: '1', binding: null };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...state(), locations: [{ ...base, calculationAvailability: automatic }, { ...base, id: cableId, calculationAvailability: confirmed }] }));
    const result = await fetchPathFinderState(projectId, 'token');
    expect(result.locations[0].calculationAvailability).toEqual(automatic); expect(result.locations[0].binding).toBeNull();
    expect(result.locations[1].calculationAvailability).toEqual(confirmed);
    fetch.mockResolvedValueOnce(Response.json({ ...state(), locations: [base] }));
    const legacy = await fetchPathFinderState(projectId, 'token'); expect(legacy.locations[0].calculationAvailability).toBeUndefined();
    expect(notEvaluatedCalculationAvailability().pointAvailable).toBe(false);
  });
  it('rejects malformed, contradictory or promoted calculation-point evidence instead of silently dropping it', async () => {
    const automatic = { status: 'automatic-ready', pointAvailable: true, source: 'automatic-model-candidate', approximate: true, candidateObjectIds: ['dbid:23'], reasonCode: null, engineeringAccepted: false };
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const availability of [null, { ...automatic, status: 'future-ready' }, { ...automatic, pointAvailable: false },
      { ...automatic, source: 'confirmed-shared-location' }, { ...automatic, approximate: false }, { ...automatic, engineeringAccepted: true },
      { ...automatic, candidateObjectIds: [] }, { ...automatic, candidateObjectIds: ['dbid:23', 'dbid:23'] }, { ...automatic, candidateObjectIds: [23] },
      { ...automatic, candidateObjectIds: Array.from({ length: 2049 }, (_, index) => 'dbid:' + index) }, { ...automatic, reasonCode: 'UNVERIFIED' },
      { ...automatic, point: [1, 2, 3] }, { ...automatic, status: 'confirmed-ready', source: 'confirmed-shared-location' },
      { ...automatic, status: 'missing', pointAvailable: false, source: null, approximate: false },
    ]) {
      fetch.mockResolvedValueOnce(Response.json({ ...state(), locations: [{ id: modelId, name: 'EQ-001', aliases: [], revision: '1', binding: null, calculationAvailability: availability }] }));
      await expect(fetchPathFinderState(projectId, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('retains validated recorded input provenance after reload without granting completeness', async () => {
    const inputScope = { schemaVersion: 'wfc.capture.input.v1', equipmentNameCount: 1527, chunkCount: 6, inputUtf8Bytes: 70438,
      scopeSha256: 'a'.repeat(64), equipmentNamesSha256: 'b'.repeat(64),
      propertyScan: { indexedObjectCount: 100, attemptedObjectCount: 100, returnedObjectCount: 90, omittedObjectCount: 10, complete: false } };
    const artifact = { id: cableId, modelVersionId: modelId, snapshotSha256: 'c'.repeat(64), objectCount: 26, engineeringAccepted: false, readiness: 'needs_review', capture: { inputScope }, coordinates: {}, createdAt: '2026-10-18T00:00:00Z' };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...state(), artifacts: [artifact] }));
    const result = await fetchPathFinderState(projectId, 'token');
    expect(result.artifacts[0].capture.inputScope).toEqual(inputScope); expect(result.artifacts[0].engineeringAccepted).toBe(false);
    fetch.mockResolvedValueOnce(Response.json({ ...state(), artifacts: [{ ...artifact, capture: { inputScope: { ...inputScope, propertyScan: { ...inputScope.propertyScan, complete: true } } } }] }));
    await expect(fetchPathFinderState(projectId, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('accepts a nonempty actual-shaped state with integer cable_id and exact BIGINT revision strings', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(state()));
    const result = await fetchPathFinderState(projectId, 'test-token');
    expect(result.cables[0].cableId).toBe(17); expect(result.cables[0].cableWriteRevision).toBe('9007199254740993'); expect(result.settings.connectionGap).toBe('1'); expect(result.settings.secondaryTrayLength).toBeNull();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/projects/${projectId}/pathfinder/state`), expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer test-token' } }));
  });
  it('reads mixed retained v1 and current v5 provenance without dropping historical proposals or granting Apply', async () => {
    const historical = recordedProposal('pathfinder.dependencies.v1'), current = { ...recordedProposal('pathfinder.dependencies.v5'), id: modelId };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...state(), proposals: [historical, current] }))
      .mockResolvedValueOnce(Response.json(historical));
    const result = await fetchPathFinderState(projectId, 'test-token');
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0].provenance).toEqual(historical.provenance);
    expect(result.proposals[1].provenance?.engineIdentity).toEqual(current.provenance.engineIdentity);
    expect(result.proposals.map(value => value.canApply)).toEqual([false, false]);
    const detail = await fetchPathFinderProposal(projectId, 'test-token', historical.id);
    expect(detail.provenance?.dependencyVersion).toBe('pathfinder.dependencies.v1');
    expect(detail.provenance?.engineIdentity).toBeNull(); expect(detail.engineeringAccepted).toBe(false);
  });
  it('refuses unknown future dependency versions instead of treating them as historical provenance', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...state(), proposals: [recordedProposal('pathfinder.dependencies.v7')] }));
    await expect(fetchPathFinderState(projectId, 'test-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('keeps the exact engine-identity boundary for historical and current provenance', async () => {
    const historical = recordedProposal('pathfinder.dependencies.v1'), current = recordedProposal('pathfinder.dependencies.v5');
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const invalid of [
      { ...historical, provenance: { ...historical.provenance, engineIdentity: current.provenance.engineIdentity } },
      { ...current, provenance: { ...current.provenance, engineIdentity: null } },
    ]) {
      fetch.mockResolvedValueOnce(Response.json({ ...state(), proposals: [invalid] }));
      await expect(fetchPathFinderState(projectId, 'test-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('keeps automatic model endpoints distinct from confirmed shared locations and requires their provenance',async()=>{
    const automatic=recordedProposal('pathfinder.dependencies.v6');
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(Response.json({...state(),proposals:[automatic]}));
    const result=await fetchPathFinderState(projectId,'test-token');
    expect(result.proposals[0].provenance?.endpointSources).toEqual({from:'automatic-model-candidate',to:'confirmed-shared-location'});
    expect(result.proposals[0].engineeringAccepted).toBe(false);
    for(const provenance of [
      {...automatic.provenance,engineIdentity:null},
      {...automatic.provenance,endpointSources:undefined},
      {...automatic.provenance,endpointSources:{from:'confirmed-shared-location',to:'confirmed-shared-location'}},
      {...automatic.provenance,dependencyVersion:'pathfinder.dependencies.v5'},
    ]){fetch.mockResolvedValueOnce(Response.json({...state(),proposals:[{...automatic,provenance}]}));await expect(fetchPathFinderState(projectId,'test-token')).rejects.toMatchObject({code:'INVALID_RESPONSE'});}
  });
  it('rejects changed project identity, malformed numeric IDs and arbitrary endpoint URLs', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...state(), projectId: modelId })).mockResolvedValueOnce(Response.json({ ...state(), cables: [{ ...state().cables[0], cableId: '17' }] }));
    await expect(fetchPathFinderState(projectId, 'test-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fetchPathFinderState(projectId, 'test-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(pathFinderRequest(projectId, 'test-token', 'https://example.invalid/extract', 'GET')).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('preserves the exact decimal project gap and rejects missing, nonpositive or oversized values', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...state(), settings: { ...state().settings, connectionGap: '0.250' } }));
    expect((await fetchPathFinderState(projectId, 'test-token')).settings.connectionGap).toBe('0.250');
    for (const connectionGap of [undefined, null, '0', '-1', '101', 'NaN', 1]) { fetch.mockResolvedValueOnce(Response.json({ ...state(), settings: { ...state().settings, connectionGap } })); await expect(fetchPathFinderState(projectId, 'test-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' }); }
  });
  it('detail readers require exact proposal/project identity and never promote an unaccepted model', async () => {
    const proposalId = '44444444-4444-4444-8444-444444444444';
    const detail = { id: proposalId, projectId, jobId: modelId, cableId, status: 'model_needs_review', proposalHash: 'f'.repeat(64), cableWriteRevision: '2', stale: false, synthetic: false, engineeringAccepted: false, acceptanceScope: 'unaccepted-model', canApply: false, compatibilityIssue: null, message: 'Review required', engineeringMessage: 'Native parity is pending', route: null, design: null, routingPreferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, createdAt: '2026-10-18T00:00:00Z' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(detail)).mockResolvedValueOnce(Response.json({ ...detail, id: modelId }));
    expect((await fetchPathFinderProposal(projectId, 'test-token', proposalId)).canApply).toBe(false);
    await expect(fetchPathFinderProposal(projectId, 'test-token', proposalId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('reads raw diagnostic lookup results with exact points and rejects wrong identity or promoted acceptance', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const detail = { id, projectId, kind: 'lookup', status: 'complete', total: 1, completed: 1, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:01Z', failure: null,
      input: { routeText: '/BC1/BC2', reverse: true }, result: { status: 'calculated', message: 'Diagnostic lookup complete.', prepared: {}, engineeringAccepted: false, acceptanceScope: 'diagnostic-lookup', stale: false, design: null, connectionGap: '0.250', diagnostics: { geometryLeavesUsed: 1, fallbackBends: 0, fallbackStraights: 1, fallbackClearances: null },
        route: { success: true, message: 'Found.', routeText: '/BC2/BC1', routeCodes: ['BC2', 'BC1'], segmentIds: ['dbid:23'], objectIds: ['dbid:23'], points: [[1.25, -2, 3], [4, 5, 6]], lengthMeters: 10, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 } } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(detail)).mockResolvedValueOnce(Response.json({ ...detail, projectId: modelId })).mockResolvedValueOnce(Response.json({ ...detail, result: { ...detail.result, engineeringAccepted: true } }));
    const value = await fetchPathFinderLookup(projectId, 'test-token', id); expect(value.result?.route?.points).toEqual([[1.25, -2, 3], [4, 5, 6]]); expect(value.result?.design).toBeNull();
    expect(value.result?.connectionGap).toBe('0.250'); expect(value.result?.diagnostics.fallbackClearances).toBeNull();
    await expect(fetchPathFinderLookup(projectId, 'test-token', id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fetchPathFinderLookup(projectId, 'test-token', id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('uses the server canonical lookup plan and rejects stale selections or malformed capture queries', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ routeCodes: ['/BC1', '/BC2'], connectionGap: '0.250', selectionRevision: '9007199254740993' }));
    const raw = '/BC1/SECONDARY/BC2/BC1';
    expect(await fetchPathFinderLookupPlan(projectId, 'test-token', raw, '9007199254740993')).toEqual({ routeCodes: ['/BC1', '/BC2'], connectionGap: '0.250', selectionRevision: '9007199254740993' });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/lookups/plan'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ routeText: raw, expectedSelectionRevision: '9007199254740993' }) }));
    for (const invalid of [{ routeCodes: [], connectionGap: '1', selectionRevision: '2' }, { routeCodes: ['/BC1', '/BC1'], connectionGap: '1', selectionRevision: '2' }, { routeCodes: ['BC1'], connectionGap: '1', selectionRevision: '2' }, { routeCodes: ['/BC1'], connectionGap: '0', selectionRevision: '2' }, { routeCodes: ['/BC1'], connectionGap: '1', selectionRevision: '3' }]) {
      fetch.mockResolvedValueOnce(Response.json(invalid));
      await expect(fetchPathFinderLookupPlan(projectId, 'test-token', raw, '2')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    await expect(pathFinderRequest(projectId, 'test-token', '/lookups/arbitrary', 'POST')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('requires an exact settings revision for standalone preview dependency fencing', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...state(), settings: { ...state().settings, revision: '9007199254740993' } }));
    expect((await fetchPathFinderState(projectId, 'test-token')).settings.revision).toBe('9007199254740993');
    fetch.mockResolvedValueOnce(Response.json({ ...state(), settings: { ...state().settings, revision: undefined } }));
    await expect(fetchPathFinderState(projectId, 'test-token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('reads a standalone path without cable Apply capability and rejects identity or capability promotion', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const endpoint = { name: 'EQ-001', point: [1, 2, 3], source: 'manual-world-point', objectId: null, locationId: null, bindingRevision: null };
    const detail = { id, projectId, kind: 'preview', status: 'complete', total: 1, completed: 1, cancelRequested: false, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:01Z', failure: null,
      input: { from: { name: 'EQ-001', point: [1, 2, 3] }, to: { name: 'EQ-002', point: [11, 2, 3] }, category: 'Control', reverse: false, artifactId: modelId, expectedSelectionRevision: '2', expectedRegistryRevision: '3', expectedSettingsRevision: '1' },
      result: { status: 'calculated', message: 'Path calculated.', prepared: {}, effectiveCategory: 'Control', engineeringAccepted: false, acceptanceScope: 'standalone-preview', canApply: false, stale: false, settings: state().settings, from: endpoint, to: { ...endpoint, name: 'EQ-002', point: [11, 2, 3] },
        design: { lengthBeforePercentageMeters: '12', unroundedLengthMeters: '12.6', designLengthMeters: '13' }, route: { success: true, message: 'Found.', routeText: '/BC1', routeCodes: ['BC1'], segmentIds: ['dbid:23'], objectIds: ['dbid:23'], points: [[1, 2, 3], [11, 2, 3]], lengthMeters: 10, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 } } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(detail));
    const value = await fetchPathFinderPreview(projectId, 'test-token', id);
    expect(value.result?.route?.lengthMeters).toBe(10); expect(value.result?.design?.designLengthMeters).toBe('13'); expect(value.result?.canApply).toBe(false);
    for (const invalid of [{ ...detail, projectId: modelId }, { ...detail, id: modelId }, { ...detail, result: { ...detail.result, canApply: true } }, { ...detail, result: { ...detail.result, engineeringAccepted: true } }]) {
      fetch.mockResolvedValueOnce(Response.json(invalid)); await expect(fetchPathFinderPreview(projectId, 'test-token', id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
});
