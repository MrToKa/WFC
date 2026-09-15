import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ChangeOrderMaterialDialog } from './ChangeOrderMaterialDialog';

vi.mock('@/api/client', () => ({
  fetchMaterialCableTypes: vi.fn(async () => ({ cableTypes: [] })),
  fetchMaterialCableInstallationMaterials: vi.fn(async () => ({ cableInstallationMaterials: [] })),
  fetchMaterialTrayInstallationMaterials: vi.fn(async () => ({
    trayInstallationMaterials: [
      {
        id: 'tray-material',
        type: 'Tray bracket',
        purpose: 'Power',
        manufacturer: 'Maker',
        partNo: 'BR-1',
      },
    ],
  })),
  fetchMaterialInstruments: vi.fn(async () => ({ instruments: [] })),
  fetchMaterialInstrumentInstallationMaterials: vi.fn(async () => ({
    instrumentInstallationMaterials: [],
  })),
  fetchAllMaterialTrays: vi.fn(async () => ({ trays: [] })),
  fetchMaterialSupports: vi.fn(async () => ({ supports: [], pagination: { totalPages: 1 } })),
}));

it('keeps all catalog categories and the standard width for change orders', async () => {
  const onSelect = vi.fn(async () => {});
  render(
    <FluentProvider theme={webLightTheme}>
      <ChangeOrderMaterialDialog open adding={false} onDismiss={vi.fn()} onSelect={onSelect} />
    </FluentProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Add material to Change Order' });
  expect(getComputedStyle(dialog).maxWidth).toBe('600px');
  const category = screen.getByLabelText('Catalog category');
  expect(within(category).getAllByRole('option')).toHaveLength(7);
  fireEvent.change(category, { target: { value: 'tray-installation-material' } });
  const table = await screen.findByRole('table', { name: 'Available materials' });
  expect(within(table).getByText('Tray bracket')).toBeInTheDocument();
  fireEvent.click(within(table).getByRole('button', { name: 'Add' }));
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'tray-material', category: 'tray-installation-material' }),
  );
});
