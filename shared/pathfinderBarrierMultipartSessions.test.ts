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
  BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE, barrierMultipartProducerCompletionContextSchema,
  barrierMultipartCompleteProducerCommandSchema, barrierMultipartProducerCompletionReceiptSchema,
  barrierMultipartReadCompletionResponseSchema, barrierMultipartMutationCommandSchema, barrierMultipartStageCommandSchema,
  barrierMultipartProducerPartChainSeedHashInput, barrierMultipartProducerPartChainStepHashInput,
  barrierMultipartProducerPartChainFinalHashInput,
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
const completionRoots = () => ({ nodes: h('1'), fragments: h('2'), 'geometry-ranges': h('3'), plan: h('f') });
const completionContext = () => ({ intentId: id(11), scopeSha256: h('c'), profileSha256: h('d'), contextSha256: h('8'),
  frameSha256: h('9'), roots: completionRoots() });
function completionCommand() {
  return { ...context(), schemaVersion: 'wfc.pf.barrier-multipart-complete-producer.v2', contextSha256: h('8'), frameSha256: h('9'),
    roots: completionRoots(), partCount: 1, partsSha256: h('7'), bookendProfile: BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE };
}
function completionReceipt() {
  return { ...completionContext(), schemaVersion: 'wfc.pf.barrier-multipart-producer-completion-receipt.v2', sessionRevision: '11',
    commandSha256: h('6'), partCount: 1, partsSha256: h('7'), bookendProfile: BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE,
    recordedAt: '2026-10-22T12:01:00.000Z', duplicate: false, completionProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false,
    qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' };
}
const hashBytes = (value: unknown) => barrierMultipartCanonicalBytes(value);

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

describe('protected producer completion prerequisite', () => {
  it('adds the exact completion command without changing stage commands or the session/status shape', () => {
    const value = completionCommand();
    expect(barrierMultipartCompleteProducerCommandSchema.safeParse(value).success).toBe(true);
    expect(barrierMultipartMutationCommandSchema.safeParse(value).success).toBe(true);
    expect(barrierMultipartStageCommandSchema.safeParse(value).success).toBe(false);
    expect(barrierMultipartSessionCommandHashInput(value)).toEqual({ domain: 'wfc.pf.barrier-multipart-session.v2/command', value });
    expect(barrierMultipartSessionSchema.safeParse(session()).success).toBe(true);
    expect(barrierMultipartSessionSchema.safeParse({ ...session(), state: 'completed' }).success).toBe(false);
    expect(barrierMultipartSessionSchema.safeParse({ ...session(), producerCompletion: completionReceipt() }).success).toBe(false);
  });
  it('requires four non-null roots, exact full frame/context identities, and finite positive part counts', () => {
    const value = completionCommand();
    for (const change of [{ roots: { ...completionRoots(), plan: null } }, { frameSha256: h('9') + '\n' }, { contextSha256: 'A'.repeat(64) },
      { intentId: id(11) + '\n' }, { expectedSessionRevision: '01' }, { expectedSessionRevision: '9223372036854775808' },
      { partCount: 0 }, { partCount: -0 }, { partCount: 1.5 }, { partCount: Number.NaN }, { partCount: Number.POSITIVE_INFINITY },
      { partCount: BARRIER_MULTIPART_PROFILE.limits.parts + 1 }, { partsSha256: 'g'.repeat(64) }, { bookendProfile: 'counter-only' }])
      expect(barrierMultipartCompleteProducerCommandSchema.safeParse({ ...value, ...change }).success).toBe(false);
    expect(barrierMultipartCompleteProducerCommandSchema.safeParse({ ...value, partCount: BARRIER_MULTIPART_PROFILE.limits.parts }).success).toBe(true);
    const { frameSha256: _fullFrame, ...missingFrame } = completionContext();
    expect(barrierMultipartProducerCompletionContextSchema.safeParse(missingFrame).success).toBe(false);
  });
  it('refuses privilege, fresh deadline, authority and source-proof fields in the public completion command', () => {
    for (const extra of [{ actorId: id(20) }, { loginId: id(21) }, { deadline: '2099-01-01T00:00:00Z' }, { ready: true },
      { authority: 'publish' }, { sdkSourceBytesVerified: true }, { completionProvenance: 'independently-verified' }, { stored: stored() }])
      expect(barrierMultipartCompleteProducerCommandSchema.safeParse({ ...completionCommand(), ...extra }).success).toBe(false);
  });
  it('refuses accessors, hidden/symbol fields, arrays, cycles and oversized data before reading a getter', () => {
    let accessed = 0;
    const getter = { ...completionCommand() }; Object.defineProperty(getter, 'roots', { enumerable: true, get() { accessed++; return completionRoots(); } });
    const hidden = { ...completionCommand() }; Object.defineProperty(hidden, 'foreign', { value: true });
    const symbol = { ...completionCommand(), [Symbol('foreign')]: true };
    const cyclic: Record<string, unknown> = { ...completionCommand() }; cyclic.foreign = cyclic;
    for (const value of [getter, hidden, symbol, cyclic, [completionCommand()], { ...completionCommand(), foreign: 'x'.repeat(65537) }])
      expect(barrierMultipartCompleteProducerCommandSchema.safeParse(value).success).toBe(false);
    expect(accessed).toBe(0);
  });
  it('retains only reported completion with unvalidated staging and explicit absent readback', () => {
    const value = completionReceipt();
    expect(barrierMultipartProducerCompletionReceiptSchema.parse(value)).toEqual(value);
    expect(barrierMultipartReadCompletionResponseSchema.parse(null)).toBeNull();
    expect(barrierMultipartReadCompletionResponseSchema.parse(value)).toEqual(value);
    expect(barrierMultipartReadCompletionResponseSchema.safeParse(undefined).success).toBe(false);
    for (const change of [{ completionProvenance: 'server-sdk-verified' }, { sdkSourceBytesVerified: true }, { geometryValidation: 'STRUCTURAL_ONLY' },
      { qualification: 'MEASURED' }, { authority: 'apply' }, { state: 'ready' }, { recordedAt: 'not-a-datetime' }, { partCount: 0 }])
      expect(barrierMultipartProducerCompletionReceiptSchema.safeParse({ ...value, ...change }).success).toBe(false);
    expect(barrierMultipartProducerCompletionReceiptSchema.parse({ ...value, duplicate: true }).sessionRevision).toBe('11');
  });
  it('freezes exact seed domain, sorted canonical bytes and independent full frame root', () => {
    const input = barrierMultipartProducerPartChainSeedHashInput(completionContext());
    const expected = '{"domain":"wfc.pf.barrier-multipart-producer-completion.v2/parts-seed","value":{'
      + '"contextSha256":"' + h('8') + '","frameSha256":"' + h('9') + '","intentId":"' + id(11)
      + '","profileSha256":"' + h('d') + '","roots":{"fragments":"' + h('2') + '","geometry-ranges":"' + h('3')
      + '","nodes":"' + h('1') + '","plan":"' + h('f') + '"},"scopeSha256":"' + h('c') + '"}}';
    expect(new TextDecoder().decode(hashBytes(input))).toBe(expected);
    for (const change of [{ frameSha256: h('5') }, { contextSha256: h('5') }, { intentId: id(99) }, { scopeSha256: h('5') },
      { profileSha256: h('5') }, { roots: { ...completionRoots(), plan: h('5') } }])
      expect(hashBytes(barrierMultipartProducerPartChainSeedHashInput({ ...completionContext(), ...change }))).not.toEqual(hashBytes(input));
  });
  it('projects original part receipt identity while duplicate replay leaves the chain unchanged', () => {
    const value = receipt(), input = barrierMultipartProducerPartChainStepHashInput(h('0'), value);
    expect(input).toEqual({ domain: 'wfc.pf.barrier-multipart-producer-completion.v2/parts-step', value: { previous: h('0'), part: {
      intentId: id(11), scopeSha256: h('c'), profileSha256: h('d'), partIndex: 0, planSealSha256: h('f'), commandSha256: h(),
      sessionRevision: '1', stored: { blobId: id(30), sha256: h('e'), bytes: 128 },
    } } });
    expect(hashBytes(barrierMultipartProducerPartChainStepHashInput(h('0'), { ...value, duplicate: true }))).toEqual(hashBytes(input));
    for (const change of [{ partIndex: 1 }, { planSealSha256: h('5') }, { commandSha256: h('5') }, { sessionRevision: '2' }, { intentId: id(99) },
      { scopeSha256: h('5') }, { profileSha256: h('5') }, { stored: { ...stored(), blobId: id(31) } },
      { stored: { ...stored(), sha256: h('5') } }, { stored: { ...stored(), bytes: 129 } }])
      expect(hashBytes(barrierMultipartProducerPartChainStepHashInput(h('0'), { ...value, ...change }))).not.toEqual(hashBytes(input));
    expect(hashBytes(barrierMultipartProducerPartChainStepHashInput(h('1'), value))).not.toEqual(hashBytes(input));
  });
  it('refuses malformed part-receipt inputs without normalizing away metadata or inventing sequence proof', () => {
    for (const change of [{ kind: 'seal' }, { planSealSha256: h('f') + '\n' }, { sessionRevision: '1\n' }, { foreign: true },
      { stored: { ...stored(), durability: 'file-only' } }, { authority: 'publish' }])
      expect(() => barrierMultipartProducerPartChainStepHashInput(h('0'), { ...receipt(), ...change })).toThrow();
    expect(() => barrierMultipartProducerPartChainStepHashInput(h('0') + '\n', receipt())).toThrow();
    expect(() => barrierMultipartProducerPartChainSeedHashInput({ ...completionContext(), roots: { ...completionRoots(), nodes: null } })).toThrow();
    // A local helper cannot infer previous ordinals from an opaque digest; the
    // surrounding writer/repository separately proves complete contiguous order.
    expect(barrierMultipartProducerPartChainStepHashInput(h('0'), { ...receipt(), partIndex: 7 }).value.part.partIndex).toBe(7);
  });
  it('binds exact final count under a distinct domain and refuses unbounded or ambiguous count encodings', () => {
    expect(barrierMultipartProducerPartChainFinalHashInput(h('0'), 2)).toEqual({
      domain: 'wfc.pf.barrier-multipart-producer-completion.v2/parts-final', value: { previous: h('0'), partCount: 2 },
    });
    expect(hashBytes(barrierMultipartProducerPartChainFinalHashInput(h('0'), 1))).not.toEqual(hashBytes(barrierMultipartProducerPartChainFinalHashInput(h('0'), 2)));
    for (const value of [0, -0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '2', BARRIER_MULTIPART_PROFILE.limits.parts + 1])
      expect(() => barrierMultipartProducerPartChainFinalHashInput(h('0'), value)).toThrow();
    expect(() => barrierMultipartProducerPartChainFinalHashInput(h('0') + '\n', 2)).toThrow();
  });
  it('returns detached inputs so later caller mutation cannot change the already constructed chain identity', () => {
    const seed = completionContext(), part = receipt();
    const seedInput = barrierMultipartProducerPartChainSeedHashInput(seed), stepInput = barrierMultipartProducerPartChainStepHashInput(h('0'), part);
    const seedBytes = hashBytes(seedInput), stepBytes = hashBytes(stepInput);
    seed.roots.plan = h('4'); seed.frameSha256 = h('4'); part.stored.sha256 = h('4'); part.sessionRevision = '99';
    expect(hashBytes(seedInput)).toEqual(seedBytes); expect(hashBytes(stepInput)).toEqual(stepBytes);
  });
});
