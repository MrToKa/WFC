import { CHANNEL, PROTOCOL_VERSION, SDK_VERSION, validateEnvelope, validateDescriptor, parseRouting } from './protocol.mjs';
import { isStagedModelCaptureStart, isModelCaptureInputAppend, CAPTURE_INPUT_LIMITS } from './capture-input.mjs';
import { parseRoutingBindings, ROUTING_BINDINGS_LIMITS } from './routing-bindings.mjs';
import { BARRIER_CAPTURE_ERROR_MESSAGES, barrierCaptureErrorMessage } from './barrier-capture-errors.mjs';
import { createBarrierMultipartTransport } from './barrier-multipart-transport.mjs';

const messages = {
  BARRIER_MULTIPART_FAILED: 'Barrier observation stopped before completing. Retain its capture and refresh its status.',
  BARRIER_MULTIPART_RECONCILE_REQUIRED: 'A barrier upload outcome is uncertain. Reconcile its saved command before starting again.',
  BARRIER_MULTIPART_CONTEXT_CHANGED: 'The barrier capture context changed. Retain the capture and refresh its context.',
  BARRIER_MULTIPART_BUSY: 'Another barrier observation is still active.',
  BARRIER_MULTIPART_DEADLINE: 'The admitted barrier observation deadline has expired.',
  BARRIER_MULTIPART_JOIN_REQUIRED: 'The previous barrier producer has not confirmed it stopped.',
  BARRIER_MULTIPART_CONTROL_LIMIT: 'This Viewer has reached its observation control budget. Cancel or reconcile the retained capture before reloading.',
  ...BARRIER_CAPTURE_ERROR_MESSAGES,
  INVALID_STATE: 'The viewer is not ready for this operation.', ROUTE_INVALID: 'The route contains invalid identifiers.',
  NO_DRAWABLE_ROUTE: 'There is no drawable route to zoom to.', SDK_UNSUPPORTED: 'The local Viewer version is not supported.',
  RESOURCE_FAILED: 'The model or a local resource could not be loaded.', MODEL_UNAVAILABLE: 'The selected model is unavailable.',
  SESSION_EXPIRED: 'The viewer session has expired.', ACCESS_REVOKED: 'Access to the model has been revoked.',
  MODEL_SELECTION_CHANGED: 'The selected model has changed.', INVALID_MESSAGE: 'The response does not match the requested model.',
  PATH_INVALID: 'The computed path is incomplete or invalid.', COORDINATES_UNSUPPORTED: 'The model coordinate convention is not supported for PathFinder.',
  EXTRACTION_FAILED: 'The requested model metadata could not be read completely.', PICK_UNAVAILABLE: 'Point picking is unavailable for this model.', PICK_TIMEOUT: 'Point picking timed out. Start picking again.',
  LOOKUP_GEOMETRY_NOT_FOUND: 'No display-visible route geometry matches the lookup. Check the route names and model visibility.',
  CAPTURE_RELOAD_REQUIRED: 'Reload the model before preparing another snapshot; this viewer has reached its bounded command budget.',
  PREPARATION_SCOPE_INVALID: 'The requested project preparation scope is invalid for this model.',
  PREPARATION_PAGE_TOO_LARGE: 'A model discovery record exceeds the bounded page size.',
  SELECTION_TOO_LARGE: 'Select at most 16 model objects at a time, then add another route rule.',
  APPEARANCE_RESTORE_FAILED: 'Some viewer appearance could not be restored. Press Clear again, or reload the model.',
  ROUTING_BINDINGS_INVALID: 'The published tray-root mapping is invalid for this loaded model. Refresh the model or preparation.',
};
const failure = code => Object.assign(new Error(messages[code] ?? messages.RESOURCE_FAILED), { code });
const httpCode = status => status === 401 || status === 410 ? 'SESSION_EXPIRED' : status === 403 ? 'ACCESS_REVOKED' : status === 409 ? 'MODEL_SELECTION_CHANGED' : status === 503 ? 'MODEL_UNAVAILABLE' : 'RESOURCE_FAILED';

export function createRuntimeBridge({ window, bootstrap, adapter, fetchImpl = window.fetch.bind(window), onState = () => {}, resourceMode = 'human' }) {
  if (!['human', 'producer'].includes(resourceMode)) throw failure('INVALID_STATE');
  const sessionFamily = resourceMode === 'producer' ? 'producer-sessions' : 'viewer-sessions';
  const producerCommands = new Set(['INIT', 'LOAD_MODEL', 'READ_PREPARATION_OBJECTS', 'START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE', 'CANCEL_REQUEST', 'DISPOSE']);
  const origin = window.location.origin;
  const requests = new Map(), usedLoads = new Set(), cleanupRequests = new Set();
  let disposed = false, phase = 'hello', current = null, handle, loadController, initController, initCommand, routeRequest, routeHasLine = false;
  let computed, captureScope;
  let loadedDescriptor, routingSelectionRevision, routeController;
  const capabilities = new Map();
  const lifetime = new AbortController();
  const identityMatches = command => command.modelVersionId === (current?.modelVersionId ?? null) && command.loadId === (current?.loadId ?? null);
  function emit(command, type, payload) {
    if (disposed && type !== 'DISPOSED') return;
    const value = validateEnvelope({ channel: CHANNEL, protocolVersion: PROTOCOL_VERSION, instanceId: bootstrap.instanceId,
      projectId: bootstrap.projectId, modelVersionId: command?.modelVersionId ?? null, loadId: command?.loadId ?? null,
      requestId: command?.requestId ?? window.crypto.randomUUID(), type, payload }, 'frame-to-parent');
    if (value) window.parent.postMessage(value, origin);
    return Boolean(value);
  }
  function finish(command) { const entry = requests.get(command.requestId); if (entry?.status === 'pending') entry.status = 'finished'; }
  function error(command, cause) {
    const code = ['BARRIER_MULTIPART_MODEL_CHANGED', 'BARRIER_MULTIPART_FRAME_CHANGED'].includes(cause?.code) ? 'MODEL_SELECTION_CHANGED' : Object.hasOwn(messages, cause?.code) ? cause.code
      : command.type.includes('BARRIER_MULTIPART') && cause?.code?.startsWith('BARRIER_MULTIPART_') ? 'BARRIER_MULTIPART_FAILED' : 'RESOURCE_FAILED';
    const recoverableCapture = (['START_BARRIER_CAPTURE', 'READ_BARRIER_CAPTURE'].includes(command.type)
      && code !== 'BARRIER_CAPTURE_MODEL_CHANGED' && (barrierCaptureErrorMessage(code) !== null || code === 'EXTRACTION_FAILED'))
      || command.type.includes('BARRIER_MULTIPART') && code.startsWith('BARRIER_MULTIPART_');
    emit(command, 'ERROR', { code, message: messages[code], retryable: recoverableCapture || ['RESOURCE_FAILED', 'SESSION_EXPIRED', 'APPEARANCE_RESTORE_FAILED'].includes(code), operation: command.type });
    finish(command);
    onState({ phase: recoverableCapture ? phase : 'error', code });
  }
  function releaseCapture(scope, abort = false) {
    if (!scope) return;
    const firstClose = !scope.closed;
    clearTimeout(scope.timer); scope.closed = true;
    if (captureScope === scope) captureScope = undefined;
    const timing = scope.timing;
    try { if (firstClose) { const logged = window.console?.debug?.('WFC capture frame timing', {
      schemaVersion: 'wfc.capture.frame-timing.v1', outcome: abort ? 'stopped' : 'completed',
      wallMilliseconds: elapsed(scope.startedAt), commandCount: timing.commandCount,
      authorizationCalls: timing.authorizationCalls, authorizationMilliseconds: timing.authorizationMilliseconds,
      adapterCalls: timing.adapterCalls, adapterMilliseconds: timing.adapterMilliseconds,
      pendingAuthorizationCalls: timing.pendingAuthorizationCalls, pendingAdapterCalls: timing.pendingAdapterCalls,
      interpretation: 'Cumulative operation waits may overlap; pending calls are not included in completed durations.',
    }); void Promise.resolve(logged).catch(() => {}); } } catch { /* Diagnostics never change capture outcome or cleanup. */ }
    if (abort) scope.controller.abort();
  }
  const elapsed = started => { const value = Date.now() - started; return Number.isFinite(value) ? Math.min(3_600_000, Math.max(0, value)) : 0; };
  async function measuredCapture(scope, phase, work) {
    const timing = scope.timing, started = Date.now(), calls = phase + 'Calls', pending = 'pending' + phase[0].toUpperCase() + phase.slice(1) + 'Calls';
    timing[calls]++; timing[pending]++;
    try { return await work(); }
    finally { timing[phase + 'Milliseconds'] = Math.min(3_600_000, timing[phase + 'Milliseconds'] + elapsed(started)); timing[pending]--; }
  }
  function beginCapture(command) {
    const scope = { captureId: command.payload.captureId, kind: command.type === 'START_BARRIER_CAPTURE' ? 'barrier' : 'model', startedAt: Date.now(), controller: new AbortController(), installed: false, closed: false, timer: null,
      timing: { commandCount: 0, authorizationCalls: 0, authorizationMilliseconds: 0, adapterCalls: 0, adapterMilliseconds: 0, pendingAuthorizationCalls: 0, pendingAdapterCalls: 0 } };
    scope.timer = setTimeout(() => {
      const owned = captureScope === scope;
      for (const entry of requests.values()) if (entry.captureScope === scope && entry.status === 'pending') error(entry.command, failure(scope.kind === 'barrier' ? 'BARRIER_CAPTURE_DEADLINE' : 'EXTRACTION_FAILED'));
      releaseCapture(scope, true);
      if (owned) { try { handle?.clearRoute(); } catch { /* Deadline remains terminal; cleanup details are not transported. */ } }
    }, CAPTURE_INPUT_LIMITS.milliseconds);
    return scope;
  }
  function checkCapture(scope) {
    if (scope && Date.now() - scope.startedAt > CAPTURE_INPUT_LIMITS.milliseconds) throw failure(scope.kind === 'barrier' ? 'BARRIER_CAPTURE_DEADLINE' : 'EXTRACTION_FAILED');
    if (!scope || scope.closed || scope.installed && captureScope !== scope) throw failure('EXTRACTION_FAILED');
  }
  const liveLoad = command => !disposed && current === command && !loadController?.signal.aborted;
  async function responseJson(response, maximum = 32768) {
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > maximum) throw failure('INVALID_MESSAGE'); chunks.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw failure('INVALID_MESSAGE'); }
  }
  async function descriptor(command, signal) {
    const base = new URL(`/api/projects/${bootstrap.projectId}/model-versions/${command.modelVersionId}/${sessionFamily}/${command.payload.sessionId}/`, origin);
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
  function stopRoute(exceptRequestId) {
    routeController?.abort(); routeController = undefined;
    releaseCapture(captureScope, true);
    if (routeRequest) { const entry = requests.get(routeRequest.requestId); if (entry?.status === 'pending') entry.status = 'cancelled'; }
    routeRequest = undefined;
    routeHasLine = false;
    computed = undefined;
    for (const [id, controller] of capabilities) {
      const entry = requests.get(id);
      if (id !== exceptRequestId && (entry?.command.type.includes('COMPUTED_PATH') || entry?.command.type.includes('MODEL_CAPTURE') || entry?.command.type.includes('BARRIER_CAPTURE') || ['PICK_POINT', 'READ_SELECTION', 'SET_PATH_TRANSPARENCY'].includes(entry?.command.type))) {
        if (entry?.status === 'pending') entry.status = 'cancelled';
        if (['START_MODEL_CAPTURE', 'START_BARRIER_CAPTURE'].includes(entry?.command.type)) releaseCapture(entry.captureScope, true);
        controller.abort();
      }
    }
    handle?.clearRoute();
  }
  function stopLoad() {
    releaseCapture(captureScope, true);
    if (current) { const entry = requests.get(current.requestId); if (entry?.status === 'pending') entry.status = 'cancelled'; }
    loadController?.abort();
    routeController?.abort(); routeController = undefined; loadedDescriptor = undefined; routingSelectionRevision = undefined;
    handle?.finish();
    handle = undefined;
    routeRequest = undefined;
    routeHasLine = false;
    computed = undefined;
    for (const [id, controller] of capabilities) { releaseCapture(requests.get(id)?.captureScope, true); controller.abort(); }
    capabilities.clear();
  }
  async function requirePathFinder(command, signal) {
    if (!current || phase !== 'loaded' || !handle || !identityMatches(command)) throw failure('INVALID_STATE');
    const base = new URL(`/api/projects/${bootstrap.projectId}/model-versions/${command.modelVersionId}/${sessionFamily}/${current.payload.sessionId}/`, origin);
    const response = await fetchImpl(new URL('pathfinder-authorization', base).href, { signal, credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error' });
    if (!response.ok) throw failure(httpCode(response.status));
    const permission = await responseJson(response);
    if (!permission || Object.keys(permission).length !== 2 || permission.authorized !== true || permission.loadId !== command.loadId) throw failure('INVALID_MESSAGE');
    if (disposed || signal.aborted || !identityMatches(command) || phase !== 'loaded') throw failure('INVALID_STATE');
  }
  async function pathFinder(command) {
    if (capabilities.size >= 2) { error(command, failure('INVALID_STATE')); return; }
    const controller = new AbortController(); capabilities.set(command.requestId, controller);
    const barrierCapture = command.type === 'START_BARRIER_CAPTURE' || command.type === 'READ_BARRIER_CAPTURE';
    const captureStart = command.type === 'START_MODEL_CAPTURE' || command.type === 'START_BARRIER_CAPTURE';
    const capturing = barrierCapture || command.type === 'START_MODEL_CAPTURE' || command.type === 'READ_MODEL_CAPTURE';
    const ownedCapture = captureStart ? beginCapture(command) : capturing ? captureScope : undefined;
    if (capturing) requests.get(command.requestId).captureScope = ownedCapture;
    const signal = AbortSignal.any([lifetime.signal, loadController.signal, controller.signal, ...(ownedCapture ? [ownedCapture.controller.signal] : [])]);
    const live = () => !disposed && !signal.aborted && identityMatches(command) && requests.get(command.requestId)?.status === 'pending';
    try {
      if (capturing) { checkCapture(ownedCapture); if (ownedCapture.captureId !== command.payload.captureId) throw failure('EXTRACTION_FAILED'); }
      if (capturing) { ownedCapture.timing.commandCount++; await measuredCapture(ownedCapture, 'authorization', () => requirePathFinder(command, signal)); }
      else await requirePathFinder(command, signal);
      if (command.type === 'READ_PREPARATION_OBJECTS' && requests.size > 4000) throw failure('CAPTURE_RELOAD_REQUIRED');
      if (capturing) checkCapture(ownedCapture);
      if (!live()) return;
      if (capturing) {
        // Reserve the complete 3,000 ACK+output response budget inside the
        // unchanged 4,096-command replay budget, leaving room for cleanup.
        if (captureStart && requests.size > 1091) throw failure('CAPTURE_RELOAD_REQUIRED');
        if (barrierCapture && command.type === 'START_BARRIER_CAPTURE' && command.payload.scope.contentFingerprint !== loadedDescriptor.contentFingerprint) throw failure('MODEL_SELECTION_CHANGED');
        if (captureStart) { stopRoute(command.requestId); captureScope = ownedCapture; ownedCapture.installed = true; ownedCapture.kind = barrierCapture ? 'barrier' : 'model'; }
        if (ownedCapture.kind !== (barrierCapture ? 'barrier' : 'model')) throw failure('EXTRACTION_FAILED');
        const progress = value => { if (live()) emit(command, barrierCapture ? 'BARRIER_CAPTURE_PROGRESS' : 'MODEL_CAPTURE_PROGRESS', { captureId: command.payload.captureId, ...value }); };
        const result = await measuredCapture(ownedCapture, 'adapter', () => barrierCapture
          ? captureStart ? handle.startBarrierCapture(command.payload, signal, progress, { startedAt: ownedCapture.startedAt }) : handle.readBarrierCapture(command.payload, signal, progress)
          : captureStart ? handle.startModelCapture(command.payload, signal, progress, { startedAt: ownedCapture.startedAt }) : handle.readModelCapture(command.payload, signal, progress));
        if (barrierCapture && (result.captureId !== command.payload.captureId || result.index !== (captureStart ? 0 : command.payload.index))) throw failure('EXTRACTION_FAILED');
        checkCapture(ownedCapture);
        await measuredCapture(ownedCapture, 'authorization', () => requirePathFinder(command, signal));
        checkCapture(ownedCapture);
        if (!live()) return;
        const terminal = barrierCapture ? 'BARRIER_CAPTURE_EVENT' : isStagedModelCaptureStart(command.payload) || command.type === 'READ_MODEL_CAPTURE' && isModelCaptureInputAppend(command.payload) ? 'MODEL_CAPTURE_INPUT_ACK' : 'MODEL_CAPTURE_EVENT';
        if (!emit(command, terminal, result)) throw failure('EXTRACTION_FAILED');
        if (['MODEL_CAPTURE_EVENT', 'BARRIER_CAPTURE_EVENT'].includes(terminal) && result.done) releaseCapture(ownedCapture);
      } else if (command.type.includes('BARRIER_MULTIPART')) {
        const loaded = current, context = loadedDescriptor;
        const stillLoaded = () => !disposed && !loadController.signal.aborted && current === loaded && loadedDescriptor === context && phase === 'loaded';
        if (command.type === 'READ_BARRIER_MULTIPART_FRAME' && command.payload.contentFingerprint !== context.contentFingerprint) throw failure('MODEL_SELECTION_CHANGED');
        let result;
        if (command.type === 'READ_BARRIER_MULTIPART_FRAME') result = await handle.readBarrierMultipartFrame(command.payload, signal);
        else if (command.type === 'START_BARRIER_MULTIPART') {
          const transport = createBarrierMultipartTransport({ origin, projectId: bootstrap.projectId, modelVersionId: command.modelVersionId,
            sessionId: loaded.payload.sessionId, loadId: command.loadId, isCurrent: stillLoaded, fetchImpl,
            randomUUID: () => window.crypto.randomUUID(), signal: AbortSignal.any([lifetime.signal, loadController.signal]) });
          result = await handle.startBarrierMultipart(command.payload, transport, signal);
        } else if (command.type === 'STATUS_BARRIER_MULTIPART') result = await handle.statusBarrierMultipart(command.payload, signal);
        else if (command.type === 'RECONCILE_BARRIER_MULTIPART') result = await handle.reconcileBarrierMultipart(command.payload, signal);
        else result = await handle.cancelBarrierMultipart(command.payload, signal);
        await requirePathFinder(command, signal);
        if (!live() || !stillLoaded()) return;
        if (!emit(command, command.type === 'READ_BARRIER_MULTIPART_FRAME' ? 'BARRIER_MULTIPART_FRAME' : 'BARRIER_MULTIPART_STATUS', result)) throw failure('BARRIER_MULTIPART_FAILED');
      } else if (command.type === 'BEGIN_COMPUTED_PATH') {
        stopRoute(command.requestId); computed = { pathId: command.payload.pathId, pointCount: command.payload.pointCount, objectIds: command.payload.objectIds, points: [] };
        emit(command, 'COMPUTED_PATH_UPDATED', { pathId: computed.pathId, phase: 'begun', received: 0 });
      } else if (command.type === 'APPEND_COMPUTED_PATH') {
        if (!computed || computed.pathId !== command.payload.pathId || computed.points.length !== command.payload.offset || computed.points.length + command.payload.points.length > computed.pointCount) throw failure('PATH_INVALID');
        computed.points.push(...command.payload.points);
        emit(command, 'COMPUTED_PATH_UPDATED', { pathId: computed.pathId, phase: 'appended', received: computed.points.length });
      } else if (command.type === 'COMMIT_COMPUTED_PATH') {
        if (!computed || computed.pathId !== command.payload.pathId || computed.points.length !== computed.pointCount) throw failure('PATH_INVALID');
        const path = computed;
        handle.showComputedPath({ points: path.points, objectIds: path.objectIds });
        computed = undefined; routeRequest = command; routeHasLine = true;
        emit(command, 'COMPUTED_PATH_UPDATED', { pathId: path.pathId, phase: 'displayed', received: path.points.length });
      } else if (command.type === 'SET_PATH_TRANSPARENCY') {
        if (!routeHasLine || routeRequest?.type !== 'COMMIT_COMPUTED_PATH' || routeRequest.requestId !== command.payload.routeRequestId) throw failure('NO_DRAWABLE_ROUTE');
        await handle.setPathTransparency(command.payload.percent, signal, async () => {
          // Material preparation can yield; recheck authority and route ownership
          // immediately before the SDK makes its synchronous appearance change.
          await requirePathFinder(command, signal);
          if (!live() || !routeHasLine || routeRequest?.type !== 'COMMIT_COMPUTED_PATH' || routeRequest.requestId !== command.payload.routeRequestId) throw failure('NO_DRAWABLE_ROUTE');
        });
        if (!live()) return;
        emit(command, 'PATH_TRANSPARENCY_UPDATED', command.payload);
      } else if (command.type === 'READ_MODEL_OBJECTS' || command.type === 'READ_PREPARATION_OBJECTS' || command.type === 'READ_SELECTION') {
        const result = command.type === 'READ_SELECTION' ? await handle.readSelection(signal) : command.type === 'READ_PREPARATION_OBJECTS' ? await handle.readPreparationObjects(command.payload, signal) : await handle.readModelObjects(command.payload, signal);
        // Metadata and picks may outlive an ACL change while the SDK worker runs.
        await requirePathFinder(command, signal);
        if (!live()) return;
        if (!emit(command, command.type === 'READ_SELECTION' ? 'MODEL_SELECTION' : command.type === 'READ_PREPARATION_OBJECTS' ? 'PREPARATION_OBJECTS' : 'MODEL_OBJECTS', result)) throw failure('EXTRACTION_FAILED');
      } else {
        const result = await handle.pickPoint(signal);
        await requirePathFinder(command, signal);
        if (!live()) return;
        if (!emit(command, 'POINT_PICKED', result)) throw failure('PICK_UNAVAILABLE');
      }
      finish(command);
    } catch (cause) {
      if (!live()) return;
      if (capturing) {
        const owned = captureScope === ownedCapture;
        releaseCapture(ownedCapture, true);
        if (owned) {
          try { handle?.clearRoute(); }
          catch {
            // Preserve the request's extraction/authority failure. Restoration
            // is secondary and must not disguise it as a broken model load.
            try { window.console?.warn?.('WFC capture cleanup failed', { code: 'APPEARANCE_RESTORE_FAILED' }); } catch { /* Diagnostics cannot change the primary outcome. */ }
          }
        }
      } else if (['BEGIN_COMPUTED_PATH', 'APPEND_COMPUTED_PATH', 'COMMIT_COMPUTED_PATH'].includes(command.type)) {
        computed = undefined; routeHasLine = false;
        try { handle?.clearRoute(); } catch (cleanup) { cause = cleanup; }
      }
      error(command, cause);
    } finally { capabilities.delete(command.requestId); if (captureStart && captureScope !== ownedCapture) releaseCapture(ownedCapture, true); }
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
      loadedDescriptor = target.descriptor;
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
    try { stopRoute(); } catch (cause) { error(command, cause); return; }
    routeRequest = command;
    const ticket = command;
    const controller = new AbortController(); routeController = controller;
    const signal = AbortSignal.any([lifetime.signal, loadController.signal, controller.signal]);
    try {
      const parsed = parseRouting(command.payload.rawRouting);
      const base = new URL(`/api/projects/${bootstrap.projectId}/model-versions/${command.modelVersionId}/${sessionFamily}/${current.payload.sessionId}/`, origin);
      const response = await fetchImpl(new URL('routing-bindings', base).href,
        { signal, credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error' });
      if (!response.ok) throw failure(httpCode(response.status));
      const bindings = parseRoutingBindings(await responseJson(response, ROUTING_BINDINGS_LIMITS.bytes), loadedDescriptor, routingSelectionRevision);
      if (!bindings) throw failure('INVALID_MESSAGE');
      if (disposed || signal.aborted || routeRequest !== ticket || !identityMatches(command)) return;
      routingSelectionRevision = bindings.selectionRevision;
      const result = parsed.segments.length ? await handle.showRoute(command.payload.rawRouting, { routingBindings: bindings }) : { segments: [], drawableCount: 0, lineCount: 0, warnings: [], diagnostics: { connectors: [] } };
      if (disposed || routeRequest !== ticket || !identityMatches(command)) return;
      const warnings = [];
      const segments = parsed.segments.map((entry, index) => {
        const model = result.segments[index];
        const state = model.status;
        if (state !== 'found') warnings.push({ code: state === 'missing' ? 'MODEL_MISSING' : 'MODEL_AMBIGUOUS', segmentIndex: entry.segmentIndex, message: state === 'missing' ? 'The identifier was not found in the model.' : 'The identifier matches more than one model object.' });
        else if (!model.drawable) warnings.push({ code: 'NO_DRAWABLE_GEOMETRY', segmentIndex: entry.segmentIndex, message: 'The identifier has no usable geometry.' });
        if (state === 'found' && model.mapped) warnings.push({ code: 'PUBLISHED_TRAY_ROOT_MAPPING', segmentIndex: entry.segmentIndex, message: 'This project tray is shown through its published model-root mapping.' });
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
      routeHasLine = false;
      try { handle?.clearRoute(); } catch (cleanup) { cause = cleanup; }
      error(command, cause);
    }
  }
  function receive(event) {
    if (disposed || event.origin !== origin || event.source !== window.parent) return;
    const command = validateEnvelope(event.data, 'parent-to-frame');
    if (!command || command.instanceId !== bootstrap.instanceId || command.projectId !== bootstrap.projectId || requests.has(command.requestId) || cleanupRequests.has(command.requestId)) return;
    if (resourceMode === 'producer' && !producerCommands.has(command.type)) return;
    if (command.type !== 'LOAD_MODEL' && !identityMatches(command)) return;
    if (command.type === 'LOAD_MODEL' && usedLoads.has(command.loadId)) return;
    // Refused polls consume no replay slot; preserve the finite cleanup tail.
    // They can only receive the same refusal, never start SDK/HTTP work.
    if (command.type.includes('BARRIER_MULTIPART') && !['CANCEL_BARRIER_MULTIPART', 'RECONCILE_BARRIER_MULTIPART'].includes(command.type)
      && requests.size >= 4000) { error(command, failure('BARRIER_MULTIPART_CONTROL_LIMIT')); return; }
    if (requests.size >= 4096) {
      // Saturation must not prevent resource release. Cleanup replay tracking has
      // its own bounded budget; terminal DISPOSE never needs another record.
      if (command.type === 'CANCEL_REQUEST' && cleanupRequests.size < 4096) cleanupRequests.add(command.requestId);
      else if (command.type !== 'DISPOSE') return;
    } else requests.set(command.requestId, { command, status: 'pending' });
    try { switch (command.type) {
      case 'BEGIN_COMPUTED_PATH': case 'APPEND_COMPUTED_PATH': case 'COMMIT_COMPUTED_PATH': case 'PICK_POINT': case 'READ_MODEL_OBJECTS': case 'READ_PREPARATION_OBJECTS': case 'READ_SELECTION': case 'SET_PATH_TRANSPARENCY': case 'START_MODEL_CAPTURE': case 'READ_MODEL_CAPTURE': case 'START_BARRIER_CAPTURE': case 'READ_BARRIER_CAPTURE':
      case 'READ_BARRIER_MULTIPART_FRAME': case 'START_BARRIER_MULTIPART': case 'STATUS_BARRIER_MULTIPART': case 'CANCEL_BARRIER_MULTIPART': case 'RECONCILE_BARRIER_MULTIPART':
        if (phase !== 'loaded' || !handle) { error(command, failure('INVALID_STATE')); return; }
        void pathFinder(command); break;
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
          else if (capabilities.has(entry.command.requestId)) { capabilities.get(entry.command.requestId).abort(); if (entry.command.type.includes('COMPUTED_PATH') || entry.command.type.includes('MODEL_CAPTURE') || entry.command.type.includes('BARRIER_CAPTURE')) stopRoute(); }
        }
        finish(command); emit(command, 'REQUEST_CANCELLED', { targetRequestId: command.payload.targetRequestId, outcome }); break;
      }
      case 'DISPOSE':
        lifetime.abort(); stopLoad(); adapter.dispose(); finish(command);
        disposed = true; phase = 'disposed'; window.removeEventListener('message', receive);
        emit(command, 'DISPOSED', {}); onState({ phase }); break;
    } } catch (cause) { error(command, cause); }
  }
  window.addEventListener('message', receive);
  emit(null, 'HELLO', { supportedProtocolVersions: [1], sdkVersion: SDK_VERSION });
  return { dispose() { if (disposed) return; lifetime.abort(); stopLoad(); adapter.dispose(); disposed = true; phase = 'disposed'; window.removeEventListener('message', receive); }, getState: () => ({ phase, requests: requests.size }) };
}
