import test from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT_NAME_MATCHING_POLICY, modelEquipmentMatchKeys } from '../equipment-names.mjs';

test('equipment model keys retain exact Unicode spelling and expose only a single leading-slash alternative', () => {
  assert.equal(EQUIPMENT_NAME_MATCHING_POLICY, 'wfc.pf.equipment-model-leading-slash.v1');
  assert.deepEqual(modelEquipmentMatchKeys(' /=h1=jg2=bfb001 '), ['/=H1=JG2=BFB001', '=H1=JG2=BFB001']);
  assert.deepEqual(modelEquipmentMatchKeys('/cafe\u0301'), ['/CAF\u00c9', 'CAF\u00c9']);
  assert.deepEqual(modelEquipmentMatchKeys('=A001'), ['=A001']);
  assert.deepEqual(modelEquipmentMatchKeys(''), []);
});
test('equipment model keys preserve repeated, internal and trailing slashes, punctuation and leading zeroes', () => {
  for (const value of ['//=A001', '=A001/', '=A001/PART', '=A001-2']) assert.deepEqual(modelEquipmentMatchKeys(value), [value]);
  assert.deepEqual(modelEquipmentMatchKeys('/=A001/'), ['/=A001/', '=A001/']);
  assert.deepEqual(modelEquipmentMatchKeys('/'), ['/']);
  assert.ok(!modelEquipmentMatchKeys('/=A001').includes('A001'));
  assert.ok(!modelEquipmentMatchKeys('/=A001').includes('=A1'));
});
