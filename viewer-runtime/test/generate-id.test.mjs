import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { generateId } from '../generate-id.mjs';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('generates UUID v4 with HTTP-compatible Web Crypto and no randomUUID', () => {
  const provider = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const ids = Array.from({ length: 1000 }, () => generateId(provider));
  for (const id of ids) assert.match(id, uuidV4);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(generateId(), uuidV4);
});

test('preserves random bytes except UUID version and variant bits', () => {
  for (const [byte, expected] of [
    [0x00, '00000000-0000-4000-8000-000000000000'],
    [0xff, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
  ]) {
    let calls = 0;
    const provider = { getRandomValues(bytes) {
      calls++;
      assert.ok(bytes instanceof Uint8Array);
      assert.equal(bytes.length, 16);
      return bytes.fill(byte);
    } };
    assert.equal(generateId(provider), expected);
    assert.equal(calls, 1);
  }
});

test('fails explicitly when Web Crypto is unavailable and propagates entropy errors', () => {
  for (const provider of [null, {}, { getRandomValues: null }]) {
    assert.throws(() => generateId(provider), /requires crypto\.getRandomValues/);
  }
  const cause = new Error('Entropy source unavailable');
  assert.throws(() => generateId({ getRandomValues() { throw cause; } }), error => error === cause);
});
