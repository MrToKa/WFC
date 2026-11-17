import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublishedCadDisplay } from './publishedCadDisplay';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), modelVersionId = id(2), designId = id(3);
const instance = (n: number, lengthMm: number | null = null) => ({
  id: id(n), catalogItemId: id(n + 100), revision: 1,
  xMm: 11360, yMm: 75500, zMm: 21460, qx: 0, qy: 0.6, qz: 0, qw: 0.8, lengthMm,
  metadata: { instanceId: id(n), name: `Section ${n}` },
  route: { id: id(10), name: 'BC901', purpose: 'POWER' },
});
const route = (instanceIds = [id(20)], status = 'published') => ({
  id: id(10), name: 'BC901', tag: 'BC901', color: '#00FFFF', purpose: 'POWER',
  revision: 1, status, instanceIds, projectTrayId: status === 'published' ? id(11) : null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture() {
  let current = true;
  const state = {
    designs: [{ id: designId, modelVersionId, activeModel: true, status: 'proposed' }],
    routes: [route()], instances: [instance(20)],
  };
  const viewer = {
    showCadTray: vi.fn().mockResolvedValue(undefined),
    setCadComponentVisibility: vi.fn().mockResolvedValue(undefined),
    showCadComponent: vi.fn().mockResolvedValue(undefined),
    removeCadComponent: vi.fn().mockResolvedValue(undefined),
    setCadComponentColor: vi.fn().mockResolvedValue(undefined),
    setCadComponentProperties: vi.fn().mockResolvedValue(undefined),
    setCadComponentRoute: vi.fn().mockResolvedValue(undefined),
  };
  const onError = vi.fn();
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const base = `/api/projects/${projectId}/cad-design`;
    if (path === `${base}/designs`) return Response.json({ designs: state.designs });
    if (path === `${base}/designs/${designId}/routes`) return Response.json({ routes: state.routes });
    if (path === `${base}/designs/${designId}/instances`) return Response.json({ instances: state.instances });
    if (path.endsWith('/mesh')) return Response.json({ mesh: path });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const display = createPublishedCadDisplay({ viewer, projectId, token: 'current-token', modelVersionId,
    isCurrent: () => current, onError });
  return { state, viewer, fetcher, onError, display, setCurrent: (value: boolean) => { current = value; } };
}
afterEach(() => vi.unstubAllGlobals());

describe('published CAD geometry in Path Finder', () => {
  it.each(['metadata', 'route', 'both'])('binds route membership when optional %s is missing', async missing => {
    const f = fixture();
    if (missing !== 'route') Reflect.deleteProperty(f.state.instances[0], 'metadata');
    if (missing !== 'metadata') Reflect.deleteProperty(f.state.instances[0], 'route');
    await f.display.refresh();
    expect(f.viewer.setCadComponentProperties).not.toHaveBeenCalled();
    expect(f.viewer.setCadComponentRoute).toHaveBeenCalledExactlyOnceWith(id(20), 'BC901');
    expect(f.onError).not.toHaveBeenCalled();
    await f.display.refresh();
    expect(f.viewer.showCadComponent).toHaveBeenCalledOnce();
    expect(f.viewer.setCadComponentRoute).toHaveBeenCalledOnce();
    f.display.dispose();
  });
  it('binds current group membership before applying optional route properties', async () => {
    const f = fixture();
    f.state.instances[0].route.name = 'OLD';
    await f.display.refresh();
    expect(f.viewer.setCadComponentRoute).toHaveBeenCalledExactlyOnceWith(id(20), 'BC901');
    expect(f.viewer.setCadComponentRoute.mock.invocationCallOrder[0]).toBeLessThan(f.viewer.setCadComponentProperties.mock.invocationCallOrder[0]);
    f.display.dispose();
  });
  it('binds membership even when optional property presentation fails', async () => {
    const f = fixture();
    f.viewer.setCadComponentProperties.mockRejectedValueOnce(new Error('Invalid optional properties'));
    await f.display.refresh();
    expect(f.viewer.setCadComponentRoute).toHaveBeenCalledExactlyOnceWith(id(20), 'BC901');
    expect(f.onError).toHaveBeenCalledOnce();
    f.display.dispose();
  });
  it('retries route binding failures instead of caching an unclassified component', async () => {
    const f = fixture();
    f.viewer.setCadComponentRoute.mockRejectedValueOnce(new Error('Temporary binding failure'));
    await f.display.refresh();
    expect(f.onError).toHaveBeenCalledOnce();
    await f.display.refresh();
    expect(f.viewer.setCadComponentRoute).toHaveBeenCalledTimes(2);
    expect(f.viewer.removeCadComponent).toHaveBeenCalledWith(id(20));
    f.display.dispose();
  });
  it('loads all saved draft sections automatically and shows them by authoritative group ID', async () => {
    const f = fixture();
    f.state.routes = [route([id(20), id(21)], 'draft')];
    f.state.instances = [instance(20), instance(21)];
    await f.display.refresh();
    expect(f.viewer.showCadComponent.mock.calls.map(call => call[0])).toEqual([id(20), id(21)]);
    expect(await f.display.showTray(id(11), id(10))).toBe(true);
    expect(f.viewer.showCadComponent.mock.calls.map(call => call[0])).toEqual([id(20), id(21)]);
    expect(f.viewer.setCadComponentVisibility).not.toHaveBeenCalled();
    expect(f.viewer.showCadTray).toHaveBeenCalledWith([id(20), id(21)]);
    expect(await f.display.hideTray()).toBe(true);
    expect(f.viewer.removeCadComponent).not.toHaveBeenCalled();
    f.display.dispose();
  });
  it('focuses published routes by tray ID and retains their ordinary visibility after Hide', async () => {
    const f = fixture();
    expect(await f.display.showTray(id(11))).toBe(true);
    await f.display.hideTray();
    expect(f.viewer.removeCadComponent).not.toHaveBeenCalled();
    expect(await f.display.showTray(id(99))).toBe(false);
    f.display.dispose();
  });
  it('does not report a preview as shown when a section mesh fails', async () => {
    const f = fixture();
    const normal = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation((url, init) => String(url).endsWith('/mesh')
      ? Promise.resolve(new Response('', { status: 503 })) : normal(url, init));
    expect(await f.display.showTray(id(11))).toBe(false);
    expect(f.viewer.showCadTray).not.toHaveBeenCalled();
    f.display.dispose();
  });
  it('rejects showing cached geometry after a failed route refresh', async () => {
    const f = fixture();
    await f.display.refresh();
    f.fetcher.mockImplementationOnce(async () => new Response('', { status: 503 }));
    expect(await f.display.showTray(id(11))).toBe(false);
    expect(f.viewer.showCadTray).not.toHaveBeenCalled();
    f.display.dispose();
  });
  it('shows a healthy tray even when another saved route has a failed mesh', async () => {
    const f = fixture();
    f.state.routes.push({ ...route([id(21)]), id: id(12), projectTrayId: id(13) });
    f.state.instances.push(instance(21));
    const normal = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation((url, init) => String(url).endsWith(`/catalog/${id(121)}/mesh`)
      ? Promise.resolve(new Response('', { status: 503 })) : normal(url, init));
    expect(await f.display.showTray(id(11))).toBe(true);
    expect(f.viewer.showCadTray).toHaveBeenCalledWith([id(20)]);
    expect(f.onError).toHaveBeenCalled();
    f.display.dispose();
  });
  it('does not focus a delayed CAD Show after Hide supersedes it', async () => {
    const f = fixture(), gate = deferred<Response>(), meshStarted = deferred<void>();
    const normal = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation((url, init) => {
      if (String(url).endsWith('/mesh')) { meshStarted.resolve(); return gate.promise; }
      return normal(url, init);
    });
    const shown = f.display.showTray(id(11));
    await meshStarted.promise;
    const hidden = f.display.hideTray();
    gate.resolve(Response.json({ mesh: 'saved' }));
    expect(await shown).toBe(false);
    expect(await hidden).toBe(true);
    expect(f.viewer.showCadTray).not.toHaveBeenCalled();
    f.display.dispose();
  });
  it('cancels a Show waiting for an automatic refresh when Hide supersedes it', async () => {
    const f = fixture(), gate = deferred<Response>();
    f.fetcher.mockImplementationOnce(() => gate.promise);
    const automatic = f.display.refresh();
    const shown = f.display.showTray(id(11));
    const hidden = f.display.hideTray();
    gate.resolve(Response.json({ designs: f.state.designs }));
    await automatic;
    expect(await shown).toBe(false);
    expect(await hidden).toBe(true);
    expect(f.viewer.showCadTray).not.toHaveBeenCalled();
    f.display.dispose();
  });
  it('keeps the newest Show when both await an automatic refresh', async () => {
    const f = fixture(), gate = deferred<Response>();
    f.state.routes.push({ ...route([id(21)]), id: id(12), projectTrayId: id(13) });
    f.state.instances.push(instance(21));
    f.fetcher.mockImplementationOnce(() => gate.promise);
    const automatic = f.display.refresh();
    const oldShow = f.display.showTray(id(11));
    const newShow = f.display.showTray(id(13));
    gate.resolve(Response.json({ designs: f.state.designs }));
    await automatic;
    expect(await oldShow).toBe(false);
    expect(await newShow).toBe(true);
    expect(f.viewer.showCadTray).toHaveBeenCalledExactlyOnceWith([id(21)]);
    f.display.dispose();
  });
  it('keeps failed draft preview cleanup retryable', async () => {
    const f = fixture();
    f.state.routes = [route([id(20)], 'draft')];
    expect(await f.display.showTray(id(11), id(10))).toBe(true);
    f.state.routes = [];
    f.viewer.removeCadComponent.mockRejectedValueOnce(new Error('Removal failed'));
    expect(await f.display.hideTray()).toBe(false);
    expect(await f.display.hideTray()).toBe(true);
    expect(f.viewer.removeCadComponent).toHaveBeenCalledTimes(2);
    f.display.dispose();
  });
  it('loads saved route members of the exact active model with saved transforms, cut mesh and presentation', async () => {
    const f = fixture();
    f.state.designs.unshift({ id: id(4), modelVersionId: id(5), activeModel: true, status: 'proposed' });
    f.state.routes = [route([id(20), id(21)]), { ...route([id(22)], 'draft'), id: id(12) }];
    f.state.instances = [instance(20, 1530), instance(21), instance(22), instance(23)];
    await f.display.refresh();
    expect(f.viewer.showCadComponent.mock.calls.map(call => call[0])).toEqual([id(20), id(21), id(22)]);
    const cutPath = `/api/projects/${projectId}/cad-design/designs/${designId}/instances/${id(20)}/mesh`;
    expect(f.viewer.showCadComponent).toHaveBeenCalledWith(id(20), { mesh: cutPath }, {
      positionMm: { x: 11360, y: 75500, z: 21460 }, rotation: { x: 0, y: 0.6, z: 0, w: 0.8 },
    });
    expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith(`/catalog/${id(121)}/mesh`))).toBe(true);
    expect(f.viewer.setCadComponentColor).toHaveBeenCalledWith(id(20), '#00FFFF');
    expect(f.viewer.setCadComponentProperties).toHaveBeenCalledWith(id(20), f.state.instances[0].metadata, f.state.instances[0].route);
    expect(f.onError).not.toHaveBeenCalled();
    for (const [, init] of f.fetcher.mock.calls) {
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer current-token' }));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.method ?? 'GET').toBe('GET');
    }
    f.display.dispose();
  });

  it('keeps unchanged geometry, refreshes changed revisions and removes withdrawn route members', async () => {
    const f = fixture();
    await f.display.refresh();
    await f.display.refresh();
    expect(f.viewer.showCadComponent).toHaveBeenCalledTimes(1);
    f.state.instances[0] = { ...f.state.instances[0], revision: 2, zMm: 23000 };
    await f.display.refresh();
    expect(f.viewer.showCadComponent).toHaveBeenCalledTimes(2);
    f.state.routes = [];
    await f.display.refresh();
    expect(f.viewer.removeCadComponent).toHaveBeenCalledWith(id(20));
    expect(f.viewer.showCadComponent).toHaveBeenCalledTimes(2);
    f.display.dispose();
  });

  it('updates published presentation when the route revision changes', async () => {
    const f = fixture();
    await f.display.refresh();
    f.state.routes[0] = { ...f.state.routes[0], revision: 2, color: '#FF0000' };
    await f.display.refresh();
    expect(f.viewer.setCadComponentColor).toHaveBeenLastCalledWith(id(20), '#FF0000');
    f.display.dispose();
  });

  it('coalesces overlapping refresh requests without duplicate mesh uploads', async () => {
    const f = fixture(), gate = deferred<Response>();
    f.fetcher.mockImplementationOnce(() => gate.promise);
    const first = f.display.refresh(), second = f.display.refresh();
    gate.resolve(Response.json({ designs: f.state.designs }));
    await Promise.all([first, second]);
    expect(f.viewer.showCadComponent).toHaveBeenCalledTimes(1);
    f.display.dispose();
  });

  it.each(['disposed', 'scope changed'])('does not render a delayed mesh after the display is %s', async reason => {
    const f = fixture(), gate = deferred<Response>(), meshStarted = deferred<void>();
    const normal = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation((url, init) => {
      if (String(url).endsWith('/mesh')) { meshStarted.resolve(); return gate.promise; }
      return normal(url, init);
    });
    const pending = f.display.refresh();
    await meshStarted.promise;
    if (reason === 'disposed') f.display.dispose(); else f.setCurrent(false);
    gate.resolve(Response.json({ mesh: 'late' }));
    await pending;
    expect(f.viewer.showCadComponent).not.toHaveBeenCalled();
    expect(f.viewer.setCadComponentColor).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
    if (reason === 'disposed') {
      const meshRequest = f.fetcher.mock.calls.find(([url]) => String(url).endsWith('/mesh'));
      expect(meshRequest?.[1]?.signal?.aborted).toBe(true);
    }
    f.display.dispose();
  });

  it('does not send requests after losing scope or disposal', async () => {
    const f = fixture();
    f.setCurrent(false); await f.display.refresh();
    f.setCurrent(true); f.display.dispose(); await f.display.refresh();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('reports incomplete published membership and mesh failures while preserving healthy sections', async () => {
    const f = fixture();
    f.state.routes = [route([id(20), id(21), id(22)])];
    f.state.instances = [instance(20), instance(21)];
    const normal = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation((url, init) => String(url).endsWith(`/catalog/${id(120)}/mesh`)
      ? Promise.resolve(new Response('', { status: 503 })) : normal(url, init));
    await f.display.refresh();
    expect(f.onError).toHaveBeenCalled();
    expect(f.viewer.showCadComponent).toHaveBeenCalledWith(id(21), expect.anything(), expect.anything());
    expect(f.viewer.showCadComponent).not.toHaveBeenCalledWith(id(20), expect.anything(), expect.anything());
    f.display.dispose();
  });

  it('treats disabled CAD and absent active designs as empty geometry', async () => {
    const f = fixture();
    f.fetcher.mockImplementationOnce(async () => new Response('', { status: 404 }));
    await f.display.refresh();
    f.state.designs = [];
    await f.display.refresh();
    expect(f.viewer.showCadComponent).not.toHaveBeenCalled();
    expect(f.onError).not.toHaveBeenCalled();
    f.display.dispose();
  });
});
