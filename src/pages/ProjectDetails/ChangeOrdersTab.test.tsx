import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeOrderDetails, Project, User } from '@/api/client';
import { ToastProvider } from '@/context/ToastContext';
import { ChangeOrdersTab } from './ChangeOrdersTab';

const details: ChangeOrderDetails = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  title: 'Existing order',
  projectReference: 'P-100',
  preparedBy: 'Test User',
  reportDate: '2026-07-29',
  revision: '00',
  itemCount: 1,
  totalPrice: 40,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
  projectName: 'Project',
  projectCustomer: 'Customer',
  createdBy: null,
  items: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      changeOrderId: '11111111-1111-4111-8111-111111111111',
      sortOrder: 1,
      sourceCatalog: 'support',
      sourceMaterialId: '44444444-4444-4444-8444-444444444444',
      designQuantity: 12,
      orderQuantity: 10,
      spareQuantity: -2,
      unit: 'pcs',
      packaging: null,
      packagingQuantity: null,
      packagingUnit: null,
      orderedQuantity: null,
      orderedUnit: null,
      sapNumber: null,
      descriptionEn: 'Widget support',
      descriptionDe: null,
      dimensionMm: null,
      material: null,
      weightKg: null,
      clearDescription: null,
      unitPrice: 4,
      totalPrice: 40,
      countryOfOrigin: null,
      hsCode: null,
      tagNo: null,
      drawingNo: null,
      shippingList: null,
      revisionNumber: null,
      clientBarcode: null,
      manufacturer: 'Maker',
      manufacturerPartNo: 'PART-1',
      acsBarcode: null,
      remarks: null,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    },
  ],
};

vi.mock('@/api/client', () => ({
  fetchChangeOrders: vi.fn(async () => ({
    changeOrders: [
      {
        id: details.id,
        projectId: details.projectId,
        title: details.title,
        projectReference: details.projectReference,
        preparedBy: details.preparedBy,
        reportDate: details.reportDate,
        revision: details.revision,
        itemCount: 1,
        totalPrice: 40,
        createdAt: details.createdAt,
        updatedAt: details.updatedAt,
      },
    ],
  })),
  fetchChangeOrder: vi.fn(async () => ({ changeOrder: details })),
  createChangeOrder: vi.fn(),
  updateChangeOrder: vi.fn(),
  deleteChangeOrder: vi.fn(),
  addChangeOrderItem: vi.fn(),
  updateChangeOrderItem: vi.fn(),
  deleteChangeOrderItem: vi.fn(),
  duplicateChangeOrderItem: vi.fn(async () => ({
    item: details.items[0],
    changeOrder: details,
  })),
  reorderChangeOrderItems: vi.fn(),
  exportChangeOrder: vi.fn(),
  fetchMaterialCableTypes: vi.fn(async () => ({ cableTypes: [] })),
  fetchMaterialCableInstallationMaterials: vi.fn(async () => ({
    cableInstallationMaterials: [],
  })),
  fetchMaterialTrayInstallationMaterials: vi.fn(async () => ({
    trayInstallationMaterials: [],
  })),
  fetchAllMaterialTrays: vi.fn(async () => ({ trays: [] })),
  fetchMaterialSupports: vi.fn(async () => ({
    supports: [],
    pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
  })),
}));

const project: Project = {
  id: details.projectId,
  projectNumber: 'P-100',
  name: 'Project',
  customer: 'Customer',
  manager: null,
  description: null,
  secondaryTrayLength: null,
  supportDistance: null,
  supportWeight: null,
  trayLoadSafetyFactor: null,
  supportDistanceOverrides: {},
  trayPurposeTemplates: {},
  cableLayout: {
    cableSpacing: null,
    considerBundleSpacingAsFree: null,
    minFreeSpacePercent: null,
    maxFreeSpacePercent: null,
    mv: null,
    power: null,
    vfd: null,
    control: null,
    customBundleRanges: null,
  },
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

const user: User = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isAdmin: false,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

describe('ChangeOrdersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  const openExistingOrder = async (): Promise<void> => {
    await screen.findByRole('table', { name: 'All Change Orders' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Existing order' }));
    await screen.findByRole('cell', { name: 'Widget support' });
  };

  it('shows all Change Orders in a table until one is selected', async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <ToastProvider>
          <ChangeOrdersTab project={project} token="token" currentUser={user} />
        </ToastProvider>
      </FluentProvider>,
    );

    const table = await screen.findByRole('table', { name: 'All Change Orders' });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Existing order' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'P-100' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '40.00' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Existing order' }));
    expect(await screen.findByRole('cell', { name: 'Widget support' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'All Change Orders' })).not.toBeInTheDocument();
  });

  it('uses Internal NCR terminology and the independent API collection', async () => {
    const api = await import('@/api/client');
    render(
      <FluentProvider theme={webLightTheme}>
        <ToastProvider>
          <ChangeOrdersTab
            project={project}
            token="token"
            currentUser={user}
            collection="internal-ncrs"
          />
        </ToastProvider>
      </FluentProvider>,
    );

    await screen.findByRole('table', { name: 'All Internal NCRs' });
    expect(screen.getByRole('option', { name: 'Select an Internal NCR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Internal NCR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Internal NCR' })).toBeInTheDocument();
    expect(api.fetchChangeOrders).toHaveBeenCalledWith('token', project.id, 'internal-ncrs');

    fireEvent.click(screen.getByRole('button', { name: 'Open Existing order' }));
    await screen.findByRole('table', { name: 'Internal NCR items' });
    expect(api.fetchChangeOrder).toHaveBeenCalledWith(
      'token',
      project.id,
      details.id,
      'internal-ncrs',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit item 1' }));
    expect(screen.getByText('Edit Internal NCR item')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'SAP number' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Description (DE)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'HS Code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Shipping list' })).not.toBeInTheDocument();
  });

  it.each([
    ['change-orders', 'All Change Orders'],
    ['internal-ncrs', 'All Internal NCRs'],
  ] as const)(
    'adds a Trays installation material through the %s collection',
    async (collection, collectionTableName) => {
      const api = await import('@/api/client');
      const trayInstallationMaterialId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const addedItem: ChangeOrderDetails['items'][number] = {
        ...details.items[0],
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        sortOrder: 2,
        sourceCatalog: 'tray-installation-material',
        sourceMaterialId: trayInstallationMaterialId,
        descriptionEn: 'Tray splice plate',
      };
      vi.mocked(api.fetchMaterialTrayInstallationMaterials).mockResolvedValueOnce({
        trayInstallationMaterials: [
          {
            id: trayInstallationMaterialId,
            type: 'Tray splice plate',
            purpose: 'Tray joining',
            material: 'Stainless steel',
            description: 'Joining plate for tray sections',
            manufacturer: 'Tray Co',
            partNo: 'TSP-1',
            dimensionMm: '100 × 40',
            weightKg: 0.2,
            minimumOrderQuantity: 10,
            orderMeasurement: 'pcs',
            packaging: 'Box',
            source: null,
            createdAt: details.createdAt,
            updatedAt: details.updatedAt,
          },
        ],
      });
      vi.mocked(api.addChangeOrderItem).mockResolvedValueOnce({
        item: addedItem,
        changeOrder: {
          ...details,
          itemCount: 2,
          items: [...details.items, addedItem],
        },
      });

      render(
        <FluentProvider theme={webLightTheme}>
          <ToastProvider>
            <ChangeOrdersTab
              project={project}
              token="token"
              currentUser={user}
              collection={collection}
            />
          </ToastProvider>
        </FluentProvider>,
      );

      await screen.findByRole('table', { name: collectionTableName });
      fireEvent.click(screen.getByRole('button', { name: 'Open Existing order' }));
      await screen.findByRole('cell', { name: 'Widget support' });
      fireEvent.click(screen.getByRole('button', { name: 'Add material' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Catalog category' }), {
        target: { value: 'tray-installation-material' },
      });
      const purposeSelect = screen.getByRole('combobox', { name: 'Purpose' });
      await screen.findByRole('option', { name: 'Tray joining' });
      fireEvent.change(purposeSelect, { target: { value: 'Tray joining' } });

      const catalogRow = (await screen.findByText('Tray splice plate')).closest('tr');
      expect(catalogRow).not.toBeNull();
      fireEvent.click(within(catalogRow!).getByText('Add'));

      await waitFor(() =>
        expect(api.addChangeOrderItem).toHaveBeenCalledWith(
          'token',
          project.id,
          details.id,
          {
            sourceCatalog: 'tray-installation-material',
            sourceMaterialId: trayInstallationMaterialId,
          },
          collection,
        ),
      );
    },
    15_000,
  );

  it('loads rows, displays derived values, and disables export after an unsaved header edit', async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <ToastProvider>
          <ChangeOrdersTab project={project} token="token" currentUser={user} />
        </ToastProvider>
      </FluentProvider>,
    );

    await openExistingOrder();
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(screen.getByText(/Total: 40\.00/)).toBeInTheDocument();

    const exportButton = screen.getByRole('button', { name: /export excel/i });
    expect(exportButton).toBeEnabled();

    const title = screen.getByRole('textbox', { name: /^title/i });
    fireEvent.change(title, { target: { value: 'Existing order changed' } });
    await waitFor(
      () => {
        expect(screen.getByText('Unsaved header changes')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /export excel/i })).toBeDisabled();
      },
      { timeout: 5_000 },
    );
  }, 15_000);

  it('allows selecting an unrestricted future header date', async () => {
    const api = await import('@/api/client');
    vi.mocked(api.updateChangeOrder).mockResolvedValueOnce({
      changeOrder: { ...details, reportDate: '2099-12-31' },
    });
    render(
      <FluentProvider theme={webLightTheme}>
        <ToastProvider>
          <ChangeOrdersTab project={project} token="token" currentUser={user} />
        </ToastProvider>
      </FluentProvider>,
    );

    await openExistingOrder();
    const dateInput = screen.getByLabelText('Date');
    fireEvent.change(dateInput, { target: { value: '2099-12-31' } });

    expect(dateInput).toHaveValue('2099-12-31');
    expect(dateInput).not.toHaveAttribute('min');
    expect(dateInput).not.toHaveAttribute('max');
    expect(screen.getByText('Unsaved header changes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateChangeOrder).toHaveBeenCalledWith(
        'token',
        project.id,
        details.id,
        expect.objectContaining({ reportDate: '2099-12-31' }),
        'change-orders',
      ),
    );
  });

  it('duplicates a manual material from its row action', async () => {
    const api = await import('@/api/client');
    render(
      <FluentProvider theme={webLightTheme}>
        <ToastProvider>
          <ChangeOrdersTab project={project} token="token" currentUser={user} />
        </ToastProvider>
      </FluentProvider>,
    );

    await openExistingOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate item 1' }));

    await waitFor(() =>
      expect(api.duplicateChangeOrderItem).toHaveBeenCalledWith(
        'token',
        project.id,
        details.id,
        details.items[0].id,
        'change-orders',
      ),
    );
  }, 15_000);

  it('shows an expansion control immediately for a copied material', async () => {
    const api = await import('@/api/client');
    const copiedParent: ChangeOrderDetails['items'][number] = {
      ...details.items[0],
      id: '88888888-8888-4888-8888-888888888888',
      sortOrder: 2,
      lineKind: 'manual',
      parentItemId: null,
    };
    const copiedChild: ChangeOrderDetails['items'][number] = {
      ...details.items[0],
      id: '99999999-9999-4999-8999-999999999999',
      sortOrder: 3,
      sourceCatalog: 'cable-installation-material',
      descriptionEn: 'Copied inherited material',
      lineKind: 'inherited',
      parentItemId: copiedParent.id,
      quantityPerParent: 1,
    };
    vi.mocked(api.duplicateChangeOrderItem).mockResolvedValueOnce({
      item: copiedParent,
      changeOrder: {
        ...details,
        itemCount: 3,
        totalPrice: 120,
        items: [details.items[0], copiedParent, copiedChild],
      },
    });

    render(
      <FluentProvider theme={webLightTheme}>
        <ToastProvider>
          <ChangeOrdersTab project={project} token="token" currentUser={user} />
        </ToastProvider>
      </FluentProvider>,
    );

    await openExistingOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate item 1' }));

    const expandButton = await screen.findByRole('button', {
      name: 'Expand inherited standard materials for item 2',
    });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Copied inherited material')).not.toBeInTheDocument();

    fireEvent.click(expandButton);
    expect(screen.getByText('Copied inherited material')).toBeInTheDocument();
  }, 15_000);

  it('shows an expansion control immediately for a newly added material', async () => {
    const api = await import('@/api/client');
    const addedParent: ChangeOrderDetails['items'][number] = {
      ...details.items[0],
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sortOrder: 2,
      sourceCatalog: 'cable-type',
      descriptionEn: 'New cable type',
      lineKind: 'manual',
      parentItemId: null,
    };
    const addedChild: ChangeOrderDetails['items'][number] = {
      ...details.items[0],
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sortOrder: 3,
      sourceCatalog: 'cable-installation-material',
      descriptionEn: 'New inherited material',
      lineKind: 'inherited',
      parentItemId: addedParent.id,
      quantityPerParent: 1,
    };
    vi.mocked(api.fetchMaterialCableTypes).mockResolvedValueOnce({
      cableTypes: [
        {
          id: addedParent.sourceMaterialId,
          name: addedParent.descriptionEn,
          purpose: null,
          material: null,
          description: null,
          manufacturer: null,
          partNo: null,
          remarks: null,
          diameterMm: null,
          weightKgPerM: null,
          minimumOrderQuantity: 1,
          orderMeasurement: 'pcs',
          packaging: 'pcs',
          createdAt: details.createdAt,
          updatedAt: details.updatedAt,
        },
      ],
    });
    vi.mocked(api.addChangeOrderItem).mockResolvedValueOnce({
      item: addedParent,
      changeOrder: {
        ...details,
        itemCount: 3,
        totalPrice: 120,
        items: [details.items[0], addedParent, addedChild],
      },
    });

    render(
      <FluentProvider theme={webLightTheme}>
        <ToastProvider>
          <ChangeOrdersTab project={project} token="token" currentUser={user} />
        </ToastProvider>
      </FluentProvider>,
    );

    await openExistingOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Add material' }));

    const catalogRow = (await screen.findByText('New cable type')).closest('tr');
    expect(catalogRow).not.toBeNull();
    fireEvent.click(within(catalogRow!).getByText('Add'));

    const expandButton = await screen.findByRole('button', {
      name: 'Expand inherited standard materials for item 2',
    });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('New inherited material')).not.toBeInTheDocument();

    fireEvent.click(expandButton);
    expect(screen.getByText('New inherited material')).toBeInTheDocument();
  }, 15_000);

  it('starts inherited standard materials collapsed without renumbering rows', async () => {
    const api = await import('@/api/client');
    const inheritedDetails: ChangeOrderDetails = {
      ...details,
      itemCount: 3,
      totalPrice: 120,
      items: [
        {
          ...details.items[0],
          sourceCatalog: 'cable-type',
          descriptionEn: 'Cable type',
          lineKind: 'manual',
          parentItemId: null,
          sortOrder: 1,
        },
        {
          ...details.items[0],
          id: '66666666-6666-4666-8666-666666666666',
          sourceCatalog: 'cable-installation-material',
          descriptionEn: 'Inherited cable cleat',
          lineKind: 'inherited',
          parentItemId: details.items[0].id,
          quantityPerParent: 2,
          sortOrder: 2,
        },
        {
          ...details.items[0],
          id: '77777777-7777-4777-8777-777777777777',
          descriptionEn: 'Standalone support',
          lineKind: 'manual',
          parentItemId: null,
          sortOrder: 3,
        },
      ],
    };
    vi.mocked(api.fetchChangeOrder).mockResolvedValueOnce({ changeOrder: inheritedDetails });

    render(
      <FluentProvider theme={webLightTheme}>
        <ToastProvider>
          <ChangeOrdersTab project={project} token="token" currentUser={user} />
        </ToastProvider>
      </FluentProvider>,
    );

    await screen.findByRole('table', { name: 'All Change Orders' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Existing order' }));

    const materialsTable = await screen.findByRole('table', { name: 'Change Order items' });
    const cableTypeRow = within(materialsTable).getByText('Cable type').closest('tr');
    const standaloneRow = within(materialsTable).getByText('Standalone support').closest('tr');
    expect(cableTypeRow).not.toBeNull();
    expect(standaloneRow).not.toBeNull();

    const cableTypeItemCell = within(cableTypeRow!).getAllByRole('cell')[0];
    const standaloneItemCell = within(standaloneRow!).getAllByRole('cell')[0];
    const expandButton = within(cableTypeItemCell).getByRole('button', {
      name: 'Expand inherited standard materials for item 1',
    });
    expect(cableTypeItemCell).toHaveTextContent('1');
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');
    expect(standaloneItemCell).toHaveTextContent('3');
    expect(within(materialsTable).queryByText('Inherited cable cleat')).not.toBeInTheDocument();
    expect(screen.getByText(/Total: 120\.00/)).toBeInTheDocument();

    fireEvent.click(expandButton);

    expect(within(materialsTable).getByText('Inherited cable cleat')).toBeInTheDocument();
    expect(within(standaloneRow!).getAllByRole('cell')[0]).toHaveTextContent('3');
    expect(screen.getByText(/Total: 120\.00/)).toBeInTheDocument();

    const collapseButton = within(cableTypeItemCell).getByRole('button', {
      name: 'Collapse inherited standard materials for item 1',
    });
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapseButton);
    expect(within(materialsTable).queryByText('Inherited cable cleat')).not.toBeInTheDocument();
  }, 15_000);
});
