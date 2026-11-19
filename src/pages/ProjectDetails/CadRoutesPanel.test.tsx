import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadRouteGroup } from '../../../shared/cadRouteGroups';
import { CadRoutesPanel } from './CadRoutesPanel';
import { projectTrayPurposesRequest } from '@/api/projectTrayPurposes';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

vi.mock('@/api/projectTrayPurposes', () => ({ projectTrayPurposesRequest: vi.fn() }));
const purposesRequest = vi.mocked(projectTrayPurposesRequest);

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const instances = [1, 2, 3].map((n) => ({
  id: id(n),
  partNumber: `PART-${n}`,
  revision: 1,
  xMm: n * 1000,
  yMm: 0,
  zMm: 0,
}));
const displayedIds = [id(1), id(2)];
const draft: CadRouteGroup = {
  id: id(10),
  name: 'Main riser',
  tag: 'TRAY-01',
  color: '#16A34A',
  purpose: 'Low voltage cable tray',
  revision: 7,
  status: 'draft',
  instanceIds: [id(1), id(3)],
  projectTrayId: null,
};
const automaticAttachments = [
  { instanceId: id(1), portName: 'start', targetObjectRevisionId: id(20), targetPortIndex: 1 },
  { instanceId: id(3), portName: 'end', targetObjectRevisionId: id(21), targetPortIndex: 0 },
];
const autoResult = { status: 'aligned', attachments: automaticAttachments };
const fetchMock = vi.fn();
const onColor = vi.fn(async (_id: string, _color: string) => {});
const writes = () =>
  fetchMock.mock.calls.filter(([, options]) => ['POST', 'PATCH'].includes(options?.method));
function show(
  onGeometryChanged?: () => Promise<void>,
  onConnectionsChanged?: () => Promise<void>,
  onTraysChanged?: () => Promise<void>,
) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <CadRoutesPanel
        projectId={id(50)}
        designId={id(51)}
        token="cad-token"
        instances={instances}
        displayedIds={displayedIds}
        onColor={onColor}
        onGeometryChanged={onGeometryChanged}
        onConnectionsChanged={onConnectionsChanged}
        onTraysChanged={onTraysChanged}
      />
    </FluentProvider>,
  );
}
function fields(name = 'tray-01') {
  fireEvent.change(screen.getByLabelText('Route name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Route purpose'), { target: { value: draft.purpose } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Route colour hex' }), {
    target: { value: '#16a34a' },
  });
}
function catalogue(routes: CadRouteGroup[]) {
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (url.endsWith('/auto-attachments') ? autoResult : { routes }),
  }));
}
beforeEach(() => {
  showToast.mockClear();
  purposesRequest.mockReset().mockResolvedValue([{ name: draft.purpose, trayCount: 9 }]);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  onColor.mockClear();
  catalogue([]);
});
afterEach(() => vi.unstubAllGlobals());

describe('automatic Trays display updates after membership changes', () => {
  function membershipCatalogue(sourceAssigned: boolean, refused = false) {
    let saved = { ...draft };
    const source = {
      ...draft,
      id: id(11),
      name: 'Source route',
      tag: 'SOURCE',
      instanceIds: [id(2)],
    };
    let routes = sourceAssigned ? [saved, source] : [saved];
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (options.method === 'POST' || options.method === 'PATCH') {
        if (refused)
          return { ok: false, status: 409, json: async () => ({ code: 'STALE_CAD_ROUTE' }) };
        saved = {
          ...saved,
          revision: saved.revision + 1,
          instanceIds: [...saved.instanceIds, id(2)],
        };
        routes = sourceAssigned
          ? [saved, { ...source, revision: source.revision + 1, instanceIds: [] }]
          : [saved];
        return { ok: true, json: async () => ({ route: saved }) };
      }
      return {
        ok: true,
        json: async () => (url.endsWith('/auto-attachments') ? autoResult : { routes }),
      };
    });
  }
  async function addSection() {
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add existing section' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add existing section' }));
    const panel = screen.getByRole('region', { name: 'Add existing section' });
    fireEvent.click(within(panel).getByRole('radio', { name: /PART-2/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Add section' }));
  }
  it.each([true, false])(
    'updates Trays automatically after assigning an existing section, source assigned=%s',
    async (sourceAssigned) => {
      membershipCatalogue(sourceAssigned);
      const traysChanged = vi.fn(async () => {});
      show(undefined, undefined, traysChanged);
      await addSection();
      await waitFor(() => expect(traysChanged).toHaveBeenCalledOnce());
      expect(
        await screen.findByRole('button', { name: /Main riser · 3 components/ }),
      ).toBeInTheDocument();
      if (sourceAssigned)
        expect(
          screen.getByRole('button', { name: /Source route · 0 components/ }),
        ).toBeInTheDocument();
      expect(writes()).toHaveLength(1);
      expect(writes()[0][0]).toMatch(
        sourceAssigned ? /\/sections$/ : new RegExp(`/routes/${draft.id}$`),
      );
      expect(writes()[0][1].method).toBe(sourceAssigned ? 'POST' : 'PATCH');
      expect(writes().some(([url]) => url.endsWith('/trays-list'))).toBe(false);
    },
  );
  it('does not announce changed Trays when the section transfer is refused', async () => {
    membershipCatalogue(true, true);
    const traysChanged = vi.fn(async () => {});
    show(undefined, undefined, traysChanged);
    await addSection();
    await screen.findByText('STALE_CAD_ROUTE');
    expect(traysChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Main riser · 2 components/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Source route · 1 components/ })).toBeInTheDocument();
  });
  it('keeps the saved transfer visible when only reloading the Trays display fails', async () => {
    membershipCatalogue(true);
    const traysChanged = vi.fn().mockRejectedValue(new Error('Display unavailable'));
    show(undefined, undefined, traysChanged);
    await addSection();
    await screen.findByText(
      'Section assignment and Trays entries saved. The Trays display could not be reloaded; reopen the project to see the updated entries.',
    );
    expect(screen.getByRole('button', { name: /Main riser · 3 components/ })).toBeInTheDocument();
    expect(showToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Section added', intent: 'warning' }),
    );
    expect(writes()).toHaveLength(1);
  });
  it('updates Trays after saving changed membership without using Refresh routes', async () => {
    let saved = { ...draft };
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (options.method === 'PATCH') {
        const value = JSON.parse(String(options.body));
        saved = { ...saved, ...value, revision: saved.revision + 1 };
        return { ok: true, json: async () => ({ route: saved }) };
      }
      return {
        ok: true,
        json: async () => (url.endsWith('/auto-attachments') ? autoResult : { routes: [saved] }),
      };
    });
    const traysChanged = vi.fn(async () => {});
    show(undefined, undefined, traysChanged);
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: `Include component ${id(3)}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Save route changes' }));
    await waitFor(() => expect(traysChanged).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: /Main riser · 1 components/ })).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
  });
});

describe('complete CAD routes', () => {
  it('shows independent Trays and network indicators for saved routes', async () => {
    catalogue([
      draft,
      { ...draft, id: id(11), name: 'Listed route', exportedTrayId: id(70) },
      { ...draft, id: id(12), name: 'Published route', status: 'published', projectTrayId: id(71) },
    ]);
    show();
    await screen.findByRole('button', { name: /Main riser/ });
    const [unlisted, listed, published] = screen.getAllByRole('listitem');
    expect(within(unlisted).queryByRole('img')).not.toBeInTheDocument();
    expect(within(listed).getByRole('img', { name: 'In Trays list' })).toBeInTheDocument();
    expect(
      within(listed).queryByRole('img', { name: 'In routing network' }),
    ).not.toBeInTheDocument();
    expect(within(published).getByRole('img', { name: 'In Trays list' })).toBeInTheDocument();
    expect(within(published).getByRole('img', { name: 'In routing network' })).toBeInTheDocument();
  });

  it('offers only purposes used by existing project trays, including custom names', async () => {
    purposesRequest.mockResolvedValue([
      { name: draft.purpose, trayCount: 9 },
      { name: 'Project-specific purpose', trayCount: 2 },
      { name: 'Medium voltage cable tray', trayCount: 0 },
      { name: 'EMC cable tray', trayCount: 0 },
    ]);
    show();
    const select = screen.getByLabelText('Route purpose');
    await within(select).findByRole('option', { name: 'Project-specific purpose' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose purpose', draft.purpose, 'Project-specific purpose']);
    expect(purposesRequest).toHaveBeenCalledWith(id(50), 'cad-token');
    fireEvent.change(select, { target: { value: 'Project-specific purpose' } });
    expect(select).toHaveValue('Project-specific purpose');
  });

  it('does not offer configured or template purposes when the project has no trays', async () => {
    purposesRequest.mockResolvedValue([{ name: draft.purpose, trayCount: 0 }]);
    show();
    await screen.findByText('No tray purposes are available in this project.');
    expect(within(screen.getByLabelText('Route purpose')).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save complete route' })).toBeDisabled();
  });

  it('marks a removed saved purpose unavailable and requires a current choice', async () => {
    purposesRequest.mockResolvedValue([{ name: 'Current purpose', trayCount: 1 }]);
    catalogue([draft]);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    expect(
      screen.getByRole('option', { name: `${draft.purpose} (unavailable in this project)` }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save route changes' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Save route changes' }).closest('form')!);
    expect(
      screen.getByText('Choose a purpose available in this project before saving.'),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Route purpose'), {
      target: { value: 'Current purpose' },
    });
    expect(screen.getByRole('button', { name: 'Save route changes' })).toBeEnabled();
    await screen.findByRole('button', { name: 'Align whole route to network point' });
    await waitFor(() =>
      expect(screen.queryByText('Finding connection points…')).not.toBeInTheDocument(),
    );
  });

  it('keeps choices unavailable while loading and reports an empty project catalog', async () => {
    let finish!: (purposes: []) => void;
    purposesRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    show();
    expect(screen.getByLabelText('Route purpose')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save complete route' })).toBeDisabled();
    await act(async () => {
      finish([]);
    });
    expect(screen.getByText('No tray purposes are available in this project.')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save complete route' })).toBeDisabled();
  });

  it('blocks choices after a catalog failure and retries through Refresh routes', async () => {
    purposesRequest.mockRejectedValueOnce(new Error('Purpose catalog unavailable'));
    show();
    await screen.findByText('Purpose catalog unavailable');
    expect(screen.getByLabelText('Route purpose')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save complete route' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh routes' }));
    await screen.findByRole('option', { name: draft.purpose });
    expect(screen.getByLabelText('Route purpose')).toBeEnabled();
  });

  it('does not submit stale automatic draft IDs that are outside the current unassigned component scope', async () => {
    let routes: CadRouteGroup[] = [];
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (options.method === 'POST') {
        const route = { ...draft, name: 'TRAY-01', instanceIds: [id(1)] };
        routes = [route];
        return { ok: true, json: async () => ({ route }) };
      }
      return {
        ok: true,
        json: async () => (url.endsWith('/auto-attachments') ? autoResult : { routes }),
      };
    });
    const panel = (draftIds: string[]) => (
      <FluentProvider theme={webLightTheme}>
        <CadRoutesPanel
          projectId={id(50)}
          designId={id(51)}
          token="cad-token"
          instances={instances}
          displayedIds={displayedIds}
          onColor={onColor}
          memberScopeIds={[id(1)]}
          newDraftInstanceIds={draftIds}
          creationActive
          onNewRoute={vi.fn()}
        />
      </FluentProvider>
    );
    const view = render(panel([]));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save complete route' })).toBeEnabled(),
    );
    view.rerender(panel([id(1), id(2)]));
    await waitFor(() => expect(screen.getByLabelText(`Include component ${id(1)}`)).toBeChecked());
    expect(screen.queryByLabelText(`Include component ${id(2)}`)).not.toBeInTheDocument();
    fields();
    fireEvent.click(screen.getByRole('button', { name: 'Save complete route' }));
    await screen.findByText('Route saved. Its colour is applied to all member components.');
    expect(JSON.parse(writes()[0][1].body).instanceIds).toEqual([id(1)]);
  });
  it('adds a saved route to the Trays list without a prepared network or endpoint attachment', async () => {
    const geometryChanged = vi.fn(async () => {});
    const traysChanged = vi.fn(async () => {});
    let completeExport!: (value: unknown) => void;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url.endsWith('/trays-list') && options.method === 'POST')
        return new Promise((resolve) => {
          completeExport = resolve;
        });
      return {
        ok: true,
        json: async () =>
          url.endsWith('/auto-attachments')
            ? {
                status: 'network-required',
                attachments: [],
                diagnostics: { message: 'No prepared Path Finder network is available.' },
              }
            : { routes: [draft] },
      };
    });
    show(geometryChanged, undefined, traysChanged);
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    expect(
      await screen.findByText('No prepared Path Finder network is available.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Add to trays list/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Add to trays list/i }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.getByRole('button', { name: /Add to trays list/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Add to trays list/i }));
    expect(writes()).toHaveLength(1);
    await act(async () =>
      completeExport({
        ok: true,
        json: async () => ({ trayId: id(70), lengthMm: 2680.25, reused: false }),
      }),
    );
    expect(writes()[0][0]).toMatch(new RegExp(`/routes/${draft.id}/trays-list$`));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ expectedRevision: 7 });
    expect(writes()[0][1].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer cad-token' }),
    );
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Trays list/i));
    expect(screen.getByRole('img', { name: 'In Trays list' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'In routing network' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Centreline length: 2.680 m.');
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Route added to trays list',
        intent: 'success',
        body: expect.stringContaining('Centreline length: 2.680 m.'),
      }),
    );
    expect(
      screen.queryByRole('button', { name: 'Withdraw from routing network' }),
    ).not.toBeInTheDocument();
    expect(geometryChanged).not.toHaveBeenCalled();
    expect(traysChanged).toHaveBeenCalledOnce();
    expect(
      fetchMock.mock.calls.some(([url]) => /\/publish$|\/align$|\/instances\//.test(url)),
    ).toBe(false);
  });

  it('requires pending name or membership changes to be saved before copying the route to the Trays list', async () => {
    catalogue([draft]);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add to trays list/i })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Route name'), { target: { value: 'R-102' } });
    expect(screen.getByRole('button', { name: /Add to trays list/i })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it('reports a stale Trays list export without pretending that the route was copied or published', async () => {
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) =>
      options.method === 'POST'
        ? {
            ok: false,
            status: 409,
            json: async () => ({
              code: 'STALE_CAD_ROUTE',
              message: 'The route changed before the Trays list could be updated.',
            }),
          }
        : {
            ok: true,
            json: async () =>
              url.endsWith('/auto-attachments')
                ? { status: 'network-required', attachments: [] }
                : { routes: [draft] },
          },
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Add to trays list/i })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Add to trays list/i }));
    expect(
      await screen.findByText('The route changed before the Trays list could be updated.'),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Add to trays list/i })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /Main riser · 2 components · draft/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Withdraw from routing network' }),
    ).not.toBeInTheDocument();
  });

  it('shows a saved installation transition and its routing length even before an existing network is available', async () => {
    const geometryChanged = vi.fn(async () => {});
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith('/auto-attachments')
          ? {
              status: 'network-required',
              attachments: [],
              diagnostics: {
                message: 'Prepare the existing routing network first.',
                logicalTransitions: [
                  {
                    sourceInstanceId: id(1),
                    sourcePortName: 'end',
                    targetInstanceId: id(3),
                    targetPortName: 'start',
                    gapMm: 180,
                  },
                ],
              },
            }
          : { routes: [draft] },
    }));
    show(geometryChanged);
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    expect(
      await screen.findByRole('list', { name: 'Installation routing transitions' }),
    ).toHaveTextContent('Component 1 end → component 3 start: 180 mm routing transition');
    expect(screen.getByText('Prepare the existing routing network first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled();
    expect(geometryChanged).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
  });
  it('reads incomplete topology without writing, then auto-connects at the saved revision and refreshes the parent graph', async () => {
    let routes = [draft];
    let connected = false;
    const connectionsChanged = vi.fn(async () => {});
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url.endsWith('/auto-connect') && options.method === 'POST') {
        connected = true;
        routes = [{ ...draft, revision: 8 }];
        return {
          ok: true,
          json: async () => ({ id: draft.id, revision: 8, connectionsCreated: 1, connected: true }),
        };
      }
      return {
        ok: true,
        json: async () =>
          url.endsWith('/auto-attachments')
            ? connected
              ? autoResult
              : {
                  status: 'incomplete',
                  attachments: [],
                  diagnostics: {
                    message: 'The saved parts need one internal connector relationship.',
                    nearestGaps: [
                      {
                        sourceInstanceId: id(1),
                        sourcePortName: 'end',
                        targetInstanceId: id(3),
                        targetPortName: 'start',
                        gapMm: 0.2,
                        aligned: true,
                      },
                    ],
                  },
                }
            : { routes },
      };
    });
    show(undefined, connectionsChanged);
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    expect(
      await screen.findByText('The saved parts need one internal connector relationship.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Align whole route to network point' }),
    ).toBeDisabled();
    expect(writes()).toHaveLength(0);
    expect(screen.queryByLabelText('Route end 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Auto-select connection points' }));
    await waitFor(() => expect(connectionsChanged).toHaveBeenCalledOnce());
    expect(
      await screen.findByText(
        /1 component connections and 0 routing transitions saved automatically/,
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled(),
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatch(new RegExp(`/routes/${draft.id}/auto-connect$`));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ expectedRevision: 7 });
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith('/auto-attachments')).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          /\/instances\//.test(url) && ['PATCH', 'POST'].includes(options?.method),
      ),
    ).toBe(false);
  });

  it.each(['network-required', 'ambiguous', 'unavailable'])(
    'clears stale optional alignment matches while allowing automatic publication when the next route is %s',
    async (status) => {
      const other = {
        ...draft,
        id: id(11),
        tag: 'OTHER-02',
        name: 'Other run',
        instanceIds: [id(2)],
      };
      const diagnostic = `Automatic connection refused: ${status}.`;
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: async () =>
          url.endsWith(`/${draft.id}/auto-attachments`)
            ? autoResult
            : url.endsWith('/auto-attachments')
              ? { status, attachments: [], diagnostics: { message: diagnostic } }
              : { routes: [draft, other] },
      }));
      show();
      fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole('button', { name: /Other run/ }));
      expect(await screen.findByText(diagnostic)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled();
      expect(
        screen.getByRole('button', { name: 'Align whole route to network point' }),
      ).toBeDisabled();
      expect(screen.queryByLabelText('Route end 1')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Network point 1')).not.toBeInTheDocument();
      expect(writes()).toHaveLength(0);
    },
  );

  it('changes a published route colour without withdrawing or altering its members', async () => {
    let routes: CadRouteGroup[] = [{ ...draft, status: 'published', projectTrayId: id(70) }];
    fetchMock.mockImplementation(async (_url: string, options: RequestInit = {}) => {
      if (options.method === 'PATCH') {
        routes = [{ ...routes[0], color: '#3B82F6', revision: 8 }];
        return { ok: true, json: async () => ({ route: routes[0] }) };
      }
      return { ok: true, json: async () => ({ routes }) };
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    expect(screen.getByLabelText('Route name')).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Route colour hex' }), {
      target: { value: '#3b82f6' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save route changes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].method).toBe('PATCH');
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      name: draft.name,
      tag: draft.tag,
      color: '#3B82F6',
      purpose: draft.purpose,
      instanceIds: draft.instanceIds,
      expectedRevision: 7,
    });
    await waitFor(() => expect(onColor).toHaveBeenCalledWith(id(1), '#3B82F6'));
    expect(
      screen.getByRole('button', { name: 'Withdraw from routing network' }),
    ).toBeInTheDocument();
  });
  it('aligns the entire saved group and refreshes geometry before publication', async () => {
    let routes = [draft];
    const geometryChanged = vi.fn(async () => {});
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (options.method === 'POST') {
        routes = [{ ...draft, revision: 8 }];
        return { ok: true, json: async () => ({ id: draft.id, revision: 8 }) };
      }
      return {
        ok: true,
        json: async () =>
          url.endsWith('/auto-attachments')
            ? { ...autoResult, status: routes[0].revision === 7 ? 'alignment-required' : 'aligned' }
            : { routes },
      };
    });
    show(geometryChanged);
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Align whole route to network point' }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Align whole route to network point' }));
    await waitFor(() => expect(geometryChanged).toHaveBeenCalledOnce());
    expect(writes()[0][0]).toMatch(/\/align$/);
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      expectedRevision: 7,
      attachment: {
        instanceId: id(1),
        portName: 'start',
        targetObjectRevisionId: id(20),
        targetPortIndex: 1,
      },
    });
    expect(await screen.findByText(/Whole route aligned and saved/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Main riser · 2 components · draft/ }),
    ).toBeInTheDocument();
  });
  it('requires unsaved member or name changes to be saved before network publication', async () => {
    catalogue([draft]);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Route name'), { target: { value: 'New name' } });
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });
  it('saves selected members with one canonical route name, purpose and color, then applies color only to displayed members', async () => {
    let routes: CadRouteGroup[] = [];
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (options.method === 'POST') {
        routes = [{ ...draft, name: 'TRAY-01' }];
        return { ok: true, json: async () => ({ route: routes[0] }) };
      }
      return {
        ok: true,
        json: async () => (url.endsWith('/auto-attachments') ? autoResult : { routes }),
      };
    });
    show();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save complete route' })).toBeEnabled(),
    );
    fields();
    expect(screen.getByLabelText('Route name')).toHaveValue('TRAY-01');
    expect(screen.queryByLabelText('Route tag')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(`Include component ${id(1)}`));
    fireEvent.click(screen.getByLabelText(`Include component ${id(3)}`));
    fireEvent.click(screen.getByRole('button', { name: 'Save complete route' }));
    expect(
      await screen.findByText('Route saved. Its colour is applied to all member components.'),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatch(/\/cad-design\/designs\/.*\/routes$/);
    expect(writes()[0][1].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer cad-token' }),
    );
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      name: 'TRAY-01',
      purpose: draft.purpose,
      color: '#16A34A',
      instanceIds: [id(1), id(3)],
    });
    await waitFor(() => expect(onColor).toHaveBeenCalledWith(id(1), '#16A34A'));
    expect(onColor).not.toHaveBeenCalledWith(id(3), expect.any(String));
    expect(
      screen.getByRole('button', { name: /TRAY-01 · 2 components · draft/ }),
    ).toBeInTheDocument();
  });

  it('restores a saved route color on load and prevents taking members from another route', async () => {
    catalogue([draft]);
    show();
    await screen.findByRole('button', { name: /Main riser/ });
    await waitFor(() => expect(onColor).toHaveBeenCalledWith(id(1), '#16A34A'));
    expect(onColor).toHaveBeenCalledWith(id(2), '#D9AB33');
    expect(onColor).not.toHaveBeenCalledWith(id(3), expect.any(String));
    expect(screen.getByLabelText(`Include component ${id(1)}`)).toBeDisabled();
    expect(screen.getByLabelText(`Include component ${id(2)}`)).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Main riser/ }));
    expect(screen.getByLabelText(`Include component ${id(1)}`)).toBeEnabled();
    expect(screen.getByLabelText(`Include component ${id(1)}`)).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    expect(screen.getByLabelText(`Include component ${id(1)}`)).toBeDisabled();
  });

  it.each(['invalid name', 'empty members'])(
    'rejects %s without a write request',
    async (reason) => {
      show();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save complete route' })).toBeEnabled(),
      );
      fields(reason === 'invalid name' ? 'NOT A NAME' : 'TRAY-01');
      if (reason === 'invalid name')
        fireEvent.click(screen.getByLabelText(`Include component ${id(1)}`));
      fireEvent.click(screen.getByRole('button', { name: 'Save complete route' }));
      expect(screen.getByRole('status')).toHaveTextContent(/name|component/i);
      expect(writes()).toHaveLength(0);
    },
  );

  it('publishes saved geometry automatically without submitting optional alignment attachments', async () => {
    let saved = draft;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url.endsWith('/publish') && options.method === 'POST') {
        saved = { ...draft, status: 'published', revision: 8, projectTrayId: id(30) };
        return { ok: true, json: async () => ({ route: saved }) };
      }
      return {
        ok: true,
        json: async () => (url.endsWith('/auto-attachments') ? autoResult : { routes: [saved] }),
      };
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled(),
    );
    expect(writes()).toHaveLength(0);
    expect(screen.queryByLabelText('Route end 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Network point 1')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auto-attachments$/),
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer cad-token' }),
      }),
    );
    expect(
      fetchMock.mock.calls
        .filter(([url]) => url.endsWith('/auto-attachments'))
        .every(([, options]) => !options.method || options.method === 'GET'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add to routing network' }));
    expect(await screen.findByText('Route added to the routing network.')).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatch(new RegExp(`/routes/${draft.id}/publish$`));
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      expectedRevision: 7,
      schemaVersion: 'wfc.cad.route-publication.write.v3',
    });
    expect(
      await screen.findByRole('button', { name: 'Withdraw from routing network' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'In Trays list' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'In routing network' })).toBeInTheDocument();
    expect(screen.getByLabelText('Route name')).toBeDisabled();
  });

  it('publishes a routable component automatically when no compatible base connection exists', async () => {
    let saved = draft;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url.endsWith('/publish') && options.method === 'POST') {
        saved = {
          ...draft,
          status: 'published',
          revision: 8,
          projectTrayId: id(30),
          networkMode: 'automatic',
        };
        return { ok: true, json: async () => ({ route: saved }) };
      }
      return {
        ok: true,
        json: async () =>
          url.endsWith('/auto-attachments')
            ? { status: 'no-compatible-points', attachments: [] }
            : { routes: [saved] },
      };
    });
    const refreshed = vi.fn(async () => {});
    show(undefined, undefined, refreshed);
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    expect(screen.queryByRole('checkbox', { name: /Independent route/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled();
    expect(screen.queryByText('Connections to existing routing network')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to routing network' }));
    expect(await screen.findByText('Route added to the routing network.')).toBeInTheDocument();
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      schemaVersion: 'wfc.cad.route-publication.write.v3',
      expectedRevision: 7,
    });
    expect(refreshed).toHaveBeenCalledOnce();
    expect(
      screen.getByText(/Routes can be separate or connect to nearby trays/),
    ).toBeInTheDocument();
  });

  it('reports a stale publication refusal and keeps the saved route in draft', async () => {
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) =>
      options.method === 'POST'
        ? { ok: false, status: 409, json: async () => ({ code: 'STALE_CAD_ROUTE' }) }
        : {
            ok: true,
            json: async () =>
              url.endsWith('/auto-attachments') ? autoResult : { routes: [draft] },
          },
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to routing network' }));
    expect(await screen.findByText('STALE_CAD_ROUTE')).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Routing network command failed',
        body: 'STALE_CAD_ROUTE',
        intent: 'error',
      }),
    );
    expect(screen.queryByText('Route added to the routing network.')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Withdraw from routing network' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /Main riser · 2 components · draft/ }),
    ).toBeInTheDocument();
  });
});

describe('route command toaster feedback', () => {
  it.each([
    ['Save route changes', 'Route saved', 'success'],
    ['Auto-select connection points', 'Connection points checked', 'success'],
    ['Align whole route to network point', 'Route aligned', 'success'],
    ['Add to routing network', 'Route added to routing network', 'success'],
    ['Withdraw from routing network', 'Route withdrawn', 'success'],
    ['Remove route group', 'Route group removed', 'success'],
  ])('reports the result of %s', async (button, title, intent) => {
    const route: CadRouteGroup = button.startsWith('Withdraw')
      ? { ...draft, status: 'published', projectTrayId: id(70) }
      : draft;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => ({
      ok: true,
      json: async () =>
        options.method
          ? { route, connectionsCreated: 2, routingTransitionsCreated: 0, connected: true }
          : url.endsWith('/auto-attachments')
            ? autoResult
            : { routes: [route] },
    }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
    if (button === 'Save route changes')
      fireEvent.change(screen.getByLabelText('Route colour hex'), { target: { value: '#FF0000' } });
    await waitFor(() => expect(screen.getByRole('button', { name: button })).toBeEnabled());
    expect(showToast).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: button }));
    if (button === 'Remove route group') {
      // Re-query the portal after Fluent's modal focus/visibility handoff.
      const confirm = await waitFor(() => {
        const dialog = screen.getByRole('dialog', { name: 'Remove route group?' });
        const remove = within(dialog).getByRole('button', { name: 'Remove group' });
        expect(remove).toBeEnabled();
        return remove;
      });
      fireEvent.click(confirm);
    }
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title, intent })),
    );
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'notifies on every repeated connection check, connected=%s',
    async (connected) => {
      fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => ({
        ok: true,
        json: async () =>
          options.method === 'POST'
            ? { connectionsCreated: 0, routingTransitionsCreated: 0, connected }
            : url.endsWith('/auto-attachments')
              ? autoResult
              : { routes: [draft] },
      }));
      show();
      fireEvent.click(await screen.findByRole('button', { name: /Main riser/ }));
      for (let count = 1; count <= 2; count++) {
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: 'Auto-select connection points' }),
          ).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Auto-select connection points' }));
        await waitFor(() => expect(showToast).toHaveBeenCalledTimes(count));
      }
      expect(showToast).toHaveBeenLastCalledWith(
        expect.objectContaining({
          intent: connected ? 'success' : 'warning',
          body: expect.stringContaining(
            connected ? 'The route is connected.' : 'Some ends need review',
          ),
        }),
      );
    },
  );
});
