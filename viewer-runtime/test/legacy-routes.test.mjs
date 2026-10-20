import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteController, normalizeIdentifier, parseRoute } from '../routes.mjs';

const example = '/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY';
const expected = ['DFB018-1', 'DFB011', 'DFB012', 'DFB013', 'B002', 'B107-1', 'B107-2', 'B107-3', 'BC025', 'BC022-2'];

test('the supplied route keeps its ten tray identifiers in traversal order', () => {
  assert.deepEqual(parseRoute(example), expected);
});

test('surrounding spaces and redundant separators do not create route segments', () => {
  assert.deepEqual(parseRoute('  /// DFB018-1 /\n DFB011 // BC022-2 /  '), ['DFB018-1', 'DFB011', 'BC022-2']);
});

test('SECONDARY is ignored as a complete marker regardless of case or position', () => {
  assert.deepEqual(parseRoute('/secondary/B002/ Secondary /B107-1/ＳＥＣＯＮＤＡＲＹ'), ['B002', 'B107-1']);
  assert.deepEqual(parseRoute('/SECONDARY-1/BSECONDARY/SECONDARY'), ['SECONDARY-1', 'BSECONDARY']);
});

test('repeated identifiers remain in the route to support returning through a tray', () => {
  assert.deepEqual(parseRoute('/B002/B107-1/B002'), ['B002', 'B107-1', 'B002']);
});

test('display tokens retain their entered case while matching keys are canonical', () => {
  const tokens = parseRoute(' / dfb018-1 / b107-2 / bc022-2 / ');
  assert.deepEqual(tokens, ['dfb018-1', 'b107-2', 'bc022-2']);
  assert.deepEqual(tokens.map(normalizeIdentifier), ['DFB018-1', 'B107-2', 'BC022-2']);
});

test('identifier normalization handles whitespace, case and leading or trailing slash', () => {
  assert.equal(normalizeIdentifier('  ///dfb018-1///  '), 'DFB018-1');
  assert.equal(normalizeIdentifier('\t/Bc022-2/\n'), 'BC022-2');
});

test('Unicode compatibility characters match the equivalent model identifier', () => {
  assert.equal(normalizeIdentifier(' ／ｄｆｂ０１８－１／ '), 'DFB018-1');
  assert.equal(normalizeIdentifier('\u00a0/Ｂ１０７－２/\u00a0'), 'B107-2');
});

test('canonical identifiers preserve distinguishing suffixes, zeros and internal path separators', () => {
  const identifiers = ['B107', 'B107-1', 'B107-2', 'B107-10', 'B0107-1', 'BRANCH/B107-1'];
  const keys = identifiers.map(normalizeIdentifier);
  assert.equal(new Set(keys).size, identifiers.length);
  assert.deepEqual(keys, identifiers);
});

test('empty routes and routes containing only the ignored marker are rejected', () => {
  for (const input of ['', ' \n\t ', '/////', '/secondary/SECONDARY/']) {
    assert.throws(() => parseRoute(input), /Въведи означенията/);
  }
});

test('the segment limit accepts 100 tray identifiers and excludes SECONDARY', () => {
  const identifiers = Array.from({ length: 100 }, (_, index) => `B${String(index).padStart(3, '0')}`);
  assert.deepEqual(parseRoute(`/${identifiers.join('/')}/SECONDARY`), identifiers);
  assert.throws(() => parseRoute(`/${identifiers.join('/')}/B100`), /до 100 участъка/);
});

test('the input length limit is enforced before parsing oversized input', () => {
  assert.deepEqual(parseRoute('B'.repeat(8000)), ['B'.repeat(8000)]);
  assert.throws(() => parseRoute('B'.repeat(8001)), /твърде дълъг/);
  assert.throws(() => parseRoute('/'.repeat(8001)), /твърде дълъг/);
});

test('non-text input is rejected instead of being coerced into an identifier', () => {
  for (const input of [undefined, null, 12, {}, ['B002']]) {
    assert.throws(() => parseRoute(input), /Маршрутът/);
  }
});

function visibilityFixture(t) {
  const savedWindow = globalThis.window;
  globalThis.window = { THREE: {} };
  t.after(() => { globalThis.window = savedWindow; });
  const calls = [], baseline = { defaultVisible: true, states: [[4, false], [3, true]] };
  let state = structuredClone(baseline), failRestore = false;
  const tree = {
    getRootId: () => 1,
    getNodeName: id => ({ 1: 'Plant', 2: 'BC1', 3: 'BC2', 4: 'Equipment' })[id],
    enumNodeChildren(id, visit) { if (id === 1) for (const child of [2, 3, 4]) visit(child); },
    enumNodeFragments() {},
  };
  const manager = {
    getDefaultVisibility() { calls.push(['capture-default']); return state.defaultVisible; },
    getVisibility() { calls.push(['capture-states']); return state.states; },
    setVisibility(defaultVisible, states) {
      calls.push(['restore', defaultVisible, structuredClone(states)]);
      if (failRestore) throw Error('Synthetic visibility restore failure');
      state = { defaultVisible, states: structuredClone(states) };
    },
  };
  const model = { getInstanceTree: () => tree, getFragmentList: () => ({}), visibilityManager: manager };
  const fadeMaterial = { opacity: 0.15, variants: [{ opacity: 0.45 }] };
  const viewer = {
    model, preference: false,
    prefs: { get: () => viewer.preference },
    impl: { fadeMaterial, showGhosting: false, toggleGhosting(value) { this.showGhosting = value; }, invalidate() {} },
    setGhosting(value) { this.preference = value; },
    isolate(ids, selected) {
      assert.equal(selected, model); calls.push(['isolate', [...ids]]);
      // SDK isolation replaces ordinary hidden/visible overrides. This models
      // why isolate([]) cannot be evidence of an exact pre-route restoration.
      state.defaultVisible = ids.length === 0;
      state.states.splice(0, state.states.length, ...ids.map(id => [id, true]));
    },
    clearSelection() {}, fitToView() {},
    overlays: { addScene() {}, removeScene() {}, addMesh() {}, removeMesh() {} },
  };
  const controller = createRouteController(viewer);
  return { controller, viewer, model, manager, baseline, fadeMaterial, calls, state: () => structuredClone(state), failRestore: value => { failRestore = value; } };
}

test('legacy discovery preparation restores exact user-hidden equipment and original Ghost appearance', async t => {
  const f = visibilityFixture(t);
  await f.controller.showRoute('BC1');
  assert.deepEqual(f.state(), { defaultVisible: false, states: [[2, true]] });
  assert.equal(f.fadeMaterial.opacity, 0.025);
  f.controller.prepareForVisibilityObservation();
  assert.deepEqual(f.state(), f.baseline);
  assert.equal(f.fadeMaterial.opacity, 0.15); assert.equal(f.fadeMaterial.variants[0].opacity, 0.45);
  assert.equal(f.viewer.preference, false); assert.equal(f.viewer.impl.showGhosting, false);
  assert.equal(f.calls.filter(([kind]) => kind === 'restore').length, 1);
  assert.equal(f.calls.some(([kind, ids]) => kind === 'isolate' && ids.length === 0), false);
  const before = f.calls.length; f.controller.prepareForVisibilityObservation();
  assert.equal(f.calls.length, before);
  f.controller.dispose();
});

test('replacement legacy routes retain the first detached visibility snapshot until Clear', async t => {
  const f = visibilityFixture(t);
  await f.controller.showRoute('BC1'); await f.controller.showRoute('BC2');
  assert.deepEqual(f.state(), { defaultVisible: false, states: [[3, true]] });
  assert.equal(f.calls.filter(([kind]) => kind === 'capture-states').length, 1);
  f.controller.clearRoute();
  assert.deepEqual(f.state(), f.baseline);
  f.controller.clearRoute(); f.controller.prepareForVisibilityObservation();
  assert.deepEqual(f.state(), f.baseline);
  f.controller.dispose();
});

test('legacy dispose restores exact visibility without show-all isolation', async t => {
  const f = visibilityFixture(t); await f.controller.showRoute('BC1'); f.controller.dispose();
  assert.deepEqual(f.state(), f.baseline);
  assert.equal(f.fadeMaterial.opacity, 0.15);
  assert.equal(f.calls.some(([kind, ids]) => kind === 'isolate' && ids.length === 0), false);
  const before = f.calls.length; f.controller.dispose(); assert.equal(f.calls.length, before);
});

test('missing legacy snapshot APIs never become pre-route proof after manual fallback Clear', async t => {
  const f = visibilityFixture(t); delete f.manager.getVisibility;
  await f.controller.showRoute('BC1'); f.controller.clearRoute();
  assert.deepEqual(f.state(), { defaultVisible: true, states: [] });
  assert.throws(() => f.controller.prepareForVisibilityObservation(), { code: 'PREPARATION_VISIBILITY_UNAVAILABLE' });
  f.controller.clearRoute();
  assert.throws(() => f.controller.prepareForVisibilityObservation(), { code: 'PREPARATION_VISIBILITY_UNAVAILABLE' });
  f.controller.dispose();
});

test('discovery refuses unsupported active legacy visibility after cleaning its temporary appearance', async t => {
  const f = visibilityFixture(t); delete f.manager.setVisibility;
  await f.controller.showRoute('BC1');
  assert.throws(() => f.controller.prepareForVisibilityObservation(), { code: 'PREPARATION_VISIBILITY_UNAVAILABLE' });
  assert.equal(f.fadeMaterial.opacity, 0.15);
  assert.equal(f.viewer.preference, false);
  f.controller.dispose();
});

test('failed exact restoration stays unverified even if a later Clear can restore the saved state', async t => {
  const f = visibilityFixture(t); await f.controller.showRoute('BC1'); f.failRestore(true);
  assert.throws(() => f.controller.prepareForVisibilityObservation(), { code: 'PREPARATION_VISIBILITY_UNAVAILABLE' });
  assert.equal(f.fadeMaterial.opacity, 0.15);
  f.failRestore(false); f.controller.clearRoute();
  assert.deepEqual(f.state(), f.baseline);
  assert.throws(() => f.controller.prepareForVisibilityObservation(), { code: 'PREPARATION_VISIBILITY_UNAVAILABLE' });
  f.controller.dispose();
});

test('malformed or throwing snapshots refuse endpoint observation while preserving legacy display fallback', async t => {
  for (const bad of [() => [[4, 'hidden']], () => { throw Error('Synthetic snapshot failure'); }]) {
    const f = visibilityFixture(t); f.manager.getVisibility = bad;
    await f.controller.showRoute('BC1'); f.controller.clearRoute();
    assert.throws(() => f.controller.prepareForVisibilityObservation(), { code: 'PREPARATION_VISIBILITY_UNAVAILABLE' });
    f.controller.dispose();
  }
});

test('an unused legacy controller never changes user visibility during observation or disposal', t => {
  const f = visibilityFixture(t); f.controller.prepareForVisibilityObservation();
  f.controller.clearRoute(); f.controller.dispose();
  assert.deepEqual(f.state(), f.baseline);
  assert.equal(f.calls.some(([kind]) => kind === 'isolate' || kind === 'restore'), false);
});

test('a pending legacy route cannot commit temporary isolation after visibility observation starts', async t => {
  const f = visibilityFixture(t);
  await assert.rejects(() => f.controller.showRoute('BC1', { onProgress(message) {
    if (typeof message === 'string') f.controller.prepareForVisibilityObservation();
  } }), { name: 'AbortError' });
  assert.deepEqual(f.state(), f.baseline);
  assert.equal(f.calls.some(([kind]) => kind === 'isolate'), false);
  f.controller.prepareForVisibilityObservation(); f.controller.dispose();
});
