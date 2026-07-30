import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  duplicateChangeOrderItem: vi.fn(async () => ({ item: details.items[0] })),
  reorderChangeOrderItems: vi.fn(),
  exportChangeOrder: vi.fn(),
  fetchMaterialCableTypes: vi.fn(async () => ({ cableTypes: [] })),
  fetchMaterialCableInstallationMaterials: vi.fn(async () => ({
    cableInstallationMaterials: [],
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

  it(
    'loads rows, displays derived values, and disables export after an unsaved header edit',
    async () => {
      render(
        <FluentProvider theme={webLightTheme}>
          <ToastProvider>
            <ChangeOrdersTab project={project} token="token" currentUser={user} />
          </ToastProvider>
        </FluentProvider>,
      );

      expect(await screen.findByRole('cell', { name: 'Widget support' })).toBeInTheDocument();
      expect(screen.getByText('-2')).toBeInTheDocument();
      expect(screen.getByText(/Total: 40\.00/)).toBeInTheDocument();

      const exportButton = screen.getByRole('button', { name: /export excel/i });
      expect(exportButton).toBeEnabled();

      const title = screen.getByRole('textbox', { name: /^title/i });
      fireEvent.change(title, { target: { value: 'Existing order changed' } });
      await waitFor(() => expect(exportButton).toBeDisabled());
      expect(screen.getByText('Unsaved header changes')).toBeInTheDocument();
    },
    15_000,
  );

  it(
    'duplicates a manual material from its row action',
    async () => {
      const api = await import('@/api/client');
      render(
        <FluentProvider theme={webLightTheme}>
          <ToastProvider>
            <ChangeOrdersTab project={project} token="token" currentUser={user} />
          </ToastProvider>
        </FluentProvider>,
      );

      await screen.findByRole('cell', { name: 'Widget support' });
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate item 1' }));

      await waitFor(() =>
        expect(api.duplicateChangeOrderItem).toHaveBeenCalledWith(
          'token',
          project.id,
          details.id,
          details.items[0].id,
        ),
      );
    },
    15_000,
  );
});
