import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerController, type ViewerEvent } from './ViewerController';
import { invalidateViewerLogin } from './loginLifecycle';

const projectId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
let controllers: ViewerController[];
beforeEach(() => { controllers = []; vi.useFakeTimers(); });
afterEach(() => { controllers.forEach(c => c.dispose()); vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
function setup(token = 'login-a') {
  const container = document.createElement('div'); document.body.append(container);
  const events: ViewerEvent[] = [];
  const c = new ViewerController({ container, projectId, token, onEvent: e => events.push(e) });
  controllers.push(c);
  const send = vi.spyOn(c.iframe.contentWindow!, 'postMessage');
  const message = (type: string, payload: Record<string, unknown>, requestId: string = crypto.randomUUID(), extra: Record<string, unknown> = {}, source: MessageEventSource | null = c.iframe.contentWindow, origin = location.origin) => {
    window.dispatchEvent(new MessageEvent('message', { origin, source, data: {
      channel: 'wfc-routings-viewer', protocolVersion: 1, instanceId: c.instanceId, projectId,
      modelVersionId: null, loadId: null, requestId, type, payload, ...extra,
    } }));
  };
  const hello = () => message('HELLO', { supportedProtocolVersions: [1], sdkVersion: '7.130.0' });
  const ready = () => {
    hello();
    const init = send.mock.calls[0][0];
    message('RUNTIME_READY', { sdkVersion: '7.130.0' }, init.requestId);
  };
  return { c, events, send, message, hello, ready };
}

describe('PathFinder protected Viewer capabilities', () => {
  async function loaded() {
    const s = setup(); s.ready();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (options?.method === 'POST') return Response.json({ sessionId: crypto.randomUUID(), projectId, modelVersionId: versionId,
        loadId: JSON.parse(String(options.body)).loadId, expiresAt: new Date(Date.now() + 300_000).toISOString(), absoluteExpiresAt: new Date(Date.now() + 1_800_000).toISOString() });
      return Response.json({ selection: { activeModelVersionId: versionId, selectionRevision: 1 } });
    });
    await s.c.load(versionId);
    const command = s.send.mock.calls.find(call => call[0].type === 'LOAD_MODEL')![0];
    const identity = { modelVersionId: versionId, loadId: command.loadId };
    s.message('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true }, command.requestId, identity);
    return { ...s, identity };
  }
  it('freezes and transports engine points in acknowledged bounded chunks before an exact display commit', async () => {
    const s = await loaded();
    let received = 0;
    s.send.mockImplementation(value => {
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : value.type === 'COMMIT_COMPUTED_PATH' ? 'displayed' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
    });
    const points: [number, number, number][] = Array.from({ length: 257 }, (_, i) => [i / 7, i / 9, i / 11]);
    const showing = s.c.showComputedPath({ pathId: crypto.randomUUID(), points, objectIds: [23] });
    points[0][0] = 9999;
    const requestId = await showing;
    const chunks = s.send.mock.calls.filter(call => call[0].type === 'APPEND_COMPUTED_PATH').map(call => call[0]);
    expect(chunks.map(chunk => chunk.payload.points.length)).toEqual([128, 128, 1]);
    expect(chunks[0].payload.points[0][0]).toBe(0);
    expect(chunks.every(chunk => new TextEncoder().encode(JSON.stringify(chunk)).byteLength <= 65536)).toBe(true);
    expect(requestId).toBeTruthy(); expect(() => s.c.zoom()).not.toThrow();
    expect(s.send.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'ZOOM_ROUTE', payload: { routeRequestId: requestId } });
  });
  it('Clear during a chunk cancels the calculated path and cannot commit later', async () => {
    const s = await loaded();
    s.send.mockImplementation(value => {
      if (value.type === 'BEGIN_COMPUTED_PATH') s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase: 'begun', received: 0 }, value.requestId, s.identity);
      if (value.type === 'APPEND_COMPUTED_PATH') s.c.clear();
    });
    await expect(s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0], [1, 2, 3]], objectIds: [23] })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.send.mock.calls.some(call => call[0].type === 'COMMIT_COMPUTED_PATH')).toBe(false);
    expect(() => s.c.zoom()).toThrow();
  });
  it('acknowledges a legitimate one-point zero-length path without synthesizing geometry input', async () => {
    const s = await loaded(); let received = 0;
    s.send.mockImplementation(value => {
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : value.type === 'COMMIT_COMPUTED_PATH' ? 'displayed' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
    });
    await expect(s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[1, 0, 0.5]], objectIds: [] })).resolves.toBeTruthy();
    expect(s.send.mock.calls.find(call => call[0].type === 'BEGIN_COMPUTED_PATH')![0].payload.pointCount).toBe(1);
    expect(s.send.mock.calls.find(call => call[0].type === 'APPEND_COMPUTED_PATH')![0].payload.points).toEqual([[1, 0, 0.5]]);
  });
  it('one-shot picking and metadata retain typed load identity and reject mismatched pages', async () => {
    const s = await loaded();
    s.send.mockImplementation(value => {
      if (value.type === 'PICK_POINT') s.message('POINT_PICKED', { objectId: 23, point: [12.25, -3, 4.5], derivation: 'picked-surface-point' }, value.requestId, s.identity);
      if (value.type === 'READ_MODEL_OBJECTS') s.message('MODEL_OBJECTS', { cursor: 0, nextCursor: null, complete: true, query: 'WRONG', coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] }, value.requestId, s.identity);
    });
    expect(await s.c.pickPoint()).toEqual({ objectId: 23, point: [12.25, -3, 4.5], derivation: 'picked-surface-point' });
    await expect(s.c.readModelObjects(0, 'PANEL')).rejects.toThrow('acknowledgement mismatch');
    expect(s.events.find(event => event.type === 'POINT_PICKED')?.identity).toMatchObject(s.identity);
  });
  it('reads only the protected current SDK selection and binds transparency acknowledgements to the displayed path', async () => {
    const s = await loaded(); let received = 0;
    s.send.mockImplementation(value => {
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : value.type === 'COMMIT_COMPUTED_PATH' ? 'displayed' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
      if (value.type === 'READ_SELECTION') s.message('MODEL_SELECTION', { coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] }, value.requestId, s.identity);
      if (value.type === 'SET_PATH_TRANSPARENCY') s.message('PATH_TRANSPARENCY_UPDATED', value.payload, value.requestId, s.identity);
    });
    expect((await s.c.readSelection()).objects).toEqual([]);
    const routeRequestId = await s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0]], objectIds: [] });
    await s.c.setPathTransparency(40);
    expect(s.send.mock.calls.find(call => call[0].type === 'SET_PATH_TRANSPARENCY')![0].payload).toEqual({ routeRequestId, percent: 40 });
    await expect(s.c.setPathTransparency(101)).rejects.toThrow('integer');
    s.c.clear(); await expect(s.c.setPathTransparency(40)).rejects.toThrow('No drawable route');
  });
  it('Clear cancels a pending selection and freezes nested rule arrays before asynchronous model authorization', async () => {
    const s = await loaded();
    const selecting = s.c.readSelection(); await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'READ_SELECTION')).toBe(true));
    s.c.clear(); await expect(selecting).rejects.toMatchObject({ name: 'AbortError' });
    const rules = [{ id: crypto.randomUUID(), objectIds: [23], allowedCategories: ['Control' as const] }];
    s.send.mockImplementation(value => { if (value.type === 'START_MODEL_CAPTURE') s.message('ERROR', { code: 'EXTRACTION_FAILED', message: 'Synthetic controlled extraction failure.', retryable: false, operation: 'START_MODEL_CAPTURE' }, value.requestId, s.identity); });
    const capturing = s.c.captureModel({ routeRules: rules, equipmentNames: [] }); rules[0].objectIds[0] = 99;
    await expect(capturing).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    expect(s.send.mock.calls.find(call => call[0].type === 'START_MODEL_CAPTURE')![0].payload.routeRules[0].objectIds).toEqual([23]);
  });
});

describe('Viewer parent identity and lifecycle', () => {
  function realSessionResponses(activeVersion = versionId) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (options?.method === 'POST') return new Response(JSON.stringify({ sessionId: crypto.randomUUID(), projectId, modelVersionId: activeVersion,
        loadId: JSON.parse(String(options.body)).loadId, expiresAt: new Date(Date.now() + 300_000).toISOString(), absoluteExpiresAt: new Date(Date.now() + 1_800_000).toISOString() }));
      return new Response(JSON.stringify({ selection: { activeModelVersionId: activeVersion, selectionRevision: 1 } }));
    });
  }

  it('exposes only detached validated event identity and a ready-gated current load snapshot', async () => {
    const s = setup(); expect(s.c.getLoadSnapshot()).toBeNull(); s.ready();
    const readiness = s.events.find(event => event.type === 'RUNTIME_READY')!;
    expect(readiness.identity).toMatchObject({ protocolVersion: 1, instanceId: s.c.instanceId, projectId, modelVersionId: null, loadId: null, requestId: readiness.requestId });
    expect(Object.isFrozen(readiness.identity)).toBe(true); realSessionResponses(); await s.c.load(versionId);
    const load = s.send.mock.calls.find(call => call[0].type === 'LOAD_MODEL')![0], identity = { modelVersionId: versionId, loadId: load.loadId };
    const initial = s.c.getLoadSnapshot()!; expect(initial).toEqual({ instanceId: s.c.instanceId, projectId, ...identity, selectionRevision: 1, ready: false }); expect(Object.isFrozen(initial)).toBe(true);
    s.message('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true }, load.requestId, identity);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true); expect(initial.ready).toBe(false);
    expect(s.events.find(event => event.type === 'MODEL_LOADED')?.identity).toEqual({ protocolVersion: 1, instanceId: s.c.instanceId, projectId, ...identity, requestId: load.requestId });
    s.c.dispose(); expect(s.c.getLoadSnapshot()).toBeNull();
  });

  it('emits only the latest same-text route request with its exact public identity', async () => {
    const s = setup(); s.ready(); realSessionResponses(); await s.c.load(versionId);
    const load = s.send.mock.calls.find(call => call[0].type === 'LOAD_MODEL')![0], identity = { modelVersionId: versionId, loadId: load.loadId };
    s.message('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true }, load.requestId, identity);
    const a = await s.c.showRoute('BC1'), b = await s.c.showRoute('BC1'); expect(a).not.toBe(b);
    const payload = { rawRouting: 'BC1', source: 'manual', cableId: null, segments: [{ segmentIndex: 0, token: 'BC1', key: 'BC1', model: { state: 'found', matchCount: 1, drawable: true } }], ignored: [], drawableCount: 1, lineCount: 1, warnings: [] };
    s.message('ROUTE_RESULT', payload, b!, identity); s.message('ROUTE_RESULT', payload, a!, identity);
    const results = s.events.filter(event => event.type === 'ROUTE_RESULT'); expect(results).toHaveLength(1); expect(results[0].identity).toEqual({ protocolVersion: 1, instanceId: s.c.instanceId, projectId, ...identity, requestId: b });
  });

  it('announces load admission synchronously and automatic same-version renewal before any new model progress', async () => {
    const s = setup(); s.ready();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (options?.method === 'POST') return Response.json({ sessionId: crypto.randomUUID(), projectId, modelVersionId: versionId,
        loadId: JSON.parse(String(options.body)).loadId, expiresAt: new Date(Date.now() + 190_000).toISOString(), absoluteExpiresAt: new Date(Date.now() + 190_000).toISOString() });
      return Response.json({ selection: { activeModelVersionId: versionId, selectionRevision: 1 } });
    });
    const loading = s.c.load(versionId);
    expect(s.events.at(-1)).toEqual({ type: 'MODEL_LOADING', payload: {}, requestId: undefined });
    expect(s.c.getLoadSnapshot()?.ready).not.toBe(true);
    await loading;
    const load = s.send.mock.calls.find(call => call[0].type === 'LOAD_MODEL')![0];
    s.message('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true }, load.requestId, { modelVersionId: versionId, loadId: load.loadId });
    const old = s.c.getLoadSnapshot()!; expect(old.ready).toBe(true);
    const eventCount = s.events.length;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(s.events.slice(eventCount)).toEqual([{ type: 'MODEL_LOADING', payload: {}, requestId: undefined }]);
    expect(s.c.instanceId).not.toBe(old.instanceId); expect(s.c.getLoadSnapshot()).toBeNull();
  });

  it('Clear invalidates a route whose pre-route access request resolves later', async () => {
    const s = setup(); s.ready(); realSessionResponses(); await s.c.load(versionId);
    const load = s.send.mock.calls.find(call => call[0].type === 'LOAD_MODEL')![0];
    s.message('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true }, load.requestId, { modelVersionId: versionId, loadId: load.loadId });
    let finish!: (response: Response) => void;
    vi.mocked(globalThis.fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const showing = s.c.showRoute('BC1'); s.c.clear(); finish(Response.json({ selection: { activeModelVersionId: versionId, selectionRevision: 1 } }));
    expect(await showing).toBeNull(); expect(s.send.mock.calls.filter(call => call[0].type === 'SHOW_ROUTE')).toHaveLength(0);
  });

  it('keeps one selection deadline when focus and visibility checks overlap and clears it on dispose', async () => {
    const s = setup(); s.ready(); const mock = realSessionResponses();
    await s.c.load(versionId);
    const load = s.send.mock.calls.find(x => x[0].type === 'LOAD_MODEL')![0];
    s.message('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true }, load.requestId,
      { modelVersionId: versionId, loadId: load.loadId });
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(2);
    const responses: Array<(response: Response) => void> = [];
    mock.mockImplementation(async (_url, options) => options?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : new Promise<Response>(resolve => responses.push(resolve)));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(responses).toHaveLength(2);
    for (const finish of responses) finish(new Response(JSON.stringify({ selection: { activeModelVersionId: versionId, selectionRevision: 1 } })));
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(2);
    s.c.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.c.iframe.isConnected).toBe(false);
  });

  it('ignores a cancelled LOAD error even after the cancellation acknowledgement', async () => {
    const s = setup(); s.ready(); realSessionResponses();
    await s.c.load(versionId);
    const load = s.send.mock.calls.find(x => x[0].type === 'LOAD_MODEL')![0];
    const cancellation = s.c.cancel(load.requestId);
    const identity = { modelVersionId: load.modelVersionId, loadId: load.loadId };
    s.message('REQUEST_CANCELLED', { targetRequestId: load.requestId, outcome: 'cancelled' }, cancellation, identity);
    s.message('ERROR', { code: 'RESOURCE_FAILED', message: 'Ресурсът е недостъпен.', retryable: true, operation: 'LOAD_MODEL' }, load.requestId, identity);
    expect(s.events.filter(x => x.type === 'ERROR')).toHaveLength(0);
    expect(s.c.iframe.style.display).not.toBe('none');
  });

  it('retires load A immediately and starts a distinct iframe/load identity for B', async () => {
    const s = setup(); s.ready(); const mock = realSessionResponses();
    await s.c.load(versionId);
    const loadA = s.send.mock.calls.find(x => x[0].type === 'LOAD_MODEL')![0];
    const oldFrame = s.c.iframe, oldInstance = s.c.instanceId;
    const loadingB = s.c.load(versionId);
    expect(oldFrame.style.display).toBe('none');
    expect(s.c.iframe).not.toBe(oldFrame);
    expect(s.c.instanceId).not.toBe(oldInstance);
    const post = vi.spyOn(s.c.iframe.contentWindow!, 'postMessage');
    s.hello(); const initB = post.mock.calls[0][0];
    s.message('RUNTIME_READY', { sdkVersion: '7.130.0' }, initB.requestId);
    await loadingB;
    const loadB = post.mock.calls.find(x => x[0].type === 'LOAD_MODEL')![0];
    expect(loadB.loadId).not.toBe(loadA.loadId);
    s.message('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true }, loadA.requestId,
      { instanceId: oldInstance, modelVersionId: versionId, loadId: loadA.loadId }, oldFrame.contentWindow);
    expect(s.events.filter(x => x.type === 'MODEL_LOADED')).toHaveLength(0);
    expect(mock.mock.calls.filter(x => x[1]?.method === 'POST')).toHaveLength(2);
  });
  it('rejects foreign origins, sibling sources, extra fields and repeated handshake', () => {
    const { c, message, send, hello } = setup();
    const payload = { supportedProtocolVersions: [1], sdkVersion: '7.130.0' };
    message('HELLO', payload, crypto.randomUUID(), {}, c.iframe.contentWindow, 'https://forged.example');
    message('HELLO', payload, crypto.randomUUID(), {}, window);
    message('HELLO', payload, crypto.randomUUID(), { url: '/arbitrary' });
    expect(send).not.toHaveBeenCalled();
    hello(); hello();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe(location.origin);
    expect(c.iframe.src).toContain('/viewer-runtime/7.130.0/index.html?instanceId=');
    expect(c.iframe.src).not.toContain('login-a');
  });

  it('accepts only the correlated readiness ack and ignores its replay', () => {
    const { hello, send, message, events } = setup(); hello();
    const init = send.mock.calls[0][0];
    message('RUNTIME_READY', { sdkVersion: '7.130.0' });
    expect(events).toHaveLength(0);
    message('RUNTIME_READY', { sdkVersion: '7.130.0' }, init.requestId);
    message('RUNTIME_READY', { sdkVersion: '7.130.0' }, init.requestId);
    expect(events.map(e => e.type)).toEqual(['RUNTIME_READY']);
  });

  it('times out once without an automatic reopen and removes the frame within two seconds', () => {
    const { c, events, send } = setup();
    vi.advanceTimersByTime(10_000);
    expect(events.filter(e => e.type === 'ERROR')).toHaveLength(1);
    expect(send.mock.calls[0][0].type).toBe('DISPOSE');
    vi.advanceTimersByTime(2_000);
    expect(c.iframe.isConnected).toBe(false);
    vi.advanceTimersByTime(120_000);
    expect(events).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes just the matching login synchronously and ignores late handshake', () => {
    const a = setup('login-a'), b = setup('login-b');
    invalidateViewerLogin('login-a');
    expect(a.c.iframe.style.visibility).toBe('hidden');
    expect(b.c.iframe.style.visibility).not.toBe('hidden');
    a.hello(); b.hello();
    expect(a.send.mock.calls.map(x => x[0].type)).toEqual(['DISPOSE']);
    expect(b.send.mock.calls.map(x => x[0].type)).toEqual(['INIT']);
  });

  it('disposes each repeated mount with no retained deadlines or frame', () => {
    for (let i = 0; i < 10; i++) {
      const { c } = setup(); c.dispose(); c.dispose();
      vi.advanceTimersByTime(2_000);
      expect(c.iframe.isConnected).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('ignores a session response that arrives after unmount and revokes that session', async () => {
    const { c, ready, send } = setup(); ready();
    let finish!: (r: Response) => void;
    const session = { sessionId: '33333333-3333-4333-8333-333333333333', projectId, modelVersionId: versionId,
      loadId: '', expiresAt: '2026-10-16T22:05:00Z', absoluteExpiresAt: '2026-10-16T22:30:00Z' };
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (options?.method === 'POST') {
        session.loadId = JSON.parse(String(options.body)).loadId;
        return new Promise<Response>(resolve => { finish = resolve; });
      }
      return new Response(JSON.stringify({ selection: { activeModelVersionId: versionId, selectionRevision: 1 } }));
    });
    const loading = c.load(versionId);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    c.dispose(); finish(new Response(JSON.stringify(session))); await loading;
    expect(send.mock.calls.map(x => x[0].type)).not.toContain('LOAD_MODEL');
    expect(mock).toHaveBeenCalledWith(expect.stringContaining(session.sessionId), expect.objectContaining({ method: 'DELETE' }));
  });
});
