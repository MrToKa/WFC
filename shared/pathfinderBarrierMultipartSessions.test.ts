import { describe, expect, it } from 'vitest';
import {
  BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes, barrierMultipartHashInput,
} from './pathfinderBarrierMultipart.js';
import { BARRIER_LIMITS } from './pathfinderBarriers.js';
import {
  BARRIER_MULTIPART_SESSION_LIMITS as L, barrierMultipartAdmitCommandSchema,
  barrierMultipartStagePageCommandSchema, barrierMultipartStageSealCommandSchema,
  barrierMultipartStagePartCommandSchema, barrierMultipartCancelCommandSchema,
  barrierMultipartStoredBlobSchema, barrierMultipartSessionSchema, barrierMultipartAdmitReceiptSchema,
  barrierMultipartStageReceiptSchema, barrierMultipartCancelReceiptSchema,
  barrierMultipartReadSessionQuerySchema, barrierMultipartListQuerySchema,
  barrierMultipartReceiptQuerySchema, barrierMultipartReceiptPageSchema,
  barrierMultipartReconcileCommandSchema, barrierMultipartSessionCommandHashInput,
} from './pathfinderBarrierMultipartSessions.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const h = (letter = 'a') => letter.repeat(64);
function admit() {
  return { schemaVersion: 'wfc.pf.barrier-multipart-admit.v2', idempotencyKey: id(10),
    scope: { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2',
      modelScope: { projectId: id(1), modelVersionId: id(2), contentFingerprint: h(), selectionRevision: '1',
        captureFrameId: id(3), captureFrameSha256: h('b'), coordinateFrame: 'canonical-world-metres' },
      modelLoadId: id(4), selectedParents: [{ selectionId: id(5), dbId: 3, kind: 'obstacle' }],
      geometryPolicy: 'original-triangles-structural-only.v2' },
    profile: structuredClone(BARRIER_MULTIPART_PROFILE), expectedRegistryRevision: '0',
    selectedParentLabels: [{ selectionId: id(5), name: 'Selected RVM parent' }],
    reservation: { bytes: 1024 * 1024, files: 100 } };
}
const context = () => ({ intentId: id(11), expectedSessionRevision: '0', idempotencyKey: id(12),
  scopeSha256: h('c'), profileSha256: h('d') });
function page() {
  return { schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind: 'nodes', scopeSha256: h('c'), profileSha256: h('d'),
    index: 0, firstOrdinal: 0, previousPageSha256: null, pageSha256: h('e'),
    records: [{ dbId: 3, membershipMask: '0'.repeat(31) + '1' }] };
}
function seal() {
  return { schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind: 'nodes', scopeSha256: h('c'), profileSha256: h('d'),
    pageCount: 1, recordCount: 1, tailPageSha256: h('e'), sealSha256: h('f'), totals: { nodes: 1 } };
}
const partCommand = () => ({ ...context(), schemaVersion: 'wfc.pf.barrier-multipart-stage-part.v2', partIndex: 0,
  planSealSha256: h('f'), payload: { sha256: h('e'), bytes: 128 } });
function session() {
  return { schemaVersion: 'wfc.pf.barrier-multipart-session.v2', id: id(11), projectId: id(1), state: 'admitted',
    sessionRevision: '0', principal: { kind: 'current-login-admin', actorId: id(20), loginId: id(21) },
    command: admit(), requestSha256: h(), scopeSha256: h('c'), profileSha256: h('d'),
    createdAt: '2026-10-22T12:00:00.000Z', updatedAt: '2026-10-22T12:00:00.000Z',
    jobDeadline: '2026-10-22T13:00:00.000Z', leaseDeadline: null,
    reservation: { bytes: 1024 * 1024, files: 100, chargedBytes: 0, chargedFiles: 0 },
    counts: { pages: 0, seals: 0, parts: 0 }, roots: { nodes: null, fragments: null, 'geometry-ranges': null, plan: null },
    qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' };
}
const stored = () => ({ blobId: id(30), sha256: h('e'), bytes: 128, durability: 'file-and-directory-fsynced' });
function receipt() {
  return { schemaVersion: 'wfc.pf.barrier-multipart-stage-receipt.v2', intentId: id(11), sessionRevision: '1',
    commandSha256: h(), scopeSha256: h('c'), profileSha256: h('d'), stored: stored(), duplicate: false,
    qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none',
    kind: 'part', partIndex: 0, planSealSha256: h('f') };
}

describe('isolated multipart staging commands', () => {
  it('keeps unmeasured permanent storage budgets separate from unchanged v1 per-file ceilings', () => {
    expect(L.totalBytes).toBe(8 * 1024 ** 3); expect(L.totalFiles).toBe(50_000);
    expect(L.partBytes).toBe(BARRIER_LIMITS.captureBytes); expect(L.pageBytes).toBe(BARRIER_MULTIPART_PROFILE.limits.pageBytes);
    expect(BARRIER_LIMITS.fragments).toBe(8192); expect(L.jobMilliseconds).toBe(3_600_000);
    expect(L.leaseMilliseconds).toBe(180_000); expect(L.qualification).toBe('NOT_MEASURED');
  });
  it('admits exact scope/profile and bounded display labels without public actor or storage selection', () => {
    expect(barrierMultipartAdmitCommandSchema.parse(admit()).scope.selectedParents[0].dbId).toBe(3);
    for (const extra of [{ actorId: id(20) }, { loginId: id(21) }, { blobId: id(30) }, { filesystemPath: '/private' },
      { ready: true }, { published: true }, { drillThroughWalls: true }, { jobDeadline: '2099-01-01T00:00:00Z' }])
      expect(barrierMultipartAdmitCommandSchema.safeParse({ ...admit(), ...extra }).success).toBe(false);
  });
  it('labels affect the exact command identity while remaining separate from selected geometry identity', () => {
    const first = admit(), second = structuredClone(first); second.selectedParentLabels[0].name = 'Renamed display';
    expect(barrierMultipartCanonicalBytes(barrierMultipartSessionCommandHashInput(first)))
      .not.toEqual(barrierMultipartCanonicalBytes(barrierMultipartSessionCommandHashInput(second)));
    expect(barrierMultipartHashInput('scope', first.scope)).toEqual(barrierMultipartHashInput('scope', second.scope));
    for (const labels of [[], [{ selectionId: id(99), name: 'Wrong identity' }], [first.selectedParentLabels[0], first.selectedParentLabels[0]],
      [{ selectionId: id(5), name: 'x'.repeat(513) }], [{ selectionId: id(5), name: 'bad\nlabel' }]])
      expect(barrierMultipartAdmitCommandSchema.safeParse({ ...first, selectedParentLabels: labels }).success).toBe(false);
  });
  it('refuses overflowing, signed-zero and over-limit reservation requests', () => {
    for (const reservation of [{ bytes: L.totalBytes + 1, files: 1 }, { bytes: 1, files: L.totalFiles + 1 },
      { bytes: Number.MAX_SAFE_INTEGER + 1, files: 1 }, { bytes: -0, files: 1 }, { bytes: 1, files: 0 }])
      expect(barrierMultipartAdmitCommandSchema.safeParse({ ...admit(), reservation }).success).toBe(false);
    expect(barrierMultipartAdmitCommandSchema.safeParse({ ...admit(), reservation: { bytes: L.totalBytes, files: L.totalFiles } }).success).toBe(true);
  });
  it('separates canonical page files from bounded wrappers and requires exact scope/profile roots', () => {
    const command = { ...context(), schemaVersion: 'wfc.pf.barrier-multipart-stage-page.v2', page: page() };
    expect(barrierMultipartStagePageCommandSchema.safeParse(command).success).toBe(true);
    for (const changed of [{ scopeSha256: h('b') }, { profileSha256: h('b') }, { page: { ...page(), ready: true } },
      { page: { ...page(), index: 1 } }, { payload: 'not a page' }])
      expect(barrierMultipartStagePageCommandSchema.safeParse({ ...command, ...changed }).success).toBe(false);
  });
  it('stages seals as untrusted immutable roots and never as final publication authority', () => {
    const command = { ...context(), schemaVersion: 'wfc.pf.barrier-multipart-stage-seal.v2', seal: seal() };
    expect(barrierMultipartStageSealCommandSchema.safeParse(command).success).toBe(true);
    for (const change of [{ scopeSha256: h('b') }, { seal: { ...seal(), authority: 'publish' } }, { snapshotId: id(99) }])
      expect(barrierMultipartStageSealCommandSchema.safeParse({ ...command, ...change }).success).toBe(false);
  });
  it('keeps opaque part bytes outside metadata and bounds exact source digest and size declarations', () => {
    expect(barrierMultipartStagePartCommandSchema.safeParse({ ...partCommand(), payload: { sha256: h(), bytes: L.partBytes } }).success).toBe(true);
    for (const change of [{ payload: { sha256: h(), bytes: L.partBytes + 1 } }, { payload: { sha256: h().toUpperCase(), bytes: 1 } },
      { partIndex: BARRIER_MULTIPART_PROFILE.limits.parts }, { geometry: [[0, 0, 0]] }, { payload: { ...partCommand().payload, blobId: id(30) } }])
      expect(barrierMultipartStagePartCommandSchema.safeParse({ ...partCommand(), ...change }).success).toBe(false);
  });
});

describe('server-owned staging views and receipts', () => {
  it('retains actor and login only in server views and preserves expired finite contexts for inspection', () => {
    expect(barrierMultipartSessionSchema.safeParse(session()).success).toBe(true);
    const expired = session(); expired.createdAt = expired.updatedAt = '2020-01-01T00:00:00.000Z'; expired.jobDeadline = '2020-01-01T01:00:00.000Z';
    expect(barrierMultipartSessionSchema.safeParse(expired).success).toBe(true);
    expect(barrierMultipartAdmitReceiptSchema.safeParse({ schemaVersion: 'wfc.pf.barrier-multipart-admit-receipt.v2', session: expired, duplicate: true }).success).toBe(true);
    for (const change of [{ projectId: id(99) }, { jobDeadline: '2026-10-22T13:00:00.001Z' },
      { updatedAt: '2026-10-22T11:59:59.000Z' }, { leaseDeadline: '2026-10-22T13:00:00.001Z' },
      { principal: { kind: 'client-admin', actorId: id(20), loginId: id(21) } }])
      expect(barrierMultipartSessionSchema.safeParse({ ...session(), ...change }).success).toBe(false);
  });
  it('does not release charged temp/final capacity on cancellation or infer readiness from seals', () => {
    const value = session(); value.state = 'cancelled'; value.counts.pages = 1;
    value.reservation.chargedBytes = 256; value.reservation.chargedFiles = 2;
    expect(barrierMultipartSessionSchema.safeParse(value).success).toBe(true);
    expect(barrierMultipartCancelReceiptSchema.safeParse({ schemaVersion: 'wfc.pf.barrier-multipart-cancel-receipt.v2', session: value, commandSha256: h(), duplicate: false }).success).toBe(true);
    expect(barrierMultipartSessionSchema.safeParse({ ...value, reservation: { ...value.reservation, chargedFiles: 0 } }).success).toBe(false);
    expect(barrierMultipartSessionSchema.safeParse({ ...value, reservation: { ...value.reservation, chargedBytes: value.reservation.bytes + 1 } }).success).toBe(false);
    expect(barrierMultipartSessionSchema.safeParse({ ...value, roots: { ...value.roots, nodes: h() } }).success).toBe(false);
    for (const state of ['ready', 'qualified', 'published', 'complete'])
      expect(barrierMultipartSessionSchema.safeParse({ ...value, state }).success).toBe(false);
    const orphan = session(); orphan.reservation.chargedBytes = 256; orphan.reservation.chargedFiles = 2;
    expect(barrierMultipartSessionSchema.safeParse(orphan).success).toBe(true); // Charge may outlive a missing successful receipt.
  });
  it('requires directory durability shape and retains raw blob digests separately from semantic page roots', () => {
    expect(barrierMultipartStoredBlobSchema.safeParse(stored()).success).toBe(true);
    for (const change of [{ durability: 'file-only' }, { path: '/private' }, { url: 'https://private.invalid' }, { bytes: 0 }])
      expect(barrierMultipartStoredBlobSchema.safeParse({ ...stored(), ...change }).success).toBe(false);
    const value = { ...receipt(), kind: 'page', pageKind: 'nodes', index: 0, firstOrdinal: 0, recordCount: 1,
      previousPageSha256: null, pageSha256: h('f') };
    const { partIndex: _partIndex, planSealSha256: _plan, ...pageReceipt } = value;
    const parsed = barrierMultipartStageReceiptSchema.parse(pageReceipt);
    expect(parsed.stored.sha256).toBe(h('e')); expect(parsed.kind === 'page' && parsed.pageSha256).toBe(h('f'));
    expect(barrierMultipartStageReceiptSchema.safeParse({ ...pageReceipt, stored: { ...stored(), bytes: L.pageBytes + 1 } }).success).toBe(false);
  });
  it('binds cancellation and exact reconciliation without introducing actor selection or new mutations', () => {
    const command = { ...context(), schemaVersion: 'wfc.pf.barrier-multipart-cancel.v2', reason: 'Stop this capture' };
    expect(barrierMultipartCancelCommandSchema.safeParse(command).success).toBe(true);
    const reconcile = { schemaVersion: 'wfc.pf.barrier-multipart-reconcile.v2', intentId: id(11), idempotencyKey: id(12), commandSha256: h() };
    expect(barrierMultipartReconcileCommandSchema.safeParse(reconcile).success).toBe(true);
    expect(barrierMultipartReconcileCommandSchema.safeParse({ ...reconcile, acquireLease: true }).success).toBe(false);
    expect(barrierMultipartCancelCommandSchema.safeParse({ ...command, releaseBytes: true }).success).toBe(false);
  });
  it('bounds own-session reads and prevents receipts from another session entering a result page', () => {
    expect(barrierMultipartReadSessionQuerySchema.safeParse({ intentId: id(11) }).success).toBe(true);
    expect(barrierMultipartReadSessionQuerySchema.safeParse({ intentId: id(11), actorId: id(20) }).success).toBe(false);
    expect(barrierMultipartListQuerySchema.safeParse({ cursor: 0, limit: L.listPageSize + 1 }).success).toBe(false);
    expect(barrierMultipartReceiptQuerySchema.safeParse({ intentId: id(11), cursor: 0, limit: L.receiptPageSize }).success).toBe(true);
    const value = { schemaVersion: 'wfc.pf.barrier-multipart-receipt-page.v2', intentId: id(11), receipts: [receipt()], nextCursor: null };
    expect(barrierMultipartReceiptPageSchema.safeParse(value).success).toBe(true);
    expect(barrierMultipartReceiptPageSchema.safeParse({ ...value, receipts: [{ ...receipt(), intentId: id(99) }] }).success).toBe(false);
    expect(barrierMultipartStageReceiptSchema.safeParse({ ...receipt(), geometryValidation: 'QUALIFIED', authority: 'apply' }).success).toBe(false);
  });
});
