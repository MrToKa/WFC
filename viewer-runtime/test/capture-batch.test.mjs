import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePacketBytes, MODEL_CAPTURE_BATCH_BYTES, MODEL_CAPTURE_BATCH_EVENTS, validCaptureBatch } from '../capture-batch.mjs';
import { validateEnvelope, CHANNEL, MAX_MESSAGE_BYTES } from '../protocol.mjs';

test('2045 escaped 16 KiB events use bounded packets with fewer authenticated roundtrips', () => {
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const captureId = uuid(1), events = Array.from({ length: 2045 }, (_, index) => JSON.stringify({ type: index === 2044 ? 'complete' : 'geometry', captureId, index, data: 'x'.repeat(16300) + JSON.stringify({ escaped: String.fromCharCode(34, 92) }) }));
  let index = 0, packets = 0;
  while (index < events.length) {
    const eventJsons = [], start = index;
    while (index < events.length && eventJsons.length < MODEL_CAPTURE_BATCH_EVENTS) {
      const next = { captureId, index: start, done: index === events.length - 1, eventJsons: [...eventJsons, events[index]] };
      if (capturePacketBytes(next) > MODEL_CAPTURE_BATCH_BYTES) break;
      eventJsons.push(events[index++]);
    }
    assert.ok(eventJsons.length > 0);
    const payload = { captureId, index: start, done: index === events.length, eventJsons };
    assert.ok(validCaptureBatch(payload));
    const envelope = { channel: CHANNEL, protocolVersion: 1, instanceId: uuid(2), projectId: uuid(3), modelVersionId: uuid(4), loadId: uuid(5), requestId: uuid(6), type: 'MODEL_CAPTURE_EVENT', payload };
    assert.ok(capturePacketBytes(envelope) < MAX_MESSAGE_BYTES);
    assert.ok(validateEnvelope(envelope, 'frame-to-parent'));
    packets++;
  }
  // The JSON includes nested backslashes/quotes: packing counts wire bytes,
  // never an unescaped string length. No original event is removed or merged.
  assert.equal(index, 2045);
  assert.equal(packets, 682);
  assert.equal(2 * packets, 1364); // before/after authority calls, versus4090
});

