import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterialCableInstallationMaterial } from '@/api/client';
import { MaterialEditDialog } from './MaterialEditDialog';

const apiMocks = vi.hoisted(() => ({
  updateCableInstallationMaterial: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  updateMaterialCableInstallationMaterial: apiMocks.updateCableInstallationMaterial,
}));

const material: MaterialCableInstallationMaterial = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'Cable gland M32',
  purpose: 'Power',
  material: 'Brass',
  description: null,
  manufacturer: 'Original manufacturer',
  partNo: 'CG-32',
  minimumOrderQuantity: 10,
  orderMeasurement: 'pcs',
  packaging: 'Box',
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiMocks.updateCableInstallationMaterial).toHaveBeenCalledWith(
        'token',
        material.id,
        expect.objectContaining({ manufacturer: 'Updated manufacturer' }),
      ),
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
