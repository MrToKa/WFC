import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialCableInstallationMaterial } from '@/api/client';
import { MasterMaterialDetailsPage } from './MasterMaterialDetailsPage';

const mocks = vi.hoisted(() => ({
  fetchDetails: vi.fn(),
  fetchCableInstallationMaterials: vi.fn(),
  fetchTrayInstallationMaterials: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchMaterialDetails: mocks.fetchDetails,
  fetchMaterialCableInstallationMaterials: mocks.fetchCableInstallationMaterials,
  fetchMaterialTrayInstallationMaterials: mocks.fetchTrayInstallationMaterials,
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

const renderDetails = (category: 'cable-installation-material' | 'tray-installation-material') => {
  const isTray = category === 'tray-installation-material';
  const segment = isTray ? 'tray-installation-materials' : 'cable-installation-materials';
  const idParam = isTray ? 'trayInstallationMaterialId' : 'cableInstallationMaterialId';

  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[`/materials/${segment}/${ownerId}`]}>
        <Routes>
          <Route
            path={`/materials/${segment}/:${idParam}`}
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
});
