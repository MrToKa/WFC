import { digestSha256 } from './sha256.mjs';
// Shared pure input contract. No SDK globals or asynchronous work during import.
import { validatePreparationSlice } from './preparation-input.mjs';
export const CAPTURE_INPUT_LIMITS = Object.freeze({ names: 4096, namesPerChunk: 256, chunks: 16, bytes: 1024 ** 2, messageBytes: 65536, responses: 3000, milliseconds: 300000 });
const encoder = new TextEncoder(), UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const integer = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const record = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, fields) => record(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k) && Object.getOwnPropertyDescriptor(v, k)?.get === undefined);
const name = v => typeof v === 'string' && v.length <= 256 && v.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const categories = (v, empty = false) => Array.isArray(v) && (empty || v.length > 0) && v.length <= 3 && v.every(x => ['MV', 'LV', 'Control'].includes(x)) && new Set(v).size === v.length;
const refuse = () => { throw new Error('Invalid, incomplete or over-budget model capture input.'); };
const requireThat = v => { if (!v) refuse(); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const active = (signal, current = () => true, startedAt = Date.now()) => { if (signal?.aborted || !current()) throw new DOMException('Model capture cancelled.', 'AbortError'); if (Date.now() - startedAt > CAPTURE_INPUT_LIMITS.milliseconds) refuse(); };
const serialize = value => JSON.stringify(value);
const bytes = value => encoder.encode(serialize(value));

function routeScope(request) {
  if (request?.preparationSlice !== undefined) {
    requireThat(request.routeCodes === undefined && request.routeRules === undefined && request.allowedCategories === undefined && request.lookupRouteCodes === undefined && validatePreparationSlice(request.preparationSlice));
    return { preparationSlice: JSON.parse(JSON.stringify(request.preparationSlice)) };
  }
  if (request?.routeRules !== undefined) {
    requireThat(request.routeCodes === undefined && request.allowedCategories === undefined && request.lookupRouteCodes === undefined && Array.isArray(request.routeRules) && request.routeRules.length > 0 && request.routeRules.length <= 100);
    requireThat(request.routeRules.every(rule => exact(rule, ['id', 'objectIds', 'allowedCategories']) && UUID.test(rule.id ?? '') && Array.isArray(rule.objectIds) && rule.objectIds.length > 0 && rule.objectIds.length <= 512 && rule.objectIds.every(id => integer(id, 2147483647) && id > 0) && new Set(rule.objectIds).size === rule.objectIds.length && categories(rule.allowedCategories, true)));
    requireThat(new Set(request.routeRules.map(rule => rule.id)).size === request.routeRules.length && request.routeRules.reduce((n, rule) => n + rule.objectIds.length, 0) <= 512);
    return { routeRules: request.routeRules.map(rule => ({ id: rule.id, objectIds: [...rule.objectIds], allowedCategories: [...rule.allowedCategories] })) };
  }
  requireThat(request?.routeRules === undefined && request?.lookupRouteCodes === undefined && Array.isArray(request?.routeCodes) && request.routeCodes.length > 0 && request.routeCodes.length <= 100 && categories(request.allowedCategories));
  requireThat(request.routeCodes.every(code => typeof code === 'string' && code.length <= 256 && /^[A-Z0-9][A-Z0-9_.-]*$/i.test(code.replace(/^\/+|\/+$/g, '').trim()) && code.normalize('NFC').trim().replace(/^\/+|\/+$/g, '').toUpperCase() !== 'SECONDARY'));
  return { routeCodes: [...new Set(request.routeCodes.map(code => code.normalize('NFC').trim().toUpperCase().replace(/^\/+|\/+$/g, '')))], allowedCategories: [...request.allowedCategories] };
}
export function normalizeModelCapturePlanningInput(request) {
  requireThat(record(request)); const scope = routeScope(request);
  requireThat(Array.isArray(request.equipmentNames) && request.equipmentNames.length <= CAPTURE_INPUT_LIMITS.names && request.equipmentNames.every(name));
  return freeze({ ...scope, equipmentNames: [...new Set(request.equipmentNames.map(value => value.normalize('NFC').trim()))] });
}
export function modelCaptureScopeBytes(request) {
  const input = normalizeModelCapturePlanningInput(request);
  return bytes({ schemaVersion: 'wfc.capture.input.v1', routeScope: routeScope(input), equipmentNames: input.equipmentNames });
}
export function validateModelCaptureInputDescriptor(value) {
  return exact(value, ['schemaVersion', 'equipmentNameCount', 'chunkCount', 'inputUtf8Bytes', 'scopeSha256', 'equipmentNamesSha256']) && value.schemaVersion === 'wfc.capture.input.v1' && integer(value.equipmentNameCount, CAPTURE_INPUT_LIMITS.names) && integer(value.chunkCount, CAPTURE_INPUT_LIMITS.chunks) && (value.equipmentNameCount === 0 ? value.chunkCount === 0 : value.chunkCount > 0 && value.chunkCount <= value.equipmentNameCount && value.equipmentNameCount <= value.chunkCount * CAPTURE_INPUT_LIMITS.namesPerChunk) && integer(value.inputUtf8Bytes, CAPTURE_INPUT_LIMITS.bytes) && value.inputUtf8Bytes > 0 && HASH.test(value.scopeSha256 ?? '') && HASH.test(value.equipmentNamesSha256 ?? '');
}
export function validateModelCaptureInputScope(value, { allowPending = false } = {}) {
  if (!record(value) || !Object.hasOwn(value, 'propertyScan')) return false;
  const { propertyScan, ...descriptor } = value;
  if (!validateModelCaptureInputDescriptor(descriptor)) return false;
  if (propertyScan === null) return allowPending;
  return exact(propertyScan, ['indexedObjectCount', 'attemptedObjectCount', 'returnedObjectCount', 'omittedObjectCount', 'complete']) && ['indexedObjectCount', 'attemptedObjectCount', 'returnedObjectCount', 'omittedObjectCount'].every(k => integer(propertyScan[k], 1000000)) && propertyScan.indexedObjectCount > 0 && propertyScan.returnedObjectCount <= propertyScan.attemptedObjectCount && propertyScan.attemptedObjectCount <= propertyScan.indexedObjectCount && propertyScan.omittedObjectCount === propertyScan.attemptedObjectCount - propertyScan.returnedObjectCount && propertyScan.complete === (value.equipmentNameCount > 0 && propertyScan.attemptedObjectCount === propertyScan.indexedObjectCount && propertyScan.omittedObjectCount === 0);
}
export function isStagedModelCaptureStart(value) {
  try { if (!UUID.test(value?.captureId ?? '') || !validateModelCaptureInputDescriptor(value.input)) return false; const fields = value.preparationSlice !== undefined ? ['captureId', 'preparationSlice', 'input'] : value.routeRules !== undefined ? ['captureId', 'routeRules', 'input'] : ['captureId', 'routeCodes', 'allowedCategories', 'input']; if (!exact(value, fields)) return false; routeScope(value); return true; } catch { return false; }
}
export function isModelCaptureInputAppend(value) {
  return exact(value, ['captureId', 'equipmentOffset', 'equipmentNames']) && UUID.test(value.captureId ?? '') && integer(value.equipmentOffset, CAPTURE_INPUT_LIMITS.names) && Array.isArray(value.equipmentNames) && value.equipmentNames.length > 0 && value.equipmentNames.length <= CAPTURE_INPUT_LIMITS.namesPerChunk && value.equipmentNames.every(name);
}
export function validateModelCaptureInputAck(value) {
  return exact(value, ['captureId', 'phase', 'receivedNameCount', 'scopeSha256', 'equipmentNamesSha256']) && UUID.test(value.captureId ?? '') && integer(value.receivedNameCount, CAPTURE_INPUT_LIMITS.names) && (value.phase === 'receiving' ? value.scopeSha256 === null && value.equipmentNamesSha256 === null : value.phase === 'ready' && HASH.test(value.scopeSha256 ?? '') && HASH.test(value.equipmentNamesSha256 ?? ''));
}
const digest = async (data, signal, current, startedAt) => { active(signal, current, startedAt); const result = Array.from(new Uint8Array(await digestSha256(data))).map(v => v.toString(16).padStart(2, '0')).join(''); active(signal, current, startedAt); return result; };

export async function planModelCaptureInput(request, { captureId, envelopeIdentity, signal } = {}) {
  const input = normalizeModelCapturePlanningInput(request), startedAt = Date.now(); // Detach before the first await.
  requireThat(UUID.test(captureId ?? '') && exact(envelopeIdentity, ['instanceId', 'projectId', 'modelVersionId', 'loadId']) && Object.values(envelopeIdentity).every(v => UUID.test(v ?? '')));
  const scopeBytes = modelCaptureScopeBytes(input); requireThat(scopeBytes.length <= CAPTURE_INPUT_LIMITS.bytes);
  const scopeSha256 = await digest(scopeBytes, signal, undefined, startedAt), equipmentNamesSha256 = await digest(bytes(input.equipmentNames), signal, undefined, startedAt);
  const chunks = [];
  for (let offset = 0; offset < input.equipmentNames.length;) {
    active(signal, undefined, startedAt); let length = Math.min(CAPTURE_INPUT_LIMITS.namesPerChunk, input.equipmentNames.length - offset), payload;
    for (;;) {
      payload = { captureId, equipmentOffset: offset, equipmentNames: input.equipmentNames.slice(offset, offset + length) };
      const envelope = { channel: 'wfc-routings-viewer', protocolVersion: 1, ...envelopeIdentity, requestId: captureId, type: 'READ_MODEL_CAPTURE', payload };
      if (bytes(envelope).length <= CAPTURE_INPUT_LIMITS.messageBytes) break;
      length = Math.floor(length / 2); requireThat(length > 0);
    }
    chunks.push(payload); requireThat(chunks.length <= CAPTURE_INPUT_LIMITS.chunks); offset += length;
  }
  const descriptor = { schemaVersion: 'wfc.capture.input.v1', equipmentNameCount: input.equipmentNames.length, chunkCount: chunks.length, inputUtf8Bytes: scopeBytes.length, scopeSha256, equipmentNamesSha256 };
  const startPayload = { captureId, ...routeScope(input), input: descriptor };
  requireThat(bytes({ channel:'wfc-routings-viewer', protocolVersion:1, ...envelopeIdentity, requestId:captureId, type:'START_MODEL_CAPTURE', payload:startPayload }).length <= CAPTURE_INPUT_LIMITS.messageBytes);
  return freeze({ request: input, descriptor, chunks, startPayload });
}

/** One private staged request; no SDK scan starts before all input is verified. */
export function createModelCaptureInputStage(start, { signal, isCurrent = () => true, startedAt = Date.now() } = {}) {
  requireThat(isStagedModelCaptureStart(start));
  const detached = JSON.parse(serialize(start)), names = [], seen = new Set(); let receivedChunks = 0, ready = false, reading = false, failed = false;
  const check = () => { active(signal, isCurrent, startedAt); requireThat(!failed); };
  const ack = () => ({ captureId: detached.captureId, phase: ready ? 'ready' : 'receiving', receivedNameCount: names.length, scopeSha256: ready ? detached.input.scopeSha256 : null, equipmentNamesSha256: ready ? detached.input.equipmentNamesSha256 : null });
  const verify = async () => {
    check(); const request = normalizeModelCapturePlanningInput({ ...routeScope(detached), equipmentNames: names }), raw = modelCaptureScopeBytes(request);
    requireThat(raw.length === detached.input.inputUtf8Bytes && raw.length <= CAPTURE_INPUT_LIMITS.bytes && request.equipmentNames.length === names.length);
    const full = await digest(raw, signal, isCurrent, startedAt), equipment = await digest(bytes(names), signal, isCurrent, startedAt); check();
    requireThat(full === detached.input.scopeSha256 && equipment === detached.input.equipmentNamesSha256); ready = true;
  };
  return {
    async initialAck() { check(); if (!detached.input.equipmentNameCount) await verify(); check(); return ack(); },
    async append(value) {
      check(); requireThat(!reading && !ready && isModelCaptureInputAppend(value) && value.captureId === detached.captureId && value.equipmentOffset === names.length); reading = true;
      try {
        for (const entry of value.equipmentNames) { requireThat(entry === entry.normalize('NFC').trim() && !seen.has(entry)); seen.add(entry); names.push(entry); }
        receivedChunks++; requireThat(names.length <= detached.input.equipmentNameCount && receivedChunks <= detached.input.chunkCount && modelCaptureScopeBytes({ ...routeScope(detached), equipmentNames: names }).length <= CAPTURE_INPUT_LIMITS.bytes);
        if (names.length === detached.input.equipmentNameCount) { requireThat(receivedChunks === detached.input.chunkCount); await verify(); } else requireThat(receivedChunks < detached.input.chunkCount);
        check(); return ack();
      } catch (error) { failed = true; throw error; } finally { reading = false; }
    },
    request() { check(); requireThat(ready && !reading); return freeze({ captureId: detached.captureId, ...routeScope(detached), equipmentNames: [...names], inputScope: { ...detached.input } }); },
    get ready() { return ready && !failed; },
    get remainingResponses() { return CAPTURE_INPUT_LIMITS.responses - 1 - detached.input.chunkCount; },
    get startedAt() { return startedAt; },
  };
}
