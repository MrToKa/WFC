import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialCableInstallationMaterial } from '@/api/client';
import { MaterialEditDialog } from './MaterialEditDialog';

const apiMocks = vi.hoisted(() => ({
  updateCableInstallationMaterial: vi.fn(),
  updateTrayInstallationMaterial: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  updateMaterialCableInstallationMaterial: apiMocks.updateCableInstallationMaterial,
  updateMaterialTrayInstallationMaterial: apiMocks.updateTrayInstallationMaterial,
}));

const material: MaterialCableInstallationMaterial = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'Cable gland M32',
  purpose: 'Power',
  material: 'Brass',
  description: null,
  manufacturer: 'Original manufacturer',
  partNo: 'CG-32',
  dimensionMm: '32 × 45',
  weightKg: 0.18,
  minimumOrderQuantity: 10,
  orderMeasurement: 'pcs',
  packaging: 'Box',
  unitPrice: 7.5,
  source: 'https://example.com/original',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('MaterialEditDialog', () => {
  beforeEach(() => {
    apiMocks.updateCableInstallationMaterial.mockReset();
    apiMocks.updateCableInstallationMaterial.mockResolvedValue({
      cableInstallationMaterial: material,
    });
    apiMocks.updateTrayInstallationMaterial.mockReset();
    apiMocks.updateTrayInstallationMaterial.mockResolvedValue({
      trayInstallationMaterial: material,
    });
  });

  it('edits a material without leaving the details page', async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onDismiss = vi.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <MaterialEditDialog
          open
          category="cable-installation-material"
          material={material}
          token="token"
          onDismiss={onDismiss}
          onSaved={onSaved}
        />
      </FluentProvider>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Manufacturer' }), {
      target: { value: 'Updated manufacturer' },
    });
    expect(screen.getByRole('textbox', { name: 'Dimension [mm]' })).toHaveValue('32 × 45');
    expect(screen.getByRole('textbox', { name: 'Weight [kg]' })).toHaveValue('0.18');
    expect(screen.getByRole('spinbutton', { name: 'Price' })).toHaveValue(7.5);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Price' }), {
      target: { value: '8.25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiMocks.updateCableInstallationMaterial).toHaveBeenCalledWith(
        'token',
        material.id,
        expect.objectContaining({ manufacturer: 'Updated manufacturer', unitPrice: 8.25 }),
      ),
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('uses the tray installation catalog endpoint for tray installation materials', async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <MaterialEditDialog
          open
          category="tray-installation-material"
          material={material}
          token="token"
          onDismiss={vi.fn()}
          onSaved={vi.fn().mockResolvedValue(undefined)}
        />
      </FluentProvider>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Manufacturer' }), {
      target: { value: 'Tray supplier' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiMocks.updateTrayInstallationMaterial).toHaveBeenCalledWith(
        'token',
        material.id,
        expect.objectContaining({ manufacturer: 'Tray supplier' }),
      ),
    );
    expect(apiMocks.updateCableInstallationMaterial).not.toHaveBeenCalled();
  });

  it('does not save a negative price', async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <MaterialEditDialog
          open
          category="cable-installation-material"
          material={material}
          token="token"
          onDismiss={vi.fn()}
          onSaved={vi.fn().mockResolvedValue(undefined)}
        />
      </FluentProvider>,
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Price' }), {
      target: { value: '-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Price must be a non-negative number.')).toBeInTheDocument();
    expect(apiMocks.updateCableInstallationMaterial).not.toHaveBeenCalled();
  });
});
