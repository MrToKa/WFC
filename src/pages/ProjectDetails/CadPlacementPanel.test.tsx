import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCallback, useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadPlacementPanel } from './CadPlacementPanel';

const projectId = '00000000-0000-4000-8000-000000000001';
const modelVersionId = '00000000-0000-4000-8000-000000000002';
const designId = '00000000-0000-4000-8000-000000000003';
const catalogId = '00000000-0000-4000-8000-000000000004';
const instanceId = '00000000-0000-4000-8000-000000000005';

function mount(
  onShow: () => Promise<void>,
  onFocus = vi.fn().mockResolvedValue(undefined),
  onRemove?: (id: string) => Promise<void>,
  deleteStatus = 204,
) {
  let deleted = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      if (options?.method === 'DELETE') {
        if (deleteStatus === 204) deleted = true;
        return {
          ok: deleteStatus === 204,
          status: deleteStatus,
          json: async () => ({ code: 'STALE_INSTANCE' }),
        };
      }
      return {
        ok: true,
        json: async () =>
          input.endsWith('/designs')
            ? { designs: [{ id: designId, modelVersionId, activeModel: true, status: 'proposed' }] }
            : input.endsWith('/instances')
              ? {
                  instances: deleted
                    ? []
                    : [
                        {
                          id: instanceId,
                          catalogItemId: catalogId,
                          partNumber: 'STRAIGHT-300',
                          manufacturer: 'Niedax',
                          revision: 1,
                          xMm: 100,
                          yMm: 200,
                          zMm: 300,
                          qx: 0,
                          qy: 0,
                          qz: 0,
                          qw: 1,
                        },
                      ],
                }
              : input.endsWith('/connections')
                ? {
                    connections:
                      onRemove && !deleted
                        ? [{ id: 'link', sourceInstanceId: instanceId, targetInstanceId: 'other' }]
                        : [],
                  }
                : { schemaVersion: 1, units: 'mm' },
      };
    }),
  );
  render(
    <FluentProvider theme={webLightTheme}>
      <CadPlacementPanel
        projectId={projectId}
        modelVersionId={modelVersionId}
        token="test-token"
        catalogue={[
          {
            id: catalogId,
            partNumber: 'STRAIGHT-300',
            manufacturer: 'Niedax',
            originalFilename: 'custom.step',
            sourceSha256: 'a'.repeat(64),
            conversionStatus: 'ready',
            materialAssetId: catalogId,
            cadRevision: 1,
          },
        ]}
        onPick={vi.fn()}
        onShow={onShow}
        onMove={vi.fn()}
        onFocus={onFocus}
        onRemove={onRemove}
      />
    </FluentProvider>,
  );
  return onFocus;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saved CAD component focus', { timeout: 20000 }, () => {
  it('waits for the display acknowledgement and focuses only the selected saved component UUID', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const onShow = vi.fn(() => pending);
    const onFocus = mount(onShow);
    const focus = screen.getByRole('button', { name: 'Zoom to selected component' });
    expect(focus).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: /Niedax STRAIGHT-300 — X/ }));
    await waitFor(() => expect(onShow).toHaveBeenCalledOnce());
    expect(focus).toBeDisabled();
    await act(async () => {
      complete();
      await pending;
    });
    await waitFor(() => expect(focus).toBeEnabled());
    expect(screen.getByText('1 of 1 saved components ready in 3D')).toBeInTheDocument();
    fireEvent.click(focus);
    await waitFor(() => expect(onFocus).toHaveBeenCalledWith(instanceId));
    expect(
      await screen.findByText('Camera focused on the selected saved component.'),
    ).toBeInTheDocument();
  });

  it('keeps focus disabled when the saved mesh fails to display', async () => {
    mount(vi.fn().mockRejectedValue(new Error('Mesh unavailable')));
    fireEvent.click(await screen.findByRole('button', { name: /Niedax STRAIGHT-300 — X/ }));
    expect(await screen.findByText('3D rendering: Mesh unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom to selected component' })).toBeDisabled();
    expect(screen.getByText('0 of 1 saved components ready in 3D')).toBeInTheDocument();
  });
});

describe('removing a proposed CAD component', { timeout: 20000 }, () => {
  const choose = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /Niedax STRAIGHT-300 — X/ }));
    const button = screen.getByRole('button', { name: 'Remove selected component' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toHaveTextContent('STRAIGHT-300');
  };
  it('requires selection and confirmation, and Cancel leaves the proposal untouched', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    mount(vi.fn().mockResolvedValue(undefined), undefined, onRemove);
    expect(screen.getByRole('button', { name: 'Remove selected component' })).toBeDisabled();
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(
      false,
    );
    expect(onRemove).not.toHaveBeenCalled();
    expect(
      screen.getByText('Saved component instances: 1; saved connector relationships: 1'),
    ).toBeInTheDocument();
  });
  it('deletes only the selected revision, clears the scene and relationships, and prevents repeat deletion', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    mount(vi.fn().mockResolvedValue(undefined), undefined, onRemove);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    expect(
      await screen.findByText(
        'Component and its connector relationships removed from this proposal.',
      ),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/designs/${designId}/instances/${instanceId}`),
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ expectedRevision: 1 }) }),
    );
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(instanceId);
    expect(
      screen.getByText('Saved component instances: 0; saved connector relationships: 0'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove selected component' })).toBeDisabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps the saved part and its scene when optimistic concurrency rejects the delete', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    mount(vi.fn().mockResolvedValue(undefined), undefined, onRemove, 409);
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    expect(
      await screen.findByText('This component changed. Select it again before removing it.'),
    ).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();
    expect(
      screen.getByText('Saved component instances: 1; saved connector relationships: 1'),
    ).toBeInTheDocument();
  });
  it('reports scene cleanup failure without restoring a successfully deleted server part', async () => {
    mount(
      vi.fn().mockResolvedValue(undefined),
      undefined,
      vi.fn().mockRejectedValue(new Error('Viewer unavailable')),
    );
    await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Remove component' }));
    expect(
      await screen.findByText(
        'Component removed from the proposal. Reload the 3D view to clear its remaining display.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Saved component instances: 0; saved connector relationships: 0'),
    ).toBeInTheDocument();
  });
});

function mountScoped(holdFirstExport = false, withMetadata = false) {
  const secondId = '00000000-0000-4000-8000-000000000006';
  const freeId = '00000000-0000-4000-8000-000000000007';
  const newId = '00000000-0000-4000-8000-000000000008';
  const routeA = '00000000-0000-4000-8000-000000000060';
  const routeB = '00000000-0000-4000-8000-000000000061';
  let rows = [instanceId, secondId, freeId].map((id, index) => ({
    id,
    catalogItemId: catalogId,
    partNumber: ['A-PART', 'B-PART', 'FREE-PART'][index],
    manufacturer: 'Niedax',
    revision: 1,
    xMm: index === 0 ? 123.123456789 : index * 1000,
    yMm: 200,
    zMm: 300,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  }));
  const groups = [
    {
      id: routeA,
      name: 'A-ROUTE',
      tag: 'A-ROUTE',
      color: '#16A34A',
      purpose: 'Low voltage cable tray',
      revision: 1,
      status: 'draft',
      instanceIds: [instanceId],
      projectTrayId: null,
    },
    {
      id: routeB,
      name: 'B-ROUTE',
      tag: 'B-ROUTE',
      color: '#3B82F6',
      purpose: 'Low voltage cable tray',
      revision: 1,
      status: 'draft',
      instanceIds: [secondId],
      projectTrayId: null,
    },
  ];
  const onShow = vi.fn(async () => {}),
    onRemove = vi.fn(async () => {}),
    onColor = vi.fn(async () => {});
  const onProperties = vi.fn<NonNullable<ComponentProps<typeof CadPlacementPanel>['onProperties']>>(
    async () => {},
  );
  const onMove = vi.fn(async () => {}),
    onPick = vi.fn();
  const downloads: string[] = [];
  let finishExport: ((response: unknown) => void) | undefined;
  const exportResponse = { ok: true, blob: async () => new Blob(['test export']) };
  const jsonResponse = (data: unknown) => {
    const snapshot = structuredClone(data);
    return { ok: true, json: async () => structuredClone(snapshot) };
  };
  const request = vi.fn(async (url: string, options: RequestInit = {}) => {
    if (/\/(assembly\.step|materials\.csv)(?:\?|$)/.test(url)) {
      if (holdFirstExport) {
        holdFirstExport = false;
        return new Promise((resolve) => {
          finishExport = resolve;
        });
      }
      return exportResponse;
    }
    if (url.endsWith('/instances') && options.method === 'POST') {
      const input = JSON.parse(String(options.body));
      rows = [
        ...rows,
        {
          ...rows[2],
          id: newId,
          partNumber: 'NEW-PART',
          xMm: input.transform.positionMm.x,
          yMm: input.transform.positionMm.y,
          zMm: input.transform.positionMm.z,
        },
      ];
      return jsonResponse({ id: newId });
    }
    if (url.includes('/routes/') && options.method === 'PATCH') {
      const route = groups.find((row) => url.endsWith('/' + row.id));
      if (!route) throw new Error('Unknown test route');
      Object.assign(route, JSON.parse(String(options.body)), { revision: route.revision + 1 });
      return jsonResponse({ route });
    }
    if (url.endsWith('/routes') && options.method === 'POST') {
      const input = JSON.parse(String(options.body));
      const route = {
        ...groups[0],
        ...input,
        id: '00000000-0000-4000-8000-000000000062',
        tag: input.name,
      };
      groups.push(route);
      return jsonResponse({ route });
    }
    return jsonResponse(
      url.endsWith('/designs')
        ? { designs: [{ id: designId, modelVersionId, activeModel: true, status: 'proposed' }] }
        : url.endsWith('/instances')
          ? {
              instances: rows.map((row) => {
                if (!withMetadata) return row;
                const group = groups.find((group) => group.instanceIds.includes(row.id));
                const route = {
                  id: group?.id ?? null,
                  name: group?.name ?? 'Unassigned components',
                  purpose: group?.purpose ?? null,
                };
                return {
                  ...row,
                  route,
                  metadata: {
                    instanceId: row.id,
                    name: route.name + ' / ' + row.id,
                    actualLengthMm: 6000,
                    widthMm: 300,
                    heightMm: 60,
                    partNumber: row.partNumber,
                    manufacturer: row.manufacturer,
                    purpose: route.purpose,
                    componentKind: 'straight',
                    cadAssetId: catalogId,
                    cadRevision: 1,
                  },
                };
              }),
            }
          : url.endsWith('/connections')
            ? { connections: [] }
            : url.endsWith('/routes')
              ? { routes: groups }
              : url.endsWith('/auto-attachments')
                ? { status: 'network-required', attachments: [] }
                : { schemaVersion: 1, units: 'mm' },
    );
  });
  vi.stubGlobal('fetch', request);
  const NativeURL = URL;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:test-export');
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  function Harness() {
    const [newTrayMode, setMode] = useState(false),
      [epoch, setEpoch] = useState(0),
      [busy, setBusy] = useState(false);
    const open = useCallback(() => {
      setMode(true);
      setEpoch((value) => value + 1);
    }, []);
    const close = useCallback(() => setMode(false), []);
    return (
      <FluentProvider theme={webLightTheme}>
        <button disabled={busy} onClick={open}>
          Begin new tray
        </button>
        <CadPlacementPanel
          projectId={projectId}
          modelVersionId={modelVersionId}
          token="test-token"
          catalogue={[
            {
              id: catalogId,
              partNumber: 'SOURCE-PART',
              manufacturer: 'Niedax',
              originalFilename: 'custom.step',
              sourceSha256: 'a'.repeat(64),
              conversionStatus: 'ready',
              materialAssetId: catalogId,
              cadRevision: 1,
            },
          ]}
          onPick={onPick}
          onShow={onShow}
          onMove={onMove}
          onRemove={onRemove}
          onColor={onColor}
          onProperties={withMetadata ? onProperties : undefined}
          newTrayMode={newTrayMode}
          newTrayEpoch={epoch}
          onNewTray={open}
          onCloseNewTray={close}
          onBusyChange={setBusy}
        />
      </FluentProvider>
    );
  }
  render(<Harness />);
  return {
    request,
    onShow,
    onRemove,
    onProperties,
    downloads,
    routeA,
    routeB,
    newId,
    freeId,
    finishExport: () => {
      if (!finishExport) throw new Error('No export is pending');
      finishExport(exportResponse);
    },
  };
}

describe('saved route component scope and exports', { timeout: 20000 }, () => {
  it('refreshes canonical properties after a route Purpose edit without recreating saved geometry', async () => {
    const fixture = mountScoped(false, true);
    await waitFor(() => expect(fixture.onProperties).toHaveBeenCalledTimes(3));
    expect(fixture.onProperties.mock.calls[0]).toEqual([
      instanceId,
      expect.objectContaining({ widthMm: 300, heightMm: 60, purpose: 'Low voltage cable tray' }),
      expect.objectContaining({ name: 'A-ROUTE' }),
    ]);
    // Select immediately after metadata delivery, while initial draft effects
    // can still be pending. They must not erase the saved route's membership.
    fireEvent.click(await screen.findByRole('button', { name: /A-ROUTE · 1 components/ }));
    await waitFor(() =>
      expect(screen.getByLabelText('Include component ' + instanceId)).toBeChecked(),
    );
    fireEvent.change(screen.getByLabelText('Route purpose'), {
      target: { value: 'Medium voltage cable tray' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save route changes' }));
    await screen.findByText('Route saved. Its colour is applied to all member components.');
    const saved = fixture.request.mock.calls.find(
      ([url, options]) => url.endsWith(`/routes/${fixture.routeA}`) && options?.method === 'PATCH',
    );
    expect(JSON.parse(String(saved?.[1]?.body))).toEqual(
      expect.objectContaining({ instanceIds: [instanceId], purpose: 'Medium voltage cable tray' }),
    );
    await waitFor(() =>
      expect(
        fixture.onProperties.mock.calls.some(
          (call) => call[0] === instanceId && call[1].purpose === 'Medium voltage cable tray',
        ),
      ).toBe(true),
    );
    expect(fixture.onShow).toHaveBeenCalledTimes(3);
    await act(async () => {});
  });

  it('filters the component list by route while keeping every saved mesh in the scene and exact editor coordinates', async () => {
    const fixture = mountScoped();
    await waitFor(() => expect(fixture.onShow).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('form', { name: 'Save component position' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Catalogue component')).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole('button', { name: /A-ROUTE · 1 components/ }, { timeout: 10000 }),
    );
    const list = screen.getByRole('list', { name: 'Placed tray components' });
    expect(
      within(list).getByRole('button', { name: /A-PART — X 123.123, Y 200, Z 300/ }),
    ).toBeInTheDocument();
    expect(within(list).queryByText(/B-PART|FREE-PART/)).not.toBeInTheDocument();
    expect(screen.getByText('Components in A-ROUTE: 1')).toBeInTheDocument();
    expect(screen.queryByLabelText(`Include component ${fixture.freeId}`)).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: /A-PART/ }));
    expect(screen.getByLabelText('x')).toHaveValue(123.123456789);
    expect(screen.queryByLabelText('Catalogue component')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /B-ROUTE · 1 components/ }));
    expect(within(list).getByRole('button', { name: /B-PART/ })).toBeInTheDocument();
    expect(within(list).queryByText(/A-PART|FREE-PART/)).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Save component position' })).not.toBeInTheDocument();
    expect(fixture.onShow).toHaveBeenCalledTimes(3);
    expect(fixture.onRemove).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('starts a new tray with unassigned parts and automatically groups only newly placed components', async () => {
    const fixture = mountScoped();
    fireEvent.click(
      await screen.findByRole('button', { name: /A-ROUTE · 1 components/ }, { timeout: 10000 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Begin new tray' }));
    const list = screen.getByRole('list', { name: 'Placed tray components' });
    expect(within(list).getByRole('button', { name: /FREE-PART/ })).toBeInTheDocument();
    expect(within(list).queryByText(/A-PART|B-PART/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`Include component ${instanceId}`)).not.toBeInTheDocument();
    expect(screen.getByLabelText(`Include component ${fixture.freeId}`)).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Catalogue component'), {
      target: { value: catalogId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new component' }));
    await waitFor(() =>
      expect(screen.getByLabelText(`Include component ${fixture.newId}`)).toBeChecked(),
    );
    expect(screen.getByLabelText(`Include component ${fixture.freeId}`)).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Route name'), { target: { value: 'NEW-ROUTE' } });
    fireEvent.change(screen.getByLabelText('Route purpose'), {
      target: { value: 'Low voltage cable tray' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save complete route' }));
    await screen.findByRole('button', { name: /NEW-ROUTE · 1 components/ });
    const saved = fixture.request.mock.calls.find(
      ([url, options]) => url.endsWith('/routes') && options?.method === 'POST',
    );
    expect(JSON.parse(String(saved?.[1]?.body)).instanceIds).toEqual([fixture.newId]);
    expect(screen.queryByLabelText('Catalogue component')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New route' })).not.toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Begin new tray' })).toBeEnabled(),
      { timeout: 10000 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Begin new tray' }));
    expect(within(list).getByRole('button', { name: /FREE-PART/ })).toBeInTheDocument();
    expect(within(list).queryByText(/NEW-PART|A-PART|B-PART/)).not.toBeInTheDocument();
    expect(fixture.onRemove).not.toHaveBeenCalled();
    await act(async () => {});
  }, 20000);

  it('exports the selected saved route separately from all placements, locks races and disables dirty selected exports', async () => {
    const fixture = mountScoped(true);
    await waitFor(() => expect(fixture.onShow).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('button', { name: 'Export selected tray STEP' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: /A-ROUTE · 1 components/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export selected tray STEP' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export selected tray STEP' }));
    await waitFor(() =>
      expect(
        fixture.request.mock.calls.some(([url]) =>
          url.endsWith(`assembly.step?routeId=${fixture.routeA}`),
        ),
      ).toBe(true),
    );
    expect(screen.getByRole('button', { name: /B-ROUTE · 1 components/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Begin new tray' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export all STEP' })).toBeDisabled();
    await act(async () => fixture.finishExport());
    await screen.findByText('Export prepared: A-ROUTE.step');
    for (const [label, filename] of [
      ['Export selected tray materials list', 'A-ROUTE-materials.csv'],
      ['Export all STEP', 'all-placed-components.step'],
      ['Export all materials list', 'all-placed-components-materials.csv'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      await screen.findByText(`Export prepared: ${filename}`);
    }
    const exports = fixture.request.mock.calls
      .filter(([url]) => /\/(assembly\.step|materials\.csv)(?:\?|$)/.test(url))
      .map(([url]) => url);
    expect(exports).toEqual([
      expect.stringContaining(`/assembly.step?routeId=${fixture.routeA}`),
      expect.stringContaining(`/materials.csv?routeId=${fixture.routeA}`),
      expect.stringMatching(/\/assembly\.step$/),
      expect.stringMatching(/\/materials\.csv$/),
    ]);
    expect(fixture.downloads).toEqual([
      'A-ROUTE.step',
      'A-ROUTE-materials.csv',
      'all-placed-components.step',
      'all-placed-components-materials.csv',
    ]);
    fireEvent.change(screen.getByLabelText('Route name'), { target: { value: 'A-CHANGED' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export selected tray STEP' })).toBeDisabled(),
    );
    expect(
      screen.getByRole('button', { name: 'Export selected tray materials list' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export all STEP' })).toBeEnabled();
    expect(fixture.onShow).toHaveBeenCalledTimes(3);
    expect(fixture.onRemove).not.toHaveBeenCalled();
  }, 20000);
});
