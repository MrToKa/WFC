import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MaterialCableInstallationMaterial,
  StandardMaterialOwnerCategory,
} from '@/api/client';
import { MasterMaterialDetailsPage } from './MasterMaterialDetailsPage';
import { MATERIAL_DETAILS_CAPABILITIES } from './materialCapabilities';

const mocks = vi.hoisted(() => ({
  fetchDetails: vi.fn(),
  fetchCableInstallationMaterials: vi.fn(),
  fetchTrayInstallationMaterials: vi.fn(),
  fetchInstrumentInstallationMaterials: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchMaterialDetails: mocks.fetchDetails,
  fetchMaterialCableInstallationMaterials: mocks.fetchCableInstallationMaterials,
  fetchMaterialTrayInstallationMaterials: mocks.fetchTrayInstallationMaterials,
  fetchMaterialInstrumentInstallationMaterials: mocks.fetchInstrumentInstallationMaterials,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { isAdmin: true }, token: 'token' }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const material = (id: string, type: string): MaterialCableInstallationMaterial => ({
  id,
  type,
  purpose: null,
  material: null,
  description: null,
  manufacturer: null,
  partNo: null,
  dimensionMm: null,
  weightKg: null,
  minimumOrderQuantity: 1,
  orderMeasurement: 'pcs',
  packaging: 'pcs',
  unitPrice: 0,
  source: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const ownerMaterial = material(ownerId, 'Owner material');
const otherMaterial = material(otherId, 'Selectable material');

const renderDetails = (category: StandardMaterialOwnerCategory) => {
  const route = MATERIAL_DETAILS_CAPABILITIES[category].route;
  const idParam = 'materialId';

  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[route(ownerId)]}>
        <Routes>
          <Route
            path={route(`:${idParam}`)}
            element={
              <MasterMaterialDetailsPage<MaterialCableInstallationMaterial>
                category={category}
                idParam={idParam}
                getTitle={(item) => item.type}
                getProperties={() => []}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
};

describe('MasterMaterialDetailsPage Standard Material catalogs', () => {
  beforeEach(() => {
    mocks.fetchDetails.mockReset();
    mocks.fetchCableInstallationMaterials.mockReset();
    mocks.fetchTrayInstallationMaterials.mockReset();
    mocks.fetchInstrumentInstallationMaterials.mockReset();
    mocks.showToast.mockReset();
    mocks.fetchDetails.mockResolvedValue({
      category: {
        key: 'tray-installation-material',
        label: 'Installation material',
        supportsStandardMaterials: true,
      },
      material: ownerMaterial,
      standardMaterials: [],
    });
    mocks.fetchCableInstallationMaterials.mockResolvedValue({
      cableInstallationMaterials: [ownerMaterial, otherMaterial],
    });
    mocks.fetchTrayInstallationMaterials.mockResolvedValue({
      trayInstallationMaterials: [ownerMaterial, otherMaterial],
    });
    mocks.fetchInstrumentInstallationMaterials.mockResolvedValue({
      instrumentInstallationMaterials: [ownerMaterial, otherMaterial],
    });
  });

  it('uses the tray installation catalog and excludes the owner on tray details', async () => {
    renderDetails('tray-installation-material');

    await waitFor(() => expect(mocks.fetchTrayInstallationMaterials).toHaveBeenCalledOnce());
    expect(mocks.fetchCableInstallationMaterials).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Standard Material' }));

    expect(await screen.findByRole('combobox', { name: 'Tray Installation Material' })).toHaveValue(
      otherId,
    );
    expect(screen.queryByRole('option', { name: 'Owner material' })).not.toBeInTheDocument();
  });

  it('keeps the cable installation catalog and excludes the owner on cable details', async () => {
    renderDetails('cable-installation-material');

    await waitFor(() => expect(mocks.fetchCableInstallationMaterials).toHaveBeenCalledOnce());
    expect(mocks.fetchTrayInstallationMaterials).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Standard Material' }));

    expect(
      await screen.findByRole('combobox', { name: 'Cable Installation Material' }),
    ).toHaveValue(otherId);
    expect(screen.queryByRole('option', { name: 'Owner material' })).not.toBeInTheDocument();
  });

  it.each(['instrument', 'instrument-installation-material'] as const)(
    'uses instrument installation materials for %s Standard Materials',
    async (category) => {
      renderDetails(category);

      await waitFor(() =>
        expect(mocks.fetchInstrumentInstallationMaterials).toHaveBeenCalledOnce(),
      );
      expect(mocks.fetchCableInstallationMaterials).not.toHaveBeenCalled();
      expect(mocks.fetchTrayInstallationMaterials).not.toHaveBeenCalled();
      expect(mocks.fetchDetails).toHaveBeenCalledWith(category, ownerId);

      fireEvent.click(await screen.findByRole('button', { name: 'Add Standard Material' }));

      const picker = await screen.findByRole('combobox', {
        name: 'Instrument Installation Material',
      });
      expect(picker).toHaveValue(category === 'instrument' ? ownerId : otherId);
      if (category === 'instrument') {
        // The catalogs are separate: a matching ID is still a valid reference.
        expect(screen.getByRole('option', { name: 'Owner material' })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole('option', { name: 'Owner material' })).not.toBeInTheDocument();
      }
    },
  );
});
