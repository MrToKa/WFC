import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCableTypeDetails,
  fetchMaterialCableInstallationMaterials,
  fetchMaterialCableTypes,
  createCableTypeDefaultMaterial,
  updateCableTypeDefaultMaterial,
  deleteCableTypeDefaultMaterial,
} from '@/api/client';
import { CableTypeDetails } from './CableTypeDetails';

const materialFixture = {
  id: 'default',
  cableTypeId: 'type',
  name: 'Cleat',
  quantity: 1,
  unit: 'pcs',
  remarks: null,
  sourceKind: 'manual' as const,
  sourceMasterMaterialId: 'cleat-id',
  sourceStandardMaterialAssignmentIds: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const logEntry = {
  id: 'new-log',
  userId: 'actor',
  userName: 'Editor',
  changedAt: '2026-01-02T10:00:00Z',
  changes: ['Default material "Cleat" / Quantity: 1 → 4'],
};

const auth = vi.hoisted(() => ({ isAdmin: false }));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  fetchCableTypeDetails: vi.fn(),
  fetchMaterialCableInstallationMaterials: vi.fn(),
  fetchMaterialCableTypes: vi.fn(),
  createCableTypeDefaultMaterial: vi.fn(),
  updateCableTypeDefaultMaterial: vi.fn(),
  deleteCableTypeDefaultMaterial: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: auth.isAdmin ? { isAdmin: true } : null,
    token: auth.isAdmin ? 'token' : null,
  }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('./ProjectDetails/hooks/useProjectDetailsData', () => ({
  useProjectDetailsData: () => ({
    project: { id: 'project', projectNumber: 'P1', name: 'Project' },
    projectLoading: false,
    projectError: null,
  }),
}));

const renderDetails = () =>
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={['/projects/project/cable-types/type']}>
        <Routes>
          <Route
            path="/projects/:projectId/cable-types/:cableTypeId"
            element={<CableTypeDetails />}
          />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  auth.isAdmin = false;
  vi.mocked(fetchCableTypeDetails).mockResolvedValue({
    cableType: {
      id: 'type',
      projectId: 'project',
      tag: null,
      purpose: 'Power',
      diameterMm: 12,
      weightKgPerM: 2,
      fromLocation: null,
      toLocation: null,
      routing: null,
      createdAt: '2026-01-01',
      name: 'Cable',
      updatedAt: '2026-01-01',
      changeLog: [
        {
          id: 'first',
          userId: 'actor',
          userName: 'First editor',
          changedAt: '2026-01-01T10:00:00Z',
          changes: ['Type: Old → Cable'],
        },
        {
          id: 'second',
          userId: 'actor',
          userName: 'Latest editor',
          changedAt: '2026-01-02T10:00:00Z',
          changes: ['Diameter [mm]: 12 → 14'],
        },
      ],
    },
    defaultMaterials: [],
    materialCableType: null,
    cableCount: 0,
  });
});

describe('cable type change tracker', () => {
  it('lets read-only viewers expand history with newest changes first', async () => {
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Change tracker' }));
    const table = screen.getByRole('table', { name: 'Change tracker' });
    const rows = within(table).getAllByRole('row');
    expect(rows[0]).toHaveTextContent('WhoWhenChanges');
    expect(rows[1]).toHaveTextContent('Latest editor');
    expect(rows[1]).toHaveTextContent('Diameter [mm]: 12 → 14');
    expect(rows[2]).toHaveTextContent('First editor');
  });
  it('explains the empty history of existing cable types', async () => {
    const details = await fetchCableTypeDetails('project', 'type');
    vi.mocked(fetchCableTypeDetails).mockResolvedValue({
      ...details,
      cableType: { ...details.cableType, changeLog: [] },
    });
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Change tracker' }));
    expect(
      screen.getByText('No recorded changes yet. Future saved changes will appear here.'),
    ).toBeInTheDocument();
  });
});

it('adds a database cable installation material and opens its editor without reloading', async () => {
  auth.isAdmin = true;
  vi.mocked(fetchMaterialCableInstallationMaterials).mockResolvedValue({
    cableInstallationMaterials: [
      {
        id: 'cleat-id',
        type: 'Cleat',
        purpose: 'Power',
        description: 'Cable fixing',
        manufacturer: 'Acme',
        partNo: 'AC-1',
      },
      { id: 'gland-id', type: 'Gland', purpose: 'Control', manufacturer: 'Other', partNo: 'GL-2' },
    ],
  } as Awaited<ReturnType<typeof fetchMaterialCableInstallationMaterials>>);
  vi.mocked(createCableTypeDefaultMaterial).mockResolvedValue({
    defaultMaterial: materialFixture,
    changeLogEntry: { ...logEntry, changes: ['Added default material "Cleat"'] },
  });
  renderDetails();
  fireEvent.click(await screen.findByRole('button', { name: 'Change tracker' }));
  const history = screen.getByRole('table', { name: 'Change tracker' });
  fireEvent.click(screen.getByRole('button', { name: 'Add default material' }));
  const dialog = screen.getByRole('dialog', {
    name: 'Add material to cable type default materials',
  });
  expect(dialog).toHaveStyle({ width: '1200px' });
  expect(getComputedStyle(dialog).maxWidth).toBe('calc(100vw - 32px)');
  const table = await within(dialog).findByRole('table', { name: 'Available materials' });
  expect(within(table).getByText('AC-1')).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Catalog category')).toHaveValue(
    'cable-installation-material',
  );
  expect(
    within(dialog).queryByRole('option', { name: 'Cable material types' }),
  ).not.toBeInTheDocument();
  expect(fetchMaterialCableTypes).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Import from Excel' })).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Purpose'), { target: { value: 'Power' } });
  expect(within(table).queryByText('Gland')).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Search'), { target: { value: 'AC-1' } });
  fireEvent.click(within(table).getByRole('button', { name: 'Add' }));
  await waitFor(() =>
    expect(createCableTypeDefaultMaterial).toHaveBeenCalledWith('token', 'project', 'type', {
      sourceMaterialId: 'cleat-id',
    }),
  );
  const editor = await screen.findByRole('dialog', { name: 'Edit default material' });
  expect(within(editor).getByLabelText('Material')).toHaveValue('Cleat');
  expect(within(editor).getByLabelText('Quantity')).toHaveValue('1');
  expect(within(editor).getByLabelText('Quantity')).toHaveFocus();
  expect(within(editor).getByLabelText('Unit')).toHaveValue('pcs');
  expect(
    screen.queryByRole('dialog', { name: 'Add material to cable type default materials' }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(fetchCableTypeDetails).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('table', { name: 'Change tracker' })).toBe(history);
  expect(within(history).getByText('Added default material "Cleat"')).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Cleat' })).toBeInTheDocument();
}, 15_000);

it('edits quantity and remarks without changing the selected database material', async () => {
  auth.isAdmin = true;
  const details = await fetchCableTypeDetails('project', 'type');
  const material = {
    id: 'default',
    cableTypeId: 'type',
    name: 'Cleat',
    quantity: 1,
    unit: 'pcs',
    remarks: null,
    sourceKind: 'manual' as const,
    sourceMasterMaterialId: 'cleat-id',
    sourceStandardMaterialAssignmentIds: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
  vi.mocked(fetchCableTypeDetails).mockResolvedValue({ ...details, defaultMaterials: [material] });
  vi.mocked(updateCableTypeDefaultMaterial).mockResolvedValue({
    defaultMaterial: { ...material, quantity: 4, remarks: 'Updated' },
    changeLogEntry: logEntry,
  });
  vi.mocked(fetchCableTypeDetails).mockClear();
  renderDetails();
  fireEvent.click(await screen.findByRole('button', { name: 'Change tracker' }));
  const history = screen.getByRole('table', { name: 'Change tracker' });
  const materialRow = screen.getByRole('cell', { name: 'Cleat' }).closest('tr')!;
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveStyle({ width: '1200px' });
  expect(within(dialog).getByLabelText('Material')).toHaveAttribute('readonly');
  fireEvent.change(within(dialog).getByLabelText('Quantity'), { target: { value: '4' } });
  fireEvent.change(within(dialog).getByLabelText('Remarks'), { target: { value: 'Updated' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(updateCableTypeDefaultMaterial).toHaveBeenCalledWith(
      'token',
      'project',
      'type',
      'default',
      { quantity: 4, unit: 'pcs', remarks: 'Updated' },
    ),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(fetchCableTypeDetails).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('table', { name: 'Change tracker' })).toBe(history);
  expect(screen.getByRole('cell', { name: 'Cleat' }).closest('tr')).toBe(materialRow);
  expect(within(materialRow).getByRole('cell', { name: '4' })).toBeInTheDocument();
  expect(within(history).getByText(logEntry.changes[0])).toBeInTheDocument();
}, 15_000);

afterEach(() => vi.restoreAllMocks());

it('removes a material and updates history without reloading the page', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  auth.isAdmin = true;
  const details = await fetchCableTypeDetails('project', 'type');
  vi.mocked(fetchCableTypeDetails).mockResolvedValue({
    ...details,
    defaultMaterials: [materialFixture],
  });
  vi.mocked(fetchCableTypeDetails).mockClear();
  vi.mocked(deleteCableTypeDefaultMaterial).mockResolvedValue({
    changeLogEntry: { ...logEntry, changes: ['Removed default material "Cleat"'] },
  });
  renderDetails();
  fireEvent.click(await screen.findByRole('button', { name: 'Change tracker' }));
  const history = screen.getByRole('table', { name: 'Change tracker' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() =>
    expect(screen.queryByRole('cell', { name: 'Cleat' })).not.toBeInTheDocument(),
  );
  expect(fetchCableTypeDetails).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('table', { name: 'Change tracker' })).toBe(history);
  expect(within(history).getByText('Removed default material "Cleat"')).toBeInTheDocument();
}, 15_000);
