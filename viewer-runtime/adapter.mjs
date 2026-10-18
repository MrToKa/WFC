import { createRouteController } from './routes.mjs';
import { createPathFinderController } from './pathfinder.mjs';
import { captureSelectedModel } from './model-capture.mjs';
import { createModelCaptureInputStage, isStagedModelCaptureStart, isModelCaptureInputAppend, CAPTURE_INPUT_LIMITS } from './capture-input.mjs';
import { SDK_VERSION } from './protocol.mjs';

const interrupted = () => new DOMException('Operation cancelled.', 'AbortError');
const active = signal => { if (signal?.aborted) throw interrupted(); };
const safeError = (code = 'RESOURCE_FAILED') => Object.assign(new Error('The local model or one of its resources could not be read.'), { code });

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
    const viewing = window.Autodesk.Viewing, viewer = new viewing.GuiViewer3D(container);
    let finished = false, routes, pathfinder, observer, geometryLoaded = false, nodeIndexReady = false, nodeCount = 0;
    let capture;
    const cancelCapture = () => { if (!capture) return; const old = capture; capture = undefined; clearTimeout(old.deadline); old.controller.abort(); if (old.iterator) void old.iterator.return().catch(() => {}); };
    const runtimeError = () => { if (!finished) onRuntimeError(safeError()); };
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', finish);
      cancelCapture();
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
      let computedPath = false, legacyPath = false;
      async function captureEvent(captureId, index, operationSignal, onProgress) {
        if (!capture || capture.id !== captureId || capture.index !== index || capture.reading) throw safeError('EXTRACTION_FAILED');
        const currentCapture = capture; currentCapture.reading = true; currentCapture.onProgress = onProgress;
        const abort = () => currentCapture.controller.abort();
        operationSignal?.addEventListener('abort', abort, { once: true });
        try {
          active(operationSignal); active(currentCapture.controller.signal);
          if (Date.now() - currentCapture.startedAt > CAPTURE_INPUT_LIMITS.milliseconds || currentCapture.responses >= CAPTURE_INPUT_LIMITS.responses) throw safeError('EXTRACTION_FAILED');
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
        } catch (error) { if (capture === currentCapture) cancelCapture(); throw error?.name === 'AbortError' ? error : safeError(error?.code === 'LOOKUP_GEOMETRY_NOT_FOUND' ? 'LOOKUP_GEOMETRY_NOT_FOUND' : 'EXTRACTION_FAILED'); }
        finally { currentCapture.reading = false; operationSignal?.removeEventListener('abort', abort); }
      }
      function captureIterator(state, request, eventLimit = CAPTURE_INPUT_LIMITS.responses) {
        return captureSelectedModel(viewer, { ...request, projectId: descriptor.projectId, modelVersionId: descriptor.modelVersionId, contentFingerprint: descriptor.contentFingerprint }, { signal: AbortSignal.any([signal, state.controller.signal].filter(Boolean)), startedAt: state.startedAt, eventLimit, onProgress(progress) { if (capture === state) state.onProgress?.(progress); } });
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
        showRoute(...args) { pathfinder.clear(); computedPath = false; legacyPath = true; return routes.showRoute(...args); },
        clearRoute() {
          cancelCapture();
          if (computedPath) pathfinder.clear(); else if (legacyPath) routes.clearRoute(); else { viewer.clearSelection(); viewer.fitToView(); }
          computedPath = legacyPath = false;
        },
        fitRoute() { if (computedPath) pathfinder.fit(); else routes.fitRoute(); },
        showComputedPath(value) { if (legacyPath) routes.clearRoute(); legacyPath = false; const result = pathfinder.showPath(value); computedPath = true; return result; },
        readModelObjects: pathfinder.readObjects,
        readSelection: pathfinder.readSelection,
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
          if (isModelCaptureInputAppend(request)) {
            if (!capture || capture.id !== request.captureId || !capture.stage) throw safeError('EXTRACTION_FAILED');
            return inputAck(capture, request, operationSignal);
          }
          return captureEvent(request.captureId, request.index, operationSignal, onProgress);
        },
      };
      current = handle;
      return handle;
    } catch (error) { finish(); throw error; }
  }
  return { initialize, load, dispose() { current?.finish(); current = undefined; } };
}
