import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareAssignedCadNetwork } from './cadNetworkPreparation';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), modelId = id(2), artifactId = id(3), designId = id(4), snapshot = 'a'.repeat(64);
const design = { id: designId, modelVersionId: modelId, activeModel: true, status: 'proposed' };
const receipt = { artifactId, snapshotSha256: snapshot, publishedCount: 1, revalidatedCount: 1, routeCount: 2, duplicate: false };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());
describe('assigned CAD network preparation', () => {
  it('uses the proposed active design for the exact current model and pins the prepared artifact', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ designs: [
      { ...design, id: id(5), modelVersionId: id(9) }, { ...design, id: id(6), status: 'archived' }, design,
    ] })).mockResolvedValueOnce(response(receipt));
    vi.stubGlobal('fetch', fetch);
    await expect(prepareAssignedCadNetwork(projectId, 'login', modelId, artifactId, snapshot)).resolves.toEqual(receipt);
    expect(fetch.mock.calls[1][0]).toContain(`/designs/${designId}/prepare-network`);
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer login' },
      body: JSON.stringify({ expectedArtifactId: artifactId, expectedSnapshotSha256: snapshot }) });
  });
  it.each([[], [{ ...design, activeModel: false }], [{ ...design, modelVersionId: id(9) }], [design, { ...design, id: id(5) }]].map(designs => ({ designs })))('refuses an unavailable or ambiguous exact model design', async ({ designs }) => {
    const fetch = vi.fn().mockResolvedValue(response({ designs })); vi.stubGlobal('fetch', fetch);
    await expect(prepareAssignedCadNetwork(projectId, 'login', modelId, artifactId, snapshot)).rejects.toMatchObject({ code: 'CAD_NETWORK_DESIGN_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not accept a receipt for a different base', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ designs: [design] })).mockResolvedValueOnce(response({ ...receipt, artifactId: id(9) })));
    await expect(prepareAssignedCadNetwork(projectId, 'login', modelId, artifactId, snapshot)).rejects.toMatchObject({ code: 'CAD_NETWORK_RESPONSE_INVALID' });
  });
  it('keeps the current server refusal visible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ designs: [design] })).mockResolvedValueOnce(response({ code: 'CAD_ROUTE_BASE_CHANGED', message: 'The current network changed.' }, 409)));
    await expect(prepareAssignedCadNetwork(projectId, 'login', modelId, artifactId, snapshot)).rejects.toMatchObject({ code: 'CAD_ROUTE_BASE_CHANGED', outcome: 'refused', message: 'The current network changed.' });
  });
  it('retains an unreadable gateway failure as an uncertain command with its HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ designs: [design] }))
      .mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(prepareAssignedCadNetwork(projectId, 'login', modelId, artifactId, snapshot))
      .rejects.toMatchObject({ code: 'CAD_NETWORK_RESPONSE_UNREADABLE', status: 502, outcome: 'unknown', message: expect.stringContaining('HTTP 502') });
  });
  it('honors cancellation before starting any request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const abort = new AbortController(); abort.abort();
    await expect(prepareAssignedCadNetwork(projectId, 'login', modelId, artifactId, snapshot, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
