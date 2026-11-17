import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCableObstacleLinks } from './cableObstacleLinks';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const value = { schemaVersion: 'wfc.pf.cable-obstacle-links.v1', projectId: id(1), cableId: id(2),
  cableWriteRevision: '3', remarks: null, status: 'none', source: null, scope: null, obstacles: [] };
afterEach(() => vi.unstubAllGlobals());
describe('saved cable obstacle reference read', () => {
  it('uses an authenticated cancellable GET without browser caching', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(value))); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    await expect(fetchCableObstacleLinks(id(1), id(2), 'test-token', controller.signal)).resolves.toEqual(value);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/projects/${id(1)}/cables/${id(2)}/obstacle-links`),
      expect.objectContaining({ signal: controller.signal, cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer test-token' } }));
  });
  it.each([{ ...value, cableId: id(9) }, { ...value, projectId: id(9) }, { ...value, scope: { dbId: 18 } }])('rejects mismatched or malformed references', async response => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
    await expect(fetchCableObstacleLinks(id(1), id(2), 'test-token', new AbortController().signal)).rejects.toThrow(/could not be read|cable changed/);
  });
  it('keeps an HTTP refusal visible instead of producing a target', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    await expect(fetchCableObstacleLinks(id(1), id(2), 'test-token', new AbortController().signal)).rejects.toThrow('could not be read');
  });
});
