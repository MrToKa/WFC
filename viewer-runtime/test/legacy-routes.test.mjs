import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdentifier, parseRoute } from '../routes.mjs';

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
