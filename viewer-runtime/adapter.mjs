import { createRouteController } from './routes.mjs';
import { createPathFinderController } from './pathfinder.mjs';
import { captureSelectedModel } from './model-capture.mjs';
import { captureSelectedBarriers } from './barrier-capture.mjs';
import { createBarrierMultipartRuntime } from './barrier-multipart-runtime.mjs';
import { barrierCaptureErrorMessage } from './barrier-capture-errors.mjs';
import { createModelCaptureInputStage, isStagedModelCaptureStart, isModelCaptureInputAppend, CAPTURE_INPUT_LIMITS } from './capture-input.mjs';
import { SDK_VERSION } from './protocol.mjs';
import { parseRoutingBindings } from './routing-bindings.mjs';

const interrupted = () => new DOMException('Operation cancelled.', 'AbortError');
const active = signal => { if (signal?.aborted) throw interrupted(); };
const safeError = (code = 'RESOURCE_FAILED') => Object.assign(new Error(barrierCaptureErrorMessage(code) ?? 'The local model or one of its resources could not be read.'), { code });
const positiveObjectId = id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647;

async function locationTree(model, signal) {
  active(signal);
  try {
    const tree = model.getInstanceTree?.();
    if (tree) return tree;
  } catch { throw safeError('LOCATION_UNAVAILABLE'); }
  if (typeof model.getObjectTree !== 'function') throw safeError('LOCATION_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, tree) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(tree);
    };
    const abort = () => finish(interrupted());
    const timer = setTimeout(() => finish(safeError('LOCATION_UNAVAILABLE')), 45000);
    signal?.addEventListener('abort', abort, { once: true });
    try { model.getObjectTree(tree => finish(tree ? null : safeError('LOCATION_UNAVAILABLE'), tree), () => finish(safeError('LOCATION_UNAVAILABLE'))); }
    catch { finish(safeError('LOCATION_UNAVAILABLE')); }
  });
}

function containsLocation(tree, id) {
  try {
    const root = tree.getRootId(), seen = new Set();
    if (!Number.isSafeInteger(root) || root < 0 || root > 2147483647) return false;
    for (let depth = 0; depth < 256; depth++) {
      if (id === root) return true;
      if (!positiveObjectId(id) || seen.has(id)) return false;
      // The pinned public tree API reads its immutable dbId index. Checking it
      // avoids treating a missing ID's parent fallback as a real root-zero node.
      const index = tree.getNodeIndex(id);
      if (!Number.isSafeInteger(index) || index < 0) return false;
      seen.add(id); id = tree.getNodeParentId(id);
    }
  } catch { /* Missing/invalid IDs must not reach SDK visibility calls. */ }
  return false;
}

// Exercise the property worker through its public callback API, without exporting
// the SDK object or property contents to the host. The bounded sample is evidence,
// while prepareIndex independently waits for the complete name index.
async function readPropertyEvidence(model, signal) {
  active(signal);
  const tree = model.getInstanceTree();
  if (!tree) throw safeError();
  const leaves = [];
  tree.enumNodeChildren(tree.getRootId(), id => {
    if (tree.getChildCount(id) === 0) leaves.push(id);
    return leaves.length >= 16;
  }, true);
  if (!leaves.length) leaves.push(tree.getRootId());
  return new Promise((resolve, reject) => {
    let settled = false, index = 0;
    const finish = (error, count = 0) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(count);
    };
    const abort = () => finish(interrupted());
    const timer = setTimeout(() => finish(safeError()), 45000);
    const next = () => {
      if (settled) return;
      try {
        active(signal);
        model.getProperties(leaves[index++], result => {
          if (settled) return;
          if (!Array.isArray(result?.properties)) { finish(safeError()); return; }
          const count = result.properties.length;
          if (count > 0 || index >= leaves.length) finish(null, count); else next();
        }, () => finish(safeError()));
      } catch (error) { finish(error); }
    };
    signal?.addEventListener('abort', abort, { once: true }); next();
  });
}

function asset(document, tag, attributes, signal) {
  active(signal);
  return new Promise((resolve, reject) => {
    const element = document.createElement(tag);
    let settled = false;
    const abort = () => finish(interrupted());
    const timer = setTimeout(() => finish(safeError('SDK_UNSUPPORTED')), 45000);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      element.removeEventListener('load', loaded);
      element.removeEventListener('error', failed);
      if (error) { element.remove(); reject(error); } else resolve();
    };
    const loaded = () => finish(), failed = () => finish(safeError('SDK_UNSUPPORTED'));
    Object.assign(element, attributes);
    element.addEventListener('load', loaded, { once: true });
    element.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    document.head.append(element);
  });
}

export function createViewerAdapter({ window, container, onEvidence = () => {} }) {
  const sdkRoot = new URL('./sdk/', import.meta.url).href;
  let initialization, current;
  async function initialize({ signal } = {}) {
    active(signal);
    if (!initialization) initialization = (async () => {
      await Promise.all([
        asset(window.document, 'link', { rel: 'stylesheet', href: new URL('./style.local.css', import.meta.url).href }, signal),
        asset(window.document, 'script', { src: sdkRoot + 'viewer3D.min.js', async: true }, signal),
      ]);
      active(signal);
      const viewing = window.Autodesk?.Viewing;
      if (!viewing || window.LMV_VIEWER_VERSION !== SDK_VERSION) throw safeError('SDK_UNSUPPORTED');
      if (typeof viewing.FeatureFlags?.set !== 'function' || !viewing.PublicFeatureFlags?.WebGPU) throw safeError('SDK_UNSUPPORTED');
      // The pinned SDK's WebGPU renderer draws Ghost as edges only. Use WebGL
      // for translucent surfaces, including when WebGPU was previously saved.
      // Initializer locks feature flags, so choose the renderer before it runs.
      viewing.FeatureFlags.set(viewing.PublicFeatureFlags.WebGPU, false);
      await new Promise((resolve, reject) => {
        let settled = false;
        const abort = () => finish(interrupted());
        const timer = setTimeout(() => finish(safeError('SDK_UNSUPPORTED')), 45000);
        const finish = error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          error ? reject(error) : resolve();
        };
        signal?.addEventListener('abort', abort, { once: true });
        viewing.Initializer({ env: 'Local', offline: 'true', useADP: false, disableAnalytics: true,
          shouldInitializeAuth: false, useCredentials: true, useCookie: true, language: 'en', lmvResourceRoot: sdkRoot }, () => finish());
      });
      active(signal);
    })().catch(error => { initialization = undefined; throw error; });
    await initialization;
    active(signal);
  }
  async function load({ modelUrl, descriptor, signal, onProgress = () => {}, onRuntimeError = () => {} }) {
    active(signal);
    if (!initialization) throw safeError('INVALID_STATE');
    await initialization;
    active(signal);
    current?.finish();
    const viewing = window.Autodesk.Viewing, viewer = new viewing.GuiViewer3D(container, {
      // The pinned SDK otherwise isolates tree clicks without changing selection.
      // Select the clicked group itself; descendant highlighting is SDK-owned.
      docStructureConfig: {
        click: { onObject: ['selectOnly'] },
        clickShift: { onObject: ['toggleMultipleOverlayedSelection'] },
        clickCtrl: { onObject: ['toggleVisibility'] },
      },
    });
    let finished = false, routes, pathfinder, observer, geometryLoaded = false, nodeIndexReady = false, nodeCount = 0;
    let capture, multipart;
    const cancelCapture = () => { if (!capture) return; const old = capture; capture = undefined; clearTimeout(old.deadline); old.controller.abort(); if (old.iterator) void old.iterator.return().catch(() => {}); };
    const runtimeError = () => { if (!finished) onRuntimeError(safeError()); };
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', finish);
      cancelCapture();
      multipart?.dispose();
      observer?.disconnect();
      if (viewing.ERROR_EVENT) viewer.removeEventListener(viewing.ERROR_EVENT, runtimeError);
      routes?.dispose();
      pathfinder?.dispose();
      viewer.finish();
      container.replaceChildren();
      onEvidence({ sdkVersion: SDK_VERSION, geometryLoaded: false, nodeIndexReady: false, nodeCount: 0, fragmentCount: 0, propertiesLoaded: false, propertiesCount: 0 });
    };
    signal?.addEventListener('abort', finish, { once: true });
    try {
      if (viewer.start() !== 0) throw safeError('SDK_UNSUPPORTED');
      viewer.setTheme('light-theme');
      await new Promise((resolve, reject) => {
        let settled = false;
        const geometry = () => complete(), failure = () => complete(safeError());
        const progress = event => { if (Number.isFinite(event.percent) && event.percent >= 0 && event.percent <= 100) onProgress({ phase: 'model', loaded: event.percent, total: 100 }); };
        const abort = () => complete(interrupted());
        const complete = error => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abort);
          viewer.removeEventListener(viewing.GEOMETRY_LOADED_EVENT, geometry);
          viewer.removeEventListener(viewing.PROGRESS_UPDATE_EVENT, progress);
          if (viewing.ERROR_EVENT) viewer.removeEventListener(viewing.ERROR_EVENT, failure);
          error ? reject(error) : resolve();
        };
        viewer.addEventListener(viewing.GEOMETRY_LOADED_EVENT, geometry);
        viewer.addEventListener(viewing.PROGRESS_UPDATE_EVENT, progress);
        if (viewing.ERROR_EVENT) viewer.addEventListener(viewing.ERROR_EVENT, failure);
        signal?.addEventListener('abort', abort, { once: true });
        const url = new URL(modelUrl);
        if (url.origin !== window.location.origin) { complete(safeError()); return; }
        viewer.loadModel(url.href, {}, model => { if (model.isLoadDone?.()) complete(); }, () => complete(safeError()));
      });
      active(signal);
      geometryLoaded = true;
      viewer.setLightPreset(7);
      viewer.setQualityLevel(false, true);
      viewer.impl.setTonemapMethod(1);
      viewer.impl.setTonemapExposureBias(1.0);
      viewer.fitToView();
      viewer.resize();
      observer = new window.ResizeObserver(() => { if (!finished) viewer.resize(); });
      observer.observe(container);
      if (viewing.ERROR_EVENT) viewer.addEventListener(viewing.ERROR_EVENT, runtimeError);
      routes = createRouteController(viewer, { signal });
      pathfinder = createPathFinderController(viewer, { window, signal });
      const loadedModel = viewer.model;
      multipart = createBarrierMultipartRuntime(viewer, { descriptor, signal, isCurrent: () => !finished && viewer.model != null });
      let computedPath = false, legacyPath = false;
      async function captureEvent(captureId, index, operationSignal, onProgress) {
        if (!capture || capture.id !== captureId || capture.index !== index || capture.reading) throw safeError('EXTRACTION_FAILED');
        const currentCapture = capture; currentCapture.reading = true; currentCapture.onProgress = onProgress;
        const abort = () => currentCapture.controller.abort();
        operationSignal?.addEventListener('abort', abort, { once: true });
        try {
          active(operationSignal); active(currentCapture.controller.signal);
          if (Date.now() - currentCapture.startedAt > CAPTURE_INPUT_LIMITS.milliseconds) throw safeError(currentCapture.kind === 'barrier' ? 'BARRIER_CAPTURE_DEADLINE' : 'EXTRACTION_FAILED');
          if (currentCapture.responses >= CAPTURE_INPUT_LIMITS.responses) throw safeError(currentCapture.kind === 'barrier' ? 'BARRIER_CAPTURE_PAYLOAD_LIMIT' : 'EXTRACTION_FAILED');
          if (!currentCapture.iterator) {
            if (!currentCapture.stage?.ready || index !== 0) throw safeError('EXTRACTION_FAILED');
            currentCapture.iterator = captureIterator(currentCapture, currentCapture.stage.request(), currentCapture.stage.remainingResponses);
          }
          const next = await currentCapture.iterator.next(); active(operationSignal);
          if (capture !== currentCapture || next.done || !next.value || next.value.captureId !== captureId) throw safeError('EXTRACTION_FAILED');
          const eventJson = JSON.stringify(next.value, (_key, value) => { if (typeof value === 'number' && !Number.isFinite(value)) throw safeError('EXTRACTION_FAILED'); return value; });
          const done = next.value.type === 'complete'; currentCapture.index++; currentCapture.responses++;
          if (done) cancelCapture();
          return { captureId, index, done, eventJson };
        } catch (error) {
          if (capture === currentCapture) cancelCapture();
          throw error?.name === 'AbortError' ? error : safeError(currentCapture.kind === 'barrier'
            ? barrierCaptureErrorMessage(error?.code) ? error.code : 'EXTRACTION_FAILED'
            : error?.code === 'LOOKUP_GEOMETRY_NOT_FOUND' ? 'LOOKUP_GEOMETRY_NOT_FOUND' : 'EXTRACTION_FAILED');
        }
        finally { currentCapture.reading = false; operationSignal?.removeEventListener('abort', abort); }
      }
      function captureIterator(state, request, eventLimit = CAPTURE_INPUT_LIMITS.responses) {
        if (state.kind === 'barrier') return captureSelectedBarriers(viewer, request, { loadId: descriptor.loadId,
          signal: AbortSignal.any([signal, state.controller.signal].filter(Boolean)), startedAt: state.startedAt, eventLimit,
          onProgress(progress) { if (capture === state) state.onProgress?.(progress); } });
        prepareForEndpointVisibility();
        return captureSelectedModel(viewer, { ...request, projectId: descriptor.projectId, modelVersionId: descriptor.modelVersionId, contentFingerprint: descriptor.contentFingerprint,loadId:descriptor.loadId }, { signal: AbortSignal.any([signal, state.controller.signal].filter(Boolean)), startedAt: state.startedAt, eventLimit, onProgress(progress) { if (capture === state) state.onProgress?.(progress); } });
      }
      function prepareForEndpointVisibility() {
        // Restore only our route appearance. Ghost/isolation must not become an
        // automatic endpoint exclusion, and a failed restoration must refuse.
        routes.prepareForVisibilityObservation(); legacyPath = false;
        pathfinder.prepareForVisibilityObservation(); computedPath = false;
      }
      async function inputAck(state, request, operationSignal) {
        if (capture !== state || state.reading || state.iterator) throw safeError('EXTRACTION_FAILED');
        state.reading = true; const abort = () => state.controller.abort(); operationSignal?.addEventListener('abort', abort, { once: true });
        try {
          active(operationSignal); active(state.controller.signal);
          const result = request ? await state.stage.append(request) : await state.stage.initialAck();
          active(operationSignal); active(state.controller.signal);
          if (capture !== state || ++state.responses > CAPTURE_INPUT_LIMITS.responses) throw safeError('EXTRACTION_FAILED');
          return result;
        } catch (error) { if (capture === state) cancelCapture(); throw error?.name === 'AbortError' ? error : safeError('EXTRACTION_FAILED'); }
        finally { state.reading = false; operationSignal?.removeEventListener('abort', abort); }
      }
      const handle = {
        finish,
        readBarrierMultipartFrame: (request, operationSignal) => multipart.readFrame(request, operationSignal),
        startBarrierMultipart: (request, transport, operationSignal) => multipart.start(request, transport, operationSignal),
        statusBarrierMultipart: request => multipart.status(request),
        cancelBarrierMultipart: (request, operationSignal) => multipart.cancel(request, operationSignal),
        reconcileBarrierMultipart: (request, operationSignal) => multipart.reconcile(request, operationSignal),
        async prepareIndex() {
          await routes.prepareIndex(progress => { nodeCount = progress.total ?? nodeCount; onProgress({ phase: 'index', ...progress }); });
          active(signal);
          nodeIndexReady = true;
          const propertiesCount = await readPropertyEvidence(viewer.model, signal);
          active(signal);
          onEvidence({ sdkVersion: SDK_VERSION, geometryLoaded, nodeIndexReady, nodeCount,
            propertiesLoaded: true, propertiesCount,
            fragmentCount: viewer.model.getFragmentList()?.getCount?.() ?? viewer.model.getData()?.fragments?.length ?? 0 });
        },
        showRoute(text, options = {}) {
          const bindings = options.routingBindings === undefined ? undefined : parseRoutingBindings(options.routingBindings, descriptor);
          if (options.routingBindings !== undefined && !bindings) throw safeError('ROUTING_BINDINGS_INVALID');
          pathfinder.clear(); computedPath = false; legacyPath = true;
          return routes.showRoute(text, { ...options, routingBindings: bindings });
        },
        clearRoute() {
          cancelCapture();
          if (computedPath) pathfinder.clear(); else if (legacyPath) routes.clearRoute(); else { viewer.clearSelection(); viewer.fitToView(); }
          computedPath = legacyPath = false;
        },
        fitRoute() { if (computedPath) pathfinder.fit(); else routes.fitRoute(); },
        showComputedPath(value) { if (legacyPath) routes.clearRoute(); legacyPath = false; const result = pathfinder.showPath(value); computedPath = true; return result; },
        readModelObjects: pathfinder.readObjects,
        readPreparationObjects(request, operationSignal) {
          active(operationSignal); prepareForEndpointVisibility();
          return pathfinder.readPreparationObjects(request, operationSignal);
        },
        readSelection: pathfinder.readSelection,
        readTrayRootSelection: pathfinder.readTrayRootSelection,
        async showLocation(sdkObjectId, operationSignal, beforeCommit = async () => {}) {
          if (!positiveObjectId(sdkObjectId)) throw safeError('LOCATION_UNAVAILABLE');
          const displaySignal = AbortSignal.any([signal, operationSignal].filter(Boolean));
          const currentModel = () => {
            active(displaySignal);
            if (finished || !loadedModel || viewer.model !== loadedModel) throw safeError('MODEL_SELECTION_CHANGED');
          };
          currentModel();
          const tree = await locationTree(loadedModel, displaySignal);
          currentModel();
          if (!containsLocation(tree, sdkObjectId) || typeof viewer.show !== 'function' || typeof viewer.fitToView !== 'function') throw safeError('LOCATION_UNAVAILABLE');
          await beforeCommit();
          currentModel();
          try {
            // The pinned SDK show() changes only this node's visibility. It
            // reveals it normally under route Ghost without changing selection,
            // global Ghost, route overlays or their saved appearance baseline.
            viewer.show([sdkObjectId], loadedModel);
            viewer.fitToView([sdkObjectId], loadedModel);
          } catch { throw safeError('LOCATION_UNAVAILABLE'); }
        },
        async showTray(sdkObjectIds, operationSignal, beforeCommit = async () => {}) {
          if (!Array.isArray(sdkObjectIds) || sdkObjectIds.length === 0 || sdkObjectIds.length > 512) throw safeError('TRAY_UNAVAILABLE');
          const ids = [...sdkObjectIds];
          if (!ids.every(positiveObjectId) || new Set(ids).size !== ids.length) throw safeError('TRAY_UNAVAILABLE');
          const displaySignal = AbortSignal.any([signal, operationSignal].filter(Boolean));
          const currentModel = () => {
            active(displaySignal);
            if (finished || !loadedModel || viewer.model !== loadedModel) throw safeError('MODEL_SELECTION_CHANGED');
          };
          currentModel();
          let tree;
          try { tree = await locationTree(loadedModel, displaySignal); }
          catch (error) { if (error?.code === 'LOCATION_UNAVAILABLE') throw safeError('TRAY_UNAVAILABLE'); throw error; }
          currentModel();
          if (!ids.every(id => containsLocation(tree, id)) || typeof viewer.show !== 'function' || typeof viewer.fitToView !== 'function') throw safeError('TRAY_UNAVAILABLE');
          await beforeCommit();
          currentModel();
          try {
            // Reveal all resolved roots together, preserving the user's current
            // selection and any route overlays, Ghost or appearance baseline.
            viewer.show(ids, loadedModel);
            viewer.fitToView(ids, loadedModel);
          } catch { throw safeError('TRAY_UNAVAILABLE'); }
        },
        setPathTransparency: pathfinder.setTransparency,
        pickPoint: pathfinder.pickPoint,
        async startModelCapture(request, operationSignal, onProgress, { startedAt = Date.now() } = {}) {
          cancelCapture();
          if (!descriptor) throw safeError('EXTRACTION_FAILED');
          if (!Number.isFinite(startedAt) || startedAt > Date.now() || Date.now() - startedAt > CAPTURE_INPUT_LIMITS.milliseconds) throw safeError('EXTRACTION_FAILED');
          const controller = new AbortController();
          const state = { id: request.captureId, index: 0, reading: false, controller, onProgress, iterator: null, stage: null, startedAt, responses: 0, deadline: null };
          capture = state;
          state.deadline = setTimeout(() => { if (capture === state) cancelCapture(); }, Math.max(1, CAPTURE_INPUT_LIMITS.milliseconds - (Date.now() - startedAt)));
          if (isStagedModelCaptureStart(request)) {
            state.stage = createModelCaptureInputStage(request, { signal: AbortSignal.any([signal, controller.signal].filter(Boolean)), startedAt: state.startedAt, isCurrent: () => capture === state && !finished });
            return inputAck(state, null, operationSignal);
          }
          state.iterator = captureIterator(state, request);
          return captureEvent(request.captureId, 0, operationSignal, onProgress);
        },
        readModelCapture(request, operationSignal, onProgress) {
          if (capture?.kind === 'barrier') throw safeError('EXTRACTION_FAILED');
          if (isModelCaptureInputAppend(request)) {
            if (!capture || capture.id !== request.captureId || !capture.stage) throw safeError('EXTRACTION_FAILED');
            return inputAck(capture, request, operationSignal);
          }
          return captureEvent(request.captureId, request.index, operationSignal, onProgress);
        },
        async startBarrierCapture(request, operationSignal, onProgress, { startedAt = Date.now() } = {}) {
          cancelCapture(); active(operationSignal);
          if (!descriptor || request.scope.projectId !== descriptor.projectId || request.scope.modelVersionId !== descriptor.modelVersionId
            || request.scope.contentFingerprint !== descriptor.contentFingerprint) throw safeError('BARRIER_CAPTURE_MODEL_CHANGED');
          if (!Number.isFinite(startedAt) || startedAt > Date.now()) throw safeError('BARRIER_CAPTURE_INVALID');
          if (Date.now() - startedAt > CAPTURE_INPUT_LIMITS.milliseconds) throw safeError('BARRIER_CAPTURE_DEADLINE');
          const controller = new AbortController();
          const state = { id: request.captureId, kind: 'barrier', index: 0, reading: false, controller, onProgress, iterator: null,
            stage: null, startedAt, responses: 0, deadline: null };
          capture = state;
          state.deadline = setTimeout(() => { if (capture === state) cancelCapture(); }, Math.max(1, CAPTURE_INPUT_LIMITS.milliseconds - (Date.now() - startedAt)));
          state.iterator = captureIterator(state, request);
          return captureEvent(request.captureId, 0, operationSignal, onProgress);
        },
        readBarrierCapture(request, operationSignal, onProgress) {
          if (capture?.kind !== 'barrier') throw safeError('EXTRACTION_FAILED');
          return captureEvent(request.captureId, request.index, operationSignal, onProgress);
        },
      };
      current = handle;
      return handle;
    } catch (error) { finish(); throw error; }
  }
  return { initialize, load, dispose() { current?.finish(); current = undefined; } };
}
