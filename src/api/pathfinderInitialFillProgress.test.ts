import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyInitialFillCounters, INITIAL_FILL_PROGRESS_LIMITS } from '../../shared/pathfinderInitialFillProgress';
import { fetchInitialFillProgress, INITIAL_FILL_PROGRESS_READ_MILLISECONDS } from './pathfinderInitialFillProgress';
const id = (n: number) => `f8200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), actor = id(2), impact = id(3), cable = id(4);
function progress() { return { schemaVersion: 'wfc.pf.initial-fill-progress.v1', projectId: project, actorId: actor, impactId: impact,
  mandate: { id: id(5), contentSha256: 'a'.repeat(64), impactId: impact, mode: 'when-both-empty' }, authorized: true, currentAuthority: true, eligibleCables: 1,
  counters: { ...emptyInitialFillCounters(), pending: 1 }, retryableUnknown: 0, outstanding: 1, selected: { cableId: cable, status: 'pending', reasonCode: null, receiptId: null } }; }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('bounded exact-impact initial-fill GET client', () => {
  it('uses one fixed GET with exact IDs and no write or renewal payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(progress())); expect(await fetchInitialFillProgress(project, 'current-token', actor, impact, cable)).toEqual(progress());
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain(`/initial-fill-progress/${impact}?cableId=${cable}`);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: { Authorization: 'Bearer current-token' } });
    expect(vi.mocked(fetch).mock.calls[0][1]).not.toHaveProperty('body');
  });
  it('requires selected absence when no cable was requested', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...progress(), selected: null })).mockResolvedValueOnce(response(progress()));
    expect((await fetchInitialFillProgress(project, 'token', actor, impact)).selected).toBeNull();
    await expect(fetchInitialFillProgress(project, 'token', actor, impact)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each(['projectId', 'actorId', 'impactId', 'selected'] as const)('rejects foreign %s ownership in a successful body', async field => {
    const value = progress(); if (field === 'selected') value.selected.cableId = id(99); else value[field] = id(99); vi.mocked(fetch).mockResolvedValue(response(value));
    await expect(fetchInitialFillProgress(project, 'token', actor, impact, cable)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('refuses invalid request identity and tokens before any network call', async () => {
    for (const args of [[project, '', actor, impact, cable], [project, 'token', '../actor', impact, cable], [project, 'token', actor, '../impact', cable], [project, 'token', actor, impact, '../cable']] as const)
      await expect(fetchInitialFillProgress(args[0], args[1], args[2], args[3], args[4])).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects counters/extra fields rather than presenting calculation as a confirmed cable write', async () => {
    for (const value of [{ ...progress(), outstanding: 0 }, { ...progress(), credential: 'secret' }, { ...progress(), selected: { ...progress().selected, status: 'written' } }]) {
      vi.mocked(fetch).mockResolvedValueOnce(response(value)); await expect(fetchInitialFillProgress(project, 'token', actor, impact, cable)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('retains denied/unavailable status with safe static text and never renders server messages', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream(), { status: 403 })).mockResolvedValueOnce(response({ code: 'INITIAL_FILL_IMPACT_NOT_FOUND', message: 'private business data' }, 404));
    await expect(fetchInitialFillProgress(project, 'token', actor, impact, cable)).rejects.toMatchObject({ status: 403, message: 'Current administrator access is required. Sign in again to read initial-fill progress.' });
    await expect(fetchInitialFillProgress(project, 'token', actor, impact, cable)).rejects.toMatchObject({ status: 404, code: 'INITIAL_FILL_IMPACT_NOT_FOUND', message: 'This initial-fill impact is unavailable for the current account.' });
  });
  it('bounds body bytes and rejects duplicate JSON keys and invalid UTF8', async () => {
    const cancel = vi.fn(); vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(INITIAL_FILL_PROGRESS_LIMITS.responseBytes + 1)); }, cancel })))
      .mockResolvedValueOnce(new Response('{"actorId":"a","actor\\u0049d":"b"}')).mockResolvedValueOnce(new Response(new Uint8Array([0xff])));
    for (let n = 0; n < 3; n++) await expect(fetchInitialFillProgress(project, 'token', actor, impact, cable)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' }); expect(cancel).toHaveBeenCalledOnce();
  });
  it('bounds ignored-abort fetch and stalled body reads by the same deadline', async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const pending = expect(fetchInitialFillProgress(project, 'token', actor, impact, cable)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' }); await vi.advanceTimersByTimeAsync(INITIAL_FILL_PROGRESS_READ_MILLISECONDS); await pending;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream())); const body = expect(fetchInitialFillProgress(project, 'token', actor, impact, cable)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(INITIAL_FILL_PROGRESS_READ_MILLISECONDS); await body;
  });
  it('cancels account/selection ownership promptly and disposes late bodies', async () => {
    const abort = new AbortController(), cancel = vi.fn(); let finish!: (value: Response) => void; vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = expect(fetchInitialFillProgress(project, 'token', actor, impact, cable, abort.signal)).rejects.toMatchObject({ name: 'AbortError' }); abort.abort(); await pending;
    finish(new Response(new ReadableStream({ cancel }))); await Promise.resolve(); expect(cancel).toHaveBeenCalledOnce();
  });
});
