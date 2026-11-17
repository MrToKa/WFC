import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialCableInstallationMaterial } from '@/api/client';
import { MaterialEditDialog } from './MaterialEditDialog';
import { makeTray } from '../hooks/materialCatalog.testUtils';

const apiMocks = vi.hoisted(() => ({
  updateCableInstallationMaterial: vi.fn(),
  updateTray: vi.fn(),
  updateTrayInstallationMaterial: vi.fn(),
  updateInstrument: vi.fn(),
  updateInstrumentInstallationMaterial: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  updateMaterialCableInstallationMaterial: apiMocks.updateCableInstallationMaterial,
  updateMaterialTray: apiMocks.updateTray,
  updateMaterialTrayInstallationMaterial: apiMocks.updateTrayInstallationMaterial,
  updateMaterialInstrument: apiMocks.updateInstrument,
  updateMaterialInstrumentInstallationMaterial: apiMocks.updateInstrumentInstallationMaterial,
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
  it.each(['  000123-KL  '])('edits a tray order number from the details page: %s', async (value) => {
    const tray = makeTray(1);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    apiMocks.updateTray.mockResolvedValue({ tray });
    render(
      <FluentProvider theme={webLightTheme}>
        <MaterialEditDialog open category="tray" material={tray} token="token" onDismiss={vi.fn()} onSaved={onSaved} />
      </FluentProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Order number' });
    expect(input).toHaveValue('00-1');
    expect(input).toHaveAttribute('maxLength', '200');
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMocks.updateTray).toHaveBeenCalledWith('token', tray.id, expect.objectContaining({ orderNumber: value.trim() })));
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it.each(['', '   '])('rejects a missing order number when editing a legacy tray: %s', async (value) => {
    const tray = { ...makeTray(1), orderNumber: null };
    const onSaved = vi.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <MaterialEditDialog open category="tray" material={tray} token="token" onDismiss={vi.fn()} onSaved={onSaved} />
      </FluentProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Order number' });
    expect(input).toBeRequired();
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Order number is required.')).toBeInTheDocument();
    expect(apiMocks.updateTray).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    apiMocks.updateTray.mockReset();
    apiMocks.updateCableInstallationMaterial.mockReset();
    apiMocks.updateCableInstallationMaterial.mockResolvedValue({
      cableInstallationMaterial: material,
    });
    apiMocks.updateTrayInstallationMaterial.mockReset();
    apiMocks.updateTrayInstallationMaterial.mockResolvedValue({
      trayInstallationMaterial: material,
    });
    apiMocks.updateInstrument.mockReset().mockResolvedValue({ instrument: material });
    apiMocks.updateInstrumentInstallationMaterial.mockReset().mockResolvedValue({
      instrumentInstallationMaterial: material,
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

  it.each(['instrument', 'instrument-installation-material'] as const)(
    'saves all installation-style fields to the %s endpoint',
    async (category) => {
      render(
        <FluentProvider theme={webLightTheme}>
          <MaterialEditDialog
            open
            category={category}
            material={material}
            token="token"
            onDismiss={vi.fn()}
            onSaved={vi.fn().mockResolvedValue(undefined)}
          />
        </FluentProvider>,
      );

      fireEvent.change(screen.getByRole('textbox', { name: 'Purpose' }), {
        target: { value: 'Measurement' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      const update =
        category === 'instrument'
          ? apiMocks.updateInstrument
          : apiMocks.updateInstrumentInstallationMaterial;
      const otherUpdate =
        category === 'instrument'
          ? apiMocks.updateInstrumentInstallationMaterial
          : apiMocks.updateInstrument;
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith(
          'token',
          material.id,
          expect.objectContaining({
            type: material.type,
            purpose: 'Measurement',
            dimensionMm: material.dimensionMm,
            weightKg: material.weightKg,
            unitPrice: material.unitPrice,
          }),
        ),
      );
      expect(otherUpdate).not.toHaveBeenCalled();
      expect(apiMocks.updateTrayInstallationMaterial).not.toHaveBeenCalled();
    },
  );

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
