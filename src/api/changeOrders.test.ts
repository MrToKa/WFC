import { describe, expect, it, vi } from 'vitest';
import { buildChangeOrderExportFileName, fetchChangeOrders } from './changeOrders';

describe('Change Order export filename', () => {
  it('uses the Change Order title in the client fallback filename', () => {
    expect(buildChangeOrderExportFileName('GDS ESD cables')).toBe(
      'Change order - GDS ESD cables.xlsx',
    );
    expect(buildChangeOrderExportFileName('  Area 1: cable/order  ')).toBe(
      'Change order - Area 1 cable order.xlsx',
    );
  });

  it('supports the Internal NCR export filename', () => {
    expect(buildChangeOrderExportFileName('Cable damage', 'Internal NCR')).toBe(
      'Internal NCR - Cable damage.xlsx',
    );
  });

  it('uses the independent Internal NCR API collection', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ changeOrders: [] }),
    } as Response);

    await fetchChangeOrders('token', 'project-id', 'internal-ncrs');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/projects\/project-id\/internal-ncrs$/),
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer token' },
      }),
    );
    fetchMock.mockRestore();
  });
});
