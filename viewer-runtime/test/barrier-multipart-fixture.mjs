import { createHash } from 'node:crypto';
import { BARRIER_MULTIPART_PLANNER_PROFILE as profile } from '../barrier-plan.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE as producerProfile, barrierMultipartTransportCanonical as canonical,
  barrierMultipartContextHashInput } from '../barrier-multipart-protocol.mjs';
import { createBarrierMultipartTransport } from '../barrier-multipart-transport.mjs';

export const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
export const H = 'a'.repeat(64), hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const h = value => hash(new TextEncoder().encode(canonical(value)));
export const domain = (kind, value) => h({ domain: 'wfc.pf.barrier-multipart.v2/' + kind, value });
export const commandHash = value => h({ domain: 'wfc.pf.barrier-multipart-session.v2/command', value });
export const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function fixture() {
  const at = Date.now(), created = new Date(at - 1000).toISOString(), deadline = new Date(at + 120000).toISOString();
  const frame = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId: id(1), modelVersionId: id(2), contentFingerprint: H,
    loadId: id(4), sdkVersion: '7.130.0', matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerDisplayUnit: 1,
    upVector: [0, 0, 1], globalOffsetDisplayUnits: [0, 0, 0], globalOffsetMetres: [0, 0, 0], displayToWorldMetres: [...matrix], modelTransform: null, placementTransform: null };
  frame.contentSha256 = h(frame);
  const scope = { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2', modelScope: { projectId: id(1), modelVersionId: id(2), contentFingerprint: H,
    selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: h({ coordinateFrame: frame.coordinateFrame, displayToWorldMetres: matrix, globalOffsetMetres: [0, 0, 0] }), coordinateFrame: 'canonical-world-metres' },
  modelLoadId: id(4), selectedParents: [{ selectionId: id(5), dbId: 3, kind: 'obstacle' }], geometryPolicy: profile.geometryPolicy };
  const command = { schemaVersion: 'wfc.pf.barrier-multipart-admit.v2', idempotencyKey: id(6), scope, profile: structuredClone(profile), expectedRegistryRevision: '0',
    selectedParentLabels: [{ selectionId: id(5), name: 'Synthetic parent' }], reservation: { bytes: 10485760, files: 100 } };
  const session = { schemaVersion: 'wfc.pf.barrier-multipart-session.v2', id: id(7), projectId: id(1), state: 'admitted', sessionRevision: '0',
    principal: { kind: 'current-login-admin', actorId: id(8), loginId: id(9) }, command, requestSha256: commandHash(command), scopeSha256: domain('scope', scope), profileSha256: domain('profile', profile),
    createdAt: created, updatedAt: created, jobDeadline: deadline, leaseDeadline: null, reservation: { ...command.reservation, chargedBytes: 0, chargedFiles: 0 },
    counts: { pages: 0, seals: 0, parts: 0 }, roots: { nodes: null, fragments: null, 'geometry-ranges': null, plan: null }, qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' };
  const context = { schemaVersion: 'wfc.pf.barrier-multipart-context.v2', session, context: { viewerSessionId: id(10), frameObservation: frame,
    producerProfile: structuredClone(producerProfile), contextSha256: '', effectiveDeadline: deadline } };
  context.context.contextSha256 = h(barrierMultipartContextHashInput(context));
  const start = { intentId: session.id, expectedSessionRevision: '0', scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, producerProfile: structuredClone(producerProfile) };
  const base = `http://127.0.0.1:5192/api/projects/${id(1)}/model-versions/${id(2)}/viewer-sessions/${id(10)}/barrier-multipart/`;
  const calls = [], receipts = new Map(), pages = new Map(), controls = { current: true, responder: null, afterStage: null, afterCompletion: null, hold: null, entered: null }; let keys = 100, completion = null;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options }); if (controls.responder) return controls.responder(url, options);
    const suffix = url.slice(base.length);
    if (url !== base + suffix) throw Error('outside fixture');
    if (options.method === 'GET' && suffix === session.id + '/context') return reply(context);
    if (options.method === 'GET' && suffix === session.id + '/producer-completion') return session.state === 'cancelled' ? reply({ code: 'BARRIER_MULTIPART_CANCELLED' }, 409) : reply(completion);
    if (options.method === 'GET' && suffix.startsWith(session.id + '/pages/')) {
      const p = suffix.split('/'); return pages.has(p[2] + '/' + p[3]) ? reply(pages.get(p[2] + '/' + p[3])) : reply({ code: 'NOT_FOUND' }, 404);
    }
    if (suffix === 'sessions') return reply({ schemaVersion: 'wfc.pf.barrier-multipart-admit-receipt.v2', session, duplicate: false });
    const c = options.headers['x-wfc-barrier-command'] ? JSON.parse(options.headers['x-wfc-barrier-command']) : JSON.parse(options.body);
    if (suffix === session.id + '/reconcile') {
      if (c.schemaVersion !== 'wfc.pf.barrier-multipart-reconcile.v2' || Object.keys(c).sort().join(',') !== 'commandSha256,idempotencyKey,intentId,schemaVersion') return reply({ code: 'HEADER_INVALID' }, 400);
      return receipts.has(c.idempotencyKey) ? reply({ ...receipts.get(c.idempotencyKey), duplicate: true }) : reply({ code: 'BARRIER_MULTIPART_COMMAND_UNCERTAIN' }, 503);
    }
    if (suffix === session.id + '/cancel') {
      session.state = 'cancelled'; session.sessionRevision = (BigInt(c.expectedSessionRevision) + 1n).toString(); session.updatedAt = new Date().toISOString();
      const result = { schemaVersion: 'wfc.pf.barrier-multipart-cancel-receipt.v2', session: structuredClone(session), commandSha256: commandHash(c), duplicate: false };
      receipts.set(c.idempotencyKey, result); return reply(result);
    }
    if (suffix === session.id + '/producer-completion') {
      session.sessionRevision = (BigInt(c.expectedSessionRevision) + 1n).toString(); session.updatedAt = new Date().toISOString();
      const { schemaVersion: _schema, expectedSessionRevision: _revision, idempotencyKey: _key, ...evidence } = c;
      completion = { schemaVersion: 'wfc.pf.barrier-multipart-producer-completion-receipt.v2', ...evidence, sessionRevision: session.sessionRevision,
        commandSha256: commandHash(c), recordedAt: session.updatedAt, duplicate: false, completionProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false,
        qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' };
      receipts.set(c.idempotencyKey, structuredClone(completion));
      if (controls.afterCompletion) return controls.afterCompletion(structuredClone(completion), c); return reply(completion);
    }
    const page = c.page, seal = c.seal, raw = page || seal ? new TextEncoder().encode(canonical(page ?? seal)) : options.body;
    const kind = page ? 'page' : seal ? 'seal' : 'part';
    const receipt = { schemaVersion: 'wfc.pf.barrier-multipart-stage-receipt.v2', intentId: session.id, sessionRevision: (BigInt(c.expectedSessionRevision) + 1n).toString(),
      commandSha256: commandHash(c), scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, stored: { blobId: id(1000 + calls.length), sha256: hash(raw), bytes: raw.byteLength, durability: 'file-and-directory-fsynced' },
      duplicate: false, qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none', kind,
      ...(page ? { pageKind: page.kind, index: page.index, firstOrdinal: page.firstOrdinal, recordCount: page.records.length, previousPageSha256: page.previousPageSha256, pageSha256: page.pageSha256 }
        : seal ? { sealKind: seal.kind, sealSha256: seal.sealSha256, pageCount: seal.pageCount, recordCount: seal.recordCount, tailPageSha256: seal.tailPageSha256 }
          : { partIndex: c.partIndex, planSealSha256: c.planSealSha256 }) };
    session.state = 'staging'; session.sessionRevision = receipt.sessionRevision; session.updatedAt = new Date().toISOString(); session.counts[page ? 'pages' : seal ? 'seals' : 'parts']++;
    session.reservation.chargedBytes += 2 * raw.byteLength; session.reservation.chargedFiles += 2;
    if (page) pages.set(page.kind + '/' + page.index, page); if (seal) session.roots[seal.kind] = seal.sealSha256;
    receipts.set(c.idempotencyKey, structuredClone(receipt)); controls.entered?.(); if (controls.hold) await controls.hold;
    if (controls.afterStage) return controls.afterStage(receipt, c); return reply(receipt);
  };
  const transport = (options = {}) => createBarrierMultipartTransport({ origin: 'http://127.0.0.1:5192', projectId: id(1), modelVersionId: id(2), sessionId: id(10), loadId: id(4),
    isCurrent: () => controls.current, fetchImpl, sha256: async bytes => hash(bytes), randomUUID: () => id(keys++), ...options });
  const page = (changes = {}) => { const value = { schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind: 'nodes', scopeSha256: session.scopeSha256, profileSha256: session.profileSha256,
    index: 0, firstOrdinal: 0, previousPageSha256: null, records: [{ dbId: 3, membershipMask: '0'.repeat(31) + '1' }], ...changes }; return { ...value, pageSha256: domain('page', value) }; };
  const seal = nodePage => { const value = { schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind: 'nodes', scopeSha256: session.scopeSha256, profileSha256: session.profileSha256,
    pageCount: 1, recordCount: 1, tailPageSha256: nodePage.pageSha256, totals: { nodes: 1 } }; return { ...value, sealSha256: domain('seal', value) }; };
  return { context, session, command, frame, start, base, calls, controls, transport, page, seal, receipts, pages };
}
