import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerAdapter } from '../adapter.mjs';
import { createRouteController } from '../routes.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));

function sdkFixture(options = {}) {
  const assets = [], viewers = [], evidence = [];
  const facts = { observerDisconnects: 0, finishes: 0, replacements: 0, propertyReads: 0, isolated: [], initializeOptions: null,
    featureFlagWrites: [], webgpuEnabled: true, webgpuAtInitialization: null };
  const tree = { getRootId: () => 1, getChildCount: id => id === 1 ? 2 : 0,
    enumNodeChildren(id, callback) { if (id === 1) for (const child of [2, 3]) { if (callback(child)) break; } },
    getNodeName: id => ({ 1: 'Model', 2: 'BC1', 3: options.ambiguous ? 'ＢＣ１' : 'BC2' })[id],
    enumNodeFragments() {} };
  const model = { getInstanceTree: () => options.lazyTree ? null : tree, getObjectTree: options.getObjectTree ?? (success => success(tree)),
    getProperties(id, success, failure) { facts.propertyReads++; if (options.getProperties) options.getProperties(id, success, failure); else success({ properties: [{ displayName: 'Length', displayValue: '1' }, { displayName: 'Width', displayValue: '2' }] }); },
    getFragmentList: () => ({ getCount: () => 12 }), getData: () => ({ fragments: { length: 12 } }), isLoadDone: () => false };
  class Viewer {
    constructor() {
      this.model = model; this.listeners = new Map(); this.theme = null;
      this.prefs = { get: () => true };
      this.impl = { showGhosting: true, toggleGhosting(value) { this.showGhosting = value; }, fadeMaterial: { opacity: 0.4, variants: [{ opacity: 0.5 }] }, invalidate() {}, setTonemapMethod: value => { this.tonemap = value; }, setTonemapExposureBias: value => { this.exposure = value; } };
      this.overlays = { removeMesh() {}, removeScene() {}, addScene() {}, addMesh() {} };
      viewers.push(this);
    }
    start() { return options.startCode ?? 0; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    emit(type, value = {}) { for (const fn of this.listeners.get(type) ?? []) fn(value); }
    loadModel(url, ignored, success, failure) {
      this.url = url;
      if (options.loadModel) options.loadModel(this, success, failure);
      else queueMicrotask(() => { success(model); this.emit('geometry'); });
    }
    setTheme(value) { this.theme = value; }
    setLightPreset(value) { this.lighting = value; }
    setQualityLevel(...value) { this.quality = value; }
    fitToView() {}
    resize() {}
    clearSelection() {}
    setGhosting() {}
    isolate(ids) { facts.isolated.push(ids); }
    finish() { facts.finishes++; }
  }
  const viewing = { GuiViewer3D: Viewer, GEOMETRY_LOADED_EVENT: 'geometry', PROGRESS_UPDATE_EVENT: 'progress', ERROR_EVENT: 'error',
    PublicFeatureFlags: options.missingWebGPUFlag ? {} : { WebGPU: 'ENABLE_WEBGPU' },
    FeatureFlags: options.missingFeatureFlags ? undefined : { set(flag, value) { facts.featureFlagWrites.push([flag, value]); facts.webgpuEnabled = value; } },
    Initializer(value, callback) { facts.initializeOptions = value; facts.webgpuAtInitialization = facts.webgpuEnabled; if (options.initializer) options.initializer(callback); else callback(); } };
  const document = { createElement(tag) { const element = new EventTarget(); element.tagName = tag; element.remove = () => { element.removed = true; }; return element; },
    head: { append(element) { assets.push(element); if (!options.pendingAssets) queueMicrotask(() => element.dispatchEvent(new Event(options.assetError ? 'error' : 'load'))); } } };
  const window = { document, location: { origin: 'http://localhost:18085' }, LMV_VIEWER_VERSION: options.version ?? '7.130.0', Autodesk: { Viewing: viewing }, THREE: {},
    ResizeObserver: class { observe() {} disconnect() { facts.observerDisconnects++; } } };
  const container = { replaceChildren() { facts.replacements++; } };
  const adapter = createViewerAdapter({ window, container, onEvidence: value => evidence.push(value) });
  return { adapter, window, facts, assets, viewers, evidence, model, tree, container };
}

test('SDK initialization uses pinned local assets, explicit local worker root and cookie credentials only', async () => {
  const f = sdkFixture(); await f.adapter.initialize();
  assert.equal(f.assets.length, 2);
  assert.match(f.assets[0].href, /style\.local\.css$/);
  assert.match(f.assets[1].src, /sdk\/viewer3D\.min\.js$/);
  const options = f.facts.initializeOptions;
  assert.equal(options.env, 'Local'); assert.equal(options.shouldInitializeAuth, false); assert.equal(options.useCredentials, true); assert.equal(options.useCookie, true);
  assert.equal(options.disableAnalytics, true); assert.equal(options.useADP, false); assert.match(options.lmvResourceRoot, /\/sdk\/$/);
  assert.equal(Object.hasOwn(options, 'getAccessToken'), false);
  assert.deepEqual(f.facts.featureFlagWrites, [['ENABLE_WEBGPU', false]]);
  assert.equal(f.facts.webgpuAtInitialization, false);
  await f.adapter.initialize(); assert.equal(f.assets.length, 2); f.adapter.dispose();
  assert.equal(f.facts.featureFlagWrites.length, 1);
});

test('capture adapter preserves only the typed empty lookup scope error and keeps unexpected SDK errors generic', async t => {
  const previous = { window: globalThis.window, Autodesk: globalThis.Autodesk, THREE: globalThis.THREE, LMV_VIEWER_VERSION: globalThis.LMV_VIEWER_VERSION };
  t.after(() => Object.assign(globalThis, previous));
  for (const fail of [false, true]) {
    const f = sdkFixture(); globalThis.window = f.window;
    class Matrix { constructor() { this.elements = new Float64Array(16); } makeScale(x, y, z) { this.elements.fill(0); this.elements[0] = x; this.elements[5] = y; this.elements[10] = z; this.elements[15] = 1; return this; } }
    f.window.Autodesk.Viewing.Private = { LmvMatrix4: Matrix, enumMeshVertices() {}, enumMeshTriangles() {} };
    Object.assign(globalThis, { Autodesk: f.window.Autodesk, THREE: {}, LMV_VIEWER_VERSION: '7.130.0' });
    Object.assign(f.tree, { getNodeParentId: id => id === 1 ? 0 : 1, isNodeHidden: () => false, isNodeOff: () => false });
    Object.assign(f.model, { getUnitScale: () => 1, getUnitString: () => 'metres', getUpVector: () => [0, 0, 1], getGlobalOffset: () => [0, 0, 0], getFragmentList: () => ({ isFragVisible: () => true }) });
    await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: { projectId: '11111111-1111-4111-8111-111111111111', modelVersionId: '22222222-2222-4222-8222-222222222222', contentFingerprint: 'a'.repeat(64) } });
    const captureId = '33333333-3333-4333-8333-333333333333';
    await handle.startModelCapture({ captureId, lookupRouteCodes: ['/BC1'], equipmentNames: [] });
    if (fail) f.tree.getNodeName = () => { throw new Error('private SDK field'); };
    await assert.rejects(handle.readModelCapture({ captureId, index: 1 }), { code: fail ? 'EXTRACTION_FAILED' : 'LOOKUP_GEOMETRY_NOT_FOUND', message: 'The local model or one of its resources could not be read.' });
    f.adapter.dispose();
  }
});

test('missing renderer feature flag API fails before SDK initialization instead of allowing edges-only Ghost', async () => {
  for (const options of [{ missingFeatureFlags: true }, { missingWebGPUFlag: true }]) {
    const f = sdkFixture(options);
    await assert.rejects(f.adapter.initialize(), { code: 'SDK_UNSUPPORTED' });
    assert.equal(f.facts.initializeOptions, null); assert.equal(f.viewers.length, 0);
  }
});

test('wrong SDK version and asset failure remain controlled, no SDK model is started', async () => {
  for (const options of [{ version: '7.130.01' }, { assetError: true }]) {
    const f = sdkFixture(options); await assert.rejects(f.adapter.initialize(), { code: 'SDK_UNSUPPORTED' }); assert.equal(f.viewers.length, 0);
  }
});

test('aborted SDK assets detach listeners and pending initialization cannot start a viewer', async () => {
  const f = sdkFixture({ pendingAssets: true }), controller = new AbortController();
  const promise = f.adapter.initialize({ signal: controller.signal }); controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.ok(f.assets.every(asset => asset.removed)); assert.equal(f.viewers.length, 0);
});

test('geometry/index/property worker callbacks gate evidence, original lighting is preserved and dispose releases all state', async t => {
  const f = sdkFixture(); const oldWindow = globalThis.window; globalThis.window = f.window; t.after(() => { globalThis.window = oldWindow; });
  await f.adapter.initialize();
  const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/private/resources/output/0/0.svf' });
  assert.equal(f.evidence.length, 0); await handle.prepareIndex();
  assert.equal(f.facts.propertyReads, 1);
  assert.deepEqual(f.evidence[0], { sdkVersion: '7.130.0', geometryLoaded: true, nodeIndexReady: true, nodeCount: 3, fragmentCount: 12, propertiesLoaded: true, propertiesCount: 2 });
  const viewer = f.viewers[0];
  assert.equal(viewer.lighting, 7); assert.deepEqual(viewer.quality, [false, true]); assert.equal(viewer.tonemap, 1); assert.equal(viewer.exposure, 1); assert.equal(viewer.theme, 'light-theme');
  handle.clearRoute(); assert.equal(viewer.impl.fadeMaterial.opacity, 0.4);
  f.adapter.dispose(); f.adapter.dispose();
  assert.equal(f.facts.finishes, 1); assert.equal(f.facts.observerDisconnects, 1); assert.equal(f.facts.replacements, 1);
  assert.equal([...viewer.listeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0);
  assert.equal(f.evidence.at(-1).geometryLoaded, false); assert.equal(f.evidence.at(-1).propertiesLoaded, false);
});

test('property read error prevents ready evidence and caller abort releases a stalled property callback', async t => {
  for (const abort of [false, true]) {
    let callbacks, callbackReady;
    const ready = new Promise(resolve => { callbackReady = resolve; });
    const f = sdkFixture({ getProperties: (id, success, failure) => { callbacks = { success, failure }; callbackReady(); } });
    const previous = globalThis.window; globalThis.window = f.window; t.after(() => { globalThis.window = previous; });
    await f.adapter.initialize(); const controller = new AbortController();
    const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', signal: controller.signal });
    const pending = handle.prepareIndex();
    const rejected = assert.rejects(pending, abort ? { name: 'AbortError' } : { code: 'RESOURCE_FAILED' });
    await ready;
    if (abort) controller.abort(); else callbacks.failure('private data');
    await rejected;
    callbacks.success({ properties: [{ secret: 'must not be observed' }] });
    assert.equal(f.evidence.some(value => value.propertiesLoaded), false); f.adapter.dispose();
  }
});

test('aborting a geometry load or rejecting an external URL cannot retain an active viewer', async t => {
  for (const external of [false, true]) {
    const f = sdkFixture({ loadModel() {} }); const previous = globalThis.window; globalThis.window = f.window; t.after(() => { globalThis.window = previous; });
    await f.adapter.initialize(); const controller = new AbortController();
    const pending = f.adapter.load({ modelUrl: external ? 'https://outside.invalid/model.svf' : 'http://localhost:18085/model.svf', signal: controller.signal });
    const rejected = assert.rejects(pending, external ? { code: 'RESOURCE_FAILED' } : { name: 'AbortError' });
    await turn(); assert.equal(f.viewers.length, 1);
    if (!external) controller.abort();
    await rejected;
    assert.equal(f.facts.finishes, 1); assert.equal([...f.viewers[0].listeners.values()].reduce((count, set) => count + set.size, 0), 0);
  }
});

test('prepared name index normalizes collisions and a unique name without fragments stays non-drawable', async t => {
  for (const ambiguous of [false, true]) {
    const f = sdkFixture({ ambiguous }); const previous = globalThis.window; globalThis.window = f.window; t.after(() => { globalThis.window = previous; });
    const viewer = new f.window.Autodesk.Viewing.GuiViewer3D(); const controller = createRouteController(viewer);
    const progress = []; const index = await controller.prepareIndex(value => progress.push(value));
    assert.equal(index.get('BC1').length, ambiguous ? 2 : 1); assert.deepEqual(progress.at(-1), { loaded: 3, total: 3 });
    const result = await controller.showRoute('BC1/MISSING');
    assert.equal(result.segments[0].status, ambiguous ? 'ambiguous' : 'found'); assert.equal(result.segments[0].drawable, false);
    assert.equal(result.segments[1].status, 'missing'); assert.equal(result.drawableCount, 0); assert.equal(result.lineCount, 0);
    controller.dispose(); assert.equal(viewer.impl.fadeMaterial.opacity, 0.4);
  }
});

test('pending object-tree index is cancellable and ignores late SDK callback', async t => {
  let success, callbackReady;
  const ready = new Promise(resolve => { callbackReady = resolve; });
  const f = sdkFixture({ lazyTree: true, getObjectTree: callback => { success = callback; callbackReady(); } }); const previous = globalThis.window; globalThis.window = f.window; t.after(() => { globalThis.window = previous; });
  const controller = new AbortController(); const routes = createRouteController(new f.window.Autodesk.Viewing.GuiViewer3D(), { signal: controller.signal });
  const pending = routes.prepareIndex(), rejected = assert.rejects(pending, { name: 'AbortError' }); await ready;
  controller.abort(); await rejected; success(f.tree); routes.dispose();
});
