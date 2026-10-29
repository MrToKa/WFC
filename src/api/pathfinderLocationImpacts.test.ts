import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locationImpactSummarySchema, LOCATION_IMPACT_LIMITS } from '../../shared/pathfinderLocationImpacts';
import { fetchLocationImpacts, fetchLocationImpactProgress, LOCATION_IMPACT_READ_MILLISECONDS } from './pathfinderLocationImpacts';

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), actor = id(2), impactId = id(30);
function impact(n = 30) { return locationImpactSummarySchema.parse({ id: id(n), projectId: project, actorId: actor, modelVersionId: id(3), selectionRevision: '2', contentFingerprint: 'a'.repeat(64),
  current: { modelVersionId: id(3), selectionRevision: '2', contentFingerprint: 'a'.repeat(64), aggregateId: id(4), artifactId: id(5), projectionSha256: 'b'.repeat(64), captureFrameId: id(6), geometryRevision: '3', traceId: id(7) },
  calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, status: 'running', reasonCodes: [],
  eligibleCables: 3, excludedMvCables: 1, blockedCategoryCables: 1, currentTargetCables: 3, completed: 1, total: 3, readyCables: 1, blockedCables: 0, jobId: id(8),
  createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:01.000Z', admittedAt: '2026-10-20T10:00:00.200Z', authorityExpiresAt: '2026-10-20T10:30:00.000Z',
  currentAuthority: true, elapsedMilliseconds: 1000, admissionElapsedMilliseconds: 200 }); }
const page = () => ({ schemaVersion: 'wfc.pf.location-impact-page.v1', projectId: project, impacts: [impact(), impact(20)], nextBeforeId: id(20) });
const progress = () => ({ schemaVersion: 'wfc.pf.location-impact-progress.v1', projectId: project, impact: impact() });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const barrierIntent=(drillThroughWalls=false)=>{const current=impact().current,scope={projectId:project,modelVersionId:current.modelVersionId,contentFingerprint:current.contentFingerprint,selectionRevision:current.selectionRevision,captureFrameId:current.captureFrameId,captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres' as const};return{schemaVersion:'wfc.pf.barrier-admission-intent.v1' as const,scope,expectedRegistryRevision:'4',expectedSnapshot:{snapshotId:id(40),scope,registryRevision:'4',contentSha256:'c'.repeat(64),mode:'explicit-empty' as const},drillThroughWalls};};
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded owned location impact reads', () => {
  it.each([false,true])('retains exact scoped barrier input in progress and history (drill=%s)',async drillThroughWalls=>{
    const original=impact(),barrierRouting=barrierIntent(drillThroughWalls),entry={...original,calculation:{...original.calculation!,preferences:{...original.calculation!.preferences,barrierRouting}}};
    const value={...progress(),impact:entry},history={...page(),impacts:[entry],nextBeforeId:null};
    vi.mocked(fetch).mockResolvedValueOnce(response(value)).mockResolvedValueOnce(response(history));
    await expect(fetchLocationImpactProgress(project,'token',actor,impactId)).resolves.toEqual(value);
    await expect(fetchLocationImpacts(project,'token',actor)).resolves.toEqual(history);
  });
  it('refuses malformed and foreign-frame barrier input instead of stripping it from observed progress',async()=>{
    const original=impact(),intent=barrierIntent(),scope={...intent.scope,captureFrameId:id(99)};
    for(const barrierRouting of [null,{...intent,extra:true},{...intent,scope,expectedSnapshot:{...intent.expectedSnapshot,scope}}]){
      vi.mocked(fetch).mockResolvedValueOnce(response({...progress(),impact:{...original,calculation:{...original.calculation!,preferences:{...original.calculation!.preferences,barrierRouting}}}}));
      await expect(fetchLocationImpactProgress(project,'token',actor,impactId)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    }
  });
  it('uses fixed GET-only paths for paged reload discovery and one exact summary, preserving observed timing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(page())).mockResolvedValueOnce(response(progress()));
    await expect(fetchLocationImpacts(project, 'token', actor, { beforeId: id(50), limit: 25 })).resolves.toEqual(page());
    await expect(fetchLocationImpactProgress(project, 'token', actor, impactId)).resolves.toEqual(progress());
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain(`/location-impacts?limit=25&beforeId=${id(50)}`);
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain(`/location-impacts/${impactId}`);
    for (const [, options] of vi.mocked(fetch).mock.calls) { expect(options).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', headers: { Authorization: 'Bearer token' } }); expect(options).not.toHaveProperty('body'); }
    expect(progress().impact.admissionElapsedMilliseconds).toBe(200); expect(progress().impact).not.toHaveProperty('eta');
  });
  it('accepts exhausted empty history without inventing an impact', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...page(), impacts: [], nextBeforeId: null }));
    await expect(fetchLocationImpacts(project, 'token', actor)).resolves.toMatchObject({ impacts: [], nextBeforeId: null });
  });
  it('rejects malformed ownership, path IDs, cursor injection and unknown query fields before a request', async () => {
    await expect(fetchLocationImpacts(project + '\n', 'token', actor)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchLocationImpacts(project, 'token', '../actor')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchLocationImpacts(project, 'token', actor, { beforeId: '../other' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchLocationImpacts(project, 'token', actor, { limit: 101 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchLocationImpacts(project, 'token', actor, { url: 'https://untrusted.test' } as never)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchLocationImpactProgress(project, 'token', actor, 'not-an-impact')).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses foreign actors/projects, wrong exact IDs, duplicate or unordered history and mismatched continuation', async () => {
    for (const value of [{ ...page(), projectId: id(99), impacts: [] }, { ...page(), impacts: [{ ...impact(), actorId: id(99) }], nextBeforeId: null },
      { ...page(), impacts: [impact(), impact()] }, { ...page(), impacts: [impact(20), impact()], nextBeforeId: impactId },
      { ...page(), nextBeforeId: id(99) }, { ...page(), impacts: [], nextBeforeId: impactId }]) {
      vi.mocked(fetch).mockResolvedValueOnce(response(value)); await expect(fetchLocationImpacts(project, 'token', actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    for (const value of [{ ...progress(), impact: impact(99) }, { ...progress(), impact: { ...impact(), actorId: id(99) } }]) {
      vi.mocked(fetch).mockResolvedValueOnce(response(value)); await expect(fetchLocationImpactProgress(project, 'token', actor, impactId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('rejects unknown top-level fields and invalid counts, scope or phase evidence', async () => {
    for (const value of [{ ...progress(), extra: true }, { ...progress(), impact: { ...impact(), completed: 4 } },
      { ...progress(), impact: { ...impact(), elapsedMilliseconds: -1 } }, { ...progress(), impact: { ...impact(), current: { ...impact().current, selectionRevision: '9' } } }]) {
      vi.mocked(fetch).mockResolvedValueOnce(response(value)); await expect(fetchLocationImpactProgress(project, 'token', actor, impactId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('retains missing-versus-denied HTTP status without rendering arbitrary error text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream(), { status: 403 }))
      .mockResolvedValueOnce(response({ code: 'LOCATION_IMPACT_NOT_FOUND', message: 'private data' }, 404));
    await expect(fetchLocationImpactProgress(project, 'token', actor, impactId)).rejects.toMatchObject({ status: 403, message: 'Current administrator access is required. Sign in again to read recalculation progress.' });
    await expect(fetchLocationImpactProgress(project, 'token', actor, impactId)).rejects.toMatchObject({ status: 404, code: 'LOCATION_IMPACT_NOT_FOUND', message: 'This location impact is unavailable for the current account. Refresh its history.' });
  });
  it('bounds bytes and rejects duplicate JSON keys or invalid UTF8', async () => {
    const cancel = vi.fn(); vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(LOCATION_IMPACT_LIMITS.recordBytes + 1)); }, cancel })))
      .mockResolvedValueOnce(new Response('{"projectId":"a","project\\u0049d":"b"}')).mockResolvedValueOnce(new Response(new Uint8Array([0xff])));
    for (let n = 0; n < 3; n++) await expect(fetchLocationImpacts(project, 'token', actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' }); expect(cancel).toHaveBeenCalledOnce();
  });
  it('bounds ignored-abort fetch and stalled response bodies', async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const fetchPending = expect(fetchLocationImpactProgress(project, 'token', actor, impactId)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(LOCATION_IMPACT_READ_MILLISECONDS); await fetchPending;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream()));
    const bodyPending = expect(fetchLocationImpacts(project, 'token', actor)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(LOCATION_IMPACT_READ_MILLISECONDS); await bodyPending;
  });
  it('cancels owner changes immediately and discards late bodies', async () => {
    let finish!: (response: Response) => void; const cancel = vi.fn(), abort = new AbortController(); vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = expect(fetchLocationImpactProgress(project, 'token', actor, impactId, abort.signal)).rejects.toMatchObject({ name: 'AbortError' }); abort.abort(); await pending;
    finish(new Response(new ReadableStream({ cancel }))); await Promise.resolve(); expect(cancel).toHaveBeenCalledOnce();
  });
});
