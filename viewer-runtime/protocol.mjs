export const CHANNEL = 'wfc-routings-viewer';
export const PROTOCOL_VERSION = 1;
export const SDK_VERSION = '7.130.0';
export const MAX_MESSAGE_BYTES = 65536;
export const FRAME_PATH = '/viewer-runtime/7.130.0/index.html';
export const PARENT_TYPES = Object.freeze(['INIT', 'LOAD_MODEL', 'SHOW_ROUTE', 'CLEAR_ROUTE', 'ZOOM_ROUTE', 'CANCEL_REQUEST', 'DISPOSE']);
export const FRAME_TYPES = Object.freeze(['HELLO', 'RUNTIME_READY', 'MODEL_PROGRESS', 'MODEL_LOADED', 'ROUTE_RESULT', 'ROUTE_CLEARED', 'ROUTE_ZOOMED', 'REQUEST_CANCELLED', 'DISPOSED', 'WARNING', 'ERROR']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value);
const text = (value, maximum = 1024) => typeof value === 'string' && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
export const isUuid = value => typeof value === 'string' && UUID.test(value);
const nullableUuid = value => value === null || isUuid(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined);
const oneOf = (value, values) => values.includes(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const invalidRouting = () => { const error = new Error('The route contains invalid identifiers or exceeds the allowed size.'); error.code = 'ROUTE_INVALID'; throw error; };
export function normalizeRoutingKey(token) {
  if (typeof token !== 'string') invalidRouting();
  const key = token.normalize('NFKC').trim().replace(/^\/+|\/+$/g, '').toUpperCase();
  if (!key || /[\/\u0000-\u001f\u007f]/.test(key)) invalidRouting();
  return key;
}

export function parseRouting(rawRouting) {
  const invalid = invalidRouting;
  if (typeof rawRouting !== 'string' || rawRouting.length > 8000) invalid();
  const segments = [], ignored = [];
  let segmentIndex = 0;
  for (const part of rawRouting.split('/')) {
    const token = part.trim();
    if (!token) continue;
    const key = normalizeRoutingKey(token);
    if (key === 'SECONDARY') ignored.push({ segmentIndex, token, reason: 'SECONDARY' });
    else { segments.push({ segmentIndex, token, key }); if (segments.length > 100) invalid(); }
    segmentIndex++;
  }
  return { segments, ignored };
}

export function validateBootstrap(search) {
  if (typeof search !== 'string' || search.length > 200) return null;
  const params = new URLSearchParams(search);
  if ([...params].length !== 2 || params.getAll('instanceId').length !== 1 || params.getAll('projectId').length !== 1) return null;
  const instanceId = params.get('instanceId'), projectId = params.get('projectId');
  return isUuid(instanceId) && isUuid(projectId) ? { instanceId, projectId } : null;
}

export function validateDescriptor(value, identity) {
  if (!exact(value, ['projectId', 'modelVersionId', 'loadId', 'contentFingerprint', 'supportProfile', 'format', 'sdkVersion', 'entrypoint', 'resourceCount', 'totalBytes'])) return null;
  if (!isUuid(value.projectId) || !isUuid(value.modelVersionId) || !isUuid(value.loadId) ||
      value.projectId !== identity.projectId || value.modelVersionId !== identity.modelVersionId || value.loadId !== identity.loadId ||
      typeof value.contentFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentFingerprint) ||
      value.supportProfile !== 'svf-local-7.130.0-v1' || value.format !== 'svf' || value.sdkVersion !== SDK_VERSION ||
      value.entrypoint !== 'resources/output/0/0.svf' || !integer(value.resourceCount) || value.resourceCount < 1 || value.resourceCount > 100000 ||
      !integer(value.totalBytes) || value.totalBytes > 8589934592) return null;
  return { ...value };
}

function source(value) {
  return oneOf(value.source, ['manual', 'cable']) && (value.source === 'manual' ? value.cableId === null : isUuid(value.cableId));
}
function warning(value) {
  return exact(value, ['code', 'message', 'segmentIndex']) && code(value.code) && text(value.message) && (value.segmentIndex === null || integer(value.segmentIndex) && value.segmentIndex < 8000);
}
function routeResult(value) {
  if (!exact(value, ['rawRouting', 'source', 'cableId', 'segments', 'ignored', 'drawableCount', 'lineCount', 'warnings']) || !source(value)) return false;
  let parsed;
  try { parsed = parseRouting(value.rawRouting); } catch { return false; }
  if (!Array.isArray(value.segments) || value.segments.length !== parsed.segments.length || !Array.isArray(value.ignored) || value.ignored.length !== parsed.ignored.length ||
      !Array.isArray(value.warnings) || value.warnings.length > 100 || !value.warnings.every(warning) || !integer(value.drawableCount) || !integer(value.lineCount)) return false;
  if (!value.segments.every((entry, index) => {
    const expected = parsed.segments[index];
    if (!exact(entry, ['segmentIndex', 'token', 'key', 'model']) || entry.segmentIndex !== expected.segmentIndex || entry.token !== expected.token || entry.key !== expected.key ||
        !exact(entry.model, ['state', 'matchCount', 'drawable']) || !integer(entry.model.matchCount) || typeof entry.model.drawable !== 'boolean') return false;
    return entry.model.state === 'found' ? entry.model.matchCount === 1 : entry.model.state === 'missing' ? entry.model.matchCount === 0 && !entry.model.drawable : entry.model.state === 'ambiguous' && entry.model.matchCount > 1 && !entry.model.drawable;
  })) return false;
  if (!value.ignored.every((entry, index) => exact(entry, ['segmentIndex', 'token', 'reason']) && entry.segmentIndex === parsed.ignored[index].segmentIndex && entry.token === parsed.ignored[index].token && entry.reason === 'SECONDARY')) return false;
  return value.drawableCount === value.segments.filter(entry => entry.model.drawable).length && (value.drawableCount > 0 || value.lineCount === 0);
}

function payload(type, value) {
  switch (type) {
    case 'HELLO': return exact(value, ['supportedProtocolVersions', 'sdkVersion']) && Array.isArray(value.supportedProtocolVersions) && same(value.supportedProtocolVersions, [1]) && value.sdkVersion === SDK_VERSION;
    case 'INIT': return exact(value, ['locale', 'expectedSdkVersion']) && oneOf(value.locale, ['en', 'bg']) && value.expectedSdkVersion === SDK_VERSION;
    case 'RUNTIME_READY': return exact(value, ['sdkVersion']) && value.sdkVersion === SDK_VERSION;
    case 'LOAD_MODEL': return exact(value, ['sessionId']) && isUuid(value.sessionId);
    case 'SHOW_ROUTE': return exact(value, ['rawRouting', 'source', 'cableId']) && typeof value.rawRouting === 'string' && value.rawRouting.length <= 8000 && source(value);
    case 'CLEAR_ROUTE': return exact(value, ['reason']) && oneOf(value.reason, ['user', 'empty', 'selection', 'model-change', 'logout']);
    case 'ZOOM_ROUTE': case 'ROUTE_ZOOMED': return exact(value, ['routeRequestId']) && isUuid(value.routeRequestId);
    case 'CANCEL_REQUEST': return exact(value, ['targetRequestId']) && isUuid(value.targetRequestId);
    case 'REQUEST_CANCELLED': return exact(value, ['targetRequestId', 'outcome']) && isUuid(value.targetRequestId) && oneOf(value.outcome, ['cancelled', 'already-finished', 'unknown']);
    case 'DISPOSE': return exact(value, ['reason']) && oneOf(value.reason, ['unmount', 'project-change', 'logout', 'reload']);
    case 'DISPOSED': case 'ROUTE_CLEARED': return exact(value, []);
    case 'MODEL_PROGRESS': return exact(value, ['phase', 'loaded', 'total']) && oneOf(value.phase, ['runtime', 'resources', 'model', 'index']) && Number.isFinite(value.loaded) && value.loaded >= 0 && (value.total === null || Number.isFinite(value.total) && value.total >= value.loaded);
    case 'MODEL_LOADED': return exact(value, ['sdkVersion', 'format', 'nodeIndexReady']) && value.sdkVersion === SDK_VERSION && value.format === 'svf' && value.nodeIndexReady === true;
    case 'ROUTE_RESULT': return routeResult(value);
    case 'WARNING': return warning(value);
    case 'ERROR': return exact(value, ['code', 'message', 'retryable', 'operation']) && code(value.code) && text(value.message) && typeof value.retryable === 'boolean' && typeof value.operation === 'string' && /^[A-Z_]{1,64}$/.test(value.operation);
    default: return false;
  }
}

export function validateEnvelope(value, direction) {
  try {
    if (direction !== undefined && !oneOf(direction, ['parent-to-frame', 'frame-to-parent'])) return null;
    if (!exact(value, ['channel', 'protocolVersion', 'instanceId', 'projectId', 'modelVersionId', 'loadId', 'requestId', 'type', 'payload']) ||
        value.channel !== CHANNEL || value.protocolVersion !== PROTOCOL_VERSION || !isUuid(value.instanceId) || !isUuid(value.projectId) || !isUuid(value.requestId) ||
        !nullableUuid(value.modelVersionId) || !nullableUuid(value.loadId) || (value.modelVersionId === null) !== (value.loadId === null)) return null;
    const allowed = direction === 'parent-to-frame' ? PARENT_TYPES : direction === 'frame-to-parent' ? FRAME_TYPES : [...PARENT_TYPES, ...FRAME_TYPES];
    if (!allowed.includes(value.type) || !payload(value.type, value.payload)) return null;
    const handshake = ['HELLO', 'INIT', 'RUNTIME_READY'].includes(value.type);
    if (handshake ? value.modelVersionId !== null : ['LOAD_MODEL', 'MODEL_PROGRESS', 'MODEL_LOADED', 'SHOW_ROUTE', 'ROUTE_RESULT', 'ZOOM_ROUTE', 'ROUTE_ZOOMED'].includes(value.type) && value.modelVersionId === null) return null;
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).byteLength > MAX_MESSAGE_BYTES) return null;
    return JSON.parse(serialized);
  } catch { return null; }
}
