import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MaterialCableInstallationMaterial, StandardMaterialAssignment } from '@/api/client';
import {
  MaterialDetailsError,
  MaterialDetailsLayout,
  MaterialDetailsLoading,
} from './MaterialDetailsLayout';
import { StandardMaterialDialog } from './StandardMaterialDialog';
import { StandardMaterialsSection } from './StandardMaterialsSection';

const renderFluent = (content: React.ReactNode) =>
  render(<FluentProvider theme={webLightTheme}>{content}</FluentProvider>);

const catalog: MaterialCableInstallationMaterial[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'Cable gland M32',
    purpose: null,
    material: null,
    description: null,
    manufacturer: null,
    partNo: null,
    dimensionMm: null,
    weightKg: null,
    minimumOrderQuantity: 50,
    orderMeasurement: 'pcs',
    packaging: 'Package',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const catalogWithPurposes: MaterialCableInstallationMaterial[] = [
  { ...catalog[0], purpose: 'Power' },
  {
    ...catalog[0],
    id: '00000000-0000-4000-8000-000000000004',
    type: 'Control cable tie',
    purpose: 'Control',
  },
  {
    ...catalog[0],
    id: '00000000-0000-4000-8000-000000000005',
    type: 'Control cable marker',
    purpose: 'Control',
  },
];

const standardMaterial: StandardMaterialAssignment = {
  id: '00000000-0000-4000-8000-000000000002',
  ownerId: '00000000-0000-4000-8000-000000000003',
  ownerCategory: 'cable-type',
  referencedMaterialId: catalog[0].id,
  referencedMaterialCategory: 'cable-installation-material',
  referencedMaterial: catalog[0],
  quantity: 2,
  unit: 'pcs',
  remarks: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Material Details shared components', () => {
  it('exposes the material Edit action when provided', () => {
    const onEdit = vi.fn();
    renderFluent(
      <MaterialDetailsLayout
        title="Cable gland M32"
        categoryLabel="Cable installation material"
        properties={[]}
        createdAt="2026-01-01T00:00:00.000Z"
        updatedAt="2026-01-01T00:00:00.000Z"
        onBack={vi.fn()}
        onEdit={onEdit}
        onRefresh={vi.fn()}
        refreshing={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('renders loading and API failure states', () => {
    const { rerender } = renderFluent(<MaterialDetailsLoading />);
    expect(screen.getByText('Loading material details...')).toBeInTheDocument();
    rerender(
      <FluentProvider theme={webLightTheme}>
        <MaterialDetailsError message="Unable to load." onBack={vi.fn()} onRetry={vi.fn()} />
      </FluentProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Material details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows an empty read-only state to non-admin users', () => {
    renderFluent(
      <StandardMaterialsSection
        items={[]}
        isAdmin={false}
        busyId={null}
        catalogLoading={false}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('No Standard Materials are assigned.')).toBeInTheDocument();
    expect(screen.getByText(/read-only for non-admin users/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /add standard material/i }),
    ).not.toBeInTheDocument();
  });

  it('exposes admin add, edit, and delete controls', () => {
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderFluent(
      <StandardMaterialsSection
        items={[standardMaterial]}
        isAdmin
        busyId={null}
        catalogLoading={false}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Standard Material' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith(standardMaterial);
    expect(onDelete).toHaveBeenCalledWith(standardMaterial);
  });

  it('validates quantity before submitting the dialog', () => {
    const onSave = vi.fn();
    renderFluent(
      <StandardMaterialDialog
        open
        assignment={null}
        catalog={catalog}
        ownerMaterialId="owner"
        excludeOwnerFromCatalog={false}
        saving={false}
        onDismiss={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/greater than zero/i);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('filters Cable Installation Materials by Purpose', () => {
    renderFluent(
      <StandardMaterialDialog
        open
        assignment={null}
        catalog={catalogWithPurposes}
        ownerMaterialId="owner"
        excludeOwnerFromCatalog={false}
        saving={false}
        onDismiss={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Purpose' }), {
      target: { value: 'Control' },
    });

    expect(screen.getByRole('combobox', { name: 'Cable Installation Material' })).toHaveValue(
      '00000000-0000-4000-8000-000000000004',
    );
    expect(screen.getByRole('option', { name: 'Control cable tie' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Control cable marker' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cable gland M32' })).not.toBeInTheDocument();
  });

  it('labels a tray installation catalog accurately and excludes its recursive owner', () => {
    const ownerMaterialId = catalogWithPurposes[0].id;
    renderFluent(
      <StandardMaterialDialog
        open
        assignment={null}
        catalog={catalogWithPurposes}
        catalogItemLabel="Tray Installation Material"
        ownerMaterialId={ownerMaterialId}
        excludeOwnerFromCatalog
        saving={false}
        onDismiss={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const materialSelect = screen.getByRole('combobox', {
      name: 'Tray Installation Material',
    });
    expect(materialSelect).toHaveValue('00000000-0000-4000-8000-000000000004');
    expect(screen.queryByRole('option', { name: 'Cable gland M32' })).not.toBeInTheDocument();

    fireEvent.change(materialSelect, { target: { value: '' } });
    fireEvent.submit(materialSelect.closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('Select a Tray Installation Material.');
  });
});
