import { afterEach, describe, expect, it, vi } from 'vitest';
import { importCableTypeDefaultMaterials, importCableTypes, importCables } from './cables';
import { importTrays } from './trays';
import {
  importMaterialCableInstallationMaterials,
  importMaterialCableTypes,
  importMaterialInstrumentInstallationMaterials,
  importMaterialInstruments,
  importMaterialLoadCurvePoints,
  importMaterialSupports,
  importMaterialTrayInstallationMaterials,
  importMaterialTrays,
} from './materials';

const imports: [string, (file: File) => Promise<unknown>][] = [
  ['/materials/cable-types/import', (file) => importMaterialCableTypes('token', file)],
  [
    '/materials/cable-installation-materials/import',
    (file) => importMaterialCableInstallationMaterials('token', file),
  ],
  [
    '/materials/tray-installation-materials/import',
    (file) => importMaterialTrayInstallationMaterials('token', file),
  ],
  ['/materials/instruments/import', (file) => importMaterialInstruments('token', file)],
  [
    '/materials/instrument-installation-materials/import',
    (file) => importMaterialInstrumentInstallationMaterials('token', file),
  ],
  ['/materials/trays/import', (file) => importMaterialTrays('token', file)],
  ['/materials/supports/import', (file) => importMaterialSupports('token', file)],
  [
    '/materials/load-curves/curve/import',
    (file) => importMaterialLoadCurvePoints('token', 'curve', file),
  ],
  ['/projects/project/cable-types/import', (file) => importCableTypes('token', 'project', file)],
  ['/projects/project/cables/import', (file) => importCables('token', 'project', file)],
  ['/projects/project/trays/import', (file) => importTrays('token', 'project', file)],
  [
    '/projects/project/cable-types/type/default-materials/import',
    (file) => importCableTypeDefaultMaterials('token', 'project', 'type', file),
  ],
];

afterEach(() => vi.restoreAllMocks());

describe.each(imports)('Excel upload %s', (path, upload) => {
  it('preserves server validation details for the Snackbar', async () => {
    const issues = [{ row: 7, column: 'unit_price', message: 'Must be a non-negative number.' }];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Import cancelled. No data was changed.',
          issues,
          totalIssues: 108,
        }),
        { status: 400 },
      ),
    );
    const file = new File(['workbook'], 'catalog.xlsx');

    await expect(upload(file)).rejects.toMatchObject({
      status: 400,
      message: 'Import cancelled. No data was changed.',
      issues,
      totalIssues: 108,
    });
    expect(fetchMock.mock.calls[0][0]).toEqual(expect.stringContaining(`/api${path}`));
    const options = fetchMock.mock.calls[0][1]!;
    expect(options.headers).toEqual({ Authorization: 'Bearer token' });
    expect((options.body as FormData).get('file')).toBe(file);
  });

  it.each([
    { file: () => new File(['not Excel'], 'catalog.csv'), status: 400, message: '.xlsx' },
    { file: () => new File([], 'empty.xlsx'), status: 400, message: 'empty' },
    {
      file: () => new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.xlsx'),
      status: 413,
      message: '5 MB',
    },
  ])('rejects invalid files locally ($message)', async ({ file, status, message }) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(upload(file())).rejects.toMatchObject({
      status,
      message: expect.stringContaining(message),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Excel upload response handling', () => {
  it('preserves committed row counts when refreshing the result list fails', async () => {
    const summary = { inserted: 3, updated: 2, skipped: 0 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Cable types imported but failed to refresh list',
          summary,
        }),
        { status: 500 },
      ),
    );
    await expect(
      importMaterialCableTypes('token', new File(['workbook'], 'catalog.xlsx')),
    ).rejects.toMatchObject({ status: 500, summary });
  });

  it('accepts uppercase .XLSX and preserves successful import totals', async () => {
    const summary = { inserted: 2, updated: 1, skipped: 0 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ summary, cableTypes: [] })),
    );
    await expect(
      importMaterialCableTypes('token', new File(['workbook'], 'CATALOG.XLSX')),
    ).resolves.toEqual({ summary, cableTypes: [] });
  });

  it('retains upload-limit status for an HTML proxy error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Too large</html>', { status: 413 }),
    );
    await expect(
      importMaterialCableTypes('token', new File(['workbook'], 'catalog.xlsx')),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('ignores malformed issue records without hiding valid issues', async () => {
    const issue = { row: 4, column: 'name', message: 'Required.' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Invalid data',
          issues: [null, { row: '4' }, issue],
          totalIssues: 'invalid',
        }),
        { status: 400 },
      ),
    );
    await expect(
      importMaterialCableTypes('token', new File(['workbook'], 'catalog.xlsx')),
    ).rejects.toMatchObject({ issues: [issue] });
  });
});
