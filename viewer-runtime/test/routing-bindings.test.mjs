import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutingBindings, ROUTING_BINDINGS_LIMITS } from '../routing-bindings.mjs';

const modelVersionId = '22222222-2222-4222-8222-222222222222';
const descriptor = { modelVersionId, contentFingerprint: 'a'.repeat(64) };
const response = (bindings = [{ routeName: '/A105', rootObjectIds: ['dbid:2', 'dbid:3'] }]) => ({
  schemaVersion: 'wfc.viewer.routing-bindings.v1', ...descriptor, selectionRevision: '12',
  aggregateId: '33333333-3333-4333-8333-333333333333', bindings,
});

test('a detached frozen response retains one logical project route with several exact roots', () => {
  const input = response(), parsed = parseRoutingBindings(input, descriptor, '12');
  assert.deepEqual(parsed, input); assert.notEqual(parsed, input);
  input.bindings[0].rootObjectIds.push('dbid:4'); input.bindings.push({ routeName: '/X', rootObjectIds: ['dbid:5'] });
  assert.deepEqual(parsed.bindings, [{ routeName: '/A105', rootObjectIds: ['dbid:2', 'dbid:3'] }]);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.bindings) && Object.isFrozen(parsed.bindings[0]) && Object.isFrozen(parsed.bindings[0].rootObjectIds));
});

test('unpublished empty mappings are accepted but cannot smuggle mapped roots', () => {
  assert.ok(parseRoutingBindings({ ...response([]), aggregateId: null }, descriptor));
  assert.equal(parseRoutingBindings({ ...response(), aggregateId: null }, descriptor), null);
});

test('response identity, selection revision and closed shapes fail closed', () => {
  const cases = [
    { ...response(), schemaVersion: 'future' }, { ...response(), modelVersionId: '44444444-4444-4444-8444-444444444444' },
    { ...response(), contentFingerprint: 'b'.repeat(64) }, { ...response(), selectionRevision: 12 },
    { ...response(), selectionRevision: '01' }, { ...response(), selectionRevision: '-1' },
    { ...response(), selectionRevision: '9223372036854775808' }, { ...response(), aggregateId: 'not-an-id' },
    { ...response(), extra: true }, response([{ routeName: '/A105', rootObjectIds: ['dbid:2'], extra: true }]),
  ];
  for (const value of cases) assert.equal(parseRoutingBindings(value, descriptor), null);
  assert.equal(parseRoutingBindings(response(), descriptor, '13'), null);
  assert.ok(parseRoutingBindings({ ...response(), selectionRevision: '9223372036854775807' }, descriptor));
  const getter = response(); Object.defineProperty(getter, 'bindings', { enumerable: true, get() { throw new Error('must not read getters'); } });
  assert.equal(parseRoutingBindings(getter, descriptor), null);
});

test('only canonical project names and distinct exact dbid roots are accepted', () => {
  for (const routeName of ['A105', '/a105', '/A105/X', '/SECONDARY', '/Ａ105', '/A 105', `/${'A'.repeat(500)}`])
    assert.equal(parseRoutingBindings(response([{ routeName, rootObjectIds: ['dbid:2'] }]), descriptor), null);
  for (const root of ['2', 'dbid:-1', 'dbid:01', 'dbid:2147483648', 'dbid:2.0', 2])
    assert.equal(parseRoutingBindings(response([{ routeName: '/A105', rootObjectIds: [root] }]), descriptor), null);
  assert.equal(parseRoutingBindings(response([{ routeName: '/A105', rootObjectIds: [] }]), descriptor), null);
  assert.equal(parseRoutingBindings(response([{ routeName: '/A105', rootObjectIds: ['dbid:2', 'dbid:2'] }]), descriptor), null);
  assert.equal(parseRoutingBindings(response([{ routeName: '/A105', rootObjectIds: ['dbid:2'] }, { routeName: '/A120', rootObjectIds: ['dbid:2'] }]), descriptor), null);
  assert.equal(parseRoutingBindings(response([{ routeName: '/A105', rootObjectIds: ['dbid:2'] }, { routeName: '/A105', rootObjectIds: ['dbid:3'] }]), descriptor), null);
  const sparse = response(); sparse.bindings = new Array(1); assert.equal(parseRoutingBindings(sparse, descriptor), null);
  assert.ok(parseRoutingBindings(response([{ routeName: '/A105-X.1_2', rootObjectIds: ['dbid:2147483647'] }]), descriptor));
});

test('mapping, root and UTF-8 response budgets are independently bounded', () => {
  const maps = count => Array.from({ length: count }, (_, i) => ({ routeName: `/R${i}`, rootObjectIds: [`dbid:${i + 2}`] }));
  assert.ok(parseRoutingBindings(response(maps(ROUTING_BINDINGS_LIMITS.maps)), descriptor));
  assert.equal(parseRoutingBindings(response(maps(ROUTING_BINDINGS_LIMITS.maps + 1)), descriptor), null);
  const roots = count => [{ routeName: '/A105', rootObjectIds: Array.from({ length: count }, (_, i) => `dbid:${i + 2}`) }];
  assert.ok(parseRoutingBindings(response(roots(ROUTING_BINDINGS_LIMITS.roots)), descriptor));
  assert.equal(parseRoutingBindings(response(roots(ROUTING_BINDINGS_LIMITS.roots + 1)), descriptor), null);
  const oversized = maps(100).map((value, i) => ({ ...value, routeName: `/R${i}${'A'.repeat(400)}` }));
  assert.ok(new TextEncoder().encode(JSON.stringify(response(oversized))).length > ROUTING_BINDINGS_LIMITS.bytes);
  assert.equal(parseRoutingBindings(response(oversized), descriptor), null);
});
