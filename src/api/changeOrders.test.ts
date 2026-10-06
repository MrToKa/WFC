import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildChangeOrderExportFileName,
  exportChangeOrder,
  fetchChangeOrder,
  fetchChangeOrders,
} from './changeOrders';

afterEach(() => vi.restoreAllMocks());

describe('Change Order export filename', () => {
  it('uses the Change Order title in the client fallback filename', () => {
    expect(buildChangeOrderExportFileName('GDS ESD cables', 'Change order', '01')).toBe(
      'Change order - GDS ESD cables - Rev. 01.xlsx',
    );
    expect(buildChangeOrderExportFileName('  Area 1: cable/order  ', 'Change order', '00')).toBe(
      'Change order - Area 1 cable order - Rev. 00.xlsx',
    );
  });

  it('supports the Internal NCR export filename', () => {
    expect(buildChangeOrderExportFileName('Cable damage', 'Internal NCR', '02')).toBe(
      'Internal NCR - Cable damage - Rev. 02.xlsx',
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

describe.each(['change-orders', 'internal-ncrs'] as const)('%s revision requests', (collection) => {
  it('loads the newest document without a revision query by default', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ changeOrder: {} }),
    } as Response);

    await fetchChangeOrder('token', 'project-id', 'order-id', collection);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/api/projects/project-id/${collection}/order-id$`)),
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
    );
  });

  it('encodes the selected revision when loading document details', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ changeOrder: {} }),
    } as Response);

    await fetchChangeOrder('token', 'project-id', 'order-id', collection, 'Rev 1+/&?');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/projects/project-id/${collection}/order-id?revision=Rev%201%2B%2F%26%3F`,
      ),
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
    );
  });

  it.each([undefined, 'Rev 1+/&?'])('exports the requested revision %s', async (revision) => {
    const blob = new Blob(['workbook']);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: async () => blob,
    } as Response);

    const response = await exportChangeOrder(
      'token',
      'project-id',
      'order-id',
      'Cable damage',
      collection,
      revision,
    );

    const query = revision === undefined ? '' : '?revision=Rev%201%2B%2F%26%3F';
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining(`/api/projects/project-id/${collection}/order-id/export${query}`),
    );
    if (revision === undefined) expect(fetchMock.mock.calls[0]?.[0]).not.toContain('?');
    expect(response.blob).toBe(blob);
    expect(response.fileName).toBe(
      `${collection === 'internal-ncrs' ? 'Internal NCR' : 'Change order'} - Cable damage${revision === undefined ? '' : ' - Rev. Rev 1+ &'}.xlsx`,
    );
  });
});
