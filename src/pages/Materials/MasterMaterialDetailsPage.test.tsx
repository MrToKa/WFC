import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  fetchCableTypes: vi.fn(),
  create: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchMaterialChangeLog: vi.fn().mockResolvedValue({ changeLog: [] }),
  fetchMaterialDetails: mocks.fetchDetails,
  fetchMaterialCableTypes: mocks.fetchCableTypes,
  createStandardMaterial: mocks.create,
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

const openAddDialog = async () => {
  const button = await screen.findByRole('button', { name: 'Add Standard Material' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByLabelText('Material category')).toBeInTheDocument());
};

describe('MasterMaterialDetailsPage Standard Material catalogs', { timeout: 30000 }, () => {
  beforeEach(() => {
    mocks.fetchDetails.mockReset();
    mocks.fetchCableInstallationMaterials.mockReset();
    mocks.fetchTrayInstallationMaterials.mockReset();
    mocks.fetchInstrumentInstallationMaterials.mockReset();
    mocks.showToast.mockReset();
    mocks.fetchCableTypes
      .mockReset()
      .mockResolvedValue({ cableTypes: [{ ...otherMaterial, name: 'Power cable' }] });
    mocks.create.mockReset().mockResolvedValue({});
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

    await openAddDialog();

    expect(screen.getByLabelText('Tray Installation Material')).toHaveValue(otherId);
    expect(screen.queryByText('Owner material', { selector: 'option' })).not.toBeInTheDocument();
  });

  it('keeps the cable installation catalog and excludes the owner on cable details', async () => {
    renderDetails('cable-installation-material');

    await waitFor(() => expect(mocks.fetchCableInstallationMaterials).toHaveBeenCalledOnce());
    expect(mocks.fetchTrayInstallationMaterials).not.toHaveBeenCalled();

    await openAddDialog();

    expect(screen.getByLabelText('Cable Installation Material')).toHaveValue(otherId);
    expect(screen.queryByText('Owner material', { selector: 'option' })).not.toBeInTheDocument();
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

      await openAddDialog();

      const picker = await screen.findByLabelText('Instrument Installation Material');
      expect(picker).toHaveValue(category === 'instrument' ? ownerId : otherId);
      if (category === 'instrument') {
        // The catalogs are separate: a matching ID is still a valid reference.
        expect(screen.getByText('Owner material', { selector: 'option' })).toBeInTheDocument();
      } else {
        expect(
          screen.queryByText('Owner material', { selector: 'option' }),
        ).not.toBeInTheDocument();
      }
    },
  );

  it.each(['tray', 'support'] as const)(
    'defaults %s to Trays installation materials',
    async (category) => {
      renderDetails(category);
      await openAddDialog();
      expect(screen.getByLabelText('Material category')).toHaveValue('tray-installation-material');
    },
  );

  it('switches catalogs, preserves quantity, and saves the selected category', async () => {
    renderDetails('cable-type');
    await openAddDialog();
    expect(screen.getByLabelText('Material category')).toHaveValue('cable-installation-material');
    expect(screen.getByLabelText('Material category').querySelectorAll('option')).toHaveLength(7);
    fireEvent.change(screen.getByLabelText('Quantity'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('Material category'), {
      target: { value: 'cable-type' },
    });
    await screen.findByText('Power cable', { selector: 'option' });
    expect(screen.queryByText('Owner material', { selector: 'option' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Quantity')).toHaveValue(3);
    await waitFor(() => expect(screen.getByLabelText('Cable Type')).toHaveValue(otherId));
    await waitFor(() => expect(screen.getByText('Save', { selector: 'button' })).toBeEnabled());
    fireEvent.click(screen.getByText('Save', { selector: 'button' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith('token', 'cable-type', ownerId, {
        referencedMaterialCategory: 'cable-type',
        referencedMaterialId: otherId,
        quantity: 3,
        unit: 'pcs',
        remarks: null,
      }),
    );
    await openAddDialog();
    expect(screen.getByLabelText('Material category')).toHaveValue('cable-installation-material');
  });
  it('ignores a previous category response after switching again', async () => {
    let resolveTray!: (value: unknown) => void;
    mocks.fetchTrayInstallationMaterials.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTray = resolve;
        }),
    );
    renderDetails('cable-type');
    await openAddDialog();
    fireEvent.change(screen.getByLabelText('Material category'), {
      target: { value: 'tray-installation-material' },
    });
    expect(screen.getByText('Save', { selector: 'button' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Material category'), {
      target: { value: 'cable-type' },
    });
    await screen.findByText('Power cable', { selector: 'option' });
    await act(async () => {
      resolveTray({ trayInstallationMaterials: [material(otherId, 'Late tray item')] });
    });
    expect(screen.getByText('Power cable', { selector: 'option' })).toBeInTheDocument();
    expect(screen.queryByText('Late tray item', { selector: 'option' })).not.toBeInTheDocument();
  });
  it('opens an existing assignment in its saved category, including an obsolete material', async () => {
    mocks.fetchDetails.mockResolvedValue({
      category: { label: 'Cable type' },
      material: ownerMaterial,
      standardMaterials: [
        {
          id: 'assignment',
          referencedMaterialCategory: 'cable-type',
          referencedMaterialId: otherId,
          referencedMaterial: { ...otherMaterial, type: 'Obsolete cable' },
          quantity: 7,
          unit: 'meters',
          remarks: 'Keep me',
        },
      ],
    });
    mocks.fetchCableTypes.mockResolvedValue({ cableTypes: [] });
    renderDetails('cable-type');
    await screen.findByText('Obsolete cable');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1)!);
    expect(screen.getByLabelText('Material category')).toHaveValue('cable-type');
    await waitFor(() =>
      expect(screen.getByText('Obsolete cable', { selector: 'option' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Cable Type')).toHaveValue(otherId);
    expect(screen.getByLabelText('Quantity')).toHaveValue(7);
  });
});
