import { afterEach, expect, it, vi } from 'vitest';
import { exportCables, importCables, fetchCableRows } from './cables';

afterEach(() => vi.unstubAllGlobals());

it('reads only selected actual cable records without deriving Routing or Design from a proposal', async () => {
  const project = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222';
  const row = { id, projectId: project, routing: '/B002/SECONDARY', designLength: 122, autoCalculatedLength: 122, cableWriteRevision: '16' };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cables: [row] }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(fetchCableRows(project, [id])).resolves.toEqual({ cables: [row] });
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get('ids')).toBe(id);
});
it.each([[], Array(101).fill('22222222-2222-4222-8222-222222222222'), ['bad'], ['22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222']].map(ids => [ids] as const))('refuses invalid visible cable row scopes before network: %j', async ids => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(fetchCableRows('11111111-1111-4111-8111-111111111111', ids)).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  [{}, {}],
  [{preview:true}, {preview:'true'}],
  [{preview:true,protectRouting:true}, {preview:'true',protectRouting:'true'}],
  [{protectRouting:true,expectedRevisionDigest:'a'.repeat(64)}, {protectRouting:'true',expectedRevisionDigest:'a'.repeat(64)}],
])('sends explicit import intentions and the unchanged workbook: %j', async (options, query) => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({summary:{inserted:0,updated:0,skipped:0},cables:[]}),{headers:{'Content-Type':'application/json'}}));
  vi.stubGlobal('fetch',fetch);
  await importCables('token','project',new File(['workbook'],'cables.xlsx'),options);
  expect(Object.fromEntries(new URL(fetch.mock.calls[0][0]).searchParams)).toEqual(query);
  expect(fetch.mock.calls[0][1].body).toBeInstanceOf(FormData);
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
});

it('sends selected columns alongside the unchanged cable filter and sort options', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('workbook'));
  vi.stubGlobal('fetch', fetch);
  await exportCables('token', 'project', {
    view: 'list',
    columns: ['tag', 'designLength', 'actions'],
    filterText: ' TRAY-01 ',
    criteria: 'routing',
    cableTypeId: 'type-1',
    mto: 'LV',
    sortColumn: 'tag',
    sortDirection: 'desc',
  });
  const url = new URL(fetch.mock.calls[0][0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    view: 'list',
    columns: 'tag,designLength,actions',
    filter: 'TRAY-01',
    criteria: 'routing',
    cableTypeId: 'type-1',
    mto: 'LV',
    sortColumn: 'tag',
    sortDirection: 'desc',
  });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
});
