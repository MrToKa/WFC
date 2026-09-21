import { useRef } from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cable } from '@/api/client';
import { DEFAULT_CABLE_LIST_COLUMNS, type CableListColumnId } from '@/api/cableListPreferences';
import { toCableFormState } from '../ProjectDetails.forms';
import { useProjectDetailsStyles } from '../ProjectDetails.styles';
import { CableListTab } from './CableListTab';

const auth = vi.hoisted(() => ({ token: 'user-a' }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));

const cable: Cable = {
  id: 'cable-1',
  projectId: 'project-1',
  cableId: 42,
  revision: 'A',
  mto: 'LV',
  tag: 'CABLE-42',
  cableTypeId: 'type-1',
  typeName: 'Type A',
  fromLocation: 'Panel A',
  toLocation: 'Panel B',
  routing: 'TRAY-01',
  designLength: 25,
  purpose: null,
  diameterMm: null,
  weightKgPerM: null,
  delivery: null,
  installLength: null,
  pullDate: null,
  connectedFrom: null,
  connectedTo: null,
  tested: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const draftChange = vi.fn();
const exportList = vi.fn();

const Harness = ({
  editable = false,
  canExport = false,
}: {
  editable?: boolean;
  canExport?: boolean;
}) => {
  const styles = useProjectDetailsStyles();
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <CableListTab
      styles={styles}
      canManageCables={editable}
      isAdmin={false}
      canExport={canExport}
      filterText=""
      onFilterTextChange={vi.fn()}
      filterCriteria="all"
      onFilterCriteriaChange={vi.fn()}
      isRefreshing={false}
      onRefresh={vi.fn()}
      onCreate={vi.fn()}
      onImportClick={vi.fn()}
      onExport={exportList}
      onExportChangeTracker={vi.fn()}
      onGetTemplate={vi.fn()}
      onImportFileChange={vi.fn()}
      isImporting={false}
      isExporting={false}
      isGettingTemplate={false}
      fileInputRef={fileInputRef}
      inlineEditingEnabled={editable}
      onInlineEditingToggle={vi.fn()}
      inlineUpdatingIds={new Set()}
      isInlineEditable={editable}
      cableTypes={[]}
      items={[cable]}
      drafts={{ [cable.id]: toCableFormState(cable) }}
      onDraftChange={draftChange}
      onTextFieldBlur={vi.fn()}
      onInlineMtoChange={vi.fn()}
      onInlineCableTypeChange={vi.fn()}
      onOpenVersions={vi.fn()}
      onCloseVersions={vi.fn()}
      versionsDialog={{ open: false, cable: null, versions: [], loading: false, error: null }}
      pendingId={null}
      onDetails={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      error={null}
      isLoading={false}
      showPagination={false}
      page={1}
      totalPages={1}
      onPreviousPage={vi.fn()}
      onNextPage={vi.fn()}
      onPageSelect={vi.fn()}
    />
  );
};

const view = (editable = false, canExport = false) => (
  <FluentProvider theme={webLightTheme}>
    <Harness key={auth.token} editable={editable} canExport={canExport} />
  </FluentProvider>
);
const stored = new Map<string, CableListColumnId[]>();
const requests: { method: string; token: string; body?: string }[] = [];
let failLoad = false;
let failSave = false;
let pendingSave: Promise<void> | null = null;

beforeEach(() => {
  // Provide layout measurements so Tabster can activate the modal in jsdom.
  vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.parentElement;
  });
  auth.token = 'user-a';
  stored.clear();
  requests.length = 0;
  failLoad = false;
  failSave = false;
  pendingSave = null;
  draftChange.mockReset();
  exportList.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options: RequestInit) => {
      expect(new URL(input).pathname).toBe('/api/users/me/cable-list-columns');
      const token = new Headers(options.headers).get('Authorization')!.replace('Bearer ', '');
      const method = options.method ?? 'GET';
      requests.push({ method, token, body: options.body as string | undefined });
      if ((method === 'GET' && failLoad) || (method === 'PUT' && failSave)) {
        return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 });
      }
      if (method === 'PUT') {
        if (pendingSave) await pendingSave;
        stored.set(token, JSON.parse(options.body as string).columns);
      }
      return new Response(
        JSON.stringify({ columns: stored.get(token) ?? DEFAULT_CABLE_LIST_COLUMNS }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const openColumns = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Columns' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
  const dialog = screen.getByRole('dialog', { name: 'Cable list columns' });
  act(() => dialog.focus());
  return within(dialog);
};
const saveColumns = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
};
const headers = () =>
  within(screen.getByRole('table', { hidden: true }))
    .getAllByRole('columnheader', { hidden: true })
    .map((cell) => cell.textContent);

describe('personal cable list columns', () => {
  it('exports the currently applied selection after changing columns', async () => {
    stored.set('user-a', ['tag', 'routing', 'actions']);
    render(view(false, true));
    const dialog = await openColumns();
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Routing' }));
    await saveColumns();
    fireEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
    expect(exportList).toHaveBeenCalledWith(['tag', 'actions']);
  });
  it('lets a read-only user hide matching headers and cells, with choices isolated by account and restored after remount', async () => {
    const page = render(view());
    const dialog = await openColumns();
    expect(headers()).toHaveLength(10);
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Routing' }));
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Actions' }));
    await saveColumns();
    expect(headers()).not.toContain('Routing');
    expect(headers()).not.toContain('Actions');
    expect(screen.queryByText('TRAY-01')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('cell')).toHaveLength(8);
    expect(requests.find(({ method }) => method === 'PUT')?.token).toBe('user-a');

    auth.token = 'user-b';
    page.rerender(view());
    await screen.findByRole('table');
    expect(headers()).toHaveLength(10);
    expect(screen.getByText('TRAY-01')).toBeInTheDocument();

    auth.token = 'user-a';
    page.rerender(view());
    await screen.findByRole('table');
    expect(headers()).not.toContain('Routing');
    expect(headers()).not.toContain('Actions');
    expect(requests.filter(({ method }) => method === 'PUT')).toHaveLength(1);
  });

  it('discards cancelled choices, prevents an empty data table, and restores all columns', async () => {
    stored.set('user-a', ['tag']);
    render(view());
    let dialog = await openColumns();
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Tag' }));
    expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(dialog.getByRole('alert')).toHaveTextContent('Select at least one data column.');
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(headers()).toEqual(['Tag']);
    expect(requests.some(({ method }) => method === 'PUT')).toBe(false);

    dialog = await openColumns();
    expect(dialog.getByRole('checkbox', { name: 'Tag' })).toBeChecked();
    fireEvent.click(dialog.getByRole('button', { name: 'Show all columns' }));
    await saveColumns();
    expect(headers()).toHaveLength(10);
    expect(stored.get('user-a')).toEqual(DEFAULT_CABLE_LIST_COLUMNS);
  });

  it('keeps the saved table and draft on a save error and allows retry', async () => {
    render(view());
    const dialog = await openColumns();
    const routing = dialog.getByRole('checkbox', { name: 'Routing' });
    const save = dialog.getByRole('button', { name: 'Save' });
    fireEvent.click(routing);
    failSave = true;
    fireEvent.click(save);
    expect(await dialog.findByRole('alert')).toHaveTextContent('Could not save');
    expect(headers()).toContain('Routing');
    expect(routing).not.toBeChecked();
    failSave = false;
    fireEvent.click(save);
    await waitFor(() => expect(save).not.toBeInTheDocument());
    expect(headers()).not.toContain('Routing');
  });

  it('falls back to the full table after a load error, then reloads saved settings on retry', async () => {
    failLoad = true;
    stored.set('user-a', ['tag']);
    render(view());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    expect(headers()).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Columns' })).toBeDisabled();
    failLoad = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry column settings' }));
    await waitFor(() => expect(headers()).toEqual(['Tag']));
  });

  it('preserves inline editing in selected columns and removes hidden inputs', async () => {
    stored.set('user-a', ['tag', 'designLength', 'actions']);
    render(view(true));
    await screen.findByRole('table');
    expect(headers()).toEqual(['Tag', 'Design length [m]', 'Actions']);
    expect(screen.queryByRole('textbox', { name: 'Routing' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Cable tag' }), {
      target: { value: 'UPDATED' },
    });
    expect(draftChange).toHaveBeenCalledWith('cable-1', 'tag', 'UPDATED');
    expect(screen.getByRole('spinbutton', { name: 'Design length' })).toHaveValue(25);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('ignores a pending save response after switching accounts', async () => {
    let finishSave!: () => void;
    pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const page = render(view());
    const dialog = await openColumns();
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Routing' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    expect(dialog.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    auth.token = 'user-b';
    stored.set('user-b', ['tag']);
    page.rerender(view());
    await screen.findByRole('table');
    expect(headers()).toEqual(['Tag']);
    await act(async () => {
      finishSave();
    });
    expect(headers()).toEqual(['Tag']);
    expect(stored.get('user-b')).toEqual(['tag']);
  });
});
