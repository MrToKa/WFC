import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPreparerSession, revokePreparerSession, validatedPreparerUrl } from './preparer';
afterEach(() => vi.restoreAllMocks());
describe('preparer browser entry', () => {
  it.each(['http://127.0.0.1:5193', 'http://192.168.5.55:8083'])('opens %s through the same-origin gateway with the current token and empty body', async url => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ url })));
    expect(await openPreparerSession('PRIVATE_WFC_TOKEN')).toEqual({ url });
    expect(fetcher).toHaveBeenCalledWith('/api/preparer/session', expect.objectContaining({ method: 'POST', body: '{}', headers: { Authorization: 'Bearer PRIVATE_WFC_TOKEN', 'Content-Type': 'application/json' }, credentials: 'same-origin', redirect: 'error', cache: 'no-store' }));
  });
  it.each(['http://user:password@192.168.5.55:8083', 'http://192.168.5.55:8083/path', 'http://192.168.5.55:8083/', 'http://192.168.5.55:8083?token=secret', 'http://192.168.5.55:8083#fragment', 'ftp://192.168.5.55:8083'])('preserves strict destination validation on port 8083: %s', value => expect(() => validatedPreparerUrl(value)).toThrow());
  it.each(['http://127.0.0.1:5191', 'http://127.0.0.1:5192', 'https://secret@preparer.example.test:5193', 'http://127.0.0.1:5193/?token=secret', 'javascript:alert(1)', 'http://127.0.0.1:5193/'])('refuses an unexpected browser destination %s', value => expect(() => validatedPreparerUrl(value)).toThrow());
  it('rejects unexpected response fields and displays the actionable safe gateway error', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ url: 'http://127.0.0.1:5193', token: 'unexpected' }))).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'The model preparer is not configured.' }), { status: 503 }));
    await expect(openPreparerSession('fixture')).rejects.toThrow('invalid response'); await expect(openPreparerSession('fixture')).rejects.toThrow('not configured'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('logout captures only the old WFC token, stays bounded and never throws on offline', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 200 })).mockRejectedValueOnce(new TypeError('Offline'));
    expect(await revokePreparerSession('old-token')).toBe(true); expect(await revokePreparerSession('old-token')).toBe(false);
    expect(fetcher).toHaveBeenCalledWith('/api/preparer/session', expect.objectContaining({ method: 'DELETE', headers: { Authorization: 'Bearer old-token' }, keepalive: true, credentials: 'same-origin', redirect: 'error', cache: 'no-store' }));
  });
});
