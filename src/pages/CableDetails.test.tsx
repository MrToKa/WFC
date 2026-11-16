import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import {
  ApiError,
  createCableMaterial,
  deleteCableMaterial,
  fetchCableDetails,
  fetchCables,
  fetchCableTypes,
  fetchCableVersions,
  fetchMaterialCableInstallationMaterials,
  fetchTrays,
  updateCableMaterial,
  updateCable,
  type Cable,
  type CableMaterial,
  type CableVersion,
} from '@/api/client';
import { CableDetails } from './CableDetails';
import { emptyRoutingControl } from '../../shared/cableRoutingControl';

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
  updateCable: vi.fn(),
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
  // Tabster needs a visible viewport and layout parents to activate modal focus in jsdom.
  const viewport = vi
    .spyOn(document.body, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 0, 1024, 768));
  const offsetParent = vi
    .spyOn(HTMLElement.prototype, 'offsetParent', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.parentElement;
    });
  onTestFinished(() => {
    viewport.mockRestore();
    offsetParent.mockRestore();
  });
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

it('displays the checked PF length independently of Design and never falls back to a tray estimate', async () => {
  const checked = {
    ...cable,
    tag: 'PF cable',
    routing: '/TRAY-01',
    designLength: 25,
    autoCalculatedLength: 54,
    autoLengthStatus: 'calculated' as const,
    autoLengthCalculatedAt: '2026-10-21T12:00:00Z',
    autoLengthBarrierStatus: 'clear' as const,
    autoLengthMatchesLatestRequest: true,
  };
  vi.mocked(fetchCableDetails).mockResolvedValue({
    cable: checked,
    materialCableType: null,
    cableTypeDefaultMaterials: [],
    cableMaterials: [],
  });
  renderDetails();
  const auto = await screen.findByRole('region', { name: 'Path Finder automatic length' });
  expect(within(auto).getByText('54')).toBeVisible();
  expect(screen.getByText('25')).toBeVisible();
  expect(within(auto).queryByRole('spinbutton')).toBeNull();
  expect(fetchTrays).not.toHaveBeenCalled();
  vi.mocked(fetchCableDetails).mockResolvedValue({
    cable: { ...cable, routing: '/TRAY-01', designLength: 25 },
    materialCableType: null,
    cableTypeDefaultMaterials: [],
    cableMaterials: [],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  // Refresh briefly replaces this page with its loading state. Read the newly
  // mounted projection instead of retaining the now-detached previous section.
  await screen.findByText('No checked Path Finder length yet.');
  const refreshedAuto = screen.getByRole('region', { name: 'Path Finder automatic length' });
  expect(within(refreshedAuto).queryByText('25')).toBeNull();
  expect(fetchTrays).not.toHaveBeenCalled();
});

it('preserves the PF Auto value as read-only when a user edits Design length without submitting projection fields', async () => {
  const user = userEvent.setup(),
    checked = {
      ...cable,
      tag: 'PF cable',
      designLength: 25,
      autoCalculatedLength: 54,
      autoLengthStatus: 'calculated' as const,
      autoLengthCalculatedAt: '2026-10-21T12:00:00Z',
      autoLengthBarrierStatus: 'clear' as const,
      autoLengthMatchesLatestRequest: true,
    };
  const response = {
    cable: checked,
    materialCableType: null,
    cableTypeDefaultMaterials: [],
    cableMaterials: [],
  };
  vi.mocked(fetchCableDetails)
    .mockResolvedValueOnce(response)
    .mockResolvedValue({ ...response, cable: { ...checked, designLength: 30 } });
  vi.mocked(updateCable).mockResolvedValue({ cable: { ...checked, designLength: 30 } });
  renderDetails();
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit cable' }),
    design = within(dialog).getByRole('spinbutton', { name: 'Design length [m]' });
  expect(within(dialog).queryByLabelText('Auto calculated length [m]')).toBeNull();
  fireEvent.change(design, { target: { value: '30' } });
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(updateCable).toHaveBeenCalledOnce());
  const input = vi.mocked(updateCable).mock.calls[0][3];
  expect(input.designLength).toBe(30);
  expect(Object.keys(input).some((key) => key.startsWith('auto'))).toBe(false);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit cable' })).toBeNull());
  expect(screen.getByText('30')).toBeVisible();
  const auto = await screen.findByRole('region', { name: 'Path Finder automatic length' });
  expect(within(auto).getByText('54')).toBeVisible();
});

it('edits the manual route and execution dates without copying the calculated route into manual intent', async () => {
  const checked: Cable = {
    ...cable,
    tag: '-WG-4022',
    routing: '/AUTO',
    autoCalculatedRouting: '/AUTO',
    autoRoutingStatus: 'calculated',
    routingControl: emptyRoutingControl(),
    routingControlRevision: '4',
    cableWriteRevision: '9',
  };
  vi.mocked(fetchCableDetails).mockResolvedValue({
    cable: checked,
    materialCableType: null,
    cableTypeDefaultMaterials: [],
    cableMaterials: [],
  });
  vi.mocked(updateCable).mockResolvedValue({ cable: checked });
  renderDetails();
  const automatic = await screen.findByLabelText('Automatically calculated route');
  expect(automatic).toHaveValue('/AUTO');
  expect(automatic).toHaveAttribute('readonly');
  fireEvent.click(screen.getByRole('button', { name: 'Edit routing and execution' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit cable' });
  const route = within(dialog).getByRole('textbox', { name: 'Routing' });
  const protect = within(dialog).getByRole('checkbox', { name: 'Manually assigned route — keep' });
  expect(route).toHaveValue('/AUTO');
  expect(protect).not.toBeChecked();
  fireEvent.change(route, { target: { value: '/BC182/BC183' } });
  expect(protect).toBeChecked();
  fireEvent.click(protect);
  expect(protect).not.toBeChecked();
  fireEvent.change(route, { target: { value: '/BC182/BC184' } });
  expect(protect).toBeChecked();
  fireEvent.change(route, { target: { value: '' } });
  expect(protect).not.toBeChecked();
  fireEvent.change(route, { target: { value: '/BC182/BC183' } });
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Install length [m]' }), {
    target: { value: '27' },
  });
  for (const label of ['Pull date', 'Connected From', 'Connected To', 'Cable tested'])
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value: '2026-11-15' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(updateCable).toHaveBeenCalledOnce());
  expect(vi.mocked(updateCable).mock.calls[0][3]).toMatchObject({
    routing: '/BC182/BC183',
    manualRoutingProtected: true,
    expectedRoutingControlRevision: '4',
    expectedCableWriteRevision: '9',
    installLength: 27,
    pullDate: '2026-11-15',
    connectedFrom: '2026-11-15',
    connectedTo: '2026-11-15',
    tested: '2026-11-15',
  });
  expect(vi.mocked(updateCable).mock.calls[0][3]).not.toHaveProperty('autoCalculatedRouting');
});

it('keeps a refused execution-protected route edit open and names the cable and protecting fields', async () => {
  const checked: Cable = {
    ...cable,
    tag: '-WG-4022',
    routing: '/BC182',
    pullDate: '2026-11-15',
    connectedFrom: '2026-11-16',
    routingControl: {
      ...emptyRoutingControl(),
      manualRouting: '/BC182',
      manualProtected: true,
      executionLocked: true,
      executionRouting: '/BC182',
    },
  };
  vi.mocked(fetchCableDetails).mockResolvedValue({
    cable: checked,
    materialCableType: null,
    cableTypeDefaultMaterials: [],
    cableMaterials: [],
  });
  vi.mocked(updateCable).mockRejectedValue(
    new ApiError(409, 'PULL_DATE_RECORDED;CONNECTED_FROM_RECORDED'),
  );
  renderDetails();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit routing and execution' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit cable' });
  expect(within(dialog).getByLabelText('Execution unlock reason')).toBeVisible();
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Routing' }), {
    target: { value: '' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(showToast).toHaveBeenCalledWith({
      intent: 'error',
      title: 'Failed to save cable',
      body: '-WG-4022: route protected by Pull date, Connected From. No changes were saved.',
    }),
  );
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByRole('textbox', { name: 'Routing' })).toHaveValue('');
  expect(screen.getByLabelText('Routing: /BC182')).toHaveTextContent('/BC182');
});

it.each(['pending', 'stale'] as const)(
  'refreshes a %s manual length until the completed result is displayed',
  async (status) => {
    const checked: Cable = {
      ...cable,
      tag: '-WG-4022',
      routing: '/BC182',
      manualRouteLength: 5,
      designLength: 13,
      manualRouteLengthStatus: status,
      routingControlRevision: '4',
      cableWriteRevision: '9',
    };
    const response = {
      cable: checked,
      materialCableType: null,
      cableTypeDefaultMaterials: [],
      cableMaterials: [],
    };
    vi.mocked(fetchCableDetails)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({
        ...response,
        cable: {
          ...checked,
          manualRouteLength: 3,
          manualRouteLengthStatus: 'calculated',
          cableWriteRevision: '8',
        },
      })
      .mockResolvedValue({
        ...response,
        cable: {
          ...checked,
          manualRouteLength: 21,
          designLength: 21,
          manualRouteLengthStatus: 'calculated',
          cableWriteRevision: '10',
        },
      });
    renderDetails();
    expect(
      await screen.findByText(`Manual route length is ${status}. Earlier length is not current.`),
    ).toBeVisible();
    await waitFor(() => expect(fetchCableDetails).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(
      screen.getByText(`Manual route length is ${status}. Earlier length is not current.`),
    ).toBeVisible();
    await screen.findByText('Calculated from the saved manual route.', {}, { timeout: 4000 });
    expect(screen.getByText('Design length [m]').parentElement).toHaveTextContent('21');
    expect(screen.getByText('Calculated manual route length [m]').parentElement).toHaveTextContent(
      '21',
    );
    expect(fetchCableDetails).toHaveBeenCalledTimes(3);
  },
);

it.each([false, true])(
  'explains the manual Design update rule with execution protection=%s',
  async (executionLocked) => {
    const checked: Cable = {
      ...cable,
      routing: '/MANUAL',
      designLength: executionLocked ? 13 : 21,
      manualRouteLength: 21,
      manualRouteLengthStatus: 'calculated',
      routingControl: {
        ...emptyRoutingControl(),
        manualRouting: '/MANUAL',
        manualProtected: true,
        executionLocked,
        executionRouting: executionLocked ? '/MANUAL' : null,
      },
    };
    vi.mocked(fetchCableDetails).mockResolvedValue({
      cable: checked,
      materialCableType: null,
      cableTypeDefaultMaterials: [],
      cableMaterials: [],
    });
    renderDetails();
    expect(
      await screen.findByText(
        executionLocked
          ? 'Execution protection keeps Design length unchanged.'
          : 'A successful check of the used protected manual route updates Design length automatically.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Design length [m]').parentElement).toHaveTextContent(
      executionLocked ? '13' : '21',
    );
    expect(screen.getByText('Calculated manual route length [m]').parentElement).toHaveTextContent(
      '21',
    );
  },
);

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
  const addMaterialButton = await screen.findByRole('button', { name: 'Add cable material' });
  await waitFor(() => expect(addMaterialButton).toBeEnabled());
  await user.click(addMaterialButton);
  const catalog = await screen.findByRole('dialog', { name: 'Add material to cable materials' });
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
  const addMaterialButton = await screen.findByRole('button', { name: 'Add cable material' });
  await waitFor(() => expect(addMaterialButton).toBeEnabled());
  await user.click(addMaterialButton);
  const catalog = await screen.findByRole('dialog', { name: 'Add material to cable materials' });
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
  const addMaterialButton = await screen.findByRole('button', { name: 'Add cable material' });
  await waitFor(() => expect(addMaterialButton).toBeEnabled());
  await user.click(addMaterialButton);
  const catalog = await screen.findByRole('dialog', { name: 'Add material to cable materials' });
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
