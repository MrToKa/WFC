import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPreparerSession, revokePreparerSession, validatedPreparerUrl } from './preparer';
afterEach(() => vi.restoreAllMocks());
describe('preparer browser entry', () => {
  it('sends current WFC token only to the same-origin gateway and an empty request body', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ url: 'http://127.0.0.1:5193' })));
    expect(await openPreparerSession('PRIVATE_WFC_TOKEN')).toEqual({ url: 'http://127.0.0.1:5193' });
    expect(fetcher).toHaveBeenCalledWith('/api/preparer/session', expect.objectContaining({ method: 'POST', body: '{}', headers: { Authorization: 'Bearer PRIVATE_WFC_TOKEN', 'Content-Type': 'application/json' }, credentials: 'same-origin', redirect: 'error', cache: 'no-store' }));
  });
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
