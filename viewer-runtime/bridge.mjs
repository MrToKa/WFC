import { CHANNEL, PROTOCOL_VERSION, SDK_VERSION, validateEnvelope, validateDescriptor, parseRouting } from './protocol.mjs';
import { generateId } from './generate-id.mjs';

const messages = {
  INVALID_STATE: 'The viewer is not ready for this operation.', ROUTE_INVALID: 'The route contains invalid identifiers.',
  NO_DRAWABLE_ROUTE: 'There is no drawable route to zoom to.', SDK_UNSUPPORTED: 'The local Viewer version is not supported.',
  RESOURCE_FAILED: 'The model or a local resource could not be loaded.', MODEL_UNAVAILABLE: 'The selected model is unavailable.',
  SESSION_EXPIRED: 'The viewer session has expired.', ACCESS_REVOKED: 'Access to the model has been revoked.',
  MODEL_SELECTION_CHANGED: 'The selected model has changed.', INVALID_MESSAGE: 'The response does not match the requested model.',
};
const failure = code => Object.assign(new Error(messages[code] ?? messages.RESOURCE_FAILED), { code });
const httpCode = status => status === 401 || status === 410 ? 'SESSION_EXPIRED' : status === 403 ? 'ACCESS_REVOKED' : status === 409 ? 'MODEL_SELECTION_CHANGED' : status === 503 ? 'MODEL_UNAVAILABLE' : 'RESOURCE_FAILED';

export function createRuntimeBridge({ window, bootstrap, adapter, fetchImpl = window.fetch.bind(window), onState = () => {} }) {
  const origin = window.location.origin;
  const requests = new Map(), usedLoads = new Set(), cleanupRequests = new Set();
  let disposed = false, phase = 'hello', current = null, handle, loadController, initController, initCommand, routeRequest, routeHasLine = false;
  const lifetime = new AbortController();
  const identityMatches = command => command.modelVersionId === (current?.modelVersionId ?? null) && command.loadId === (current?.loadId ?? null);
  function emit(command, type, payload) {
    if (disposed && type !== 'DISPOSED') return;
    const value = validateEnvelope({ channel: CHANNEL, protocolVersion: PROTOCOL_VERSION, instanceId: bootstrap.instanceId,
      projectId: bootstrap.projectId, modelVersionId: command?.modelVersionId ?? null, loadId: command?.loadId ?? null,
      requestId: command?.requestId ?? generateId(window.crypto), type, payload }, 'frame-to-parent');
    if (value) window.parent.postMessage(value, origin);
    return Boolean(value);
  }
  function finish(command) { const entry = requests.get(command.requestId); if (entry?.status === 'pending') entry.status = 'finished'; }
  function error(command, cause) {
    const code = Object.hasOwn(messages, cause?.code) ? cause.code : 'RESOURCE_FAILED';
    emit(command, 'ERROR', { code, message: messages[code], retryable: ['RESOURCE_FAILED', 'SESSION_EXPIRED'].includes(code), operation: command.type });
    finish(command);
    onState({ phase: 'error', code });
  }
  const liveLoad = command => !disposed && current === command && !loadController?.signal.aborted;
  async function responseJson(response) {
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 32768) throw failure('INVALID_MESSAGE'); chunks.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw failure('INVALID_MESSAGE'); }
  }
  async function descriptor(command, signal) {
    const base = new URL(`/api/projects/${bootstrap.projectId}/model-versions/${command.modelVersionId}/viewer-sessions/${command.payload.sessionId}/`, origin);
    const response = await fetchImpl(new URL('descriptor', base).href, { signal, credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error' });
    if (!response.ok) {
      let code = httpCode(response.status);
      if (response.status === 409) {
        try { const body = await responseJson(response); if (body?.code === 'MODEL_UNAVAILABLE') code = 'MODEL_UNAVAILABLE'; } catch { /* Keep the status fallback; never forward server text. */ }
      }
      throw failure(code);
    }
    const value = await responseJson(response);
    const parsed = validateDescriptor(value, command);
    if (!parsed) throw failure('INVALID_MESSAGE');
    return { descriptor: parsed, modelUrl: new URL(parsed.entrypoint, base).href };
  }
  function stopRoute() {
    if (routeRequest) { const entry = requests.get(routeRequest.requestId); if (entry?.status === 'pending') entry.status = 'cancelled'; }
    routeRequest = undefined;
    routeHasLine = false;
    handle?.clearRoute();
  }
  function stopLoad() {
    if (current) { const entry = requests.get(current.requestId); if (entry?.status === 'pending') entry.status = 'cancelled'; }
    loadController?.abort();
    handle?.finish();
    handle = undefined;
    routeRequest = undefined;
    routeHasLine = false;
  }
  async function load(command) {
    stopLoad();
    current = command;
    loadController = new AbortController();
    const signal = AbortSignal.any([lifetime.signal, loadController.signal]);
    phase = 'loading'; onState({ phase });
    try {
      emit(command, 'MODEL_PROGRESS', { phase: 'resources', loaded: 0, total: null });
      const target = await descriptor(command, signal);
      if (!liveLoad(command)) return;
      const loaded = await adapter.load({ ...target, signal,
        onProgress(progress) { if (liveLoad(command)) emit(command, 'MODEL_PROGRESS', progress); },
        onRuntimeError(cause) { if (liveLoad(command)) { stopLoad(); phase = 'initialized'; error(command, cause); } },
      });
      if (!liveLoad(command)) { loaded.finish(); return; }
      handle = loaded;
      await loaded.prepareIndex();
      if (!liveLoad(command)) return;
      phase = 'loaded';
      finish(command);
      emit(command, 'MODEL_LOADED', { sdkVersion: SDK_VERSION, format: 'svf', nodeIndexReady: true });
      onState({ phase });
    } catch (cause) {
      if (!liveLoad(command)) return;
      handle?.finish(); handle = undefined; phase = 'initialized';
      // Worker SDK errors do not retain HTTP status. Recheck the protected descriptor,
      // without renewal, to distinguish session/selection/access failure safely.
      try { await descriptor(command, signal); } catch (recheck) { cause = recheck; }
      if (liveLoad(command)) error(command, cause);
    }
  }
  async function show(command) {
    stopRoute();
    routeRequest = command;
    const ticket = command;
    try {
      const parsed = parseRouting(command.payload.rawRouting);
      const result = parsed.segments.length ? await handle.showRoute(command.payload.rawRouting) : { segments: [], drawableCount: 0, lineCount: 0, warnings: [], diagnostics: { connectors: [] } };
      if (disposed || routeRequest !== ticket || !identityMatches(command)) return;
      const warnings = [];
      const segments = parsed.segments.map((entry, index) => {
        const model = result.segments[index];
        const state = model.status;
        if (state !== 'found') warnings.push({ code: state === 'missing' ? 'MODEL_MISSING' : 'MODEL_AMBIGUOUS', segmentIndex: entry.segmentIndex, message: state === 'missing' ? 'The identifier was not found in the model.' : 'The identifier matches more than one model object.' });
        else if (!model.drawable) warnings.push({ code: 'NO_DRAWABLE_GEOMETRY', segmentIndex: entry.segmentIndex, message: 'The identifier has no usable geometry.' });
        return { ...entry, model: { state, matchCount: model.count, drawable: model.drawable } };
      });
      if (result.diagnostics?.connectors?.length) warnings.push({ code: 'UNMODELLED_CONNECTOR', segmentIndex: null, message: 'An unmodelled connection between segments is shown approximately.' });
      if (result.diagnostics?.bends?.fallback) warnings.push({ code: 'APPROXIMATE_BEND', segmentIndex: null, message: 'The line through the bend is approximate; check it against the model.' });
      const drawableCount = segments.filter(entry => entry.model.drawable).length;
      if (!drawableCount) handle.clearRoute();
      routeHasLine = drawableCount > 0 && result.lineCount > 0;
      const sent = emit(command, 'ROUTE_RESULT', { ...command.payload, segments, ignored: parsed.ignored, drawableCount, lineCount: result.lineCount, warnings: warnings.slice(0, 100) });
      if (!sent) { handle.clearRoute(); routeHasLine = false; throw failure('ROUTE_INVALID'); }
      finish(command);
      onState({ phase: 'route', drawableCount, lineCount: result.lineCount });
    } catch (cause) {
      if (disposed || routeRequest !== ticket || !identityMatches(command)) return;
      handle?.clearRoute(); routeHasLine = false;
      error(command, cause);
    }
  }
  function receive(event) {
    if (disposed || event.origin !== origin || event.source !== window.parent) return;
    const command = validateEnvelope(event.data, 'parent-to-frame');
    if (!command || command.instanceId !== bootstrap.instanceId || command.projectId !== bootstrap.projectId || requests.has(command.requestId) || cleanupRequests.has(command.requestId)) return;
    if (command.type !== 'LOAD_MODEL' && !identityMatches(command)) return;
    if (command.type === 'LOAD_MODEL' && usedLoads.has(command.loadId)) return;
    if (requests.size >= 4096) {
      // Saturation must not prevent resource release. Cleanup replay tracking has
      // its own bounded budget; terminal DISPOSE never needs another record.
      if (command.type === 'CANCEL_REQUEST' && cleanupRequests.size < 4096) cleanupRequests.add(command.requestId);
      else if (command.type !== 'DISPOSE') return;
    } else requests.set(command.requestId, { command, status: 'pending' });
    switch (command.type) {
      case 'INIT':
        if (phase !== 'hello') { error(command, failure('INVALID_STATE')); return; }
        phase = 'initializing';
        initCommand = command; initController = new AbortController();
        void adapter.initialize({ signal: AbortSignal.any([lifetime.signal, initController.signal]) }).then(() => {
          if (disposed || initCommand !== command || requests.get(command.requestId)?.status !== 'pending') return;
          phase = 'initialized'; finish(command);
          emit(command, 'RUNTIME_READY', { sdkVersion: SDK_VERSION }); onState({ phase });
        }).catch(cause => { if (!disposed && initCommand === command && requests.get(command.requestId)?.status === 'pending') { phase = 'hello'; error(command, cause); } });
        break;
      case 'LOAD_MODEL':
        if (!['initialized', 'loading', 'loaded'].includes(phase)) { error(command, failure('INVALID_STATE')); return; }
        usedLoads.add(command.loadId); void load(command); break;
      case 'SHOW_ROUTE':
        if (phase !== 'loaded' || !handle) { error(command, failure('INVALID_STATE')); return; }
        void show(command); break;
      case 'CLEAR_ROUTE':
        stopRoute(); finish(command); emit(command, 'ROUTE_CLEARED', {}); break;
      case 'ZOOM_ROUTE':
        if (phase !== 'loaded' || !routeHasLine || command.payload.routeRequestId !== routeRequest?.requestId) { error(command, failure('NO_DRAWABLE_ROUTE')); return; }
        handle.fitRoute(); finish(command); emit(command, 'ROUTE_ZOOMED', command.payload); break;
      case 'CANCEL_REQUEST': {
        const entry = requests.get(command.payload.targetRequestId);
        let outcome = entry ? 'already-finished' : 'unknown';
        if (entry?.status === 'pending' && entry.command.requestId !== command.requestId) {
          outcome = 'cancelled'; entry.status = 'cancelled';
          if (entry.command === current) { stopLoad(); phase = 'initialized'; }
          else if (entry.command === routeRequest) stopRoute();
          else if (entry.command === initCommand) { initController?.abort(); initCommand = undefined; phase = 'hello'; }
        }
        finish(command); emit(command, 'REQUEST_CANCELLED', { targetRequestId: command.payload.targetRequestId, outcome }); break;
      }
      case 'DISPOSE':
        lifetime.abort(); stopLoad(); adapter.dispose(); finish(command);
        disposed = true; phase = 'disposed'; window.removeEventListener('message', receive);
        emit(command, 'DISPOSED', {}); onState({ phase }); break;
    }
  }
  window.addEventListener('message', receive);
  emit(null, 'HELLO', { supportedProtocolVersions: [1], sdkVersion: SDK_VERSION });
  return { dispose() { if (disposed) return; lifetime.abort(); stopLoad(); adapter.dispose(); disposed = true; phase = 'disposed'; window.removeEventListener('message', receive); }, getState: () => ({ phase, requests: requests.size }) };
}
