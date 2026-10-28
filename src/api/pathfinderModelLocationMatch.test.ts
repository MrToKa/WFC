import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assignModelLocations, fetchModelLocationMatchContext, isModelLocationMatchBusy, ModelLocationMatchApiError } from './pathfinderModelLocationMatch';
import { modelMatchContext, modelMatchIds as ids, modelMatchReceipt } from '@/test/modelLocationMatchFixtures';
import type { ModelLocationMatchAssign } from '../../shared/pathfinderModelLocationMatch';
import { fetchPathFinderState } from './pathfinder';
const command = (): ModelLocationMatchAssign => ({ schemaVersion: 'wfc.pf.model-location-match-assign.v1', current: modelMatchContext().current,
  namesSha256: modelMatchContext().namesSha256, expectedRegistryRevision: '7', idempotencyKey: ids.frame, names: ['TAG-1'],
  scan: { matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v3', visibilityScope: { schemaVersion: 'wfc.pf.sdk-display-visibility.v1',
    basis: 'sdk-display-before-pf-appearance', contentSha256: 'c'.repeat(64) }, indexedObjectCount: 1,
    propertyScan: { attemptedObjectCount: 1, returnedObjectCount: 1, omittedObjectCount: 0, complete: true }, complete: true,
    candidates: [{ objectId: 1, name: 'Equipment 1', matchedNames: ['TAG-1'], bounds: { minimum: [0, 0, 0], maximum: [2, 2, 2] }, bottomCentre: [1, 1, 0] }] } });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());
describe('independent model location matching transport', () => {
  it.each(['PREFLIGHT_DATABASE_BUSY', 'ENDPOINT_DATABASE_BUSY', 'WORKFLOW_DATABASE_BUSY'])('identifies only typed503 %s as a bounded replay candidate', code => {
    expect(isModelLocationMatchBusy(new ModelLocationMatchApiError(code, 503, 'unknown', 'Busy.'))).toBe(true);
    expect(isModelLocationMatchBusy(new ModelLocationMatchApiError(code, 409, 'refused', 'Refused.'))).toBe(false);
    expect(isModelLocationMatchBusy({ code, status: 503 })).toBe(false);
    expect(isModelLocationMatchBusy(new ModelLocationMatchApiError('ENGINE_FAILED', 503, 'unknown', 'Unavailable.'))).toBe(false);
  });
  it.each(['PREFLIGHT_DATABASE_BUSY', 'ENDPOINT_DATABASE_BUSY', 'WORKFLOW_DATABASE_BUSY'])('retains the exact typed %s status from the server without replaying inside transport', async code => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ schemaVersion: 'wfc.pf.endpoint-binding-error.v1', code, message: 'Busy.', outcome: 'unknown' }, { status: 503 }));
    const error = await assignModelLocations(ids.project, 'token', command()).catch(error => error);
    expect(error).toMatchObject({ code, status: 503, outcome: 'unknown' }); expect(isModelLocationMatchBusy(error)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reads authenticated endpoint scope without touching preparation or jobs', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json(modelMatchContext()));
    expect(await fetchModelLocationMatchContext(ids.project, 'token')).toEqual(modelMatchContext());
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/locations/model-match/context'), expect.objectContaining({ method: 'GET', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer token' } }));
  });
  it('refuses a context whose complete name scope hash does not match', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...modelMatchContext(), namesSha256: 'd'.repeat(64) }));
    await expect(fetchModelLocationMatchContext(ids.project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('posts exactly once and verifies the exact command receipt', async () => {
    const body = command(); vi.mocked(fetch).mockResolvedValue(Response.json(modelMatchReceipt(body)));
    expect((await assignModelLocations(ids.project, 'token', body)).registryRevision).toBe('8');
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/locations/model-match/assign'), expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }));
  });
  it.each(['project', 'key', 'hash', 'names', 'revision'])('rejects a mismatching %s receipt', async kind => {
    const body = command(), receipt = modelMatchReceipt(body);
    if (kind === 'project') receipt.projectId = ids.model;
    if (kind === 'key') receipt.idempotencyKey = ids.model;
    if (kind === 'hash') receipt.commandSha256 = '0'.repeat(64);
    if (kind === 'names') receipt.results = [];
    if (kind === 'revision') receipt.registryRevision = '6';
    vi.mocked(fetch).mockResolvedValue(Response.json(receipt));
    await expect(assignModelLocations(ids.project, 'token', body)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
  });
  it('keeps uncertain errors unknown and never retries a POST automatically', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ code: 'DATABASE_BUSY' }, { status: 503 }));
    await expect(assignModelLocations(ids.project, 'token', command())).rejects.toMatchObject({ outcome: 'unknown', status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('carries an explicit server refusal separately from an unknown outcome', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ schemaVersion: 'wfc.pf.endpoint-binding-error.v1', code: 'MODEL_LOCATION_MATCH_CONTEXT_CHANGED', message: 'Current context changed.', outcome: 'refused' }, { status: 409 }));
    await expect(assignModelLocations(ids.project, 'token', command())).rejects.toMatchObject({ code: 'MODEL_LOCATION_MATCH_CONTEXT_CHANGED', status: 409, outcome: 'refused' });
  });
  it.each(['malformed', 'server'])('retains unknown outcome for a %s refusal envelope', async kind => {
    const body = { code: 'MODEL_LOCATION_MATCH_CONTEXT_CHANGED', outcome: 'refused' };
    vi.mocked(fetch).mockResolvedValue(Response.json(kind === 'malformed' ? body : { ...body, schemaVersion: 'wfc.pf.endpoint-binding-error.v1', message: 'Server failed.' }, { status: kind === 'malformed' ? 409 : 503 }));
    const pending = assignModelLocations(ids.project, 'token', command());
    await expect(pending).rejects.toBeInstanceOf(ModelLocationMatchApiError);
    await expect(pending).rejects.toMatchObject({ outcome: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('recognizes a matching-derived shared binding when refreshing Path Finder state', async () => {
    const current = modelMatchContext().current;
    vi.mocked(fetch).mockResolvedValue(Response.json({ schemaVersion: 1, projectId: ids.project, registryRevision: '8',
      activeModel: { modelVersionId: current.modelVersionId, selectionRevision: '1', contentFingerprint: current.contentFingerprint },
      settings: { revision: '1', connectionGap: '0.1', secondaryTrayLength: '1', endConnectionLength: '1', additionalBendingPercent: '0' },
      cables: [], artifacts: [], jobs: [], proposals: [], locations: [{ id: ids.location, name: 'TAG-1', aliases: [], revision: '1',
        binding: { modelVersionId: ids.model, revision: '1', point: [1, 1, 0], objectId: 'dbid:1', externalId: null,
          source: 'automatic', status: 'confirmed', derivation: 'matched-model-bottom-aabb.v1', coordinateFrame: 'canonical-world-metres' } }] }));
    expect((await fetchPathFinderState(ids.project, 'token')).locations[0].binding?.derivation).toBe('matched-model-bottom-aabb.v1');
  });
});
