// Protected transport metadata only. Importing this module performs no IO/SDK access.
import { BARRIER_MULTIPART_PLANNER_PROFILE as P, barrierRangePlannedBytes } from './barrier-plan.mjs';
import { validateBarrierFrameObservation } from './barrier-capture.mjs';

export const BARRIER_MULTIPART_PRODUCER_PROFILE = Object.freeze({
  schemaVersion: 'wfc.pf.barrier-multipart-producer.v2', sdkVersion: '7.130.0',
  triangleOrder: 'sdk7130-rendered-triangle-order-v1', geometryDigest: 'sha256-bounded-chunk-chain-v1',
  visibility: 'selected-scope-includes-hidden-geometry-v1',
});
export const BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE = 'sdk7130-after-final-part-ack-hierarchy-frame-v1';
export const BARRIER_MULTIPART_TRANSPORT_LIMITS = Object.freeze({ controlBytes: 65536, pageBytes: 262144,
  commandBytes: 327680, responseBytes: 262144, partBytes: 33554432, partHeaderBytes: 4096,
  requestMilliseconds: 180000, jobMilliseconds: 3600000, pendingCommands: 2 });
const L = BARRIER_MULTIPART_TRANSPORT_LIMITS, E = new TextEncoder();
const own = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, keys) => own(v) && Reflect.ownKeys(v).length === keys.length && keys.every(k => {
  const d = Object.getOwnPropertyDescriptor(v, k); return d?.enumerable === true && 'value' in d;
});
const array = (v, max) => Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype && v.length <= max
  && Reflect.ownKeys(v).length === v.length + 1 && Array.from({ length: v.length }, (_, i) => Object.getOwnPropertyDescriptor(v, String(i))).every(d => d && 'value' in d);
const uint = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0) && v <= max;
const pos = (v, max) => uint(v, max) && v > 0;
const uuid = v => typeof v === 'string' && v.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(v);
const hash = v => typeof v === 'string' && v.length === 64 && /^[a-f0-9]{64}$/u.test(v);
const revision = v => typeof v === 'string' && /^(?:0|[1-9][0-9]{0,18})$(?![\s\S])/u.test(v) && BigInt(v) <= 9223372036854775807n;
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(v)
  && [...v].every(c => c.length !== 1 || c.charCodeAt(0) < 0xd800 || c.charCodeAt(0) > 0xdfff);
const date = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$(?![\s\S])/u.test(v) && Number.isFinite(Date.parse(v));
const kinds = ['nodes', 'fragments', 'geometry-ranges', 'plan'];
const mask = v => typeof v === 'string' && v.length === 32 && /^[a-f0-9]{32}$/u.test(v) && BigInt('0x' + v) > 0n;
const noAuthority = v => v.qualification === 'NOT_MEASURED' && v.geometryValidation === 'NOT_VALIDATED' && v.authority === 'none';
const same = (a, b) => barrierMultipartTransportCanonical(a) === barrierMultipartTransportCanonical(b);
const safe = fn => value => { try { return fn(value) === true; } catch { return false; } };

/** Bounds are enforced while serializing, before a complete JSON string exists.
 * This is control metadata, never a geometry coordinate codec. */
export function barrierMultipartTransportCanonical(value, maximum = L.commandBytes) {
  if (!pos(maximum, L.commandBytes)) throw Error('BARRIER_MULTIPART_TRANSPORT_BYTES');
  const chunks = [], active = new Set(); let size = 0;
  const add = s => { size += E.encode(s).byteLength; if (size > maximum) throw Error('BARRIER_MULTIPART_TRANSPORT_BYTES'); chunks.push(s); };
  function visit(v, depth) {
    if (depth > 32) throw Error('BARRIER_MULTIPART_TRANSPORT_JSON');
    if (v === null || typeof v === 'boolean') return add(JSON.stringify(v));
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw Error('BARRIER_MULTIPART_TRANSPORT_JSON'); return add(JSON.stringify(v)); }
    if (typeof v === 'string') { if (v.length > 2048 || [...v].some(c => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff)) throw Error('BARRIER_MULTIPART_TRANSPORT_JSON'); return add(JSON.stringify(v)); }
    if ((!own(v) && !array(v, 8192)) || active.has(v) || Object.getOwnPropertySymbols(v).length) throw Error('BARRIER_MULTIPART_TRANSPORT_JSON');
    active.add(v);
    if (Array.isArray(v)) { add('['); for (let i = 0; i < v.length; i++) { if (i) add(','); visit(Object.getOwnPropertyDescriptor(v, String(i)).value, depth + 1); } add(']'); }
    else { const keys = Object.keys(v).sort(); if (keys.length > 64) throw Error('BARRIER_MULTIPART_TRANSPORT_JSON'); add('{');
      for (let i = 0; i < keys.length; i++) { const k = keys[i], d = Object.getOwnPropertyDescriptor(v, k); if (!d || !('value' in d) || k.length > 96) throw Error('BARRIER_MULTIPART_TRANSPORT_JSON'); if (i) add(','); add(JSON.stringify(k)); add(':'); visit(d.value, depth + 1); } add('}'); }
    active.delete(v);
  }
  visit(value, 0); return chunks.join('');
}
const bounded = (v, max) => { barrierMultipartTransportCanonical(v, max); return true; };
export const validateBarrierMultipartProducerProfile = safe(v => exact(v, Object.keys(BARRIER_MULTIPART_PRODUCER_PROFILE)) && same(v, BARRIER_MULTIPART_PRODUCER_PROFILE));
export const validateBarrierMultipartScope = safe(v => {
  if (!exact(v, ['schemaVersion', 'modelScope', 'modelLoadId', 'selectedParents', 'geometryPolicy']) || v.schemaVersion !== 'wfc.pf.barrier-multipart-scope.v2'
    || v.geometryPolicy !== P.geometryPolicy || !uuid(v.modelLoadId) || !array(v.selectedParents, 128) || !v.selectedParents.length) return false;
  const m = v.modelScope;
  if (!exact(m, ['projectId', 'modelVersionId', 'contentFingerprint', 'selectionRevision', 'captureFrameId', 'captureFrameSha256', 'coordinateFrame'])
    || !uuid(m.projectId) || !uuid(m.modelVersionId) || !hash(m.contentFingerprint) || !revision(m.selectionRevision) || !uuid(m.captureFrameId)
    || !hash(m.captureFrameSha256) || m.coordinateFrame !== 'canonical-world-metres') return false;
  const ids = new Set(); let last = -1;
  return v.selectedParents.every(p => { if (!exact(p, ['selectionId', 'dbId', 'kind']) || !uuid(p.selectionId) || ids.has(p.selectionId)
    || !uint(p.dbId, 2147483647) || p.dbId <= last || !['wall', 'partition', 'floor', 'ceiling', 'obstacle'].includes(p.kind)) return false;
  ids.add(p.selectionId); last = p.dbId; return true; });
});
export const validateBarrierMultipartAdmitCommand = safe(v => exact(v, ['schemaVersion', 'idempotencyKey', 'scope', 'profile', 'expectedRegistryRevision', 'selectedParentLabels', 'reservation'])
  && v.schemaVersion === 'wfc.pf.barrier-multipart-admit.v2' && uuid(v.idempotencyKey) && validateBarrierMultipartScope(v.scope) && same(v.profile, P)
  && revision(v.expectedRegistryRevision) && array(v.selectedParentLabels, 128) && v.selectedParentLabels.length === v.scope.selectedParents.length
  && v.selectedParentLabels.every((p, i) => exact(p, ['selectionId', 'name']) && p.selectionId === v.scope.selectedParents[i].selectionId && text(p.name, 512))
  && exact(v.reservation, ['bytes', 'files']) && pos(v.reservation.bytes, 8589934592) && pos(v.reservation.files, 50000) && bounded(v, L.controlBytes));

export const validateBarrierMultipartPage = safe(v => {
  if (!exact(v, ['schemaVersion', 'kind', 'scopeSha256', 'profileSha256', 'index', 'firstOrdinal', 'previousPageSha256', 'records', 'pageSha256'])
    || v.schemaVersion !== 'wfc.pf.barrier-multipart-page.v2' || !kinds.includes(v.kind) || !hash(v.scopeSha256) || !hash(v.profileSha256)
    || !uint(v.index, P.limits.pages - 1) || !uint(v.firstOrdinal, P.limits.ranges - 1) || !hash(v.pageSha256) || !array(v.records, 512) || !v.records.length
    || (v.index === 0 ? v.firstOrdinal !== 0 || v.previousPageSha256 !== null : v.firstOrdinal === 0 || !hash(v.previousPageSha256))) return false;
  return v.records.every(r => {
    if (v.kind === 'nodes') return exact(r, ['dbId', 'membershipMask']) && uint(r.dbId, 2147483647) && mask(r.membershipMask);
    if (v.kind === 'fragments') return exact(r, ['fragmentId', 'ownerNodeOrdinal', 'ownerDbId', 'membershipMask', 'primitive', 'sourceGeometrySha256', 'transformSha256', 'sourceVertexCount', 'sourceTriangleCount'])
      && uint(r.fragmentId, 2147483647) && uint(r.ownerNodeOrdinal, P.limits.nodes - 1) && uint(r.ownerDbId, 2147483647) && mask(r.membershipMask)
      && ['triangles', 'lines', 'points', 'unknown', 'unavailable'].includes(r.primitive) && (r.sourceGeometrySha256 === null || hash(r.sourceGeometrySha256))
      && (r.transformSha256 === null || hash(r.transformSha256)) && uint(r.sourceVertexCount, P.limits.sourceCount) && uint(r.sourceTriangleCount, P.limits.sourceCount)
      && (r.primitive !== 'triangles' || hash(r.sourceGeometrySha256) && hash(r.transformSha256) && r.sourceVertexCount >= 3 && r.sourceTriangleCount > 0)
      && (!['lines', 'points'].includes(r.primitive) || r.sourceTriangleCount === 0);
    if (v.kind === 'geometry-ranges') return exact(r, ['fragmentOrdinal', 'triangleStart', 'triangleCount', 'referencedVertexCount', 'sourceVertexIdsSha256', 'sourceIndicesSha256', 'sourceGeometrySha256', 'transformSha256', 'membershipMask'])
      && uint(r.fragmentOrdinal, P.limits.fragments - 1) && uint(r.triangleStart, P.limits.sourceCount) && pos(r.triangleCount, P.limits.sourceCount)
      && r.triangleStart + r.triangleCount <= P.limits.sourceCount && pos(r.referencedVertexCount, P.limits.sourceCount) && r.referencedVertexCount >= 3 && r.referencedVertexCount <= 3 * r.triangleCount
      && [r.sourceVertexIdsSha256, r.sourceIndicesSha256, r.sourceGeometrySha256, r.transformSha256].every(hash) && mask(r.membershipMask);
    return exact(r, ['partIndex', 'rangeOrdinal', 'fragmentOrdinal', 'triangleStart', 'triangleCount', 'referencedVertexCount', 'rangeSha256', 'plannedEncodedBytesUpperBound'])
      && uint(r.partIndex, P.limits.parts - 1) && uint(r.rangeOrdinal, P.limits.ranges - 1) && uint(r.fragmentOrdinal, P.limits.fragments - 1)
      && uint(r.triangleStart, P.limits.sourceCount) && pos(r.triangleCount, P.part.triangles) && r.triangleStart + r.triangleCount <= P.limits.sourceCount
      && pos(r.referencedVertexCount, P.part.vertices) && r.referencedVertexCount >= 3 && r.referencedVertexCount <= 3 * r.triangleCount && hash(r.rangeSha256)
      && r.plannedEncodedBytesUpperBound === barrierRangePlannedBytes(r.referencedVertexCount, r.triangleCount) && r.plannedEncodedBytesUpperBound + P.byteEnvelope.partHeader <= P.part.bytes;
  }) && bounded(v, L.pageBytes);
});
export const validateBarrierMultipartSeal = safe(v => {
  if (!own(v) || !Object.getOwnPropertyDescriptor(v, 'kind') || !('value' in Object.getOwnPropertyDescriptor(v, 'kind'))) return false;
  const plan = v.kind === 'plan';
  if (!exact(v, ['schemaVersion', 'kind', 'scopeSha256', 'profileSha256', 'pageCount', 'recordCount', 'tailPageSha256', 'totals', 'sealSha256', ...(plan ? ['qualification', 'authority'] : [])])
    || v.schemaVersion !== 'wfc.pf.barrier-multipart-seal.v2' || !kinds.includes(v.kind) || !hash(v.scopeSha256) || !hash(v.profileSha256) || !hash(v.tailPageSha256) || !hash(v.sealSha256)
    || !pos(v.pageCount, P.limits.pages) || !pos(v.recordCount, P.limits.ranges) || v.pageCount > v.recordCount || v.recordCount > v.pageCount * 512) return false;
  const fields = { nodes: ['nodes'], fragments: ['fragments', 'sourceVertices', 'sourceTriangles', 'unavailable', 'nonTriangle'], 'geometry-ranges': ['ranges', 'referencedVertices', 'triangles'],
    plan: ['parts', 'ranges', 'referencedVertices', 'triangles', 'plannedEncodedBytesUpperBound', 'nodeSealSha256', 'fragmentSealSha256', 'rangeSealSha256'] }[v.kind];
  if (!exact(v.totals, fields) || !fields.every(k => k.endsWith('Sha256') ? hash(v.totals[k]) : uint(v.totals[k]))) return false;
  const t = v.totals;
  if (v.kind === 'nodes') return t.nodes === v.recordCount && pos(t.nodes, P.limits.nodes);
  if (v.kind === 'fragments') return t.fragments === v.recordCount && pos(t.fragments, P.limits.fragments) && t.unavailable + t.nonTriangle <= t.fragments;
  if (!pos(t.referencedVertices) || !pos(t.triangles) || t.ranges !== v.recordCount) return false;
  return !plan || v.qualification === 'NOT_MEASURED' && v.authority === 'none' && pos(t.parts, P.limits.parts) && t.parts <= t.ranges && pos(t.plannedEncodedBytesUpperBound);
});
export const validateBarrierMultipartSession = safe(v => {
  if (!exact(v, ['schemaVersion', 'id', 'projectId', 'state', 'sessionRevision', 'principal', 'command', 'requestSha256', 'scopeSha256', 'profileSha256', 'createdAt', 'updatedAt', 'jobDeadline', 'leaseDeadline', 'reservation', 'counts', 'roots', 'qualification', 'geometryValidation', 'authority'])
    || v.schemaVersion !== 'wfc.pf.barrier-multipart-session.v2' || !uuid(v.id) || !uuid(v.projectId) || !['admitted', 'staging', 'cancelled'].includes(v.state) || !revision(v.sessionRevision)
    || !exact(v.principal, ['kind', 'actorId', 'loginId']) || v.principal.kind !== 'current-login-admin' || !uuid(v.principal.actorId) || !uuid(v.principal.loginId)
    || !validateBarrierMultipartAdmitCommand(v.command) || ![v.requestSha256, v.scopeSha256, v.profileSha256].every(hash) || !noAuthority(v)
    || ![v.createdAt, v.updatedAt, v.jobDeadline].every(date) || v.leaseDeadline !== null && !date(v.leaseDeadline) || v.projectId !== v.command.scope.modelScope.projectId) return false;
  const created = Date.parse(v.createdAt), deadline = Date.parse(v.jobDeadline), r = v.reservation, c = v.counts;
  return deadline > created && deadline - created <= L.jobMilliseconds && Date.parse(v.updatedAt) >= created
    && (v.leaseDeadline === null || Date.parse(v.leaseDeadline) > created && Date.parse(v.leaseDeadline) <= deadline)
    && exact(r, ['bytes', 'files', 'chargedBytes', 'chargedFiles']) && r.bytes === v.command.reservation.bytes && r.files === v.command.reservation.files
    && uint(r.chargedBytes, r.bytes) && uint(r.chargedFiles, r.files) && exact(c, ['pages', 'seals', 'parts']) && uint(c.pages, 50000) && uint(c.seals, 4) && uint(c.parts, 50000)
    && 2 * (c.pages + c.seals + c.parts) <= r.chargedFiles && exact(v.roots, kinds) && Object.values(v.roots).every(x => x === null || hash(x))
    && Object.values(v.roots).filter(x => x !== null).length === c.seals && bounded(v, L.responseBytes);
});
export const validateBarrierMultipartContext = safe(v => {
  if (!exact(v, ['schemaVersion', 'session', 'context']) || v.schemaVersion !== 'wfc.pf.barrier-multipart-context.v2' || !validateBarrierMultipartSession(v.session)) return false;
  const c = v.context, s = v.session;
  return exact(c, ['viewerSessionId', 'frameObservation', 'producerProfile', 'contextSha256', 'effectiveDeadline']) && uuid(c.viewerSessionId)
    && validateBarrierFrameObservation(c.frameObservation) && validateBarrierMultipartProducerProfile(c.producerProfile) && hash(c.contextSha256) && date(c.effectiveDeadline)
    && Date.parse(c.effectiveDeadline) > Date.parse(s.createdAt) && Date.parse(c.effectiveDeadline) <= Date.parse(s.jobDeadline)
    && c.frameObservation.loadId === s.command.scope.modelLoadId && c.frameObservation.projectId === s.projectId
    && c.frameObservation.modelVersionId === s.command.scope.modelScope.modelVersionId && c.frameObservation.contentFingerprint === s.command.scope.modelScope.contentFingerprint
    && bounded(v, L.responseBytes);
});
export function barrierMultipartContextHashInput(v) {
  const { viewerSessionId, frameObservation, producerProfile, effectiveDeadline } = v.context;
  return { domain: 'wfc.pf.barrier-multipart-context.v2', value: { intentId: v.session.id, scopeSha256: v.session.scopeSha256,
    profileSha256: v.session.profileSha256, viewerSessionId, frameObservation, producerProfile, effectiveDeadline } };
}
export const validateBarrierMultipartStart = safe(v => exact(v, ['intentId', 'expectedSessionRevision', 'scopeSha256', 'profileSha256', 'producerProfile'])
  && uuid(v.intentId) && revision(v.expectedSessionRevision) && hash(v.scopeSha256) && hash(v.profileSha256) && validateBarrierMultipartProducerProfile(v.producerProfile));
export const validateBarrierMultipartIntentControl = safe(v => exact(v, ['intentId']) && uuid(v.intentId));
export const validateBarrierMultipartStatus = safe(v => exact(v, ['intentId', 'sessionRevision', 'state', 'counts', 'roots', 'qualification', 'geometryValidation', 'authority'])
  && uuid(v.intentId) && revision(v.sessionRevision) && ['admitted', 'staging', 'cancelled'].includes(v.state) && noAuthority(v)
  && exact(v.counts, ['pages', 'seals', 'parts']) && uint(v.counts.pages, 50000) && uint(v.counts.seals, 4) && uint(v.counts.parts, 50000)
  && exact(v.roots, kinds) && Object.values(v.roots).every(x => x === null || hash(x)) && Object.values(v.roots).filter(x => x !== null).length === v.counts.seals);
export const validateBarrierMultipartFramePayload = safe(v => exact(v, ['frameObservation', 'producerProfile'])
  && validateBarrierFrameObservation(v.frameObservation) && validateBarrierMultipartProducerProfile(v.producerProfile) && bounded(v, L.controlBytes));
export const validateBarrierMultipartFrameRequest = safe(v => exact(v, ['projectId', 'modelVersionId', 'contentFingerprint'])
  && uuid(v.projectId) && uuid(v.modelVersionId) && hash(v.contentFingerprint));

const completeRoots = v => exact(v, kinds) && kinds.every(k => hash(v[k]));
const evidenceKeys = ['contextSha256', 'frameSha256', 'roots', 'partCount', 'bookendProfile'];
const evidence = v => [v.contextSha256, v.frameSha256].every(hash) && completeRoots(v.roots)
  && pos(v.partCount, P.limits.parts) && v.bookendProfile === BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE;
const chainContextKeys = ['intentId', 'contextSha256', 'scopeSha256', 'profileSha256', 'frameSha256', 'roots'];
const chainContext = v => exact(v, chainContextKeys) && uuid(v.intentId)
  && ['contextSha256', 'scopeSha256', 'profileSha256', 'frameSha256'].every(k => hash(v[k])) && completeRoots(v.roots);
export const validateBarrierMultipartProducerCompletionEvidence = safe(v => exact(v, evidenceKeys) && evidence(v) && bounded(v, L.controlBytes));
export const validateBarrierMultipartCompleteProducerCommand = safe(v => exact(v, ['schemaVersion', 'intentId', 'expectedSessionRevision', 'idempotencyKey', 'scopeSha256', 'profileSha256', ...evidenceKeys, 'partsSha256'])
  && v.schemaVersion === 'wfc.pf.barrier-multipart-complete-producer.v2' && uuid(v.intentId) && revision(v.expectedSessionRevision) && uuid(v.idempotencyKey)
  && [v.scopeSha256, v.profileSha256, v.partsSha256].every(hash) && evidence(v) && bounded(v, L.controlBytes));
export const validateBarrierMultipartProducerCompletionReceipt = safe(v => exact(v, ['schemaVersion', 'intentId', 'sessionRevision', 'commandSha256', 'scopeSha256', 'profileSha256', ...evidenceKeys, 'partsSha256', 'recordedAt', 'duplicate',
  'completionProvenance', 'sdkSourceBytesVerified', 'qualification', 'geometryValidation', 'authority'])
  && v.schemaVersion === 'wfc.pf.barrier-multipart-producer-completion-receipt.v2' && uuid(v.intentId) && revision(v.sessionRevision)
  && [v.commandSha256, v.scopeSha256, v.profileSha256, v.partsSha256].every(hash) && evidence(v) && date(v.recordedAt) && typeof v.duplicate === 'boolean'
  && v.completionProvenance === 'protected-producer-reported' && v.sdkSourceBytesVerified === false && noAuthority(v) && bounded(v, L.controlBytes));
const partReceipt = v => exact(v, ['schemaVersion', 'intentId', 'sessionRevision', 'commandSha256', 'scopeSha256', 'profileSha256', 'stored', 'duplicate', 'qualification', 'geometryValidation', 'authority', 'kind', 'partIndex', 'planSealSha256'])
  && v.schemaVersion === 'wfc.pf.barrier-multipart-stage-receipt.v2' && v.kind === 'part' && uuid(v.intentId) && revision(v.sessionRevision)
  && [v.commandSha256, v.scopeSha256, v.profileSha256, v.planSealSha256].every(hash) && uint(v.partIndex, P.limits.parts - 1) && typeof v.duplicate === 'boolean' && noAuthority(v)
  && exact(v.stored, ['blobId', 'sha256', 'bytes', 'durability']) && uuid(v.stored.blobId) && hash(v.stored.sha256) && pos(v.stored.bytes, L.partBytes) && v.stored.durability === 'file-and-directory-fsynced';
const completionDomain = 'wfc.pf.barrier-multipart-producer-completion.v2';
function completionHashInput(kind, value) { return { domain: completionDomain + '/' + kind, value: JSON.parse(barrierMultipartTransportCanonical(value, L.controlBytes)) }; }
export function barrierMultipartProducerPartChainSeedHashInput(context) {
  if (!chainContext(context)) throw Error('BARRIER_MULTIPART_COMPLETION_CHAIN');
  return completionHashInput('parts-seed', context);
}
export function barrierMultipartProducerPartChainStepHashInput(previous, receipt) {
  if (!hash(previous) || !partReceipt(receipt)) throw Error('BARRIER_MULTIPART_COMPLETION_CHAIN');
  const { intentId, scopeSha256, profileSha256, partIndex, planSealSha256, commandSha256, sessionRevision, stored: { blobId, sha256, bytes } } = receipt;
  return completionHashInput('parts-step', { previous, part: { intentId, scopeSha256, profileSha256, partIndex, planSealSha256, commandSha256, sessionRevision, stored: { blobId, sha256, bytes } } });
}
export function barrierMultipartProducerPartChainFinalHashInput(previous, partCount) {
  if (!hash(previous) || !pos(partCount, P.limits.parts)) throw Error('BARRIER_MULTIPART_COMPLETION_CHAIN');
  return completionHashInput('parts-final', { previous, partCount });
}
