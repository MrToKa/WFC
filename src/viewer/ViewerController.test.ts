import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerController, type ViewerEvent, type ViewerOptions, type ViewerCaptureTiming } from './ViewerController';
import { invalidateViewerLogin } from './loginLifecycle';
import { createHash, webcrypto } from 'node:crypto';
import * as captureRuntime from '../../viewer-runtime/model-capture.mjs';
import * as captureInputRuntime from '../../viewer-runtime/capture-input.mjs';
import { PREPARATION_MATCHING_POLICY } from '../../viewer-runtime/preparation-input.mjs';
import { barrierCanonicalJson, validateBarrierFrameObservation, type BarrierCaptureRequest } from '../../viewer-runtime/barrier-capture.mjs';
import { barrierCaptureSchema } from '../../shared/pathfinderBarriers';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from '../../viewer-runtime/barrier-multipart-protocol.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const discoveryVisibility={schemaVersion:'wfc.pf.sdk-display-visibility.v1' as const,basis:'sdk-display-before-pf-appearance' as const,contentSha256:'a'.repeat(64)};
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
function barrierRequest(): BarrierCaptureRequest {
  return { captureId: crypto.randomUUID(), scope: { projectId, modelVersionId: versionId, contentFingerprint: 'b'.repeat(64), selectionRevision: '1',
    captureFrameId: '55555555-5555-4555-8555-555555555555', captureFrameSha256: 'd'.repeat(64), coordinateFrame: 'canonical-world-metres' },
  selectedParents: [{ selectionId: '66666666-6666-4666-8666-666666666666', kind: 'wall', objectId: 'dbid:23', dbId: 23, externalId: null,
    name: 'Selected wall', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }] };
}
function barrierStream(input: BarrierCaptureRequest, loadId: string): Array<Record<string, unknown>> {
  const sha = (value: unknown) => createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const frameInput = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId, modelVersionId: versionId, contentFingerprint: input.scope.contentFingerprint,
    loadId, sdkVersion: '7.130.0', matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerDisplayUnit: 1,
    upVector: [0, 0, 1], globalOffsetDisplayUnits: [0, 0, 0], globalOffsetMetres: [0, 0, 0], displayToWorldMetres: matrix, modelTransform: null, placementTransform: null };
  const frameObservation = { ...frameInput, contentSha256: sha(frameInput) };
  const source = { fragmentId: 0, ownerObjectId: 'dbid:23', parentSelectionIds: [input.selectedParents[0].selectionId], sourceUnits: 'm', metresPerSourceUnit: 1,
    sourceToWorldMetres: matrix, transformSha256: sha(matrix) };
  const fragments = [{ source, bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], triangleIndices: [0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5] }];
  const enumeration = { selectedParents: input.selectedParents, enumeratedFragmentIds: [0], membership: [{ fragmentId: 0, ownerObjectId: source.ownerObjectId, parentSelectionIds: source.parentSelectionIds }] };
  const capture = { schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: input.captureId, scope: input.scope, selectedParents: input.selectedParents, fragments,
    observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [0], unavailableFragmentIds: [], enumerationSha256: sha(enumeration) } };
  return [{ type: 'metadata', captureId: input.captureId, schemaVersion: 'wfc.pf.barrier-capture.events.v1', scope: input.scope, selectedParentCount: 1, frameObservation },
    { type: 'capture-part', captureId: input.captureId, partIndex: 0, final: true, text: barrierCanonicalJson(capture) },
    { type: 'complete', captureId: input.captureId, captureSha256: sha(capture), fragmentCount: 1, vertexCount: 8, triangleCount: 12 }];
}
function barrierObservation(input: BarrierCaptureRequest, loadId: string): Awaited<ReturnType<ViewerController['captureBarriers']>> {
  const events = barrierStream(input, loadId), frameObservation = events[0].frameObservation;
  if (!validateBarrierFrameObservation(frameObservation)) throw new Error('Synthetic frame fixture is invalid');
  return { capture: barrierCaptureSchema.parse(JSON.parse(String(events[1].text))), frameObservation };
}
const barrierPublicationReceipt = (input: BarrierCaptureRequest) => ({ schemaVersion: 'wfc.pf.barrier-publication-receipt.v1',
  snapshot: { snapshotId: '77777777-7777-4777-8777-777777777777', scope: structuredClone(input.scope), registryRevision: '1', contentSha256: 'e'.repeat(64), mode: 'mesh-set' }, duplicate: false });

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
  it('small multipart controls retain exact intent identity and leave model appearance alone', async () => {
    const s = await loaded(), intentId = crypto.randomUUID();
    const start = { intentId, expectedSessionRevision: '0', scopeSha256: 'a'.repeat(64), profileSha256: 'b'.repeat(64), producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE };
    const status = { intentId, sessionRevision: '0', state: 'admitted', counts: { pages: 0, seals: 0, parts: 0 }, roots: { nodes: null, fragments: null, 'geometry-ranges': null, plan: null }, qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' };
    s.send.mockImplementation(value => { if (value.type.includes('BARRIER_MULTIPART')) void Promise.resolve().then(() => s.message('BARRIER_MULTIPART_STATUS', status, value.requestId, s.identity)); });
    await expect(s.c.startBarrierMultipart(start)).resolves.toMatchObject({ intentId, authority: 'none' });
    await expect(s.c.barrierMultipartStatus(intentId)).resolves.toMatchObject({ intentId });
    await expect(s.c.reconcileBarrierMultipart(intentId)).resolves.toMatchObject({ intentId });
    await expect(s.c.barrierMultipartStatus(intentId, true)).resolves.toMatchObject({ intentId });
    expect(s.send.mock.calls.filter(call => call[0].type === 'CLEAR_ROUTE')).toHaveLength(0);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true);
  });
  it('multipart replies cannot switch intent or observed model fingerprint', async () => {
    const s = await loaded(), intentId = crypto.randomUUID(), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId);
    const status = { intentId: crypto.randomUUID(), sessionRevision: '0', state: 'admitted', counts: { pages: 0, seals: 0, parts: 0 }, roots: { nodes: null, fragments: null, 'geometry-ranges': null, plan: null }, qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' };
    s.send.mockImplementation(value => {
      const frame = value.type === 'READ_BARRIER_MULTIPART_FRAME';
      if (value.type.includes('BARRIER_MULTIPART')) void Promise.resolve().then(() => s.message(frame ? 'BARRIER_MULTIPART_FRAME' : 'BARRIER_MULTIPART_STATUS',
        frame ? { frameObservation: observation.frameObservation, producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE } : status, value.requestId, s.identity));
    });
    await expect(s.c.barrierMultipartStatus(intentId)).rejects.toThrow('response changed');
    await expect(s.c.readBarrierMultipartFrame('c'.repeat(64))).rejects.toThrow('frame changed');
    expect(s.c.getLoadSnapshot()?.ready).toBe(true);
  });
  it('a multipart control timeout retains the loaded model and requests explicit reconciliation', async () => {
    const s = await loaded(), intentId = crypto.randomUUID();
    const outcome = s.c.barrierMultipartStatus(intentId).catch(error => error);
    await vi.advanceTimersByTimeAsync(195_001);
    expect(await outcome).toBeInstanceOf(Error); expect(s.c.getLoadSnapshot()?.ready).toBe(true);
    expect(s.events.some(event => event.type === 'ERROR' && event.payload.code === 'BARRIER_MULTIPART_RECONCILE_REQUIRED')).toBe(true);
    expect(s.send.mock.calls.some(call => call[0].type === 'CANCEL_REQUEST')).toBe(true);
  });
  it('assembles a request-bound barrier capture with a separate observed frame and final model check', async () => {
    const s = await loaded(), input = barrierRequest(), events = barrierStream(input, s.identity.loadId);
    s.send.mockImplementation(value => {
      if (!['START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE'].includes(value.type)) return;
      const index = value.type === 'START_BARRIER_CAPTURE' ? 0 : value.payload.index;
      void Promise.resolve().then(() => s.message('BARRIER_CAPTURE_EVENT', { captureId: input.captureId, index, done: index === events.length - 1,
        eventJson: JSON.stringify(events[index]) }, value.requestId, s.identity));
    });
    await expect(s.c.captureBarriers(input)).resolves.toMatchObject({ capture: { captureId: input.captureId, observation: { verification: 'unverified' } }, frameObservation: { loadId: s.identity.loadId } });
    expect(s.send.mock.calls.filter(call => call[0].type === 'READ_BARRIER_CAPTURE')).toHaveLength(2);
  });
  it.each(['BARRIER_CAPTURE_FRAGMENT_LIMIT', 'BARRIER_CAPTURE_GEOMETRY_NOT_READY', 'BARRIER_CAPTURE_MODEL_CHANGED'])('preserves the exact barrier failure and only unloads a changed model: %s', async code => {
    const s = await loaded(), input = barrierRequest();
    s.send.mockImplementation(value => {
      if (value.type !== 'START_BARRIER_CAPTURE') return;
      void Promise.resolve().then(() => s.message('ERROR', { code, message: 'Barrier capture failed.', retryable: false, operation: value.type }, value.requestId, s.identity));
    });
    await expect(s.c.captureBarriers(input)).rejects.toMatchObject({ code });
    if (code === 'BARRIER_CAPTURE_MODEL_CHANGED') expect(s.c.getLoadSnapshot()).toBeNull();
    else expect(s.c.getLoadSnapshot()).toMatchObject({ ready: true, modelVersionId: versionId, loadId: s.identity.loadId });
  });
  it('superseded barrier cleanup cannot cancel a newer capture even when the caller reuses its capture UUID', async () => {
    const s = await loaded(), input = barrierRequest(), events = barrierStream(input, s.identity.loadId);
    let finishOld!: (response: Response) => void;
    vi.mocked(globalThis.fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
    s.send.mockImplementation(value => {
      if (value.type !== 'READ_BARRIER_CAPTURE') return;
      const index = value.payload.index; void Promise.resolve().then(() => s.message('BARRIER_CAPTURE_EVENT', { captureId: input.captureId, index,
        done: index === events.length - 1, eventJson: JSON.stringify(events[index]) }, value.requestId, s.identity));
    });
    const old = s.c.captureBarriers(input), oldRejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
    const next = s.c.captureBarriers(input), nextResult = expect(next).resolves.toMatchObject({ capture: { captureId: input.captureId } });
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'START_BARRIER_CAPTURE')).toBe(true));
    const command = s.send.mock.calls.find(call => call[0].type === 'START_BARRIER_CAPTURE')![0];
    finishOld(Response.json({ selection: { activeModelVersionId: versionId, selectionRevision: 1 } })); await oldRejected;
    expect(s.send.mock.calls.some(call => call[0].type === 'CANCEL_REQUEST' && call[0].payload.targetRequestId === command.requestId)).toBe(false);
    s.message('BARRIER_CAPTURE_EVENT', { captureId: input.captureId, index: 0, done: false, eventJson: JSON.stringify(events[0]) }, command.requestId, s.identity);
    await nextResult;
  });
  it.each(['index', 'capture UUID', 'part order', 'frame hash', 'premature terminal'])('rejects malformed barrier %s before returning a capture', async kind => {
    const s = await loaded(), input = barrierRequest(), events = barrierStream(input, s.identity.loadId);
    if (kind === 'part order') events[1].partIndex = 1;
    if (kind === 'frame hash') (events[0].frameObservation as { globalOffsetMetres: number[] }).globalOffsetMetres[0] = 99;
    s.send.mockImplementation(value => {
      if (!['START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE'].includes(value.type)) return;
      const index = value.type === 'START_BARRIER_CAPTURE' ? 0 : value.payload.index;
      void Promise.resolve().then(() => s.message('BARRIER_CAPTURE_EVENT', { captureId: kind === 'capture UUID' ? crypto.randomUUID() : input.captureId,
        index: kind === 'index' ? index + 1 : index, done: kind === 'premature terminal' || index === events.length - 1,
        eventJson: JSON.stringify(events[index]) }, value.requestId, s.identity));
    });
    await expect(s.c.captureBarriers(input)).rejects.toBeDefined();
  });
  it('ignores a barrier response from a foreign load and accepts only its current exact reply', async () => {
    const s = await loaded(), input = barrierRequest(), events = barrierStream(input, s.identity.loadId);
    s.send.mockImplementation(value => {
      if (!['START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE'].includes(value.type)) return;
      const index = value.type === 'START_BARRIER_CAPTURE' ? 0 : value.payload.index, payload = { captureId: input.captureId, index,
        done: index === events.length - 1, eventJson: JSON.stringify(events[index]) };
      void Promise.resolve().then(() => { s.message('BARRIER_CAPTURE_EVENT', payload, value.requestId, { ...s.identity, loadId: crypto.randomUUID() }); s.message('BARRIER_CAPTURE_EVENT', payload, value.requestId, s.identity); });
    });
    await expect(s.c.captureBarriers(input)).resolves.toMatchObject({ capture: { captureId: input.captureId } });
  });
  it('a model selection change at final barrier verification prevents publication of an otherwise intact capture', async () => {
    const s = await loaded(), input = barrierRequest(), events = barrierStream(input, s.identity.loadId);
    s.send.mockImplementation(value => {
      if (!['START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE'].includes(value.type)) return;
      const index = value.type === 'START_BARRIER_CAPTURE' ? 0 : value.payload.index;
      if (index === events.length - 1) vi.mocked(globalThis.fetch).mockImplementationOnce(async () => Response.json({ selection: { activeModelVersionId: versionId, selectionRevision: 2 } }));
      void Promise.resolve().then(() => s.message('BARRIER_CAPTURE_EVENT', { captureId: input.captureId, index, done: index === events.length - 1,
        eventJson: JSON.stringify(events[index]) }, value.requestId, s.identity));
    });
    await expect(s.c.captureBarriers(input)).rejects.toBeDefined();
  });
  it('absolute barrier deadline cannot be extended by progress keepalives', async () => {
    const s = await loaded(900_000), input = barrierRequest();
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      if (value.type === 'CANCEL_REQUEST') s.message('REQUEST_CANCELLED', { targetRequestId: value.payload.targetRequestId, outcome: 'cancelled' }, value.requestId, s.identity);
    });
    const capture = s.c.captureBarriers(input), rejected = expect(capture).rejects.toThrow(/deadline/);
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'START_BARRIER_CAPTURE')).toBe(true));
    const command = s.send.mock.calls.find(call => call[0].type === 'START_BARRIER_CAPTURE')![0];
    const progress = window.setInterval(() => s.message('BARRIER_CAPTURE_PROGRESS', { captureId: input.captureId, phase: 'geometry', loaded: 0, total: 1 }, command.requestId, s.identity), 100_000);
    await vi.advanceTimersByTimeAsync(315_001); window.clearInterval(progress); await rejected;
    expect(s.send.mock.calls.some(call => call[0].type === 'CANCEL_REQUEST' && call[0].payload.targetRequestId === command.requestId)).toBe(true);
  });
  it('publishes barriers only through the exact current session cookie path with its own bearer and bounded signal', async () => {
    const s = await loaded(), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), receipt = barrierPublicationReceipt(input);
    const baseline = vi.mocked(globalThis.fetch).getMockImplementation()!, uploads: Array<{ url: RequestInfo | URL; options?: RequestInit }> = [], started = vi.fn();
    vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => {
      if (options?.method !== 'PUT') { if (!options?.method) expect(started).not.toHaveBeenCalled(); return baseline(url, options); }
      expect(started).toHaveBeenCalledOnce(); uploads.push({ url, options }); return Response.json(receipt);
    });
    await expect(s.c.publishBarriers(input.captureId, observation, undefined, started)).resolves.toEqual(receipt);
    expect(uploads).toHaveLength(1); const upload = uploads[0], session = s.send.mock.calls.find(call => call[0].type === 'LOAD_MODEL')![0].payload.sessionId;
    expect(upload.url).toBe(`/api/projects/${projectId}/model-versions/${versionId}/viewer-sessions/${session}/barriers/captures/${input.captureId}`);
    expect(upload.options).toMatchObject({ method: 'PUT', credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error' });
    expect(new Headers(upload.options?.headers).get('Authorization')).toBe('Bearer login-a');
    expect(new Headers(upload.options?.headers).get('Content-Type')).toBe('application/json');
    expect(upload.options?.signal).toBeInstanceOf(AbortSignal); expect(upload.options?.signal?.aborted).toBe(false);
    expect(JSON.parse(String(upload.options?.body))).toEqual(observation);
    expect(JSON.stringify(upload.options?.body)).not.toContain('login-a');
  });
  it('accepts an in-flight barrier publication across an ordinary renewal of the same Viewer session', async () => {
    const s = await loaded(), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), receipt = barrierPublicationReceipt(input);
    // Start the write just before the real scheduled renewal, leaving its own
    // independent 180-second publication deadline well beyond the renewal.
    await vi.advanceTimersByTimeAsync(179_000);
    const baseline = vi.mocked(globalThis.fetch).getMockImplementation()!;
    let finish!: (value: Response) => void, uploadSignal: AbortSignal | null | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => {
      if (options?.method !== 'PUT') return baseline(url, options);
      uploadSignal = options.signal; return await new Promise<Response>(resolve => { finish = resolve; });
    });
    const writing = s.c.publishBarriers(input.captureId, observation), accepted = expect(writing).resolves.toEqual(receipt);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'POST' && String(call[0]).endsWith('/renew'))).toHaveLength(1);
    expect(s.send.mock.calls.filter(call => call[0].type === 'LOAD_MODEL')).toHaveLength(1);
    expect(uploadSignal?.aborted).toBe(false);
    finish(Response.json(receipt)); await accepted;
    expect(s.c.getLoadSnapshot()).toMatchObject({ ready: true, modelVersionId: versionId, loadId: s.identity.loadId });
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(1);
  });
  it.each(['capture project', 'capture model', 'capture UUID', 'capture revision', 'frame load', 'frame project', 'frame model', 'frame fingerprint', 'frame extra', 'frame digest'])('refuses foreign or invalid barrier %s before starting an upload', async kind => {
    const s = await loaded(), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), started = vi.fn();
    if (kind === 'capture project') observation.capture.scope.projectId = crypto.randomUUID();
    if (kind === 'capture model') observation.capture.scope.modelVersionId = crypto.randomUUID();
    if (kind === 'capture UUID') observation.capture.captureId = crypto.randomUUID();
    if (kind === 'capture revision') observation.capture.scope.selectionRevision = '2';
    if (kind === 'frame load') observation.frameObservation.loadId = crypto.randomUUID();
    if (kind === 'frame project') observation.frameObservation.projectId = crypto.randomUUID();
    if (kind === 'frame model') observation.frameObservation.modelVersionId = crypto.randomUUID();
    if (kind === 'frame fingerprint') observation.frameObservation.contentFingerprint = 'f'.repeat(64);
    if (kind === 'frame extra') (observation.frameObservation as unknown as Record<string, unknown>).verified = true;
    if (kind === 'frame digest') observation.frameObservation.contentSha256 = 'f'.repeat(64);
    await expect(s.c.publishBarriers(input.captureId, observation, undefined, started)).rejects.toBeDefined();
    expect(started).not.toHaveBeenCalled();
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(0);
  });
  it('does not announce or dispatch a barrier PUT when its caller was already cancelled', async () => {
    const s = await loaded(), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), started = vi.fn(), caller = new AbortController();
    caller.abort();
    await expect(s.c.publishBarriers(input.captureId, observation, caller.signal, started)).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).not.toHaveBeenCalled(); expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(0);
  });
  it('does not announce a barrier PUT when protected selection preflight is denied', async () => {
    const s = await loaded(), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), started = vi.fn();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(Response.json({ code: 'ACCESS_REVOKED' }, { status: 403 }));
    await expect(s.c.publishBarriers(input.captureId, observation, undefined, started)).rejects.toThrow('Barrier publication is unavailable');
    expect(s.events.some(event => event.type === 'ERROR' && event.payload.code === 'ACCESS_REVOKED')).toBe(true);
    expect(started).not.toHaveBeenCalled(); expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(0);
  });
  it.each(['receipt extra', 'snapshot extra', 'project', 'model', 'fingerprint', 'selection revision', 'frame ID', 'frame hash', 'duplicate type', 'schema', 'explicit empty'])('refuses a barrier publication receipt with changed %s', async kind => {
    const s = await loaded(), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), receipt = barrierPublicationReceipt(input);
    if (kind === 'receipt extra') (receipt as unknown as Record<string, unknown>).ready = true;
    if (kind === 'snapshot extra') (receipt.snapshot as unknown as Record<string, unknown>).ready = true;
    if (kind === 'project') receipt.snapshot.scope.projectId = crypto.randomUUID();
    if (kind === 'model') receipt.snapshot.scope.modelVersionId = crypto.randomUUID();
    if (kind === 'fingerprint') receipt.snapshot.scope.contentFingerprint = 'f'.repeat(64);
    if (kind === 'selection revision') receipt.snapshot.scope.selectionRevision = '2';
    if (kind === 'frame ID') receipt.snapshot.scope.captureFrameId = crypto.randomUUID();
    if (kind === 'frame hash') receipt.snapshot.scope.captureFrameSha256 = 'f'.repeat(64);
    if (kind === 'duplicate type') (receipt as unknown as Record<string, unknown>).duplicate = 'yes';
    if (kind === 'schema') receipt.schemaVersion = 'untrusted.version';
    if (kind === 'explicit empty') receipt.snapshot.mode = 'explicit-empty';
    const baseline = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => options?.method === 'PUT' ? Response.json(receipt) : baseline(url, options));
    await expect(s.c.publishBarriers(input.captureId, observation)).rejects.toBeDefined();
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(1);
  });
  it('does not retry a barrier publication after a 401 or emit automatic success', async () => {
    const s = await loaded(), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), baseline = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => options?.method === 'PUT'
      ? Response.json({ code: 'SESSION_EXPIRED' }, { status: 401 }) : baseline(url, options));
    const before = s.events.length; await expect(s.c.publishBarriers(input.captureId, observation)).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(1);
    expect(s.events.slice(before).some(event => event.type.includes('BARRIER'))).toBe(false);
  });
  it.each(['caller', 'logout', 'dispose', 'timeout'])('aborts an uncertain barrier write on %s without retrying its intent', async reason => {
    const s = await loaded(900_000), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), baseline = vi.mocked(globalThis.fetch).getMockImplementation()!;
    const caller = new AbortController(); let uploadSignal: AbortSignal | null | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => {
      if (options?.method !== 'PUT') return baseline(url, options);
      uploadSignal = options.signal; return await new Promise<Response>((_resolve, reject) => uploadSignal?.addEventListener('abort', () => reject(new DOMException('Synthetic upload interrupted.', 'AbortError')), { once: true }));
    });
    const writing = s.c.publishBarriers(input.captureId, observation, caller.signal), rejected = expect(writing).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(uploadSignal).toBeDefined());
    if (reason === 'caller') caller.abort();
    if (reason === 'logout') invalidateViewerLogin('login-a');
    if (reason === 'dispose') s.c.dispose();
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(180_001);
    await rejected; expect(uploadSignal?.aborted).toBe(true);
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(1);
  });
  it('enforces the barrier write timeout even when fetch ignores abort and discards its late successful receipt', async () => {
    const s = await loaded(900_000), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), receipt = barrierPublicationReceipt(input);
    const baseline = vi.mocked(globalThis.fetch).getMockImplementation()!; let finish!: (value: Response) => void, uploadSignal: AbortSignal | null | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => {
      if (options?.method !== 'PUT') return baseline(url, options); uploadSignal = options.signal; return await new Promise<Response>(resolve => { finish = resolve; });
    });
    let success = false; const writing = s.c.publishBarriers(input.captureId, observation); void writing.then(() => { success = true; }, () => {});
    const rejected = expect(writing).rejects.toMatchObject({ name: 'AbortError' }); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await vi.advanceTimersByTimeAsync(180_001); await rejected; expect(uploadSignal?.aborted).toBe(true);
    finish(Response.json(receipt)); await Promise.resolve(); await Promise.resolve(); expect(success).toBe(false);
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(1);
  });
  it('logout cancels an in-flight write even if its transport later returns a valid receipt', async () => {
    const s = await loaded(), input = barrierRequest(), observation = barrierObservation(input, s.identity.loadId), receipt = barrierPublicationReceipt(input);
    const baseline = vi.mocked(globalThis.fetch).getMockImplementation()!; let finish!: (value: Response) => void;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => options?.method === 'PUT'
      ? await new Promise<Response>(resolve => { finish = resolve; }) : baseline(url, options));
    const writing = s.c.publishBarriers(input.captureId, observation), rejected = expect(writing).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); invalidateViewerLogin('login-a'); await rejected;
    finish(Response.json(receipt)); await Promise.resolve(); await Promise.resolve();
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(1);
  });
  it('preparation discovery freezes exact scope, validates echoed scope and rechecks the current model',async()=>{
    const s=await loaded(),request={schemaVersion:'wfc.pf.viewer-discovery.v1' as const,mode:'names' as const,names:['TRAY-001'],rootObjectId:null,cursor:0,limit:128};
    s.send.mockImplementation(value=>{if(value.type==='READ_PREPARATION_OBJECTS')s.message('PREPARATION_OBJECTS',{schemaVersion:request.schemaVersion,mode:'names',names:value.payload.names,rootObjectId:null,cursor:0,matchingPolicyVersion:PREPARATION_MATCHING_POLICY,visibilityScope:discoveryVisibility,indexedObjectCount:1,propertyScan:null,objects:[],nextCursor:null,complete:true},value.requestId,s.identity);});
    const reading=s.c.discoverPreparationObjects(request);request.names[0]='CHANGED';expect((await reading).names).toEqual(['TRAY-001']);
    s.send.mockImplementation(value=>{if(value.type==='READ_PREPARATION_OBJECTS')s.message('PREPARATION_OBJECTS',{schemaVersion:request.schemaVersion,mode:'names',names:['WRONG'],rootObjectId:null,cursor:0,matchingPolicyVersion:PREPARATION_MATCHING_POLICY,visibilityScope:discoveryVisibility,indexedObjectCount:1,propertyScan:null,objects:[],nextCursor:null,complete:true},value.requestId,s.identity);});
    await expect(s.c.discoverPreparationObjects(request)).rejects.toThrow('acknowledgement mismatch');
  });
  it('rejects changed discovery visibility evidence while retaining the exact detached expected scope',async()=>{
    const s=await loaded(),request={schemaVersion:'wfc.pf.viewer-discovery.v1' as const,mode:'equipment' as const,names:['EQ1'],rootObjectId:null,cursor:0,limit:128,visibilityScope:{...discoveryVisibility}};
    s.send.mockImplementation(value=>{if(value.type==='READ_PREPARATION_OBJECTS')s.message('PREPARATION_OBJECTS',{schemaVersion:request.schemaVersion,mode:'equipment',names:value.payload.names,rootObjectId:null,cursor:0,
      matchingPolicyVersion:PREPARATION_MATCHING_POLICY,visibilityScope:{...discoveryVisibility,contentSha256:'b'.repeat(64)},indexedObjectCount:1,
      propertyScan:{attemptedObjectCount:1,returnedObjectCount:1,omittedObjectCount:0,complete:true},objects:[],nextCursor:null,complete:true},value.requestId,s.identity);});
    const pending=s.c.discoverPreparationObjects(request);request.visibilityScope.contentSha256='b'.repeat(64);
    await expect(pending).rejects.toThrow('acknowledgement mismatch');
    expect(s.send.mock.calls.find(([message])=>message.type==='READ_PREPARATION_OBJECTS')?.[0].payload.visibilityScope).toEqual(discoveryVisibility);
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
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
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
  it('keeps a large-model computed appearance commit alive past ten seconds and accepts its bounded acknowledgement', async () => {
    const s = await loaded(600_000); let received = 0;
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
    });
    const showing = s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0], [1, 2, 3]], objectIds: [23] });
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'COMMIT_COMPUTED_PATH')).toBe(true));
    const command = s.send.mock.calls.find(call => call[0].type === 'COMMIT_COMPUTED_PATH')![0];
    await vi.advanceTimersByTimeAsync(10_001);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true); expect(s.events.some(event => event.type === 'ERROR')).toBe(false);
    await vi.advanceTimersByTimeAsync(48_000);
    s.message('COMPUTED_PATH_UPDATED', { pathId: command.payload.pathId, phase: 'displayed', received }, command.requestId, s.identity);
    await expect(showing).resolves.toBe(command.requestId);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true); expect(s.events.some(event => event.type === 'ERROR')).toBe(false);
  });
  it('gives whole-model visibility restoration the same bounded appearance allowance', async () => {
    const s = await loaded(600_000), requestId = s.c.clear();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true); expect(s.events.some(event => event.type === 'ERROR')).toBe(false);
    await vi.advanceTimersByTimeAsync(48_000);
    s.message('ROUTE_CLEARED', {}, requestId, s.identity);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true); expect(s.events.filter(event => event.type === 'ROUTE_CLEARED')).toHaveLength(1);
    expect(s.events.some(event => event.type === 'ERROR')).toBe(false);
  });
  it('waits for delayed Clear before sending BEGIN so restoration cannot consume the next command deadline', async () => {
    const s = await loaded(600_000); let received = 0;
    s.send.mockImplementation(value => {
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : value.type === 'COMMIT_COMPUTED_PATH' ? 'displayed' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
    });
    const showing = s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0]], objectIds: [23] });
    const clear = s.send.mock.calls.find(call => call[0].type === 'CLEAR_ROUTE')![0];
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true);
    expect(s.send.mock.calls.some(call => call[0].type === 'BEGIN_COMPUTED_PATH')).toBe(false);
    s.message('ROUTE_CLEARED', {}, clear.requestId, s.identity);
    await expect(showing).resolves.toBeTruthy();
    expect(s.send.mock.calls.some(call => call[0].type === 'BEGIN_COMPUTED_PATH')).toBe(true);
    expect(s.events.some(event => event.type === 'ERROR')).toBe(false);
  });
  it('does not start a computed path if the user clears it while waiting for appearance restoration', async () => {
    const s = await loaded(600_000);
    const showing = s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0]], objectIds: [23] });
    const rejected = expect(showing).rejects.toMatchObject({ name: 'AbortError' });
    const restoring = s.send.mock.calls.find(call => call[0].type === 'CLEAR_ROUTE')![0];
    s.c.clear(); await rejected;
    s.message('ROUTE_CLEARED', {}, restoring.requestId, s.identity);
    await Promise.resolve();
    expect(s.send.mock.calls.some(call => call[0].type === 'BEGIN_COMPUTED_PATH')).toBe(false);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true);
  });
  it('allows bounded whole-model material preparation for transparency without expiring at ten seconds', async () => {
    const s = await loaded(600_000); let received = 0;
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : value.type === 'COMMIT_COMPUTED_PATH' ? 'displayed' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
    });
    await s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0]], objectIds: [23] });
    const updating = s.c.setPathTransparency(75);
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'SET_PATH_TRANSPARENCY')).toBe(true));
    const command = s.send.mock.calls.find(call => call[0].type === 'SET_PATH_TRANSPARENCY')![0];
    await vi.advanceTimersByTimeAsync(10_001);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true); expect(s.events.some(event => event.type === 'ERROR')).toBe(false);
    await vi.advanceTimersByTimeAsync(48_000);
    s.message('PATH_TRANSPARENCY_UPDATED', command.payload, command.requestId, s.identity);
    await expect(updating).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.c.getLoadSnapshot()?.ready).toBe(true); expect(s.events.some(event => event.type === 'ERROR')).toBe(false);
  });
  it('fails closed when whole-model material preparation does not acknowledge within sixty seconds', async () => {
    const s = await loaded(600_000); let received = 0;
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : value.type === 'COMMIT_COMPUTED_PATH' ? 'displayed' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
    });
    await s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0]], objectIds: [23] });
    const rejected = expect(s.c.setPathTransparency(75)).rejects.toThrow('Viewer request timed out');
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'SET_PATH_TRANSPARENCY')).toBe(true));
    await vi.advanceTimersByTimeAsync(59_000); expect(s.c.getLoadSnapshot()?.ready).toBe(true);
    await vi.advanceTimersByTimeAsync(1_001); await rejected;
    expect(s.c.getLoadSnapshot()).toBeNull(); expect(s.events.some(event => event.type === 'ERROR' && event.payload.code === 'REQUEST_TIMEOUT')).toBe(true);
  });
  it('fails closed at sixty seconds when a computed appearance commit never acknowledges', async () => {
    const s = await loaded(600_000); let received = 0;
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
    });
    const showing = s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0]], objectIds: [23] });
    const rejected = expect(showing).rejects.toThrow('Viewer request timed out');
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'COMMIT_COMPUTED_PATH')).toBe(true));
    await vi.advanceTimersByTimeAsync(59_000); expect(s.c.getLoadSnapshot()?.ready).toBe(true);
    await vi.advanceTimersByTimeAsync(1_001); await rejected;
    expect(s.c.getLoadSnapshot()).toBeNull(); expect(s.c.iframe.style.display).toBe('none');
    expect(s.events.some(event => event.type === 'ERROR' && event.payload.code === 'REQUEST_TIMEOUT')).toBe(true);
  });
  it('fails closed at sixty seconds when visibility restoration never acknowledges', async () => {
    const s = await loaded(600_000); s.c.clear();
    await vi.advanceTimersByTimeAsync(59_999); expect(s.c.getLoadSnapshot()?.ready).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.c.getLoadSnapshot()).toBeNull(); expect(s.c.iframe.style.display).toBe('none');
    expect(s.events.some(event => event.type === 'ERROR' && event.payload.code === 'REQUEST_TIMEOUT')).toBe(true);
  });
  it.each(['BEGIN_COMPUTED_PATH', 'APPEND_COMPUTED_PATH'])('retains the ten-second bound for the small %s transport command', async delayed => {
    const s = await loaded(600_000); let received = 0;
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase && value.type !== delayed) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
    });
    const rejected = expect(s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0]], objectIds: [23] })).rejects.toThrow('Viewer request timed out');
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === delayed)).toBe(true));
    await vi.advanceTimersByTimeAsync(10_001); await rejected;
    expect(s.c.getLoadSnapshot()).toBeNull(); expect(s.events.some(event => event.type === 'ERROR' && event.payload.code === 'REQUEST_TIMEOUT')).toBe(true);
  });
  it('disposes immediately on revoked access during an appearance commit without waiting for the allowance', async () => {
    const s = await loaded(600_000); let received = 0;
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
      const phase = value.type === 'BEGIN_COMPUTED_PATH' ? 'begun' : value.type === 'APPEND_COMPUTED_PATH' ? 'appended' : null;
      if (phase === 'appended') received += value.payload.points.length;
      if (phase) s.message('COMPUTED_PATH_UPDATED', { pathId: value.payload.pathId, phase, received }, value.requestId, s.identity);
    });
    const showing = s.c.showComputedPath({ pathId: crypto.randomUUID(), points: [[0, 0, 0]], objectIds: [23] });
    const rejected = expect(showing).rejects.toMatchObject({ code: 'ACCESS_REVOKED' });
    await vi.waitFor(() => expect(s.send.mock.calls.some(call => call[0].type === 'COMMIT_COMPUTED_PATH')).toBe(true));
    const command = s.send.mock.calls.find(call => call[0].type === 'COMMIT_COMPUTED_PATH')![0], now = Date.now();
    s.message('ERROR', { code: 'ACCESS_REVOKED', message: 'Access revoked.', retryable: false, operation: 'COMMIT_COMPUTED_PATH' }, command.requestId, s.identity);
    await rejected;
    expect(Date.now()).toBe(now); expect(s.c.getLoadSnapshot()).toBeNull(); expect(s.c.iframe.style.display).toBe('none');
    expect(s.events.some(event => event.type === 'ERROR' && event.payload.code === 'ACCESS_REVOKED')).toBe(true);
  });
  it('Clear during a chunk cancels the calculated path and cannot commit later', async () => {
    const s = await loaded();
    s.send.mockImplementation(value => {
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
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
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
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
      if (value.type === 'CLEAR_ROUTE') s.message('ROUTE_CLEARED', {}, value.requestId, s.identity);
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
