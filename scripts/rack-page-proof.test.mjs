import test from 'node:test';
import assert from 'node:assert/strict';
import { rackPageProvesPair } from './rack-page-proof.mjs';

const sheet = 'Instrument Rack Layout\n=H1=HA1=BTA2\n=H1=UBA5';
const note =
  'HPU 3 an HPU4 have the same layout. Only the tags are change from =H1\n05\nto =H2, =H3 an =H4.';
test('a single named rack and complete printed endpoint identify a direct pair', () => {
  assert.ok(rackPageProvesPair(sheet, '=H1=HA1=BTA2', '=H1=UBA5'));
  assert.equal(rackPageProvesPair(sheet, '=H1=HA1=BTA', '=H1=UBA5'), false);
  assert.equal(rackPageProvesPair(sheet + '\n=H1=UBA6', '=H1=HA1=BTA2', '=H1=UBA5'), false);
});
test('each substitution requires both printed prefixes and an explicit same-layout note', () => {
  assert.ok(rackPageProvesPair(sheet + '\n' + note, '=H2=HA1=BTA2', '=H2=UBA5'));
  assert.equal(rackPageProvesPair(sheet + '\n' + note, '=H3=HA1=BTA2', '=H2=UBA5'), false);
  assert.equal(rackPageProvesPair(sheet + '\n' + note, '=H7=HA1=BTA2', '=H7=UBA5'), false);
  assert.equal(rackPageProvesPair(sheet, '=H2=HA1=BTA2', '=H2=UBA5'), false);
});
