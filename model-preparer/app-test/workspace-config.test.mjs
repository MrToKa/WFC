import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readConfiguration } from '../app/config.mjs';

const env = () => ({ PREPARER_DATA_DIR: path.resolve('config-test/data'), PREPARER_WORK_DIR: path.resolve('config-test/work'), PREPARER_OUTPUT_DIR: path.resolve('config-test/output'), PREPARER_PACKAGE_MODULE: path.resolve('config-test/package.mjs') });
test('standalone mode defaults and explicit choices remain unchanged without WFC', () => {
  assert.equal(readConfiguration(env()).mode, 'closed');
  assert.equal(readConfiguration(env()).wfcOrigin, null);
  assert.equal(readConfiguration(env()).liveReuseOnly, true);
  for (const mode of ['closed', 'simulation', 'live']) assert.equal(readConfiguration({ ...env(), PREPARER_MODE: mode }).mode, mode);
  assert.equal(readConfiguration({ ...env(), PREPARER_LIVE_REUSE_ONLY: 'false' }).liveReuseOnly, false);
});
test('an explicit fixed WFC origin selects the authenticated workspace in live mode', () => {
  for (const mode of ['closed', 'simulation', 'live']) {
    const config = readConfiguration({ ...env(), PREPARER_MODE: mode, PREPARER_WFC_ORIGIN: 'https://wfc.example.test/' });
    assert.equal(config.mode, 'live');
    assert.equal(config.wfcOrigin, 'https://wfc.example.test');
    assert.equal(config.liveReuseOnly, false);
    assert.equal(Object.isFrozen(config), true);
  }
  assert.equal(readConfiguration({ ...env(), PREPARER_WFC_ORIGIN: 'http://host.docker.internal:3000' }).wfcOrigin, 'http://host.docker.internal:3000');
});
test('WFC configuration rejects embedded credentials, paths, query strings and unsupported schemes without leaking input', () => {
  for (const origin of ['not-a-url', 'file:///tmp/wfc', 'https://PRIVATE_USER:PRIVATE_PASSWORD@wfc.example.test', 'https://wfc.example.test/api', 'https://wfc.example.test/?token=PRIVATE_TOKEN', 'https://wfc.example.test/#PRIVATE_TOKEN']) {
    assert.throws(() => readConfiguration({ ...env(), PREPARER_WFC_ORIGIN: origin }), error => error.message === 'Invalid PREPARER_WFC_ORIGIN' && !/PRIVATE/.test(error.message));
  }
  assert.throws(() => readConfiguration({ ...env(), PREPARER_WFC_ORIGIN: 'https://wfc.example.test', PREPARER_MODE: 'misspelled' }), /Invalid PREPARER_MODE/);
});
