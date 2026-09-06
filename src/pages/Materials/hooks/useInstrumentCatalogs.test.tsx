import type { ChangeEvent, FormEvent } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialInstrument } from '@/api/client';
import { CABLE_TYPES_PER_PAGE } from '../../ProjectDetails.forms';
import {
  useInstruments,
  useInstrumentInstallationMaterials,
} from './useCableInstallationMaterials';

const mocks = vi.hoisted(() => {
  const catalog = () => ({
    fetch: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    import: vi.fn(),
    export: vi.fn(),
    template: vi.fn(),
  });
  return { instruments: catalog(), installation: catalog(), download: vi.fn() };
});

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchMaterialInstruments: mocks.instruments.fetch,
  createMaterialInstrument: mocks.instruments.create,
  updateMaterialInstrument: mocks.instruments.update,
  deleteMaterialInstrument: mocks.instruments.remove,
  importMaterialInstruments: mocks.instruments.import,
  exportMaterialInstruments: mocks.instruments.export,
  getMaterialInstrumentsTemplate: mocks.instruments.template,
  fetchMaterialInstrumentInstallationMaterials: mocks.installation.fetch,
  createMaterialInstrumentInstallationMaterial: mocks.installation.create,
  updateMaterialInstrumentInstallationMaterial: mocks.installation.update,
  deleteMaterialInstrumentInstallationMaterial: mocks.installation.remove,
  importMaterialInstrumentInstallationMaterials: mocks.installation.import,
  exportMaterialInstrumentInstallationMaterials: mocks.installation.export,
  getMaterialInstrumentInstallationMaterialsTemplate: mocks.installation.template,
}));

vi.mock('../Materials.utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../Materials.utils')>()),
  downloadBlob: mocks.download,
}));

const material: MaterialInstrument = {
  id: 'material-1',
  type: 'Pressure transmitter',
  purpose: 'Measurement',
  material: 'Steel',
  description: 'Pressure sensor',
  manufacturer: 'Supplier',
  partNo: 'PT-100',
  dimensionMm: '30 x 40',
  weightKg: 0.5,
  minimumOrderQuantity: 1,
  orderMeasurement: 'pcs',
  packaging: 'Box',
  unitPrice: 12.5,
  source: 'https://example.com/pt-100',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const submitEvent = () => ({ preventDefault: vi.fn() }) as unknown as FormEvent<HTMLFormElement>;
const changeEvent = {} as ChangeEvent<HTMLInputElement>;
const configs = [
  {
    name: 'instruments',
    useCatalog: useInstruments,
    api: mocks.instruments,
    other: mocks.installation,
    singularKey: 'instrument',
    pluralKey: 'instruments',
    fileStem: 'materials-instruments',
  },
  {
    name: 'instrument installation materials',
    useCatalog: useInstrumentInstallationMaterials,
    api: mocks.installation,
    other: mocks.instruments,
    singularKey: 'instrumentInstallationMaterial',
    pluralKey: 'instrumentInstallationMaterials',
    fileStem: 'materials-instrument-installation-materials',
  },
] as const;

describe.each(configs)(
  '$name catalog',
  ({ useCatalog, api, other, singularKey, pluralKey, fileStem }) => {
    beforeEach(() => {
      vi.clearAllMocks();
      api.fetch.mockResolvedValue({ [pluralKey]: [material] });
      api.create.mockResolvedValue({
        [singularKey]: { ...material, id: 'created', type: 'New material' },
      });
      api.update.mockResolvedValue({ [singularKey]: { ...material, type: 'Updated material' } });
      api.remove.mockResolvedValue(undefined);
      api.import.mockResolvedValue({
        [pluralKey]: [{ ...material, id: 'imported', type: 'Imported material' }],
        summary: { inserted: 1, updated: 0, skipped: 0 },
      });
      api.export.mockResolvedValue(new Blob(['export']));
      api.template.mockResolvedValue(new Blob(['template']));
    });

    afterEach(() => vi.restoreAllMocks());

    it('loads, filters and pages its own catalog', async () => {
      api.fetch.mockResolvedValue({
        [pluralKey]: [
          ...Array.from({ length: CABLE_TYPES_PER_PAGE + 1 }, (_, index) => ({
            ...material,
            id: `sensor-${index}`,
            type: `Sensor ${String(index).padStart(3, '0')}`,
          })),
          { ...material, id: 'support', type: 'Instrument bracket', purpose: 'Installation' },
        ],
      });
      const { result } = renderHook(() =>
        useCatalog({ token: 'token', isAdmin: true, showToast: vi.fn() }),
      );
      await waitFor(() => expect(result.current.cableInstallationMaterialsLoading).toBe(false));
      expect(other.fetch).not.toHaveBeenCalled();
      expect(result.current.showCableInstallationMaterialPagination).toBe(true);
      expect(result.current.pagedCableInstallationMaterials).toHaveLength(CABLE_TYPES_PER_PAGE);
      act(() => result.current.goToNextPage());
      expect(result.current.cableInstallationMaterialPage).toBe(2);
      act(() => result.current.setPurposeFilter('Measurement'));
      act(() => result.current.setSearchText('Sensor 000'));
      expect(result.current.cableInstallationMaterialPage).toBe(1);
      expect(result.current.pagedCableInstallationMaterials.map((item) => item.type)).toEqual([
        'Sensor 000',
      ]);
    });

    it('creates, edits and deletes using only its own catalog endpoints', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { result } = renderHook(() =>
        useCatalog({ token: 'token', isAdmin: true, showToast: vi.fn() }),
      );
      await waitFor(() => expect(result.current.cableInstallationMaterialsLoading).toBe(false));
      act(() => result.current.openCreateCableInstallationMaterialDialog());
      act(() =>
        result.current.cableInstallationMaterialDialog.handleFieldChange('type')(changeEvent, {
          value: 'New material',
        }),
      );
      await act(async () =>
        result.current.cableInstallationMaterialDialog.handleSubmit(submitEvent()),
      );
      expect(api.create).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({ type: 'New material' }),
      );
      expect(result.current.cableInstallationMaterials.some((item) => item.id === 'created')).toBe(
        true,
      );

      act(() => result.current.openEditCableInstallationMaterialDialog(material));
      act(() =>
        result.current.cableInstallationMaterialDialog.handleFieldChange('type')(changeEvent, {
          value: 'Updated material',
        }),
      );
      await act(async () =>
        result.current.cableInstallationMaterialDialog.handleSubmit(submitEvent()),
      );
      expect(api.update).toHaveBeenCalledWith(
        'token',
        material.id,
        expect.objectContaining({
          type: 'Updated material',
          partNo: 'PT-100',
          unitPrice: 12.5,
          dimensionMm: '30 x 40',
        }),
      );
      expect(
        result.current.cableInstallationMaterials.find((item) => item.id === material.id)?.type,
      ).toBe('Updated material');

      await act(async () => result.current.handleDeleteCableInstallationMaterial(material));
      expect(api.remove).toHaveBeenCalledWith('token', material.id);
      expect(result.current.cableInstallationMaterials.map((item) => item.id)).toEqual(['created']);
      expect(other.create).not.toHaveBeenCalled();
      expect(other.update).not.toHaveBeenCalled();
      expect(other.remove).not.toHaveBeenCalled();
    });

    it('imports Excel results and downloads category-specific exports and templates', async () => {
      const { result } = renderHook(() =>
        useCatalog({ token: 'token', isAdmin: true, showToast: vi.fn() }),
      );
      await waitFor(() => expect(result.current.cableInstallationMaterialsLoading).toBe(false));
      const file = new File(['workbook'], 'materials.xlsx');
      const fileEvent = {
        target: { files: [file], value: 'materials.xlsx' },
      } as unknown as ChangeEvent<HTMLInputElement>;
      await act(async () => result.current.handleImportCableInstallationMaterials(fileEvent));
      expect(api.import).toHaveBeenCalledWith('token', file);
      expect(result.current.pagedCableInstallationMaterials.map((item) => item.id)).toEqual([
        'imported',
      ]);
      expect(fileEvent.target.value).toBe('');

      await act(async () => result.current.handleExportCableInstallationMaterials());
      expect(api.export).toHaveBeenCalledWith('token');
      expect(mocks.download).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringMatching(new RegExp(`^${fileStem}.*\\.xlsx$`)),
      );
      await act(async () => result.current.handleGetCableInstallationMaterialsTemplate());
      expect(api.template).toHaveBeenCalledWith('token');
      expect(mocks.download).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringMatching(new RegExp(`^${fileStem}-template.*\\.xlsx$`)),
      );
      expect(other.import).not.toHaveBeenCalled();
      expect(other.export).not.toHaveBeenCalled();
      expect(other.template).not.toHaveBeenCalled();
    });
  },
);
