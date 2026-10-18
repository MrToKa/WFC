import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPathFinderState, fetchPathFinderProposal, fetchPathFinderLookup, pathFinderRequest } from './pathfinder';

const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222', cableId = '33333333-3333-4333-8333-333333333333';
afterEach(() => vi.restoreAllMocks());
function state() { return { schemaVersion: 1, projectId, registryRevision: '3', activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
  settings: { connectionGap: '1', secondaryTrayLength: null, endConnectionLength: '2', additionalBendingPercent: '5' },
  cables: [{ id: cableId, cableId: 17, tag: '=CABLE-17', fromLocation: 'EQ-001', toLocation: 'EQ-002', mto: 'Instrumentation', routing: null, designLength: '42', installLength: '37', cableWriteRevision: '9007199254740993', fromMatch: { status: 'missing', locationId: null, candidates: [] }, toMatch: { status: 'missing', locationId: null, candidates: [] } }],
  locations: [], artifacts: [], jobs: [], proposals: [] }; }
describe('PathFinder API contract', () => {
  it('accepts a nonempty actual-shaped state with integer cable_id and exact BIGINT revision strings', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(state()));
    const result = await fetchPathFinderState(projectId, 'test-token');
    expect(result.cables[0].cableId).toBe(17); expect(result.cables[0].cableWriteRevision).toBe('9007199254740993'); expect(result.settings.connectionGap).toBe('1'); expect(result.settings.secondaryTrayLength).toBeNull();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/projects/${projectId}/pathfinder/state`), expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer test-token' } }));
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
    const detail = { id: proposalId, projectId, jobId: modelId, cableId, status: 'model_needs_review', proposalHash: 'f'.repeat(64), cableWriteRevision: '2', stale: false, synthetic: false, engineeringAccepted: false, acceptanceScope: 'unaccepted-model', canApply: false, compatibilityIssue: null, message: 'Review required', engineeringMessage: 'Native parity is pending', route: null, design: null, createdAt: '2026-10-18T00:00:00Z' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(detail)).mockResolvedValueOnce(Response.json({ ...detail, id: modelId }));
    expect((await fetchPathFinderProposal(projectId, 'test-token', proposalId)).canApply).toBe(false);
    await expect(fetchPathFinderProposal(projectId, 'test-token', proposalId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('reads raw diagnostic lookup results with exact points and rejects wrong identity or promoted acceptance', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const detail = { id, projectId, kind: 'lookup', status: 'complete', total: 1, completed: 1, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:01Z', failure: null,
      input: { routeText: '/BC1/BC2', reverse: true }, result: { status: 'calculated', message: 'Diagnostic lookup complete.', prepared: {}, engineeringAccepted: false, acceptanceScope: 'diagnostic-lookup', stale: false, design: null,
        route: { success: true, message: 'Found.', routeText: '/BC2/BC1', routeCodes: ['BC2', 'BC1'], segmentIds: ['dbid:23'], objectIds: ['dbid:23'], points: [[1.25, -2, 3], [4, 5, 6]], lengthMeters: 10, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 } } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(detail)).mockResolvedValueOnce(Response.json({ ...detail, projectId: modelId })).mockResolvedValueOnce(Response.json({ ...detail, result: { ...detail.result, engineeringAccepted: true } }));
    const value = await fetchPathFinderLookup(projectId, 'test-token', id); expect(value.result?.route?.points).toEqual([[1.25, -2, 3], [4, 5, 6]]); expect(value.result?.design).toBeNull();
    await expect(fetchPathFinderLookup(projectId, 'test-token', id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fetchPathFinderLookup(projectId, 'test-token', id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
