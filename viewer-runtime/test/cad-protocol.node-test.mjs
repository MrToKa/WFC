import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNEL, PROTOCOL_VERSION, validateEnvelope } from '../protocol.mjs';

const instanceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const modelVersionId = '33333333-3333-4333-8333-333333333333';
const loadId = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const componentId = '66666666-6666-4666-8666-666666666666';
const identity = {
  channel: CHANNEL, protocolVersion: PROTOCOL_VERSION, instanceId, projectId,
  modelVersionId, loadId, requestId,
};
const transform = {
  positionMm: { x: 12500, y: 8400, z: 4500 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
};
const parent = (type, payload, overrides = {}) =>
  ({ ...identity, type, payload, ...overrides });

test('CAD_BEGIN and CAD_APPEND accept only bounded model-scoped data', () => {
  assert.ok(validateEnvelope(parent('CAD_BEGIN', { componentId, totalChars: 42, transform }), 'parent-to-frame'));
  assert.ok(validateEnvelope(parent('CAD_APPEND', { componentId, offset: 0, chunk: 'x'.repeat(12000) }), 'parent-to-frame'));
  assert.equal(validateEnvelope(parent('CAD_BEGIN', { componentId, totalChars: 0, transform }), 'parent-to-frame'), null);
  assert.equal(validateEnvelope(parent('CAD_BEGIN', { componentId, totalChars: 42, transform },
    { modelVersionId: null, loadId: null }), 'parent-to-frame'), null);
  assert.equal(validateEnvelope(parent('CAD_APPEND', { componentId, offset: 0, chunk: 'x'.repeat(12001) }), 'parent-to-frame'), null);
  assert.equal(validateEnvelope(parent('CAD_BEGIN', { componentId, totalChars: 42, transform: {
    ...transform, positionMm: { x: NaN, y: 0, z: 0 },
  }}), 'parent-to-frame'), null);
  assert.equal(validateEnvelope(parent('CAD_BEGIN', { componentId, totalChars: 42, transform,
    arbitraryCode: 'javascript:alert(1)',
  }), 'parent-to-frame'), null);
});
test('CAD operations never bypass iframe command direction', () => {
  assert.equal(validateEnvelope(parent('CAD_REMOVE', {componentId}), 'frame-to-parent'), null);
  assert.equal(validateEnvelope(parent('CAD_ACK', { componentId, phase: 'displayed', received: 42 }), 'parent-to-frame'), null);
  assert.ok(validateEnvelope(parent('CAD_ACK', { componentId, phase: 'displayed', received: 42 }), 'frame-to-parent'));
  assert.ok(validateEnvelope(parent('CAD_TRANSFORM', { componentId, transform }), 'parent-to-frame'));
  assert.equal(validateEnvelope(parent('CAD_TRANSFORM', { componentId, transform: {
    ...transform, rotation: { x: 0, y: 0, z: 0, w: 0 },
  }}), 'parent-to-frame'), null);
});

test('CAD focus accepts only a current-model component UUID and returns a focused acknowledgement', () => {
  assert.ok(validateEnvelope(parent('CAD_FOCUS', { componentId }), 'parent-to-frame'));
  assert.equal(validateEnvelope(parent('CAD_FOCUS', { componentId }), 'frame-to-parent'), null);
  assert.equal(validateEnvelope(parent('CAD_FOCUS', { componentId, objectId: 42 }), 'parent-to-frame'), null);
  assert.equal(validateEnvelope(parent('CAD_FOCUS', { componentId }, { modelVersionId: null, loadId: null }), 'parent-to-frame'), null);
  assert.ok(validateEnvelope(parent('CAD_ACK', { componentId, phase: 'focused', received: 0 }), 'frame-to-parent'));
});

test('CAD color accepts only owned UUID commands, exact hex and a model-scoped colored acknowledgement', () => {
  assert.ok(validateEnvelope(parent('CAD_COLOR', { componentId, color: '#12aBef' }), 'parent-to-frame'));
  for (const color of ['red', '#123', '#1234567', '123456', '#gg0000', null, 123])
    assert.equal(validateEnvelope(parent('CAD_COLOR', { componentId, color }), 'parent-to-frame'), null);
  assert.equal(validateEnvelope(parent('CAD_COLOR', { componentId: 42, color: '#123456' }), 'parent-to-frame'), null);
  assert.equal(validateEnvelope(parent('CAD_COLOR', { componentId, color: '#123456', objectId: 42 }), 'parent-to-frame'), null);
  assert.equal(validateEnvelope(parent('CAD_COLOR', { componentId, color: '#123456' }), 'frame-to-parent'), null);
  assert.equal(validateEnvelope(parent('CAD_COLOR', { componentId, color: '#123456' }, { modelVersionId: null, loadId: null }), 'parent-to-frame'), null);
  assert.ok(validateEnvelope(parent('CAD_ACK', { componentId, phase: 'colored', received: 0 }), 'frame-to-parent'));
});
