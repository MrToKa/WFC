import test from 'node:test';
import assert from 'node:assert/strict';
import { planModelCaptureInput, createModelCaptureInputStage, validateModelCaptureInputDescriptor, validateModelCaptureInputScope, validateModelCaptureInputAck, CAPTURE_INPUT_LIMITS } from '../capture-input.mjs';
import { validateEnvelope } from '../protocol.mjs';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, captureId = uuid(5);
const envelopeIdentity = { instanceId: uuid(1), projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4) };
const request = count => ({ routeRules: [{ id: uuid(6), objectIds: [2], allowedCategories: ['LV', 'Control'] }], equipmentNames: Array.from({ length: count }, (_, n) => 'EQ-' + n) });
const plan = (r, extra = {}) => planModelCaptureInput(r, { captureId, envelopeIdentity, ...extra });
const envelope = (type, payload) => ({ channel: 'wfc-routings-viewer', protocolVersion: 1, ...envelopeIdentity, requestId: uuid(9), type, payload });
async function ready(p, options) { const stage = createModelCaptureInputStage(p.startPayload, options); const acks = [await stage.initialAck()]; for (const c of p.chunks) acks.push(await stage.append(c)); return { stage, acks }; }

test('1527 names use bounded sequential input chunks and one immutable exact request', async () => {
  const p = await plan(request(1527)); assert.equal(p.chunks.length, 6); assert.equal(p.descriptor.equipmentNameCount, 1527); assert.equal(p.descriptor.chunkCount, 6);
  const { stage, acks } = await ready(p); assert.deepEqual(acks.map(a => a.receivedNameCount), [0, 256, 512, 768, 1024, 1280, 1527]); assert.equal(acks.at(-1).phase, 'ready'); assert.equal(stage.remainingResponses + acks.length, 3000); assert.deepEqual(stage.request().equipmentNames, p.request.equipmentNames); assert.ok(Object.isFrozen(stage.request().routeRules[0].objectIds));
});
test('UTF8-aware chunks fit the entire unchanged64KiB envelope', async () => {
  const r = request(300); r.equipmentNames = r.equipmentNames.map((_, i) => '漢'.repeat(249) + String(i).padStart(6, '0')); const p = await plan(r); assert.ok(p.chunks.length > 2); assert.ok(p.chunks.length <= 16);
  for (const c of p.chunks) { assert.ok(c.equipmentNames.length <= 256); assert.ok(validateEnvelope(envelope('READ_MODEL_CAPTURE', c), 'parent-to-frame')); assert.ok(new TextEncoder().encode(JSON.stringify(envelope('READ_MODEL_CAPTURE', c))).length <= 65536); }
});
test('4096 short names use at most16 chunks;4097 fails without truncation', async () => { const p = await plan(request(4096)); assert.equal(p.chunks.length, 16); assert.equal(p.descriptor.equipmentNameCount, 4096); await assert.rejects(plan(request(4097)), /capture input/); });
test('oneMiB entire canonical scope is enforced independently of count limit', async () => { const r = request(4096); r.equipmentNames = r.equipmentNames.map((_, i) => 'x'.repeat(250) + String(i).padStart(6, '0')); await assert.rejects(plan(r), /capture input/); });
test('NFC trim/first dedup preserves case variants and ordered overlap rules', async () => {
  const r = request(0); r.equipmentNames = [' e\u0301 ', 'é', 'É']; r.routeRules.push({ id: uuid(7), objectIds: [2], allowedCategories: [] }); const p = await plan(r); assert.deepEqual(p.request.equipmentNames, ['é', 'É']); assert.equal(p.request.routeRules[1].id, uuid(7)); assert.deepEqual(p.request.routeRules[1].allowedCategories, []);
  const reversed = await plan({ ...r, routeRules: [...r.routeRules].reverse() }); assert.notEqual(p.descriptor.scopeSha256, reversed.descriptor.scopeSha256);
});
test('empty equipment scope hashes and acknowledges before output index0 is admitted', async () => { const p = await plan(request(0)), { stage, acks } = await ready(p); assert.equal(acks[0].phase, 'ready'); assert.equal(acks[0].receivedNameCount, 0); assert.equal(stage.remainingResponses, 2999); });
test('input ACK hashes are null until final count and digest verification', async () => { const p = await plan(request(257)), stage = createModelCaptureInputStage(p.startPayload); const initial = await stage.initialAck(), first = await stage.append(p.chunks[0]), last = await stage.append(p.chunks[1]); for (const ack of [initial, first]) { assert.equal(ack.phase, 'receiving'); assert.equal(ack.scopeSha256, null); assert.ok(validateModelCaptureInputAck(ack)); } assert.equal(last.scopeSha256, p.descriptor.scopeSha256); assert.equal(last.equipmentNamesSha256, p.descriptor.equipmentNamesSha256); });
test('missing, reordered, repeated, wrong capture and mixed append payloads fail closed', async () => {
  const p = await plan(request(257));
  for (const modify of [c => ({ ...c, equipmentOffset: 1 }), c => ({ ...c, captureId: uuid(90) }), c => ({ ...c, index: 0 }), c => ({ ...c, equipmentNames: [c.equipmentNames[0], c.equipmentNames[0]] })]) { const stage = createModelCaptureInputStage(p.startPayload); await stage.initialAck(); await assert.rejects(() => stage.append(modify(p.chunks[0]))); assert.throws(() => stage.request()); }
  const stage = createModelCaptureInputStage(p.startPayload); await stage.initialAck(); await stage.append(p.chunks[0]); await assert.rejects(() => stage.append(p.chunks[0]));
});
test('final count cannot accept omitted names, changed values or a false declared digest', async () => {
  const p = await plan(request(2)); for (const mutate of [s => { s.input.scopeSha256 = 'a'.repeat(64); }, s => { s.input.equipmentNamesSha256 = 'b'.repeat(64); }, s => { s.input.inputUtf8Bytes++; }]) { const start = structuredClone(p.startPayload); mutate(start); const stage = createModelCaptureInputStage(start); await stage.initialAck(); await assert.rejects(() => stage.append(p.chunks[0])); assert.throws(() => stage.request()); }
  const stage = createModelCaptureInputStage(p.startPayload); await stage.initialAck(); await assert.rejects(() => stage.append({ ...p.chunks[0], equipmentNames: ['EQ-0', 'CHANGED'] }));
});
test('staging retains the original300s deadline instead of resetting after each chunk', async () => { const p = await plan(request(257)), now = Date.now(), stage = createModelCaptureInputStage(p.startPayload, { startedAt: now - 300001 }); await assert.rejects(() => stage.initialAck()); });
test('current-stage and caller cancellation fences suppress a late SHA result', async t => {
  const p = await plan(request(1)), previous = globalThis.crypto, control = new AbortController(); let finish, called; const waiting = new Promise(resolve => { called = resolve; });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest() { called(); return new Promise(resolve => { finish = resolve; }); } } } }); t.after(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: previous }));
  const stage = createModelCaptureInputStage(p.startPayload, { signal: control.signal }); await stage.initialAck(); const pending = stage.append(p.chunks[0]); await waiting; control.abort(); finish(new ArrayBuffer(32)); await assert.rejects(pending, { name: 'AbortError' }); assert.throws(() => stage.request());
});
test('planner detaches mutable caller arrays before its asynchronous digest', async t => {
  const previous = globalThis.crypto, original = request(1); let finish, called; const waiting = new Promise(resolve => { called = resolve; }); let first = true;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest(...args) { if (!first) return previous.subtle.digest(...args); first = false; called(); return new Promise(resolve => { finish = async () => resolve(await previous.subtle.digest(...args)); }); } } } }); t.after(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: previous }));
  const pending = plan(original); await waiting; original.equipmentNames[0] = 'MUTATED'; original.routeRules[0].allowedCategories[0] = 'MV'; await finish(); const p = await pending; assert.deepEqual(p.request.equipmentNames, ['EQ-0']); assert.deepEqual(p.request.routeRules[0].allowedCategories, ['LV', 'Control']);
});
test('one schema validates compact descriptor, pending metadata scope and finalized omitted-row closure', async () => {
  const p = await plan(request(1)); assert.ok(validateModelCaptureInputDescriptor(p.descriptor)); assert.ok(validateModelCaptureInputScope({ ...p.descriptor, propertyScan: null }, { allowPending: true })); assert.equal(validateModelCaptureInputScope({ ...p.descriptor, propertyScan: null }), false);
  const scan = { indexedObjectCount: 10, attemptedObjectCount: 10, returnedObjectCount: 9, omittedObjectCount: 1, complete: false }; assert.ok(validateModelCaptureInputScope({ ...p.descriptor, propertyScan: scan })); assert.equal(validateModelCaptureInputScope({ ...p.descriptor, propertyScan: { ...scan, complete: true } }), false); assert.equal(validateModelCaptureInputScope({ ...p.descriptor, propertyScan: { ...scan, returnedObjectCount: 11 } }), false);
});
test('protocol staged variants are exact, directional and bound to a loaded model', async () => {
  const p = await plan(request(257)); assert.ok(validateEnvelope(envelope('START_MODEL_CAPTURE', p.startPayload), 'parent-to-frame')); assert.equal(validateEnvelope(envelope('START_MODEL_CAPTURE', { ...p.startPayload, equipmentNames: [] }), 'parent-to-frame'), null);
  const { acks } = await ready(p); assert.ok(validateEnvelope(envelope('MODEL_CAPTURE_INPUT_ACK', acks.at(-1)), 'frame-to-parent')); assert.equal(validateEnvelope(envelope('MODEL_CAPTURE_INPUT_ACK', acks.at(-1)), 'parent-to-frame'), null); assert.equal(validateEnvelope({ ...envelope('MODEL_CAPTURE_INPUT_ACK', acks[0]), modelVersionId: null, loadId: null }, 'frame-to-parent'), null);
  assert.ok(validateEnvelope(envelope('READ_MODEL_CAPTURE', { captureId, index: 0 }), 'parent-to-frame'));
});
