import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  createCableMaterial,
  deleteCableMaterial,
  fetchCableDetails,
  fetchCables,
  fetchCableTypes,
  fetchCableVersions,
  fetchMaterialCableInstallationMaterials,
  fetchTrays,
  updateCableMaterial,
  type Cable,
  type CableMaterial,
  type CableVersion,
} from '@/api/client';
import { CableDetails } from './CableDetails';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  createCableMaterial: vi.fn(),
  deleteCableMaterial: vi.fn(),
  fetchCableDetails: vi.fn(),
  fetchCables: vi.fn(),
  fetchCableTypes: vi.fn(),
  fetchCableVersions: vi.fn(),
  fetchMaterialCableInstallationMaterials: vi.fn(),
  fetchTrays: vi.fn(),
  updateCableMaterial: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { isAdmin: true }, token: 'token' }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('./ProjectDetails/hooks/useProjectDetailsData', () => ({
  useProjectDetailsData: () => ({
    project: { id: 'project', projectNumber: 'P1', name: 'Project' },
    projectLoading: false,
    projectError: null,
  }),
}));

const cable: Cable = {
  id: 'cable',
  projectId: 'project',
  cableId: 1,
  cableTypeId: 'type',
  typeName: 'Power cable',
  revision: null,
  mto: null,
  tag: null,
  purpose: null,
  diameterMm: null,
  weightKgPerM: null,
  fromLocation: null,
  toLocation: null,
  routing: null,
  delivery: null,
  designLength: null,
  installLength: null,
  pullDate: null,
  connectedFrom: null,
  connectedTo: null,
  tested: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const material: CableMaterial = {
  id: 'material',
  cableId: 'cable',
  name: 'Cleat',
  quantity: 1,
  unit: 'pcs',
  remarks: null,
  source: 'manual',
  cableTypeDefaultMaterialId: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const logEntry = {
  id: 'material-added',
  userId: 'actor',
  userName: 'Material editor',
  changedAt: '2026-01-02T10:00:00Z',
  changes: ['Added material "Cleat"'],
};

const renderDetails = () =>
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={['/projects/project/cables/cable']}>
        <Routes>
          <Route path="/projects/:projectId/cables/:cableId" element={<CableDetails />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchCableDetails).mockResolvedValue({
    cable,
    materialCableType: null,
    cableTypeDefaultMaterials: [],
    cableMaterials: [],
  });
  vi.mocked(fetchCables).mockResolvedValue({ cables: [cable] });
  vi.mocked(fetchCableTypes).mockResolvedValue({ cableTypes: [] });
  vi.mocked(fetchCableVersions).mockResolvedValue({ versions: [] });
  vi.mocked(fetchTrays).mockResolvedValue({ trays: [] });
  vi.mocked(fetchMaterialCableInstallationMaterials).mockResolvedValue({
    cableInstallationMaterials: [
      { id: 'cleat', type: 'Cleat', purpose: 'Power', manufacturer: 'Acme', partNo: 'AC-1' },
      { id: 'gland', type: 'Gland', purpose: 'Control', manufacturer: 'Other', partNo: 'GL-2' },
    ],
  } as Awaited<ReturnType<typeof fetchMaterialCableInstallationMaterials>>);
  vi.mocked(createCableMaterial).mockResolvedValue({
    cableMaterial: material,
    changeLogEntry: logEntry,
  });
});

it('selects a catalog material in a wide dialog, opens its editor and saves its quantity', async () => {
  const user = userEvent.setup();
  vi.mocked(updateCableMaterial).mockResolvedValue({
    cableMaterial: { ...material, quantity: 4, unit: 'pcs', remarks: 'For termination' },
    changeLogEntry: {
      ...logEntry,
      id: 'material-edited',
      changedAt: '2026-01-03T10:00:00Z',
      changes: ['Material "Cleat" / Quantity: 1 → 4'],
    },
  });
  renderDetails();
  await user.click(await screen.findByRole('button', { name: 'Add cable material' }));
  const catalog = screen.getByRole('dialog', { name: 'Add material to cable materials' });
  expect(catalog).toHaveStyle({ width: '1200px', maxWidth: 'calc(100vw - 32px)' });
  const table = await within(catalog).findByRole('table', { name: 'Available materials' });
  expect(within(catalog).getByLabelText('Catalog category')).toHaveValue(
    'cable-installation-material',
  );
  fireEvent.change(within(catalog).getByLabelText('Purpose'), { target: { value: 'Power' } });
  expect(within(table).queryByText('Gland')).not.toBeInTheDocument();
  fireEvent.change(within(catalog).getByLabelText('Search'), { target: { value: 'AC-1' } });
  await user.click(within(table).getByText('Add', { selector: 'button' }));

  const editor = await screen.findByRole('dialog', { name: 'Edit cable material' });
  expect(createCableMaterial).toHaveBeenCalledWith('token', 'project', 'cable', { name: 'Cleat' });
  expect(editor).toHaveStyle({ width: '1200px', maxWidth: 'calc(100vw - 32px)' });
  expect(within(editor).getByLabelText('Material')).toHaveValue('Cleat');
  expect(within(editor).getByLabelText('Material')).toHaveAttribute('readonly');
  expect(within(editor).getByLabelText('Quantity')).toHaveFocus();
  expect(within(editor).getByLabelText('Quantity')).toHaveValue('1');
  expect(within(editor).getByRole('combobox', { name: 'Unit' })).toHaveValue('pcs');
  fireEvent.change(within(editor).getByLabelText('Quantity'), { target: { value: '4' } });
  fireEvent.change(within(editor).getByLabelText('Remarks'), {
    target: { value: 'For termination' },
  });
  fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(updateCableMaterial).toHaveBeenCalledWith('token', 'project', 'cable', 'material', {
    quantity: 4,
    unit: 'pcs',
    remarks: 'For termination',
  });
  expect(await screen.findByRole('row', { name: /Cleat/ })).toHaveTextContent('For termination');
  expect(fetchCableDetails).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Change tracker' }));
  const history = screen.getByRole('table', { name: 'Change tracker' });
  expect(within(history).getByText('Added material "Cleat"')).toBeInTheDocument();
  expect(within(history).getAllByRole('row')[1]).toHaveTextContent('Quantity: 1 → 4');
}, 15_000);

it('keeps the catalog open after an add failure and allows retrying', async () => {
  const user = userEvent.setup();
  vi.mocked(createCableMaterial).mockRejectedValueOnce(new Error('Unable to add'));
  renderDetails();
  await user.click(await screen.findByRole('button', { name: 'Add cable material' }));
  const catalog = screen.getByRole('dialog', { name: 'Add material to cable materials' });
  const table = await within(catalog).findByRole('table', { name: 'Available materials' });
  const addButton = within(table).getAllByText('Add', { selector: 'button' })[0];
  await user.click(addButton);
  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith({
      intent: 'error',
      title: 'Failed to add cable material',
      body: 'Unable to add',
    }),
  );
  expect(catalog).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Edit cable material' })).not.toBeInTheDocument();
  expect(addButton).toBeEnabled();
  await user.click(addButton);
  const editor = await screen.findByRole('dialog', { name: 'Edit cable material' });
  await user.click(within(editor).getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText('Cleat', { selector: 'td' })).toBeInTheDocument();
  expect(createCableMaterial).toHaveBeenCalledTimes(2);
}, 15_000);

it('shows cable revisions and material history newest first in the final section', async () => {
  const version: CableVersion = {
    ...cable,
    id: 'version-1',
    cableRecordId: cable.id,
    versionNumber: 1,
    changeType: 'create',
    changeSource: 'manual',
    changedAt: '2026-01-01T10:00:00Z',
    changedBy: null,
  };
  vi.mocked(fetchCableVersions).mockResolvedValue({
    versions: [
      {
        ...version,
        id: 'version-2',
        versionNumber: 2,
        changeType: 'update',
        tag: 'New tag',
        changedAt: '2026-01-03T10:00:00Z',
      },
      version,
    ],
  });
  vi.mocked(fetchCableDetails).mockResolvedValue({
    cable,
    materialCableType: null,
    cableTypeDefaultMaterials: [],
    cableMaterials: [material],
    changeLog: [logEntry],
  });
  renderDetails();
  const toggle = await screen.findByRole('button', { name: 'Change tracker' });
  expect(screen.queryByRole('table', { name: 'Change tracker' })).not.toBeInTheDocument();
  expect(toggle.closest('section')?.lastElementChild).toContainElement(toggle);
  fireEvent.click(toggle);
  const history = screen.getByRole('table', { name: 'Change tracker' });
  const rows = within(history).getAllByRole('row');
  expect(rows[0]).toHaveTextContent('WhoWhenChanges');
  expect(rows[1]).toHaveTextContent('Tag: - → New tag');
  expect(rows[2]).toHaveTextContent('Material editor');
  expect(rows[2]).toHaveTextContent('Added material "Cleat"');
  expect(rows[3]).toHaveTextContent('Created via manual save');
});

it('explains the absence of recorded changes', async () => {
  renderDetails();
  fireEvent.click(await screen.findByRole('button', { name: 'Change tracker' }));
  expect(
    screen.getByText('No recorded changes yet. Future saved changes will appear here.'),
  ).toBeInTheDocument();
});

it('keeps deletion history after removing the material row without reloading the page', async () => {
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.mocked(fetchCableDetails).mockResolvedValue({
    cable,
    materialCableType: null,
    cableTypeDefaultMaterials: [],
    cableMaterials: [material],
    changeLog: [logEntry],
  });
  vi.mocked(deleteCableMaterial).mockResolvedValue({
    changeLogEntry: {
      ...logEntry,
      id: 'deleted',
      changedAt: '2026-01-03T10:00:00Z',
      changes: ['Removed material "Cleat"'],
    },
  });
  try {
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Change tracker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Removed material "Cleat"');
    expect(screen.queryByText('Cleat', { selector: 'td' })).not.toBeInTheDocument();
    const history = screen.getByRole('table', { name: 'Change tracker' });
    expect(within(history).getAllByRole('row')[1]).toHaveTextContent('Removed material "Cleat"');
    expect(within(history).getByText('Added material "Cleat"')).toBeInTheDocument();
    expect(fetchCableDetails).toHaveBeenCalledTimes(1);
  } finally {
    confirmation.mockRestore();
  }
}, 15_000);

it('rejects a material that is already on the cable without sending another create request', async () => {
  const user = userEvent.setup();
  vi.mocked(fetchCableDetails).mockResolvedValue({
    cable,
    materialCableType: null,
    cableTypeDefaultMaterials: [],
    cableMaterials: [{ ...material, name: '  CLEAT  ' }],
  });
  renderDetails();
  await user.click(await screen.findByRole('button', { name: 'Add cable material' }));
  const catalog = screen.getByRole('dialog', { name: 'Add material to cable materials' });
  const table = await within(catalog).findByRole('table', { name: 'Available materials' });
  await user.click(within(table).getAllByText('Add', { selector: 'button' })[0]);
  expect(createCableMaterial).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith({
    intent: 'error',
    title: 'Material already added',
    body: 'This material is already added to this cable. Edit the existing row to change its quantity.',
  });
  expect(catalog).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Edit cable material' })).not.toBeInTheDocument();
}, 15_000);
