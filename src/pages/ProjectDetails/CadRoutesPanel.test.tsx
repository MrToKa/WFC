import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const attachmentOptions = {
  endpoints: [
    { instanceId: id(1), portName: 'start', pointMetres: [1, 0, 0] },
    { instanceId: id(3), portName: 'end', pointMetres: [3, 0, 0] },
  ],
  options: [
    {
      objectRevisionId: id(20),
      objectId: 'dbid:42',
      portIndex: 1,
      pointMetres: [1, 0, 0],
      routeCode: 'EXISTING-01',
    },
  ],
};
const fetchMock = vi.fn();
const onColor = vi.fn(async (_id: string, _color: string) => {});
const writes = () =>
  fetchMock.mock.calls.filter(([, options]) => ['POST', 'PATCH'].includes(options?.method));
function show(onGeometryChanged?: () => Promise<void>) {
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
      />
    </FluentProvider>,
  );
}
function fields(tag = 'tray-01') {
  fireEvent.change(screen.getByLabelText('Route name'), { target: { value: 'Main riser' } });
  fireEvent.change(screen.getByLabelText('Route tag'), { target: { value: tag } });
  fireEvent.change(screen.getByLabelText('Route purpose'), { target: { value: draft.purpose } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Route colour hex' }), { target: { value: '#16a34a' } });
}
function catalogue(routes: CadRouteGroup[]) {
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (url.endsWith('/attachment-options') ? attachmentOptions : { routes }),
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
  it('changes a published route colour without withdrawing or altering its members', async () => {
    let routes: CadRouteGroup[] = [{ ...draft, status: 'published', projectTrayId: id(70) }];
    fetchMock.mockImplementation(async (_url: string, options: RequestInit = {}) => {
      if (options.method === 'PATCH') { routes = [{ ...routes[0], color: '#3B82F6', revision: 8 }]; return { ok: true, json: async () => ({ route: routes[0] }) }; }
      return { ok: true, json: async () => ({ routes }) };
    });
    show(); fireEvent.click(await screen.findByRole('button', { name: /TRAY-01 — Main riser/ }));
    expect(screen.getByLabelText('Route name')).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Route colour hex' }), { target: { value: '#3b82f6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save route changes' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].method).toBe('PATCH');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ name: draft.name, tag: draft.tag, color: '#3B82F6', purpose: draft.purpose, instanceIds: draft.instanceIds, expectedRevision: 7 });
    await waitFor(() => expect(onColor).toHaveBeenCalledWith(id(1), '#3B82F6'));
    expect(screen.getByRole('button', { name: 'Withdraw from routing network' })).toBeInTheDocument();
  });
  it('aligns the entire saved group and refreshes geometry before publication', async () => {
    let routes = [draft];
    const geometryChanged = vi.fn(async () => {});
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (options.method === 'POST') { routes = [{ ...draft, revision: 8 }]; return { ok: true, json: async () => ({ id: draft.id, revision: 8 }) }; }
      return { ok: true, json: async () => url.endsWith('/attachment-options') ? attachmentOptions : { routes } };
    });
    show(geometryChanged);
    fireEvent.click(await screen.findByRole('button', { name: /TRAY-01 — Main riser/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Route end 1'), { target: { value: `${id(1)}/start` } });
    fireEvent.change(screen.getByLabelText('Network point 1'), { target: { value: `${id(20)}/1` } });
    fireEvent.click(screen.getByRole('button', { name: 'Align whole route to network point' }));
    await waitFor(() => expect(geometryChanged).toHaveBeenCalledOnce());
    expect(writes()[0][0]).toMatch(/\/align$/);
    expect(JSON.parse(writes()[0][1].body)).toEqual({ expectedRevision: 7, attachment: { instanceId: id(1), portName: 'start', targetObjectRevisionId: id(20), targetPortIndex: 1 } });
    expect(await screen.findByText(/Whole route aligned and saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /TRAY-01 — Main riser · 2 components · draft/ })).toBeInTheDocument();
  });
  it('requires unsaved member or name changes to be saved before network publication', async () => {
    catalogue([draft]); show();
    fireEvent.click(await screen.findByRole('button', { name: /TRAY-01 — Main riser/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Route name'), { target: { value: 'New name' } });
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });
  it('saves selected members with independent name, tag, purpose and color, then applies color only to displayed members', async () => {
    let routes: CadRouteGroup[] = [];
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (options.method === 'POST') {
        routes = [draft];
        return { ok: true, json: async () => ({ route: draft }) };
      }
      return {
        ok: true,
        json: async () => (url.endsWith('/attachment-options') ? attachmentOptions : { routes }),
      };
    });
    show();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save complete route' })).toBeEnabled(),
    );
    fields();
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
      name: 'Main riser',
      tag: 'TRAY-01',
      purpose: draft.purpose,
      color: '#16A34A',
      instanceIds: [id(1), id(3)],
    });
    await waitFor(() => expect(onColor).toHaveBeenCalledWith(id(1), '#16A34A'));
    expect(onColor).not.toHaveBeenCalledWith(id(3), expect.any(String));
    expect(
      screen.getByRole('button', { name: /TRAY-01 — Main riser · 2 components · draft/ }),
    ).toBeInTheDocument();
  });

  it('restores a saved route color on load and prevents taking members from another route', async () => {
    catalogue([draft]);
    show();
    await screen.findByRole('button', { name: /TRAY-01 — Main riser/ });
    await waitFor(() => expect(onColor).toHaveBeenCalledWith(id(1), '#16A34A'));
    expect(onColor).toHaveBeenCalledWith(id(2), '#D9AB33');
    expect(onColor).not.toHaveBeenCalledWith(id(3), expect.any(String));
    expect(screen.getByLabelText(`Include component ${id(1)}`)).toBeDisabled();
    expect(screen.getByLabelText(`Include component ${id(2)}`)).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /TRAY-01 — Main riser/ }));
    expect(screen.getByLabelText(`Include component ${id(1)}`)).toBeEnabled();
    expect(screen.getByLabelText(`Include component ${id(1)}`)).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    expect(screen.getByLabelText(`Include component ${id(1)}`)).toBeDisabled();
  });

  it.each(['invalid tag', 'empty members'])(
    'rejects %s without a write request',
    async (reason) => {
      show();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save complete route' })).toBeEnabled(),
      );
      fields(reason === 'invalid tag' ? 'NOT A TAG' : 'TRAY-01');
      if (reason === 'invalid tag')
        fireEvent.click(screen.getByLabelText(`Include component ${id(1)}`));
      fireEvent.click(screen.getByRole('button', { name: 'Save complete route' }));
      expect(await screen.findByText(/Enter a name, a unique tag/)).toBeInTheDocument();
      expect(writes()).toHaveLength(0);
    },
  );

  it('requires a network attachment and publishes the chosen verified end with its expected revision', async () => {
    let saved = draft;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url.endsWith('/publish') && options.method === 'POST') {
        saved = { ...draft, status: 'published', revision: 8, projectTrayId: id(30) };
        return { ok: true, json: async () => ({ route: saved }) };
      }
      return {
        ok: true,
        json: async () =>
          url.endsWith('/attachment-options') ? attachmentOptions : { routes: [saved] },
      };
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /TRAY-01 — Main riser/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to routing network' }));
    expect(
      await screen.findByText(
        'Choose at least one route end and an existing network connection point.',
      ),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Route end 1'), { target: { value: `${id(1)}/start` } });
    fireEvent.change(screen.getByLabelText('Network point 1'), {
      target: { value: `${id(20)}/1` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add to routing network' }));
    expect(await screen.findByText('Route added to the routing network.')).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatch(new RegExp(`/routes/${draft.id}/publish$`));
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      expectedRevision: 7,
      attachments: [
        {
          instanceId: id(1),
          portName: 'start',
          targetObjectRevisionId: id(20),
          targetPortIndex: 1,
        },
      ],
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
              url.endsWith('/attachment-options') ? attachmentOptions : { routes: [draft] },
          },
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: /TRAY-01 — Main riser/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Route end 1'), { target: { value: `${id(1)}/start` } });
    fireEvent.change(screen.getByLabelText('Network point 1'), {
      target: { value: `${id(20)}/1` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add to routing network' }));
    expect(await screen.findByText('STALE_CAD_ROUTE')).toBeInTheDocument();
    expect(screen.queryByText('Route added to the routing network.')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Withdraw from routing network' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to routing network' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /TRAY-01 — Main riser · 2 components · draft/ }),
    ).toBeInTheDocument();
  });
});
