import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createProducerHost } from '../producer-host.mjs';
import { CHANNEL, SDK_VERSION, validateEnvelope } from '../protocol.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('producer initialization and disposal use HTTP-compatible secure command identifiers', async () => {
  const configuration = { instanceId: id(1), projectId: id(2), modelVersionId: id(3), loadId: id(4), sessionId: id(5) };
  const sent = [], listeners = new Set();
  let removed = false;
  const origin = 'http://192.168.5.55:5173';
  const emit = data => {
    for (const listener of listeners) listener({ origin, source: frame.contentWindow, data });
  };
  const frame = {
    style: {},
    setAttribute() {},
    remove() { removed = true; },
    contentWindow: {
      postMessage(command, targetOrigin) {
        assert.equal(targetOrigin, origin);
        assert.ok(validateEnvelope(command, 'parent-to-frame'));
        sent.push(command);
        const type = { INIT: 'RUNTIME_READY', LOAD_MODEL: 'MODEL_LOADED', DISPOSE: 'DISPOSED' }[command.type];
        const payload = command.type === 'INIT' ? { sdkVersion: SDK_VERSION }
          : command.type === 'LOAD_MODEL' ? { sdkVersion: SDK_VERSION, format: 'svf', nodeIndexReady: true } : {};
        queueMicrotask(() => emit({ ...command, type, payload }));
      },
    },
  };
  const window = {
    location: { origin },
    crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
    setTimeout,
    clearTimeout,
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    document: {
      createElement(type) { assert.equal(type, 'iframe'); return frame; },
      body: {
        append(value) {
          assert.equal(value, frame);
          queueMicrotask(() => emit({ channel: CHANNEL, protocolVersion: 1, instanceId: configuration.instanceId,
            projectId: configuration.projectId, modelVersionId: null, loadId: null, requestId: id(10), type: 'HELLO',
            payload: { supportedProtocolVersions: [1], sdkVersion: SDK_VERSION } }));
        },
      },
    },
  };
  assert.equal(window.crypto.randomUUID, undefined);
  assert.equal(window.crypto.subtle, undefined);
  const host = createProducerHost(window);
  assert.deepEqual(await host.initialize(configuration), { schemaVersion: 'wfc.pf.producer-host-ready.v1', ...configuration, sdkVersion: SDK_VERSION });
  await host.dispose();
  assert.deepEqual(sent.map(command => command.type), ['INIT', 'LOAD_MODEL', 'DISPOSE']);
  assert.equal(new Set(sent.map(command => command.requestId)).size, 3);
  for (const command of sent) assert.match(command.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(removed, true);
  assert.equal(listeners.size, 0);
});
