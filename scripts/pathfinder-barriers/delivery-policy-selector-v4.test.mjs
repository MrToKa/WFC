import test from 'node:test';
import assert from 'node:assert/strict';
import { POST_B9_NO_DDL_V4, selectDeliveryPolicy } from './delivery-policy-selector-v4.mjs';
import { qualifyMigrationInventories, qualifyRuntimeInventories, assertQualificationReceipt } from './migration-conservation-v4.mjs';

const input = () => ({ schemaVersion: 'wfc.pf.delivery-policy-selection.v1', profile: POST_B9_NO_DDL_V4 });
test('selection is explicit and binds only the versioned no-DDL qualifier', () => {
  const selected = selectDeliveryPolicy(input());
  assert.equal(selected.profile, POST_B9_NO_DDL_V4);
  assert.equal(selected.qualifierFilename, 'migration-conservation-v4.mjs');
  assert.deepEqual(selected.qualifier, { qualifyMigrationInventories, qualifyRuntimeInventories, assertQualificationReceipt });
  assert.throws(() => { selected.qualifierFilename = 'migration-qualification.mjs'; }, TypeError);
  assert.throws(() => { selected.qualifier.qualifyRuntimeInventories = () => ({ status: 'PASS' }); }, TypeError);
});
test('no absent, unknown, old-B9, path-based, extra or hidden selection is accepted', () => {
  const hidden = input(); Object.defineProperty(hidden, 'override', { value: true });
  const symbol = input(); symbol[Symbol('override')] = true;
  const getter = input(); Object.defineProperty(getter, 'profile', { enumerable: true, get() { throw Error('MUST_NOT_EVALUATE'); } });
  for (const value of [undefined, null, [], {}, { ...input(), profile: 'b9' }, { ...input(), profile: '../migration-qualification.mjs' },
    { ...input(), extra: true }, { ...input(), schemaVersion: 'unknown' }, hidden, symbol, getter]) {
    assert.throws(() => selectDeliveryPolicy(value), { code: 'V4_EXPLICIT_POLICY_REQUIRED' });
  }
  assert.throws(() => selectDeliveryPolicy(input(), true), { code: 'V4_EXPLICIT_POLICY_REQUIRED' });
});
