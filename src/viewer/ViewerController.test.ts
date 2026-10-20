import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerController, type ViewerEvent, type ViewerOptions, type ViewerCaptureTiming } from './ViewerController';
import { invalidateViewerLogin } from './loginLifecycle';
import { webcrypto } from 'node:crypto';
import * as captureRuntime from '../../viewer-runtime/model-capture.mjs';
import * as captureInputRuntime from '../../viewer-runtime/capture-input.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
let controllers: ViewerController[];
beforeEach(() => { controllers = []; vi.stubGlobal('crypto', webcrypto); vi.useFakeTimers(); });
afterEach(() => { controllers.forEach(c => c.dispose()); vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function setup(token = 'login-a', onCaptureTiming?: ViewerOptions['onCaptureTiming']) {
  const container = document.createElement('div'); document.body.append(container);
  const events: ViewerEvent[] = [];
  const c = new ViewerController({ container, projectId, token, onEvent: e => events.push(e), onCaptureTiming });
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
  async function loaded(sessionDuration = 300_000, onCaptureTiming?: ViewerOptions['onCaptureTiming']) {
    const s = setup('login-a', onCaptureTiming); s.ready();
    let session: Record<string, unknown>;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (options?.method === 'POST') {
        if (String(_url).endsWith('/renew')) return Response.json({ ...session, expiresAt: new Date(Date.now() + sessionDuration).toISOString() });
        session = { sessionId: crypto.randomUUID(), projectId, modelVersionId: versionId,
          loadId: JSON.parse(String(options.body)).loadId, expiresAt: new Date(Date.now() + sessionDuration).toISOString(), absoluteExpiresAt: new Date(Date.now() + 1_800_000).toISOString() };
        return Response.json(session);
      }
      return Response.json({ selection: { activeModelVersionId: versionId, selectionRevision: 1 } });
    });
    await s.c.load(versionId);
    const command = s.send.mock.calls.find(call => call[0].type === 'LOAD_MODEL')![0];
    const identity = { modelVersionId: versionId, loadId: command.loadId };
    s.message('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true }, command.requestId, identity);
    return { ...s, identity };
  }
  it('preparation discovery freezes exact scope, validates echoed scope and rechecks the current model',async()=>{
    const s=await loaded(),request={schemaVersion:'wfc.pf.viewer-discovery.v1' as const,mode:'names' as const,names:['TRAY-001'],rootObjectId:null,cursor:0,limit:128};
    s.send.mockImplementation(value=>{if(value.type==='READ_PREPARATION_OBJECTS')s.message('PREPARATION_OBJECTS',{schemaVersion:request.schemaVersion,mode:'names',names:value.payload.names,rootObjectId:null,cursor:0,matchingPolicyVersion:'wfc.pf.project-exact-candidates.v2',indexedObjectCount:1,propertyScan:null,objects:[],nextCursor:null,complete:true},value.requestId,s.identity);});
    const reading=s.c.discoverPreparationObjects(request);request.names[0]='CHANGED';expect((await reading).names).toEqual(['TRAY-001']);
    s.send.mockImplementation(value=>{if(value.type==='READ_PREPARATION_OBJECTS')s.message('PREPARATION_OBJECTS',{schemaVersion:request.schemaVersion,mode:'names',names:['WRONG'],rootObjectId:null,cursor:0,matchingPolicyVersion:'wfc.pf.project-exact-candidates.v2',indexedObjectCount:1,propertyScan:null,objects:[],nextCursor:null,complete:true},value.requestId,s.identity);});
    await expect(s.c.discoverPreparationObjects(request)).rejects.toThrow('acknowledgement mismatch');
  });
  it('preparation discovery and capture abort pending bridge work without returning late model data',async()=>{
    const s=await loaded(),abort=new AbortController(),reading=s.c.discoverPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'names',names:['TRAY-001'],rootObjectId:null,cursor:0,limit:128},{signal:abort.signal});
    const rejected=expect(reading).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(s.send.mock.calls.some(call=>call[0].type==='READ_PREPARATION_OBJECTS')).toBe(true));abort.abort();await rejected;expect(s.send.mock.calls.some(call=>call[0].type==='CANCEL_REQUEST')).toBe(true);
    const captureAbort=new AbortController(),capturing=s.c.captureModel({routeCodes:['BC001'],allowedCategories:['Control'],equipmentNames:[]},()=>{},{signal:captureAbort.signal});const captureRejected=expect(capturing).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(s.send.mock.calls.some(call=>call[0].type==='START_MODEL_CAPTURE')).toBe(true));captureAbort.abort();await captureRejected;
  });
  it('allows the frame discovery budget and still terminates a stalled discovery',async()=>{
    const s=await loaded(600_000),reading=s.c.discoverPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['TAG-001'],rootObjectId:null,cursor:0,limit:128});
    const rejected=expect(reading).rejects.toThrow('Viewer request timed out');
    await vi.waitFor(()=>expect(s.send.mock.calls.some(call=>call[0].type==='READ_PREPARATION_OBJECTS')).toBe(true));
    await vi.advanceTimersByTimeAsync(300_001);
    expect(s.events.some(event=>event.type==='ERROR'&&event.payload.code==='REQUEST_TIMEOUT')).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);await rejected;
    expect(s.events.some(event=>event.type==='ERROR'&&event.payload.code==='REQUEST_TIMEOUT')).toBe(true);
  });
  it('ends capture at its absolute 315s wall deadline despite continuous progress keepalives', async () => {
    const timing = vi.fn(), s = await loaded(600_000, timing);
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      if (value.type === 'CANCEL_REQUEST') s.message('REQUEST_CANCELLED', { targetRequestId: value.payload.targetRequestId, outcome: 'cancelled' }, value.requestId, s.identity);
    });
    const startedAt = Date.now(), capture = s.c.captureModel({ lookupRouteCodes: ['/BC001'], equipmentNames: [] });
    const rejected = expect(capture).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    let settled = false; void capture.then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'START_MODEL_CAPTURE')).toBe(true));
    const command = s.send.mock.calls.find(call => call[0].type === 'START_MODEL_CAPTURE')![0];
    const progress = window.setInterval(() => s.message('MODEL_CAPTURE_PROGRESS', { captureId: command.payload.captureId, phase: 'properties', loaded: 1, total: 2 }, command.requestId, s.identity), 30_000);
    try {
      await vi.advanceTimersByTimeAsync(300_000 - (Date.now() - startedAt));
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(14_999); expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1); await rejected;
      expect(captureInputRuntime.CAPTURE_INPUT_LIMITS.milliseconds).toBe(300_000);
      expect(s.send.mock.calls.some(call => call[0].type === 'CANCEL_REQUEST' && call[0].payload.targetRequestId === command.requestId)).toBe(true);
      expect(s.events.some(event => event.type === 'ERROR' && event.payload.code === 'REQUEST_TIMEOUT')).toBe(false);
      expect(timing).toHaveBeenCalledOnce(); expect(timing.mock.calls[0][0]).toMatchObject({ outcome: 'deadline', roundCount: 1, eventCount: 0 });
      const count = s.events.length;
      s.message('MODEL_CAPTURE_EVENT', { captureId: command.payload.captureId, index: 0, done: true, eventJson: JSON.stringify({ type: 'complete', captureId: command.payload.captureId }) }, command.requestId, s.identity);
      expect(s.events).toHaveLength(count);
    } finally { window.clearInterval(progress); }
  });
  it('includes asynchronous input staging in the wall bound and ignores a late staged result', async () => {
    const s = await loaded(600_000);
    s.send.mockImplementation(value => { if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity); });
    let resume!: (value: Awaited<ReturnType<typeof captureInputRuntime.planModelCaptureInput>>) => void;
    const plan = vi.spyOn(captureInputRuntime, 'planModelCaptureInput').mockImplementation(() => new Promise(resolve => { resume = resolve; }));
    const startedAt = Date.now(), capture = s.c.captureModel({ routeCodes: ['BC001'], allowedCategories: ['Control'], equipmentNames: [] });
    const rejected = expect(capture).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(315_000 - (Date.now() - startedAt)); await rejected;
    expect(plan.mock.calls[0][1].signal?.aborted).toBe(true);
    resume({} as Awaited<ReturnType<typeof captureInputRuntime.planModelCaptureInput>>); await Promise.resolve(); await Promise.resolve();
    expect(s.send.mock.calls.some(call => call[0].type === 'START_MODEL_CAPTURE')).toBe(false);
  });
  it('retains the shorter per-request timeout when capture makes no progress', async () => {
    const s = await loaded(600_000);
    s.send.mockImplementation(value => { if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity); });
    const capture = s.c.captureModel({ lookupRouteCodes: ['/BC001'], equipmentNames: [] });
    const rejected = expect(capture).rejects.toThrow('Viewer request timed out');
    let settled = false; void capture.then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'START_MODEL_CAPTURE')).toBe(true));
    await vi.advanceTimersByTimeAsync(124_000); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_001); await rejected;
    expect(s.events.some(event => event.type === 'ERROR' && event.payload.code === 'REQUEST_TIMEOUT')).toBe(true);
  });
  it('removes the wall timer after successful capture without cancelling a later idle model', async () => {
    const s = await loaded(600_000);
    vi.spyOn(captureRuntime, 'createModelCaptureAssembler').mockImplementation(() => ({ accept: vi.fn(), finish: () => ({ synthetic: true }), summary: () => ({}) }));
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      if (value.type === 'START_MODEL_CAPTURE') s.message('MODEL_CAPTURE_EVENT', { captureId: value.payload.captureId, index: 0, done: true, eventJson: JSON.stringify({ type: 'complete', captureId: value.payload.captureId }) }, value.requestId, s.identity);
    });
    await expect(s.c.captureModel({ lookupRouteCodes: ['/BC001'], equipmentNames: [] })).resolves.toMatchObject({ snapshot: { synthetic: true } });
    const count = s.send.mock.calls.filter(call => call[0].type === 'CLEAR_ROUTE' || call[0].type === 'CANCEL_REQUEST').length;
    await vi.advanceTimersByTimeAsync(315_000);
    expect(s.send.mock.calls.filter(call => call[0].type === 'CLEAR_ROUTE' || call[0].type === 'CANCEL_REQUEST')).toHaveLength(count);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true); expect(s.events.filter(event => event.type === 'ERROR')).toHaveLength(0);
  });
  it('reports one bounded aggregate on success with measured round waits and no identity or payload fields', async () => {
    const timing = vi.fn(), s = await loaded(600_000, timing);
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.spyOn(captureRuntime, 'createModelCaptureAssembler').mockImplementation(() => ({ accept: vi.fn(), finish: () => ({ privateModelData: 'DO-NOT-LOG' }), summary: () => ({}) }));
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      if (value.type === 'START_MODEL_CAPTURE' || value.type === 'READ_MODEL_CAPTURE') {
        const index = value.type === 'START_MODEL_CAPTURE' ? 0 : 1;
        window.setTimeout(() => s.message('MODEL_CAPTURE_EVENT', { captureId: value.payload.captureId, index, done: index === 1,
          eventJson: JSON.stringify({ type: index === 0 ? 'metadata' : 'complete', captureId: value.payload.captureId }) }, value.requestId, s.identity), index === 0 ? 5 : 7);
      }
    });
    const capture = s.c.captureModel({ lookupRouteCodes: ['/PRIVATE-TRAY'], equipmentNames: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.send.mock.calls.some(call => call[0].type === 'START_MODEL_CAPTURE')).toBe(true);
    await vi.advanceTimersByTimeAsync(12);
    await expect(capture).resolves.toMatchObject({ snapshot: { privateModelData: 'DO-NOT-LOG' } });
    expect(timing).toHaveBeenCalledOnce(); const value: ViewerCaptureTiming = timing.mock.calls[0][0];
    expect(value).toMatchObject({ outcome: 'completed', roundCount: 2, inputChunkCount: 0, eventCount: 2, roundWaitMs: 12, maxRoundWaitMs: 7, wallMs: 12 });
    expect(Object.keys(value).sort()).toEqual(['outcome', 'wallMs', 'roundCount', 'inputChunkCount', 'eventCount', 'roundWaitMs', 'maxRoundWaitMs', 'initialSelectionMs', 'finalSelectionMs', 'planningMs', 'assemblyMs', 'evidenceHashMs'].sort());
    for (const [key, number] of Object.entries(value)) if (key !== 'outcome') { expect(Number.isFinite(number)).toBe(true); expect(number).toBeGreaterThanOrEqual(0); expect(number).toBeLessThanOrEqual(630_000); }
    expect(Object.isFrozen(value)).toBe(true);
    for (const secret of [projectId, versionId, '/PRIVATE-TRAY', 'DO-NOT-LOG', s.identity.loadId]) expect(JSON.stringify(value)).not.toContain(secret);
    await vi.advanceTimersByTimeAsync(315_000); expect(timing).toHaveBeenCalledOnce();
  });
  it('reports a refusal without raw frame error text and isolates a throwing diagnostic callback', async () => {
    const values: ViewerCaptureTiming[] = [], s = await loaded(600_000, value => { values.push(value); throw new Error('PRIVATE-SINK-ERROR'); });
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      if (value.type === 'START_MODEL_CAPTURE') s.message('ERROR', { code: 'EXTRACTION_FAILED', message: 'PRIVATE-FRAME-ERROR', retryable: false, operation: 'START_MODEL_CAPTURE' }, value.requestId, s.identity);
    });
    await expect(s.c.captureModel({ lookupRouteCodes: ['/PRIVATE-TRAY'], equipmentNames: [] })).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    expect(values).toHaveLength(1); expect(values[0]).toMatchObject({ outcome: 'refused', roundCount: 1, eventCount: 0 });
    expect(JSON.stringify(values)).not.toContain('PRIVATE');
  });
  it('reports cancellation once even after a late capture reply', async () => {
    const timing = vi.fn(), s = await loaded(600_000, timing), abort = new AbortController();
    s.send.mockImplementation(value => { if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity); });
    const capture = s.c.captureModel({ lookupRouteCodes: ['/PRIVATE-TRAY'], equipmentNames: [] }, () => {}, { signal: abort.signal });
    const rejected = expect(capture).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'START_MODEL_CAPTURE')).toBe(true));
    const command = s.send.mock.calls.find(call => call[0].type === 'START_MODEL_CAPTURE')![0];
    abort.abort(); await rejected;
    expect(timing).toHaveBeenCalledOnce(); expect(timing.mock.calls[0][0]).toMatchObject({ outcome: 'cancelled', roundCount: 1, eventCount: 0 });
    s.message('MODEL_CAPTURE_EVENT', { captureId: command.payload.captureId, index: 0, done: true, eventJson: JSON.stringify({ type: 'complete' }) }, command.requestId, s.identity);
    expect(timing).toHaveBeenCalledOnce();
  });
  it('reports early not-ready refusal and observes a rejected asynchronous diagnostic callback', async () => {
    const timing = vi.fn().mockRejectedValue(new Error('PRIVATE-ASYNC-SINK-ERROR')), s = setup('login-a', timing);
    vi.spyOn(performance, 'now').mockReturnValue(Number.NaN);
    await expect(s.c.captureModel({ lookupRouteCodes: ['/PRIVATE-TRAY'], equipmentNames: [] })).rejects.toThrow('Model is not ready');
    await Promise.resolve();
    expect(timing).toHaveBeenCalledOnce(); expect(timing.mock.calls[0][0]).toMatchObject({ outcome: 'refused', wallMs: 0, roundCount: 0, eventCount: 0 });
    for (const [key, value] of Object.entries(timing.mock.calls[0][0])) if (key !== 'outcome') expect(Number.isFinite(value)).toBe(true);
  });
  it('freezes independent lookup capture codes without importing planning categories or roots', async () => {
    const s = await loaded(), codes = ['/BC001', '/BC002'];
    s.send.mockImplementation(value => { if (value.type === 'START_MODEL_CAPTURE') s.message('ERROR', { code: 'LOOKUP_GEOMETRY_NOT_FOUND', message: 'No display-visible route geometry matches the lookup.', retryable: false, operation: 'START_MODEL_CAPTURE' }, value.requestId, s.identity); });
    const capturing = s.c.captureModel({ lookupRouteCodes: codes, equipmentNames: [] }); codes[0] = '/CHANGED';
    await expect(capturing).rejects.toMatchObject({ code: 'LOOKUP_GEOMETRY_NOT_FOUND' });
    const payload = s.send.mock.calls.find(call => call[0].type === 'START_MODEL_CAPTURE')![0].payload;
    expect(payload.lookupRouteCodes).toEqual(['/BC001', '/BC002']); expect(payload.routeCodes).toBeUndefined(); expect(payload.routeRules).toBeUndefined(); expect(payload.allowedCategories).toBeUndefined();
  });
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
  it('collects 1,527 frozen equipment names in six bounded rounds before requesting one output stream', async () => {
    const s = await loaded(), names = Array.from({ length: 1527 }, (_, index) => `=REAL-FORMAT-${String(index).padStart(4, '0')}`);
    let descriptor: Record<string, unknown>, received = 0;
    s.send.mockImplementation(value => {
      if (value.type === 'START_MODEL_CAPTURE') { descriptor = value.payload.input; s.message('MODEL_CAPTURE_INPUT_ACK', { captureId: value.payload.captureId, phase: 'receiving', receivedNameCount: 0, scopeSha256: null, equipmentNamesSha256: null }, value.requestId, s.identity); }
      if (value.type === 'READ_MODEL_CAPTURE' && value.payload.equipmentNames) {
        received += value.payload.equipmentNames.length; const ready = received === 1527;
        s.message('MODEL_CAPTURE_INPUT_ACK', { captureId: value.payload.captureId, phase: ready ? 'ready' : 'receiving', receivedNameCount: received, scopeSha256: ready ? descriptor.scopeSha256 : null, equipmentNamesSha256: ready ? descriptor.equipmentNamesSha256 : null }, value.requestId, s.identity);
      }
      if (value.type === 'READ_MODEL_CAPTURE' && value.payload.index === 0) s.message('ERROR', { code: 'EXTRACTION_FAILED', message: 'Output boundary reached by this input-only control.', retryable: false, operation: 'READ_MODEL_CAPTURE' }, value.requestId, s.identity);
    });
    const capture = s.c.captureModel({ routeCodes: ['BC001'], allowedCategories: ['Control'], equipmentNames: names }); names[0] = 'MUTATED';
    await expect(capture).rejects.toMatchObject({ code: 'EXTRACTION_FAILED' });
    const chunks = s.send.mock.calls.map(call => call[0]).filter(value => value.type === 'READ_MODEL_CAPTURE' && value.payload.equipmentNames);
    expect(chunks.map(value => value.payload.equipmentNames.length)).toEqual([256, 256, 256, 256, 256, 247]);
    expect(chunks.flatMap(value => value.payload.equipmentNames)[0]).toBe('=REAL-FORMAT-0000');
    expect(chunks.every(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65536)).toBe(true);
    expect(s.send.mock.calls.filter(call => call[0].type === 'START_MODEL_CAPTURE')).toHaveLength(1);
    expect(s.send.mock.calls.filter(call => call[0].type === 'READ_MODEL_CAPTURE' && call[0].payload.index === 0)).toHaveLength(1);
  });
  it('cancels between acknowledged input chunks and never starts extraction after Clear', async () => {
    const s = await loaded(); let appended = 0;
    s.send.mockImplementation(value => {
      if (value.type === 'START_MODEL_CAPTURE') s.message('MODEL_CAPTURE_INPUT_ACK', { captureId: value.payload.captureId, phase: 'receiving', receivedNameCount: 0, scopeSha256: null, equipmentNamesSha256: null }, value.requestId, s.identity);
      if (value.type === 'READ_MODEL_CAPTURE' && value.payload.equipmentNames) { appended++; s.c.clear(); }
    });
    await expect(s.c.captureModel({ routeCodes: ['BC001'], allowedCategories: ['Control'], equipmentNames: Array.from({ length: 600 }, (_, i) => `EQ-${i}`) })).rejects.toMatchObject({ name: 'AbortError' });
    expect(appended).toBe(1); expect(s.send.mock.calls.some(call => call[0].type === 'READ_MODEL_CAPTURE' && call[0].payload.index !== undefined)).toBe(false);
  });
  it('refuses a ready acknowledgement with different hashes before starting extraction', async () => {
    const s = await loaded();
    s.send.mockImplementation(value => {
      if (value.type === 'START_MODEL_CAPTURE') s.message('MODEL_CAPTURE_INPUT_ACK', { captureId: value.payload.captureId, phase: 'receiving', receivedNameCount: 0, scopeSha256: null, equipmentNamesSha256: null }, value.requestId, s.identity);
      if (value.type === 'READ_MODEL_CAPTURE' && value.payload.equipmentNames) s.message('MODEL_CAPTURE_INPUT_ACK', { captureId: value.payload.captureId, phase: 'ready', receivedNameCount: 1, scopeSha256: 'f'.repeat(64), equipmentNamesSha256: 'e'.repeat(64) }, value.requestId, s.identity);
    });
    await expect(s.c.captureModel({ routeCodes: ['BC001'], allowedCategories: ['Control'], equipmentNames: ['EQ-001'] })).rejects.toThrow('acknowledgement mismatch');
    expect(s.send.mock.calls.some(call => call[0].payload.index === 0)).toBe(false);
  });
  it('refuses a complete result whose recorded summary drops requested names despite matching descriptor hashes', async () => {
    const s = await loaded(); let scope: Record<string, unknown>;
    vi.spyOn(captureRuntime, 'createModelCaptureAssembler').mockImplementation(() => ({ accept: vi.fn(), finish: () => ({ capture: { inputScope: scope } }), summary: () => ({ scope: { inputScope: scope, equipmentNames: [], routeCodes: ['/BC001'], allowedCategories: ['Control'] } }) }));
    s.send.mockImplementation(value => {
      if (value.type === 'START_MODEL_CAPTURE') {
        scope = { ...value.payload.input, propertyScan: { indexedObjectCount: 1, attemptedObjectCount: 1, returnedObjectCount: 1, omittedObjectCount: 0, complete: true } };
        s.message('MODEL_CAPTURE_INPUT_ACK', { captureId: value.payload.captureId, phase: 'receiving', receivedNameCount: 0, scopeSha256: null, equipmentNamesSha256: null }, value.requestId, s.identity);
      }
      if (value.type === 'READ_MODEL_CAPTURE' && value.payload.equipmentNames) s.message('MODEL_CAPTURE_INPUT_ACK', { captureId: value.payload.captureId, phase: 'ready', receivedNameCount: 1, scopeSha256: scope.scopeSha256, equipmentNamesSha256: scope.equipmentNamesSha256 }, value.requestId, s.identity);
      if (value.type === 'READ_MODEL_CAPTURE' && value.payload.index === 0) s.message('MODEL_CAPTURE_EVENT', { captureId: value.payload.captureId, index: 0, done: true, eventJson: JSON.stringify({ type: 'complete', captureId: value.payload.captureId }) }, value.requestId, s.identity);
    });
    await expect(s.c.captureModel({ routeCodes: ['BC001'], allowedCategories: ['Control'], equipmentNames: ['EQ-001'] })).rejects.toThrow('request summary mismatch');
  });
  it('assembles one completed staged snapshot with durable input scope and exact final request closure', async () => {
    const s = await loaded(), matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    let descriptor: Record<string, unknown>, captureId = '', events: Record<string, unknown>[] = [];
    s.send.mockImplementation(value => {
      if (value.type === 'START_MODEL_CAPTURE') {
        descriptor = value.payload.input; captureId = value.payload.captureId;
        s.message('MODEL_CAPTURE_INPUT_ACK', { captureId, phase: 'receiving', receivedNameCount: 0, scopeSha256: null, equipmentNamesSha256: null }, value.requestId, s.identity);
      }
      if (value.type === 'READ_MODEL_CAPTURE' && value.payload.equipmentNames) {
        const inputScope = { ...descriptor, propertyScan: { indexedObjectCount: 1, attemptedObjectCount: 1, returnedObjectCount: 1, omittedObjectCount: 0, complete: true } };
        const counts = { objectCount: 1, fragmentCount: 1, vertexCount: 3, triangleCount: 1 };
        const object = { id: 'dbid:1', parentId: null, dbId: 1, name: 'Straight', geometryRole: 'routing-leaf', leafToRootNames: ['Straight'], properties: [], nativeHidden: null, planningExcluded: false, routeName: '/BC001', shapeName: 'Straight', categoryAssignmentSource: 'explicit-planning', allowedCategories: ['Control'], bounds: { minimum: [0, 0, 0], maximum: [1, 1, 0] }, fragments: [{ id: 'fragment:0', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangleIndices: [0, 1, 2], fragmentToWorldMetres: matrix, transformAlreadyApplied: true }] };
        const header = { schemaVersion: 'pathfinder.model.snapshot.v1', model: { projectId, modelVersionId: versionId, contentSha256: 'a'.repeat(64) }, capture: { adapterVersion: 'wfc.protected-selected-capture.v1', sourceKind: 'converted', inventoryComplete: false, geometryComplete: false, unitsVerified: false, transformsVerified: false, planningVisibilityKnown: false, sourceLinkVerified: false, evidenceSha256: ['b'.repeat(64)], inputScope: { ...descriptor, propertyScan: null } }, coordinates: { vertexFrame: 'canonical-world-metres', sourceUnits: 'metres', metresPerSourceUnit: 1, sourceToWorldMetres: matrix, globalOffsetMetres: [0, 0, 0], displayToWorldMetres: matrix } };
        events = [{ type: 'metadata', captureId, schemaVersion: 'pathfinder.model.capture.events.v1', snapshotHeader: header, scope: 'explicit-selected-network', inventoryComplete: false, geometryComplete: false }, { type: 'object-part', captureId, objectId: object.id, partIndex: 0, final: true, text: JSON.stringify(object) }, { type: 'summary-part', captureId, partIndex: 0, final: true, text: JSON.stringify({ engineeringAccepted: false, counts, scope: { kind: 'explicit-selected-network', routeCodes: ['/BC001'], allowedCategories: ['Control'], equipmentNames: ['EQ-001'], inputScope, indexedObjectCount: 1, fullPropertyScan: true } }) }, { type: 'complete', captureId, ...counts, engineeringAccepted: false }];
        s.message('MODEL_CAPTURE_INPUT_ACK', { captureId, phase: 'ready', receivedNameCount: 1, scopeSha256: descriptor.scopeSha256, equipmentNamesSha256: descriptor.equipmentNamesSha256 }, value.requestId, s.identity);
      }
      if (value.type === 'READ_MODEL_CAPTURE' && value.payload.index !== undefined) s.message('MODEL_CAPTURE_EVENT', { captureId, index: value.payload.index, done: value.payload.index === events.length - 1, eventJson: JSON.stringify(events[value.payload.index]) }, value.requestId, s.identity);
    });
    const result = await s.c.captureModel({ routeCodes: ['BC001'], allowedCategories: ['Control'], equipmentNames: ['EQ-001'] });
    expect((result.snapshot as { objects: unknown[] }).objects).toHaveLength(1);
    expect((result.snapshot as { capture: { inputScope: { equipmentNameCount: number; propertyScan: { complete: boolean } } } }).capture.inputScope).toMatchObject({ equipmentNameCount: 1, chunkCount: 1, propertyScan: { complete: true } });
    expect(s.send.mock.calls.filter(call => call[0].type === 'START_MODEL_CAPTURE')).toHaveLength(1);
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
