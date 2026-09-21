import { afterEach, expect, it, vi } from 'vitest';
import { exportCables } from './cables';

afterEach(() => vi.unstubAllGlobals());

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
