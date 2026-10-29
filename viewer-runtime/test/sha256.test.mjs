import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { digestSha256 } from '../sha256.mjs';

const encode = value => new TextEncoder().encode(value);
const hex = value => Buffer.from(value).toString('hex');
const reference = value => createHash('sha256').update(value).digest('hex');

test('fallback matches published SHA-256 vectors and UTF-8 text', async () => {
  for (const [message, expected] of [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ]) {
    const result = await digestSha256(encode(message), {});
    assert.ok(result instanceof ArrayBuffer);
    assert.equal(result.byteLength, 32);
    assert.equal(hex(result), expected);
  }
  const unicode = encode('Стени и трасета /BC175 — 日本語 🧰\u0000');
  assert.equal(hex(await digestSha256(unicode, {})), reference(unicode));
});

test('fallback matches Node and native Web Crypto across block and padding boundaries', async () => {
  const lengths = new Set([...Array.from({ length: 258 }, (_, i) => i), 511, 512, 513, 1023, 1024, 1025, 4095, 4096, 4097, 65535, 65536]);
  for (const length of lengths) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 131 + (i >>> 3) + length * 17) & 255);
    const expected = reference(bytes);
    assert.equal(hex(await digestSha256(bytes, {})), expected, `fallback length ${length}`);
    assert.equal(hex(await digestSha256(bytes, webcrypto)), expected, `native length ${length}`);
  }
});

test('fallback reads only the selected bytes for buffers, typed-array views and DataView', async () => {
  const backing = Uint8Array.from({ length: 160 }, (_, i) => i);
  const cases = [
    [backing.buffer, backing],
    [backing.subarray(7, 68), backing.subarray(7, 68)],
    [new DataView(backing.buffer, 11, 63), backing.subarray(11, 74)],
    [new Uint16Array(backing.buffer, 12, 32), backing.subarray(12, 76)],
    [new Uint32Array(backing.buffer, 16, 17), backing.subarray(16, 84)],
    [new DataView(backing.buffer, 15, 0), backing.subarray(15, 15)],
  ];
  for (const [value, expectedBytes] of cases) {
    const original = backing.slice();
    assert.equal(hex(await digestSha256(value, {})), reference(expectedBytes));
    assert.deepEqual(backing, original);
  }
  const foreignBuffer = runInNewContext('new Uint8Array([97, 98, 99]).buffer');
  assert.equal(hex(await digestSha256(foreignBuffer, {})), reference(encode('abc')));
});

test('uses native digest with its original receiver and propagates rejection without fallback', async () => {
  const bytes = encode('abc'), expected = new ArrayBuffer(32);
  let calls = 0;
  const subtle = { digest(algorithm, value) {
    calls++;
    assert.equal(this, subtle);
    assert.equal(algorithm, 'SHA-256');
    assert.equal(value, bytes);
    return Promise.resolve(expected);
  } };
  assert.equal(await digestSha256(bytes, { subtle }), expected);
  assert.equal(calls, 1);
  const cause = new Error('Native digest failed');
  await assert.rejects(digestSha256(bytes, { subtle: { digest() { return Promise.reject(cause); } } }), error => error === cause);
  await assert.rejects(digestSha256(bytes, { subtle: { digest() { throw cause; } } }), error => error === cause);
});

test('falls back only when native digest is absent and rejects invalid buffer sources', async () => {
  const bytes = encode('abc');
  for (const provider of [null, {}, { subtle: null }, { subtle: {} }, { subtle: { digest: null } }]) {
    assert.equal(hex(await digestSha256(bytes, provider)), reference(bytes));
  }
  assert.equal(hex(await digestSha256(bytes)), reference(bytes));
  for (const value of [null, undefined, '', 'abc', [97, 98, 99], {}, 3]) {
    await assert.rejects(digestSha256(value, {}), TypeError);
  }
});

test('fallback rejects shared buffers and shared views like native BufferSource', { skip: typeof SharedArrayBuffer === 'undefined' }, async () => {
  const shared = new SharedArrayBuffer(32);
  for (const value of [shared, new Uint8Array(shared, 3, 10), new DataView(shared, 7, 12)]) {
    await assert.rejects(digestSha256(value, {}), TypeError);
    await assert.rejects(digestSha256(value, webcrypto), TypeError);
  }
});
