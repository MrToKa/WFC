import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRoutingTrays, RoutingTrayApiError } from './routingTrays';

const projectId = '11111111-1111-4111-8111-111111111111';
const id = (number: number) => `22222222-2222-4222-8222-${String(number).padStart(12, '0')}`;
const tray = (number: number, name = `TRAY-${number}`) => ({ id: id(number), projectId, name, type: null, privateExtra: 'discard' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

describe('manual routing full project tray adapter', () => {
  it('uses the explicit current token and full endpoint, never pagination, search, stored login or a mutation', async () => {
    localStorage.setItem('wfc_auth_token', 'different-stored-token');
    const fetch = vi.fn().mockResolvedValue(json({ trays: Array.from({ length: 31 }, (_, i) => tray(i)) })); vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    const result = await fetchRoutingTrays(projectId, 'current-token', { signal });
    expect(fetch).toHaveBeenCalledOnce(); const [url, options] = fetch.mock.calls[0];
    expect(new URL(url, location.origin).pathname).toBe(`/api/projects/${projectId}/trays`);
    expect(new URL(url, location.origin).search).toBe('');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: { Authorization: 'Bearer current-token' } });
    expect(options.signal).toBeInstanceOf(AbortSignal); expect(options.body).toBeUndefined();
    expect(result).toHaveLength(31); expect(result[30]).toEqual({ id: id(30), projectId, name: 'TRAY-30' });
  });

  it('keeps NFKC collisions and exact raw names for the parent index, and accepts an empty full list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ trays: [tray(1, 'BC001'), tray(2, 'ＢＣ００１')] })).mockResolvedValueOnce(json({ trays: [] })));
    expect((await fetchRoutingTrays(projectId, 'legacy-token')).map(t => t.name)).toEqual(['BC001', 'ＢＣ００１']);
    expect(await fetchRoutingTrays(projectId, 'legacy-token')).toEqual([]);
  });

  it.each([401, 403, 404])('treats HTTP%s as terminal project access failure without relying on server text', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('arbitrary proxy text', { status })));
    await expect(fetchRoutingTrays(projectId, 'token')).rejects.toMatchObject({ status, accessFailure: true });
  });

  it.each([429, 500, 503])('treats HTTP%s as unavailable, never project missing', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Secret server detail' }, status)));
    await expect(fetchRoutingTrays(projectId, 'token')).rejects.toMatchObject({ code: 'TRAY_SERVICE_FAILED', status, accessFailure: false });
  });

  it('rejects foreign project rows, duplicate IDs and malformed DTOs instead of reporting false missing trays', async () => {
    for (const value of [{ trays: [{ ...tray(1), projectId: id(999) }] }, { trays: [tray(1), tray(1)] }, { trays: [{ ...tray(1), id: 'not-a-uuid' }] }, { trays: [{ ...tray(1), name: null }] }, { trays: {} }, []]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(value)));
      await expect(fetchRoutingTrays(projectId, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', accessFailure: false });
    }
  });

  it.each([202, 206])('rejects HTTP%s as an incomplete collection, even when the DTO has the expected shape', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ trays: [tray(1)] }, status)));
    await expect(fetchRoutingTrays(projectId, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status, accessFailure: false });
  });

  it('rejects a success HTML fallback or malformed JSON and preserves network failure as unavailable', async () => {
    for (const response of [new Response('<html>SPA</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('{', { headers: { 'Content-Type': 'application/json' } })]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response)); await expect(fetchRoutingTrays(projectId, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', accessFailure: false });
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(fetchRoutingTrays(projectId, 'token')).rejects.toMatchObject({ code: 'NETWORK_ERROR', accessFailure: false });
  });

  it('bounds a slow response and distinguishes a timeout from access denial', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => { options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); })));
    const pending = fetchRoutingTrays(projectId, 'token', { timeoutMs: 20 });
    const check = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', accessFailure: false });
    await vi.advanceTimersByTimeAsync(20); await check;
  });

  it('forwards caller cancellation and refuses a late success even when transport ignored abort', async () => {
    let resolve!: (value: Response) => void;
    const controller = new AbortController(), reason = new DOMException('Scope changed', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(yes => { resolve = yes; })));
    const pending = fetchRoutingTrays(projectId, 'token', { signal: controller.signal });
    controller.abort(reason); resolve(json({ trays: [tray(1)] }));
    await expect(pending).rejects.toBe(reason);
  });

  it('does not start HTTP for invalid identity, invalid deadline, absent login or an already cancelled scope', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(fetchRoutingTrays('foreign/path', 'token')).rejects.toBeInstanceOf(RoutingTrayApiError);
    await expect(fetchRoutingTrays(projectId, 'token', { timeoutMs: 0 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchRoutingTrays(projectId, '')).rejects.toMatchObject({ code: 'AUTH_REQUIRED', accessFailure: true });
    const abort = new AbortController(); abort.abort(); await expect(fetchRoutingTrays(projectId, 'token', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
