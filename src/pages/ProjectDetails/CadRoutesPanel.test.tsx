import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadRouteGroup } from '../../../shared/cadRouteGroups';
import { CadRoutesPanel } from './CadRoutesPanel';

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
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  onColor.mockClear();
  catalogue([]);
});
afterEach(() => vi.unstubAllGlobals());

describe('complete CAD routes', () => {
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
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add to trays list/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Add to trays list/i }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.getByRole('button', { name: /Add to trays list/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Add to trays list/i }));
    expect(writes()).toHaveLength(1);
    await act(async () =>
      completeExport({
        ok: true,
        json: async () => ({ projectTrayId: id(70), lengthMm: 2680.25, reused: false }),
      }),
    );
    expect(writes()[0][0]).toMatch(new RegExp(`/routes/${draft.id}/trays-list$`));
    expect(JSON.parse(writes()[0][1].body)).toEqual({ expectedRevision: 7 });
    expect(writes()[0][1].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer cad-token' }),
    );
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Trays list/i));
    expect(screen.getByRole('status')).toHaveTextContent('Centreline length: 2.680 m.');
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
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeDisabled();
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
    'clears a previous automatic match and refuses publication when the next route is %s',
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
      expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeDisabled();
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

  it('publishes all automatically selected network ends with the expected revision and no manual port dropdowns', async () => {
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
      attachments: automaticAttachments,
    });
    expect(
      await screen.findByRole('button', { name: 'Withdraw from routing network' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Route name')).toBeDisabled();
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
