import { StrictMode } from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MaterialCableInstallationMaterial,
  MaterialCableType,
  MaterialSupport,
  MaterialTray,
} from '@/api/client';
import { Materials } from './Materials';
import { MasterMaterialDetailsPage } from './Materials/MasterMaterialDetailsPage';
import { MATERIAL_DETAILS_CAPABILITIES } from './Materials/materialCapabilities';

const apiMocks = vi.hoisted(() => ({
  cableTypes: vi.fn(),
  cableInstallationMaterials: vi.fn(),
  trays: vi.fn(),
  trayInstallationMaterials: vi.fn(),
  instruments: vi.fn(),
  instrumentInstallationMaterials: vi.fn(),
  supports: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => {
  const pagination = { page: 1, pageSize: 20, totalPages: 1, totalItems: 0 };
  return {
    ...(await importOriginal<typeof import('@/api/client')>()),
    fetchMaterialDetails: vi.fn().mockResolvedValue({
      category: { label: 'Material' },
      material: {
        id: 'detail',
        name: 'Material details',
        createdAt: '2026-09-06',
        updatedAt: '2026-09-06',
      },
      standardMaterials: [],
    }),
    fetchMaterialChangeLog: vi.fn().mockResolvedValue({ changeLog: [] }),
    fetchMaterialTrays: vi.fn().mockResolvedValue({ trays: [], pagination }),
    fetchMaterialSupports: vi.fn().mockResolvedValue({ supports: [], pagination }),
    fetchAllMaterialTrays: apiMocks.trays,
    fetchAllMaterialSupports: apiMocks.supports,
    fetchMaterialLoadCurves: vi.fn().mockResolvedValue({ loadCurves: [], pagination }),
    fetchMaterialCableTypes: apiMocks.cableTypes,
    fetchMaterialCableInstallationMaterials: apiMocks.cableInstallationMaterials,
    fetchMaterialTrayInstallationMaterials: apiMocks.trayInstallationMaterials,
    fetchMaterialInstruments: apiMocks.instruments,
    fetchMaterialInstrumentInstallationMaterials: apiMocks.instrumentInstallationMaterials,
  };
});

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, token: null }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

const catalogs = [
  { key: 'cableTypes', label: 'Cable types', primaryCriterion: 'Name' },
  { key: 'cableInstallationMaterials', label: 'Cable installation materials' },
  { key: 'trays', label: 'Trays', manufacturerFacet: true },
  { key: 'trayInstallationMaterials', label: 'Trays installation materials' },
  { key: 'instruments', label: 'Instruments' },
  { key: 'instrumentInstallationMaterials', label: 'Instruments installation materials' },
  { key: 'supports', label: 'Supports', manufacturerFacet: true },
] as const;

const catalogItems = Array.from({ length: 24 }, (_, index) => {
  const number = index + 1;
  const name = `Catalog item ${String(number).padStart(2, '0')}`;
  return {
    id: `material-${number}`,
    name,
    type: name,
    purpose: number % 2 === 0 ? 'Control' : 'Power',
    manufacturer: number % 2 === 0 ? 'ACME' : 'Other manufacturer',
    material: 'Steel',
    description: null,
    partNo: null,
    remarks: null,
    diameterMm: 10,
    dimensionMm: null,
    heightMm: 100,
    rungHeightMm: 20,
    widthMm: 200,
    lengthMm: 300,
    weightKg: 1.25,
    weightKgPerM: 1.25,
    minimumOrderQuantity: 1,
    orderMeasurement: 'pcs' as const,
    packaging: 'Box' as const,
    unitPrice: 12.5,
    loadCurveId: null,
    loadCurveName: null,
    imageTemplateId: null,
    imageTemplateFileName: null,
    imageTemplateContentType: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
  };
}) satisfies Array<
  MaterialCableType & MaterialCableInstallationMaterial & MaterialTray & MaterialSupport
>;

beforeEach(() => {
  showToast.mockClear();
  for (const [key, mock] of Object.entries(apiMocks)) {
    mock.mockReset().mockResolvedValue({ [key]: [] });
  }
});

const selectOption = (dropdownLabel: string, optionName: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: dropdownLabel }));
  fireEvent.click(screen.getByRole('option', { name: optionName }));
};

const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate('/materials?tab=loadCurves&filter=kept')}>
        Navigate to curves
      </button>
      <button onClick={() => navigate(-1)}>History back</button>
      <output aria-label="Current query">{location.search}</output>
    </>
  );
};

describe('Materials category navigation', () => {
  it('keeps the selected tab in sync with navigation and preserves other query parameters', async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <MemoryRouter initialEntries={['/materials?tab=trays&filter=kept']}>
          <Navigation />
          <Materials />
        </MemoryRouter>
      </FluentProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Trays' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('No trays found');

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to curves' }));
    expect(screen.getByRole('tab', { name: 'Load curves' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: 'Load curves' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'History back' }));
    expect(screen.getByRole('tab', { name: 'Trays' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Supports' }));
    expect(screen.getByRole('status', { name: 'Current query' })).toHaveTextContent(
      'tab=supports&filter=kept',
    );
  });
});

describe('Materials catalog filtering and pagination', () => {
  it.each(catalogs)(
    'filters and pages the full $label catalog',
    async (catalog) => {
      apiMocks[catalog.key].mockResolvedValue({ [catalog.key]: catalogItems });
      const catalogName = catalog.label.toLowerCase();
      const pageDropdownLabel = `Select ${catalogName} page`;
      const manufacturerFacet = 'manufacturerFacet' in catalog && catalog.manufacturerFacet;
      const facetLabel = manufacturerFacet ? 'Filter by manufacturer' : 'Filter by purpose';
      const facetValue = manufacturerFacet ? 'ACME' : 'Control';
      const facetReset = manufacturerFacet ? 'All manufacturers' : 'All purposes';

      render(
        <FluentProvider theme={webLightTheme}>
          <MemoryRouter initialEntries={[`/materials?tab=${catalog.key}`]}>
            <Materials />
          </MemoryRouter>
        </FluentProvider>,
      );

      await screen.findByText('Catalog item 01');
      expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(11);
      expect(screen.queryByText('Catalog item 11')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(screen.getByText('Catalog item 11')).toBeInTheDocument();
      expect(screen.queryByText('Catalog item 01')).not.toBeInTheDocument();

      selectOption(pageDropdownLabel, 'Page 3');
      expect(screen.getByText('Catalog item 21')).toBeInTheDocument();
      expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(5);
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
      selectOption(pageDropdownLabel, 'Page 2');
      expect(screen.getByText('Catalog item 11')).toBeInTheDocument();

      const search = screen.getByLabelText(`Filter ${catalogName}`);
      fireEvent.change(search, { target: { value: '  CATALOG item 2  ' } });
      expect(screen.getByText('Catalog item 20')).toBeInTheDocument();
      expect(screen.getByText('Catalog item 24')).toBeInTheDocument();
      expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(6);
      expect(screen.getByRole('combobox', { name: pageDropdownLabel })).toHaveTextContent('Page 1');

      fireEvent.change(search, { target: { value: '' } });
      expect(screen.getByText('Catalog item 01')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      selectOption(facetLabel, facetValue);
      expect(screen.getByText('Catalog item 02')).toBeInTheDocument();
      expect(screen.queryByText('Catalog item 01')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

      fireEvent.change(search, { target: { value: 'Catalog item 2' } });
      expect(screen.getByText('Catalog item 20')).toBeInTheDocument();
      expect(screen.getByText('Catalog item 22')).toBeInTheDocument();
      expect(screen.getByText('Catalog item 24')).toBeInTheDocument();
      expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(4);
      expect(screen.queryByText('Catalog item 21')).not.toBeInTheDocument();

      selectOption('Search criteria', manufacturerFacet ? 'Manufacturer' : 'Purpose');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      selectOption(
        'Search criteria',
        'primaryCriterion' in catalog ? catalog.primaryCriterion : 'Type',
      );
      expect(screen.getByText('Catalog item 24')).toBeInTheDocument();

      fireEvent.change(search, { target: { value: 'missing catalog item' } });
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: pageDropdownLabel })).not.toBeInTheDocument();
      fireEvent.change(search, { target: { value: '' } });
      selectOption(facetLabel, facetReset);
      expect(screen.getByText('Catalog item 01')).toBeInTheDocument();
      expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(11);
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      selectOption('Rows per page', '25');
      expect(screen.getByText('Catalog item 01')).toBeInTheDocument();
      expect(screen.getByText('Catalog item 24')).toBeInTheDocument();
      expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(25);
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
      for (const size of ['50', '100']) {
        selectOption('Rows per page', size);
        expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(25);
      }
      selectOption('Rows per page', '10');
      expect(screen.getAllByRole('row', { hidden: true })).toHaveLength(11);
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
      expect(apiMocks[catalog.key]).toHaveBeenCalledOnce();
      expect(showToast).not.toHaveBeenCalled();
    },
    15000,
  );
});

describe('Returning from material details', () => {
  it.each(catalogs)(
    'restores the page, page size and filters for $label',
    async (catalog) => {
      const items = Array.from({ length: 80 }, (_, index) => ({
        ...catalogItems[index % catalogItems.length],
        id: 'return-' + index,
        name: 'Return item ' + String(index + 1).padStart(2, '0'),
        type: 'Return item ' + String(index + 1).padStart(2, '0'),
      }));
      let resolveStaleRequest!: (value: unknown) => void;
      let requests = 0;
      apiMocks[catalog.key].mockImplementation(() => {
        requests += 1;
        if (requests === 3)
          return new Promise((resolve) => {
            resolveStaleRequest = resolve;
          });
        return Promise.resolve({ [catalog.key]: items });
      });
      const capability = Object.values(MATERIAL_DETAILS_CAPABILITIES).find(
        (value) => value.tab === catalog.key,
      )!;
      render(
        <StrictMode>
          <FluentProvider theme={webLightTheme}>
            <MemoryRouter initialEntries={['/materials?tab=' + catalog.key]}>
              <Routes>
                <Route path="/materials" element={<Materials />} />
                <Route
                  path="/materials/:category/:materialId"
                  element={
                    <MasterMaterialDetailsPage
                      category={capability.category}
                      idParam="materialId"
                      getTitle={() => 'Material details'}
                      getProperties={() => []}
                    />
                  }
                />
              </Routes>
            </MemoryRouter>
          </FluentProvider>
        </StrictMode>,
      );
      await screen.findByText('Return item 01');
      fireEvent.change(screen.getByLabelText('Filter ' + catalog.label.toLowerCase()), {
        target: { value: 'Return item' },
      });
      const manufacturer = 'manufacturerFacet' in catalog;
      selectOption(
        manufacturer ? 'Filter by manufacturer' : 'Filter by purpose',
        manufacturer ? 'ACME' : 'Control',
      );
      selectOption('Rows per page', '25');
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      const tableBefore = screen.getByRole('table').textContent;
      expect(
        screen.getByRole('combobox', { name: 'Select ' + catalog.label.toLowerCase() + ' page' }),
      ).toHaveTextContent('Page 2');
      fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
      fireEvent.click(await screen.findByRole('button', { name: 'Back to Materials' }));
      await waitFor(() =>
        expect(
          screen.getByRole('combobox', { name: 'Select ' + catalog.label.toLowerCase() + ' page' }),
        ).toHaveTextContent('Page 2'),
      );
      expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveTextContent('25');
      await act(async () => {
        resolveStaleRequest({ [catalog.key]: items });
      });
      expect(
        screen.getByRole('combobox', { name: 'Select ' + catalog.label.toLowerCase() + ' page' }),
      ).toHaveTextContent('Page 2');
      expect(screen.getByRole('table').textContent).toBe(tableBefore);
      expect(screen.getByLabelText('Filter ' + catalog.label.toLowerCase())).toHaveValue(
        'Return item',
      );
    },
    15000,
  );
});
