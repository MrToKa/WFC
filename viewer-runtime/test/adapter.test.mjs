import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createViewerAdapter } from '../adapter.mjs';
import { createRouteController } from '../routes.mjs';
import { planModelCaptureInput } from '../capture-input.mjs';
import { BARRIER_CAPTURE_ERROR_CODES, BARRIER_CAPTURE_ERROR_MESSAGES } from '../barrier-capture-errors.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const loadedDescriptor = () => ({ projectId: '11111111-1111-4111-8111-111111111111', modelVersionId: '22222222-2222-4222-8222-222222222222',
  loadId: '33333333-3333-4333-8333-333333333333', contentFingerprint: 'a'.repeat(64) });

function sdkFixture(options = {}) {
  const assets = [], viewers = [], evidence = [];
  const facts = { observerDisconnects: 0, finishes: 0, replacements: 0, propertyReads: 0, isolated: [], initializeOptions: null,
    featureFlagWrites: [], webgpuEnabled: true, webgpuAtInitialization: null };
  const tree = { getRootId: () => 1, getNodeParentId: id => id === 1 ? 0 : 1, getChildCount: id => id === 1 ? 2 : 0,
    getNodeIndex: id => [1, 2, 3].includes(id) ? id : undefined,
    enumNodeChildren(id, callback) { if (id === 1) for (const child of [2, 3]) { if (callback(child)) break; } },
    getNodeName: id => ({ 1: 'Model', 2: 'BC1', 3: options.ambiguous ? 'ＢＣ１' : 'BC2' })[id],
    enumNodeFragments() {} };
  const model = { getInstanceTree: () => options.lazyTree ? null : tree, getObjectTree: options.getObjectTree ?? (success => success(tree)),
    getProperties(id, success, failure) { facts.propertyReads++; if (options.getProperties) options.getProperties(id, success, failure); else success({ properties: [{ displayName: 'Length', displayValue: '1' }, { displayName: 'Width', displayValue: '2' }] }); },
    getFragmentList: () => ({ getCount: () => 12 }), getData: () => ({ fragments: { length: 12 } }), isLoadDone: () => false };
  if (options.trayVisibility) model.visibilityManager = {
    defaultVisible: true, states: [[3, false]],
    getDefaultVisibility() { return this.defaultVisible; }, getVisibility() { return this.states.map(entry => [...entry]); },
    setVisibility(defaultVisible, states) { this.defaultVisible = defaultVisible; this.states = states.map(entry => [...entry]); },
  };
  class Viewer {
    constructor(_container, config = {}) {
      this.config = config; this.model = model; this.listeners = new Map(); this.theme = null;
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
    isolate(ids) { facts.isolated.push(ids); if (model.visibilityManager) { model.visibilityManager.defaultVisible = false; model.visibilityManager.states = ids.map(id => [id, true]); } }
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


test('adapter config makes ordinary Model Browser clicks selectOnly and retains pinned modifier actions', async t => {
  const f = sdkFixture(), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize();
  await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  assert.deepEqual(f.viewers[0].config.docStructureConfig, {
    click: { onObject: ['selectOnly'] },
    clickShift: { onObject: ['toggleMultipleOverlayedSelection'] },
    clickCtrl: { onObject: ['toggleVisibility'] },
  });
});

test('location display reveals and fits just the target while preserving selection, route appearance and global Ghost', async t => {
  const f = sdkFixture(), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  const viewer = f.viewers[0], calls = [], selection = [3], background = { opacity: viewer.impl.fadeMaterial.opacity, ghost: viewer.impl.showGhosting };
  viewer.show = (ids, model) => { calls.push(['show', ids, model]); };
  viewer.fitToView = (ids, model) => { calls.push(['fit', ids, model]); };
  for (const method of ['clearSelection', 'select', 'isolate', 'setGhosting']) viewer[method] = () => { throw Error('Display must not call ' + method); };
  let authorized = 0;
  await handle.showLocation(2, undefined, async () => { assert.equal(calls.length, 0); authorized++; });
  assert.equal(authorized, 1); assert.deepEqual(calls, [['show', [2], f.model], ['fit', [2], f.model]]);
  assert.deepEqual(selection, [3]); assert.deepEqual({ opacity: viewer.impl.fadeMaterial.opacity, ghost: viewer.impl.showGhosting }, background);
  assert.deepEqual(f.facts.isolated, []);
});

test('location membership accepts a root-zero tree and refuses missing IDs, cycles and invalid targets', async t => {
  const f = sdkFixture(), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  let displayed = 0; f.viewers[0].show = () => { displayed++; };
  f.tree.getRootId = () => 0; f.tree.getNodeParentId = () => 0;
  await handle.showLocation(2); assert.equal(displayed, 1);
  for (const invalid of [0, -1, 1.5, 2147483648, '2', 999]) await assert.rejects(handle.showLocation(invalid), { code: 'LOCATION_UNAVAILABLE' });
  f.tree.getNodeParentId = id => id === 2 ? 3 : 2;
  await assert.rejects(handle.showLocation(2), { code: 'LOCATION_UNAVAILABLE' }); assert.equal(displayed, 1);
});

test('location display waits for its tree and final authority; changed model or denied authority prevents SDK changes', async t => {
  for (const action of ['model', 'denied']) {
    let treeReady; const f = sdkFixture({ lazyTree: true, getObjectTree: callback => { treeReady = callback; } }), previous = globalThis.window; globalThis.window = f.window;
    t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
    await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
    const viewer = f.viewers[0]; let displayed = 0, checks = 0; viewer.show = () => { displayed++; };
    const showing = handle.showLocation(2, undefined, async () => { checks++; if (action === 'denied') throw Object.assign(Error('No access'), { code: 'ACCESS_REVOKED' }); });
    const rejected = assert.rejects(showing, { code: action === 'model' ? 'MODEL_SELECTION_CHANGED' : 'ACCESS_REVOKED' });
    assert.equal(displayed, 0); if (action === 'model') viewer.model = {};
    treeReady(f.tree); await rejected; assert.equal(displayed, 0); assert.equal(checks, action === 'model' ? 0 : 1);
  }
});

test('location preparation is abortable and ignores a late tree callback', async t => {
  let treeReady; const f = sdkFixture({ lazyTree: true, getObjectTree: callback => { treeReady = callback; } }), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  let displayed = 0; f.viewers[0].show = () => { displayed++; };
  const controller = new AbortController(), showing = handle.showLocation(2, controller.signal), rejected = assert.rejects(showing, { name: 'AbortError' });
  controller.abort(); await rejected; treeReady(f.tree); await turn(); assert.equal(displayed, 0);
});

test('location SDK failure stays recoverable and a finished model cannot be displayed', async t => {
  const f = sdkFixture(), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  f.viewers[0].show = () => { throw Error('private SDK detail'); };
  await assert.rejects(handle.showLocation(2), error => error.code === 'LOCATION_UNAVAILABLE' && !error.message.includes('private'));
  handle.finish(); await assert.rejects(handle.showLocation(2), { code: 'MODEL_SELECTION_CHANGED' });
});

test('tray display ghosts the background, fits every root and restores the previous view on Clear', async t => {
  const f = sdkFixture({ trayVisibility: true }), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  const viewer = f.viewers[0], calls = [], background = { opacity: viewer.impl.fadeMaterial.opacity, ghost: viewer.impl.showGhosting };
  const isolate = viewer.isolate.bind(viewer);
  viewer.isolate = (ids, model) => { calls.push(['isolate', [...ids], model]); isolate(ids); };
  viewer.fitToView = (ids, model) => { calls.push(['fit', ids && [...ids], model]); };
  for (const method of ['clearSelection', 'select']) viewer[method] = () => { throw Error('Display must not call ' + method); };
  const ids = [2, 3]; let authorized = 0;
  await handle.showTray(ids, undefined, async () => { assert.equal(calls.length, 0); ids[0] = 999; authorized++; });
  assert.equal(authorized, 1); assert.deepEqual(calls, [['isolate', [2, 3], f.model], ['fit', [2, 3], f.model]]);
  assert.equal(viewer.impl.fadeMaterial.opacity, 0.025); assert.equal(viewer.impl.fadeMaterial.variants[0].opacity, 0.025);
  assert.equal(viewer.impl.showGhosting, true); assert.deepEqual(f.facts.isolated, [[2, 3]]);
  assert.deepEqual(f.model.visibilityManager.states, [[2, true], [3, true]]);
  viewer.clearSelection = () => {};
  handle.clearRoute();
  assert.deepEqual({ opacity: viewer.impl.fadeMaterial.opacity, ghost: viewer.impl.showGhosting }, background);
  assert.deepEqual(f.model.visibilityManager.getVisibility(), [[3, false]]); assert.equal(f.model.visibilityManager.defaultVisible, true);
  assert.deepEqual(calls.at(-1), ['fit', undefined, undefined]);
});

test('Hide and repeated assignment cleanup restore Ghost without moving the current camera', async t => {
  const f = sdkFixture({ trayVisibility: true }), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  const viewer = f.viewers[0]; let fits = 0;
  viewer.fitToView = () => { fits++; viewer.camera = { position: [0, 0, 1000], target: [0, 0, 0], up: [0, 1, 0], zoom: 1 }; };
  await handle.showTray([2]); assert.equal(fits, 1);
  // A user can navigate after Show. Hide must keep this camera, not the
  // pre-Show camera or the whole-model overview. No SDK camera write is needed.
  const camera = { position: [15, 23, 31], target: [12, 20, 28], up: [0, 0, 1], zoom: 7 };
  viewer.camera = structuredClone(camera);
  handle.clearRoute({ preserveCamera: true });
  handle.clearRoute({ preserveCamera: true });
  assert.deepEqual(viewer.camera, camera); assert.equal(fits, 1);
  assert.equal(viewer.impl.fadeMaterial.opacity, 0.4);
  assert.deepEqual(f.model.visibilityManager.getVisibility(), [[3, false]]);
  assert.equal(f.model.visibilityManager.defaultVisible, true);
  handle.clearRoute(); assert.equal(fits, 2); // Explicit Clear/Restore still fits.
});

test('tray display validates the whole root set before any SDK mutation', async t => {
  const f = sdkFixture({ trayVisibility: true }), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  let displayed = 0, authorized = 0; f.viewers[0].isolate = () => { displayed++; };
  for (const ids of [[], [2, 999], [0], [-1], [1.5], [2147483648], ['2'], [2, 2], Array(1), Array.from({ length: 513 }, (_, at) => at + 1), null, 2])
    await assert.rejects(handle.showTray(ids, undefined, async () => { authorized++; }), { code: 'TRAY_UNAVAILABLE' });
  assert.equal(displayed, 0); assert.equal(authorized, 0);
  await handle.showTray([2]); assert.equal(displayed, 1);
});

test('delayed tray display refuses changed model, denied authority and cancellation before revealing any root', async t => {
  for (const action of ['model', 'denied', 'cancel']) {
    let treeReady; const f = sdkFixture({ trayVisibility: true, lazyTree: true, getObjectTree: callback => { treeReady = callback; } }), previous = globalThis.window;
    globalThis.window = f.window; t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
    await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
    let displayed = 0; f.viewers[0].isolate = () => { displayed++; }; const controller = new AbortController();
    const showing = handle.showTray([2, 3], controller.signal, async () => { if (action === 'denied') throw Object.assign(Error('No access'), { code: 'ACCESS_REVOKED' }); });
    const rejected = assert.rejects(showing, action === 'cancel' ? { name: 'AbortError' } : { code: action === 'model' ? 'MODEL_SELECTION_CHANGED' : 'ACCESS_REVOKED' });
    if (action === 'model') f.viewers[0].model = {};
    if (action === 'cancel') controller.abort();
    treeReady(f.tree); await rejected; assert.equal(displayed, 0);
  }
});

test('tray display sanitizes missing-tree and SDK failures while keeping terminal model identity', async t => {
  const f = sdkFixture({ trayVisibility: true }), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  f.viewers[0].isolate = () => { throw Error('private SDK detail'); };
  await assert.rejects(handle.showTray([2, 3]), error => error.code === 'TRAY_UNAVAILABLE' && !error.message.includes('private'));
  f.model.getInstanceTree = () => { throw Error('private tree detail'); };
  await assert.rejects(handle.showTray([2, 3]), error => error.code === 'TRAY_UNAVAILABLE' && !error.message.includes('private'));
  handle.finish(); await assert.rejects(handle.showTray([2, 3]), { code: 'MODEL_SELECTION_CHANGED' });
});

test('tray focus replaces a legacy route without capturing its Ghost view as the restoration baseline', async t => {
  const f = sdkFixture({ trayVisibility: true }), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  await handle.showRoute('BC1'); assert.equal(f.viewers[0].impl.fadeMaterial.opacity, 0.025);
  await handle.showTray([3]); assert.deepEqual(f.facts.isolated.at(-1), [3]);
  handle.clearRoute(); assert.equal(f.viewers[0].impl.fadeMaterial.opacity, 0.4);
  assert.equal(f.model.visibilityManager.defaultVisible, true); assert.deepEqual(f.model.visibilityManager.getVisibility(), [[3, false]]);
});

test('tray focus rolls back Ghost if fitting fails and remains recoverable', async t => {
  const f = sdkFixture({ trayVisibility: true }), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  const viewer = f.viewers[0]; viewer.fitToView = () => { throw Error('private fit failure'); };
  await assert.rejects(handle.showTray([2]), { code: 'TRAY_UNAVAILABLE' });
  assert.equal(viewer.impl.fadeMaterial.opacity, 0.4); assert.deepEqual(f.model.visibilityManager.getVisibility(), [[3, false]]);
  viewer.fitToView = () => {}; await handle.showTray([3]); handle.clearRoute();
  assert.equal(viewer.impl.fadeMaterial.opacity, 0.4); assert.deepEqual(f.model.visibilityManager.getVisibility(), [[3, false]]);
});

test('pinned SDK show delegates only target visibility and exposes a read-only tree membership index', () => {
  const sdk = readFileSync(new URL('../sdk/7.130.0/viewer3D.min.js', import.meta.url), 'utf8');
  const match = sdk.match(/\.prototype.show=function\((\w+),(\w+)\)\{\2=\2\|\|this.model,this.impl.visibilityManager.show\(\1,\2\)\}/);
  assert.ok(match, 'The pinned public show API only delegates to target visibility.');
  assert.ok(sdk.includes('getNodeIndex(e){return this.nodeAccess.getIndex(e)}'));
  assert.ok(sdk.includes('getIndex(e){return this.dbIdToIndex[e]}'));
  assert.ok(sdk.includes('this.getObjectTree()}getFuzzyBox'), 'Pinned Model#getInstanceTree delegates to cached getObjectTree.');
  assert.ok(sdk.includes('getObjectTree(e,t){const i=this._getObjectTree();if(void 0===e&&void 0===t)return i;'));
  const calls = [], model = {}, receiver = { model, impl: { visibilityManager: { show(ids, targetModel) { calls.push([ids, targetModel]); } } } };
  const show = new Function('return ' + match[0].slice('.prototype.show='.length))();
  show.call(receiver, [2], model); assert.deepEqual(calls, [[[2], model]]);
});

test('tray-root adapter reads only selected IDs without rich metadata, geometry or appearance changes', async t => {
  const f = sdkFixture(), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  const viewer = f.viewers[0]; viewer.getAggregateSelection = () => [{ model: f.model, selection: [2, 3] }];
  for (const key of ['getObjectTree', 'getExternalIdMapping', 'getProperties', 'getFragmentList']) f.model[key] = () => { throw Error(`Forbidden rich read: ${key}`); };
  for (const key of ['enumNodeChildren', 'enumNodeFragments', 'getNodeName']) f.tree[key] = () => { throw Error(`Forbidden traversal: ${key}`); };
  let checked = false;
  assert.deepEqual(await handle.readTrayRootSelection(undefined, async () => { checked = true; }), { objects: [{ objectId: 2 }, { objectId: 3 }] });
  assert.equal(checked, true); assert.equal(f.facts.propertyReads, 0); assert.equal(f.facts.finishes, 0); assert.deepEqual(f.facts.isolated, []);
});

test('pinned SDK selectOnly keeps a clicked parent and reads its descendant bottom centre without isolation or implicit promotion', async t => {
  // Source-backed SDK callback execution, with a synthetic public-API model.
  // This does not claim a real browser or model acceptance check.
  const sdk = readFileSync(new URL('../sdk/7.130.0/viewer3D.min.js', import.meta.url), 'utf8');
  assert.ok(sdk.includes('this.clickConfig=r&&r.docStructureConfig?r.docStructureConfig:wK'));
  assert.ok(sdk.includes('var wK={click:{onObject:["isolate"]},clickShift:{onObject:["toggleMultipleOverlayedSelection"]},clickCtrl:{onObject:["toggleVisibility"]}}'));
  const sdkSelectOnly = sdk.match(/onSelectOnly:function\((\w+),(\w+)\)\{(\w+)\.select\(\1,\2\)\}/);
  assert.ok(sdkSelectOnly, 'Pinned Model Browser selectOnly forwards the clicked ID and model.');
  const f = sdkFixture(), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  class Box3 {
    constructor() { this.min = { x: Infinity, y: Infinity, z: Infinity }; this.max = { x: -Infinity, y: -Infinity, z: -Infinity }; }
    union(box) { for (const axis of ['x', 'y', 'z']) { this.min[axis] = Math.min(this.min[axis], box.min[axis]); this.max[axis] = Math.max(this.max[axis], box.max[axis]); } return this; }
    isEmpty() { return ['x', 'y', 'z'].some(axis => this.min[axis] > this.max[axis]); }
  }
  f.window.THREE.Box3 = Box3;
  const children = new Map([[1, [2]], [2, [4, 5]]]), fragmentsById = new Map([[4, [0]], [5, [1]]]);
  Object.assign(f.tree, {
    getNodeParentId: id => id === 1 ? 0 : id === 2 ? 1 : 2,
    getChildCount: id => children.get(id)?.length ?? 0,
    getNodeName: id => ({ 1: 'Model', 2: 'Equipment parent', 4: 'Front module', 5: 'Rear module' })[id],
    enumNodeChildren(id, callback, recursive) {
      if (recursive && callback(id)) return id;
      const visit = parent => { for (const child of children.get(parent) ?? []) { if (callback(child) || recursive && visit(child)) return true; } return false; };
      return visit(id) ? id : undefined;
    },
    enumNodeFragments(id, callback, recursive) {
      const visit = node => { for (const fragment of fragmentsById.get(node) ?? []) if (callback(fragment)) return true; if (recursive) for (const child of children.get(node) ?? []) if (visit(child)) return true; return false; };
      return visit(id) ? id : undefined;
    },
  });
  const fragmentBounds = [
    { min: { x: -2, y: 4, z: 6 }, max: { x: 2, y: 10, z: 8 } },
    { min: { x: 4, y: -2, z: 3 }, max: { x: 8, y: 2, z: 5 } },
  ];
  Object.assign(f.model, {
    getUnitScale: () => 1, getUpVector: () => [0, 0, 1], getGlobalOffset: () => [0, 0, 0],
    getExternalIdMapping: success => success({ parent: 2, front: 4, rear: 5 }),
    getFragmentList: () => ({ getCount: () => 2, getWorldBounds(id, box) { Object.assign(box.min, fragmentBounds[id].min); Object.assign(box.max, fragmentBounds[id].max); } }),
  });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor() });
  const viewer = f.viewers[0]; let selection = [4], fits = 0;
  const manualVisibility = { hiddenIds: [17], isolatedIds: [] }, ghost = { ...viewer.impl.fadeMaterial };
  viewer.getSelection = () => [...selection]; viewer.getAggregateSelection = () => [{ model: f.model, selection: [...selection] }];
  viewer.select = (id, model) => { assert.equal(model, f.model); selection = Array.isArray(id) ? [...id] : [id]; };
  viewer.fitToView = () => { fits++; };
  viewer.isolate = ids => { f.facts.isolated.push(ids); manualVisibility.isolatedIds = [...ids]; };
  // Use the exact pinned SDK callback rather than a replacement action handler.
  const onSelectOnly = new Function(sdkSelectOnly[3], 'return ' + sdkSelectOnly[0].slice('onSelectOnly:'.length))(viewer);
  assert.deepEqual(viewer.config.docStructureConfig.click.onObject, ['selectOnly']);
  onSelectOnly(2, f.model);
  const parent = await handle.readSelection();
  assert.deepEqual(viewer.getSelection(), [2]); assert.deepEqual(parent.objects.map(object => object.objectId), [2]);
  assert.equal(parent.objects[0].name, 'Equipment parent');
  assert.deepEqual(parent.objects[0].bounds, { minimum: [-2, -2, 3], maximum: [8, 10, 8] });
  assert.deepEqual(parent.objects[0].bottomCentre, [3, 4, 3]);
  let ownFragments = 0; f.tree.enumNodeFragments(2, () => { ownFragments++; }, false); assert.equal(ownFragments, 0);
  assert.equal(fits, 0); assert.deepEqual(f.facts.isolated, []);
  assert.deepEqual(manualVisibility, { hiddenIds: [17], isolatedIds: [] }); assert.deepEqual(viewer.impl.fadeMaterial, ghost);
  onSelectOnly(4, f.model);
  const child = await handle.readSelection(); assert.deepEqual(child.objects.map(object => object.objectId), [4]); assert.deepEqual(child.objects[0].bottomCentre, [0, 7, 6]);
  selection = [4, 5];
  const multiple = await handle.readSelection(); assert.deepEqual(multiple.objects.map(object => object.objectId), [4, 5]);
  assert.equal(fits, 0); assert.deepEqual(f.facts.isolated, []);
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
test('barrier adapter preserves only the closed diagnostic codes and discards raw SDK text', async t => {
  const previous = { window: globalThis.window, Autodesk: globalThis.Autodesk, THREE: globalThis.THREE, LMV_VIEWER_VERSION: globalThis.LMV_VIEWER_VERSION };
  t.after(() => Object.assign(globalThis, previous));
  assert.deepEqual([...BARRIER_CAPTURE_ERROR_CODES].sort(), [
    'BARRIER_CAPTURE_HIERARCHY_LIMIT', 'BARRIER_CAPTURE_FRAGMENT_LIMIT', 'BARRIER_CAPTURE_VERTEX_LIMIT', 'BARRIER_CAPTURE_TRIANGLE_LIMIT',
    'BARRIER_CAPTURE_PAYLOAD_LIMIT', 'BARRIER_CAPTURE_GEOMETRY_NOT_READY', 'BARRIER_CAPTURE_TREE_UNAVAILABLE', 'BARRIER_CAPTURE_IDENTITY_UNAVAILABLE',
    'BARRIER_CAPTURE_EMPTY_SELECTION', 'BARRIER_CAPTURE_GEOMETRY_NOT_RESIDENT', 'BARRIER_CAPTURE_GEOMETRY_BECAME_UNAVAILABLE',
    'BARRIER_CAPTURE_UNSUPPORTED_PRIMITIVE', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED', 'BARRIER_CAPTURE_MODEL_CHANGED', 'BARRIER_CAPTURE_INVALID', 'BARRIER_CAPTURE_DEADLINE',
  ].sort());
  assert.deepEqual([...BARRIER_CAPTURE_ERROR_CODES].sort(), Object.keys(BARRIER_CAPTURE_ERROR_MESSAGES).sort());
  assert.equal(Object.isFrozen(BARRIER_CAPTURE_ERROR_MESSAGES), true);
  for (const code of [...BARRIER_CAPTURE_ERROR_CODES, 'PRIVATE_SDK_FAILURE', 'LOOKUP_GEOMETRY_NOT_FOUND']) {
    const f = sdkFixture();
    globalThis.window = f.window;
    Object.assign(globalThis, { Autodesk: f.window.Autodesk, THREE: {}, LMV_VIEWER_VERSION: '7.130.0' });
    await f.adapter.initialize();
    const descriptor = { projectId: '11111111-1111-4111-8111-111111111111', modelVersionId: '22222222-2222-4222-8222-222222222222',
      loadId: '33333333-3333-4333-8333-333333333333', contentFingerprint: 'a'.repeat(64) };
    const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor });
    Object.defineProperty(f.window.Autodesk.Viewing, 'Private', { configurable: true,
      get() { throw Object.assign(Error('private object and SDK details'), { code }); } });
    const input = { captureId: '44444444-4444-4444-8444-444444444444', scope: { projectId: descriptor.projectId, modelVersionId: descriptor.modelVersionId,
      contentFingerprint: descriptor.contentFingerprint, selectionRevision: '1', captureFrameId: '55555555-5555-4555-8555-555555555555',
      captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' }, selectedParents: [{ selectionId: '66666666-6666-4666-8666-666666666666',
      kind: 'wall', objectId: 'dbid:2', dbId: 2, externalId: null, name: 'Selected parent', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }] };
    const known = BARRIER_CAPTURE_ERROR_CODES.includes(code);
    await assert.rejects(handle.startBarrierCapture(input), { code: known ? code : 'EXTRACTION_FAILED',
      message: known ? BARRIER_CAPTURE_ERROR_MESSAGES[code] : 'The local model or one of its resources could not be read.' });
    assert.equal(f.facts.finishes, 0); f.adapter.dispose();
  }
});
test('staged adapter acknowledges all input before one SDK read, admits committed index0 and clears private input', async t => {
  const previous = { window: globalThis.window, Autodesk: globalThis.Autodesk, THREE: globalThis.THREE, LMV_VIEWER_VERSION: globalThis.LMV_VIEWER_VERSION }; t.after(() => Object.assign(globalThis, previous));
  const f = sdkFixture(); globalThis.window = f.window;
  class Matrix { constructor() { this.elements = new Float64Array(16); } makeScale(x, y, z) { this.elements.fill(0); this.elements[0] = x; this.elements[5] = y; this.elements[10] = z; this.elements[15] = 1; return this; } }
  f.window.Autodesk.Viewing.Private = { LmvMatrix4: Matrix, enumMeshVertices() {}, enumMeshTriangles() {} }; Object.assign(globalThis, { Autodesk: f.window.Autodesk, THREE: {}, LMV_VIEWER_VERSION: '7.130.0' }); let sdkReads = 0;
  Object.assign(f.model, { getObjectTree: success => { sdkReads++; success(f.tree); }, getUnitScale: () => 1, getUnitString: () => 'metres', getUpVector: () => [0, 0, 1], getGlobalOffset: () => [0, 0, 0] });
  await f.adapter.initialize(); const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: { projectId: '11111111-1111-4111-8111-111111111111', modelVersionId: '22222222-2222-4222-8222-222222222222', contentFingerprint: 'a'.repeat(64) } });
  const captureId = '33333333-3333-4333-8333-333333333333', p = await planModelCaptureInput({ routeCodes: ['BC1'], allowedCategories: ['LV'], equipmentNames: Array.from({ length: 257 }, (_, i) => 'EQ-' + i) }, { captureId, envelopeIdentity: { instanceId: '44444444-4444-4444-8444-444444444444', projectId: '11111111-1111-4111-8111-111111111111', modelVersionId: '22222222-2222-4222-8222-222222222222', loadId: '55555555-5555-4555-8555-555555555555' } });
  assert.equal((await handle.startModelCapture(p.startPayload)).phase, 'receiving'); assert.equal(sdkReads, 0);
  for (const c of p.chunks) await handle.readModelCapture(c); assert.equal(sdkReads, 0);
  const first = await handle.readModelCapture({ captureId, index: 0 }); assert.equal(first.index, 0); assert.equal(JSON.parse(first.eventJson).type, 'metadata'); assert.equal(sdkReads, 1);
  handle.clearRoute(); await assert.rejects(handle.readModelCapture({ captureId, index: 1 }), { code: 'EXTRACTION_FAILED' });
  const again = await handle.startModelCapture(p.startPayload); assert.equal(again.receivedNameCount, 0); await assert.rejects(handle.readModelCapture({ captureId, index: 0 }), { code: 'EXTRACTION_FAILED' }); assert.equal(sdkReads, 1); f.adapter.dispose();
});

for (const phase of ['sdk', 'digest']) test(`a late cancelled ${phase} operation cannot clear its replacement capture`, async t => {
  const previous = { window: globalThis.window, Autodesk: globalThis.Autodesk, THREE: globalThis.THREE, LMV_VIEWER_VERSION: globalThis.LMV_VIEWER_VERSION }, originalCrypto = globalThis.crypto;
  t.after(() => { Object.assign(globalThis, previous); Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto }); });
  const f = sdkFixture(); globalThis.window = f.window; t.after(() => f.adapter.dispose());
  class Matrix { constructor() { this.elements = new Float64Array(16); } makeScale(x, y, z) { this.elements.fill(0); this.elements[0] = x; this.elements[5] = y; this.elements[10] = z; this.elements[15] = 1; return this; } }
  f.window.Autodesk.Viewing.Private = { LmvMatrix4: Matrix, enumMeshVertices() {}, enumMeshTriangles() {} };
  Object.assign(globalThis, { Autodesk: f.window.Autodesk, THREE: {}, LMV_VIEWER_VERSION: '7.130.0' });
  Object.assign(f.model, { getUnitScale: () => 1, getUnitString: () => 'metres', getUpVector: () => [0, 0, 1], getGlobalOffset: () => [0, 0, 0] });
  await f.adapter.initialize();
  const identity = { instanceId: '44444444-4444-4444-8444-444444444444', projectId: '11111111-1111-4111-8111-111111111111', modelVersionId: '22222222-2222-4222-8222-222222222222', loadId: '55555555-5555-4555-8555-555555555555' };
  const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: { projectId: identity.projectId, modelVersionId: identity.modelVersionId, contentFingerprint: 'a'.repeat(64) } });
  const request = count => ({ routeCodes: ['BC1'], allowedCategories: ['LV'], equipmentNames: Array.from({ length: count }, (_, i) => 'EQ-' + i) });
  const oldPlan = await planModelCaptureInput(request(1), { captureId: '33333333-3333-4333-8333-333333333333', envelopeIdentity: identity });
  const replacement = await planModelCaptureInput(request(257), { captureId: '66666666-6666-4666-8666-666666666666', envelopeIdentity: identity });
  let resume, observed; const waiting = new Promise(resolve => { observed = resolve; }); let pending;
  if (phase === 'sdk') {
    f.model.getObjectTree = success => { resume = () => success(f.tree); observed(); };
    pending = handle.startModelCapture({ captureId: oldPlan.startPayload.captureId, lookupRouteCodes: ['/BC1'], equipmentNames: [] });
  } else {
    await handle.startModelCapture(oldPlan.startPayload);
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest(...args) { observed(); return new Promise(resolve => { resume = async () => resolve(await originalCrypto.subtle.digest(...args)); }); } } } });
    pending = handle.readModelCapture(oldPlan.chunks[0]);
  }
  const oldRejected = assert.rejects(pending, { name: 'AbortError' }); await waiting;
  const ack = await handle.startModelCapture(replacement.startPayload); assert.equal(ack.receivedNameCount, 0);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
  await resume(); await oldRejected; await turn();
  f.model.getObjectTree = success => success(f.tree);
  assert.equal((await handle.readModelCapture(replacement.chunks[0])).receivedNameCount, 256);
  assert.equal((await handle.readModelCapture(replacement.chunks[1])).phase, 'ready');
  const metadata = await handle.readModelCapture({ captureId: replacement.startPayload.captureId, index: 0 });
  assert.equal(JSON.parse(metadata.eventJson).type, 'metadata'); assert.equal(metadata.captureId, replacement.startPayload.captureId);
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
  const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/private/resources/output/0/0.svf', descriptor: loadedDescriptor() });
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
    const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor: loadedDescriptor(), signal: controller.signal });
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

test('adapter binds published roots to the loaded descriptor identity before route resolution', async t => {
  const f = sdkFixture(), previous = globalThis.window; globalThis.window = f.window;
  t.after(() => { f.adapter.dispose(); globalThis.window = previous; });
  await f.adapter.initialize();
  const descriptor = { modelVersionId: '22222222-2222-4222-8222-222222222222', contentFingerprint: 'a'.repeat(64) };
  const handle = await f.adapter.load({ modelUrl: 'http://localhost:18085/model.svf', descriptor });
  const response = { schemaVersion: 'wfc.viewer.routing-bindings.v1', ...descriptor, selectionRevision: '12', aggregateId: '33333333-3333-4333-8333-333333333333', bindings: [{ routeName: '/A105', rootObjectIds: ['dbid:2', 'dbid:3'] }] };
  for (const invalid of [{ ...response, modelVersionId: '44444444-4444-4444-8444-444444444444' }, { ...response, contentFingerprint: 'b'.repeat(64) }]) {
    assert.throws(() => handle.showRoute('/A105', { routingBindings: invalid }), { code: 'ROUTING_BINDINGS_INVALID' });
    assert.equal(f.facts.isolated.length, 0);
  }
  const result = await handle.showRoute('/A105', { routingBindings: response });
  assert.equal(result.segments[0].count, 1); assert.equal(result.segments[0].mapped, true); assert.equal(result.segments[0].drawable, false);
  assert.deepEqual(f.facts.isolated.at(-1), [2, 3]);
});
