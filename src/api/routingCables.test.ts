import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRoutingCables, RoutingCableApiError } from './routingCables';

const projectId = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const cable = (n: number, tag: string | null = `Cable-${n}`, routing: string | null = '/BC001/SECONDARY') => ({
  id: id(n), projectId, cableId: 700 + n, tag, routing, fromLocation: 'Original from', toLocation: 'Original to',
  connectedFrom: '2026-01-01', connectedTo: '2026-01-02', cableType: { routing: '/DO-NOT-USE' }, privateExtra: 'discard',
});
const json = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

describe('independent full project cable adapter', () => {
  it('uses only the explicit current login and full GET with no table filters, query or mutations', async () => {
    localStorage.setItem('wfc_auth_token', 'different-stored-login');
    const fetch = vi.fn().mockResolvedValue(json({ cables: Array.from({ length: 41 }, (_, i) => cable(i)) })); vi.stubGlobal('fetch', fetch);
    const rows = await fetchRoutingCables(projectId, 'current-login', { signal: new AbortController().signal });
    expect(fetch).toHaveBeenCalledOnce(); const [url, options] = fetch.mock.calls[0];
    expect(new URL(url, location.origin).pathname).toBe(`/api/projects/${projectId}/cables`);
    expect(new URL(url, location.origin).search).toBe('');
    expect(options).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer current-login' }, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    expect(options.signal).toBeInstanceOf(AbortSignal); expect(options.body).toBeUndefined();
    expect(rows).toHaveLength(41);
    expect(rows[40]).toEqual({ id: id(40), projectId, tag: 'Cable-40', routing: '/BC001/SECONDARY', fromLocation: 'Original from', toLocation: 'Original to' });
  });

  it('retains duplicate tags, whitespace, fullwidth labels and nullable original routing without type fallback', async () => {
    const original = [cable(1, '  Ａbc  ', null), cable(2, '  Ａbc  ', ''), cable(3, null, '/ /'), cable(4, '   ', '/SECONDARY')];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ cables: original })).mockResolvedValueOnce(json({ cables: [] })));
    expect(await fetchRoutingCables(projectId, 'login')).toEqual(original.map(({ id, projectId, tag, routing, fromLocation, toLocation }) => ({ id, projectId, tag, routing, fromLocation, toLocation })));
    expect(await fetchRoutingCables(projectId, 'login')).toEqual([]);
  });

  it('preserves exact original locations and routing for separate duplicate-tag UUIDs without connected/type fallbacks', async () => {
    const original = [
      { ...cable(1, 'Duplicate'), fromLocation: '  Ｆrom / Å\r\nsecond line\t', toLocation: '<b>To & value</b>\n/', routing: '/BC001 /\r\nSECONDARY/' },
      { ...cable(2, 'Duplicate', null), fromLocation: null, toLocation: '' },
      { ...cable(3, 'Duplicate', ''), fromLocation: '', toLocation: null },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ cables: original })));
    const rows = await fetchRoutingCables(projectId, 'login');
    expect(rows).toEqual(original.map(({ id, projectId, tag, routing, fromLocation, toLocation }) => ({ id, projectId, tag, routing, fromLocation, toLocation })));
    expect(rows.map(row => row.id)).toEqual([id(1), id(2), id(3)]);
    expect(rows[1]).toMatchObject({ routing: null, fromLocation: null, toLocation: '' });
    expect(rows[2]).toMatchObject({ routing: '', fromLocation: '', toLocation: null });
    for (const row of rows) { expect(row).not.toHaveProperty('connectedFrom'); expect(row).not.toHaveProperty('connectedTo'); expect(row).not.toHaveProperty('cableType'); }
  });

  it.each(['fromLocation', 'toLocation'] as const)('requires nullable string %s and refuses missing or malformed data despite connected-field decoys', async field => {
    for (const value of [undefined, 0, false, {}, []]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ cables: [{ ...cable(1), [field]: value }] })));
      await expect(fetchRoutingCables(projectId, 'login')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', accessFailure: false });
    }
  });

  it.each([401, 403, 404])('treats HTTP%s as terminal access failure with a safe message', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Secret arbitrary server detail', { status })));
    const failure = await fetchRoutingCables(projectId, 'login').catch(e => e);
    expect(failure).toMatchObject({ status, accessFailure: true }); expect(failure.message).not.toContain('Secret');
  });

  it.each([429, 500, 503])('keeps HTTP%s unavailable, never an empty project or access denial', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Secret arbitrary server detail' }, status)));
    await expect(fetchRoutingCables(projectId, 'login')).rejects.toMatchObject({ code: 'CABLE_SERVICE_FAILED', status, accessFailure: false });
  });

  it.each([202, 204, 206])('rejects HTTP%s instead of accepting a partial/unfinished collection', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ cables: [cable(1)] }, status)));
    await expect(fetchRoutingCables(projectId, 'login')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status, accessFailure: false });
  });

  it('rejects a foreign project, numeric/non-UUID identity, duplicate UUID and malformed nullable source fields', async () => {
    for (const value of [
      { cables: [{ ...cable(1), projectId: id(99) }] }, { cables: [{ ...cable(1), id: 701 }] },
      { cables: [{ ...cable(1), id: 'tag-is-not-identity' }] }, { cables: [cable(1), cable(1)] },
      { cables: [{ ...cable(1), tag: 1 }] }, { cables: [{ ...cable(1), tag: undefined }] },
      { cables: [{ ...cable(1), routing: undefined }] }, { cables: [{ ...cable(1), routing: 1 }] },
      { cables: {} }, { cables: null }, [], null,
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(value)));
      await expect(fetchRoutingCables(projectId, 'login')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', accessFailure: false });
    }
  });

  it('rejects pagination metadata or Content-Range even on HTTP200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ cables: [cable(1)], nextCursor: 'more' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cables: [cable(1)] }), { headers: { 'Content-Type': 'application/json', 'Content-Range': 'items 0-0/41' } })));
    for (let i = 0; i < 2; i++) await expect(fetchRoutingCables(projectId, 'login')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects HTML fallback, malformed JSON and invalid UTF8 without exposing their body', async () => {
    for (const response of [new Response('<html>Secret</html>', { headers: { 'Content-Type': 'text/html' } }),
      new Response('{Secret', { headers: { 'Content-Type': 'application/json' } }),
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } })]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      const error = await fetchRoutingCables(projectId, 'login').catch(e => e);
      expect(error).toMatchObject({ code: 'INVALID_RESPONSE', accessFailure: false }); expect(error.message).not.toContain('Secret');
    }
  });

  it('caps streamed JSON at16MiB and cancels the remaining body', async () => {
    const cancel = vi.fn(); let chunks = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } })));
    await expect(fetchRoutingCables(projectId, 'login')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(chunks).toBeLessThanOrEqual(18); expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds fetch even if a transport ignores abort, and discards/cancels its late success', async () => {
    vi.useFakeTimers(); let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = fetchRoutingCables(projectId, 'login', { timeoutMs: 20 });
    const check = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', accessFailure: false });
    await vi.advanceTimersByTimeAsync(20); await check;
    const response = json({ cables: [cable(1)] }); const cancel = vi.spyOn(response.body!, 'cancel'); finish(response);
    await Promise.resolve(); expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds a stalled body and cancels its reader', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start() { /* No chunks until the deadline. */ }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } })));
    const check = expect(fetchRoutingCables(projectId, 'login', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT', accessFailure: false });
    await vi.advanceTimersByTimeAsync(20); await check; expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps caller cancellation distinct and rejects a success from the retired scope', async () => {
    const abort = new AbortController(), reason = new DOMException('Scope changed', 'AbortError');
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
    const check = expect(fetchRoutingCables(projectId, 'login', { signal: abort.signal })).rejects.toBe(reason);
    abort.abort(reason); await check; finish(json({ cables: [cable(1)] })); await Promise.resolve();
  });

  it('preserves network/body-stream failure as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Secret host detail'))
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error('Secret stream detail')); } }), { headers: { 'Content-Type': 'application/json' } })));
    for (let i = 0; i < 2; i++) await expect(fetchRoutingCables(projectId, 'login')).rejects.toMatchObject({ code: 'NETWORK_ERROR', accessFailure: false });
  });

  it('does not start HTTP for bad project/deadline, absent login or an already-cancelled caller', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(fetchRoutingCables('foreign/path', 'login')).rejects.toBeInstanceOf(RoutingCableApiError);
    for (const timeoutMs of [0, -1, 60_001, Infinity]) await expect(fetchRoutingCables(projectId, 'login', { timeoutMs })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchRoutingCables(projectId, '')).rejects.toMatchObject({ code: 'AUTH_REQUIRED', accessFailure: true });
    const abort = new AbortController(); abort.abort(); await expect(fetchRoutingCables(projectId, 'login', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
