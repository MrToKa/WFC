// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes, barrierMultipartHashInput, barrierMultipartPageHashInput,
  barrierMultipartPageSchema, barrierMultipartRangeBytes, barrierMultipartRangeHashInput, barrierMultipartSealHashInput, barrierMultipartSealSchema,
  type BarrierMultipartPage, type BarrierMultipartSeal,
} from '../../shared/pathfinderBarrierMultipart.js';
import {
  barrierMultipartSessionCommandHashInput, barrierMultipartSessionSchema, barrierMultipartStageReceiptSchema,
  barrierMultipartProducerCompletionReceiptSchema, barrierMultipartProducerPartChainSeedHashInput,
  barrierMultipartProducerPartChainStepHashInput, barrierMultipartProducerPartChainFinalHashInput,
  type BarrierMultipartStageReceipt,
} from '../../shared/pathfinderBarrierMultipartSessions.js';
import { barrierCanonicalJson, type BarrierFrameObservation } from '../../viewer-runtime/barrier-capture.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE, barrierMultipartContextHashInput, type BarrierMultipartContext } from '../../viewer-runtime/barrier-multipart-protocol.mjs';
import type { JobPrincipal } from './jobContracts.js';
import { openBarrierMultipartCatalogSource, type BarrierMultipartCatalogSource, type BarrierMultipartCatalogRepository } from './barrierMultipartCatalogSource.js';

type Kind = BarrierMultipartPage['kind'];
const kinds = ['nodes', 'fragments', 'geometry-ranges', 'plan'] as const;
const id = (n: number) => `b1700000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hashBytes = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const hash = (value: unknown) => hashBytes(barrierMultipartCanonicalBytes(value));
const json = (bytes: Uint8Array) => JSON.parse(Buffer.from(bytes).toString('utf8'));
const unqualified = { qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' } as const;
type PartReceipt = Extract<BarrierMultipartStageReceipt, { kind: 'part' }>;

function fixture() {
  const now = Date.now(), projectId = id(1), intentId = id(2), mask = '0'.repeat(31) + '1', partCount = 2;
  const who: JobPrincipal = { userId: id(3), loginId: id(4), loginExpiresAt: now + 7200000 };
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scope = { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2' as const, modelScope: { projectId, modelVersionId: id(5), contentFingerprint: 'a'.repeat(64),
    selectionRevision: '1', captureFrameId: id(6), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const }, modelLoadId: id(7),
  selectedParents: [{ selectionId: id(8), dbId: 3, kind: 'wall' as const }], geometryPolicy: 'original-triangles-structural-only.v2' as const };
  const command = { schemaVersion: 'wfc.pf.barrier-multipart-admit.v2' as const, idempotencyKey: id(9), scope, profile: BARRIER_MULTIPART_PROFILE,
    expectedRegistryRevision: '0', selectedParentLabels: [{ selectionId: id(8), name: 'Synthetic structural surface' }], reservation: { bytes: 1048576, files: 100 } };
  const scopeSha256 = hash(barrierMultipartHashInput('scope', scope)), profileSha256 = hash(barrierMultipartHashInput('profile', command.profile));
  const fragment = { fragmentId: 7, ownerNodeOrdinal: 0, ownerDbId: 3, membershipMask: mask, primitive: 'triangles' as const,
    sourceGeometrySha256: 'c'.repeat(64), transformSha256: 'd'.repeat(64), sourceVertexCount: 3, sourceTriangleCount: partCount };
  const ranges = Array.from({ length: partCount }, (_, i) => ({ fragmentOrdinal: 0, triangleStart: i, triangleCount: 1, referencedVertexCount: 3,
    sourceVertexIdsSha256: 'e'.repeat(64), sourceIndicesSha256: 'f'.repeat(64), sourceGeometrySha256: fragment.sourceGeometrySha256,
    transformSha256: fragment.transformSha256, membershipMask: mask }));
  const placements = ranges.map((range, i) => ({ partIndex: i, rangeOrdinal: i, fragmentOrdinal: 0, triangleStart: i, triangleCount: 1,
    referencedVertexCount: 3, rangeSha256: hash(barrierMultipartRangeHashInput(range)), plannedEncodedBytesUpperBound: barrierMultipartRangeBytes(3, 1) }));
  const pages = new Map<Kind, BarrierMultipartPage[]>(), seals = new Map<Kind, BarrierMultipartSeal>();
  function stream(kind: Kind, records: BarrierMultipartPage['records'], totals: unknown) {
    const chunks = kind === 'nodes' ? records.map(row => [row]) : [records]; let ordinal = 0, previous: string | null = null;
    const stored = chunks.map((chunk, index) => {
      const page = { schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind, scopeSha256, profileSha256, index, firstOrdinal: ordinal,
        previousPageSha256: previous, records: chunk, pageSha256: '0'.repeat(64) } as BarrierMultipartPage;
      page.pageSha256 = hash(barrierMultipartPageHashInput(page)); previous = page.pageSha256; ordinal += chunk.length; return barrierMultipartPageSchema.parse(page);
    }); pages.set(kind, stored);
    const seal = barrierMultipartSealSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind, scopeSha256, profileSha256,
      pageCount: stored.length, recordCount: records.length, tailPageSha256: previous, totals, sealSha256: '0'.repeat(64),
      ...(kind === 'plan' ? { qualification: 'NOT_MEASURED', authority: 'none' } : {}) });
    seal.sealSha256 = hash(barrierMultipartSealHashInput(seal)); seals.set(kind, seal);
  }
  stream('nodes', [{ dbId: 3, membershipMask: mask }, { dbId: 4, membershipMask: mask }], { nodes: 2 });
  stream('fragments', [fragment], { fragments: 1, sourceVertices: 3, sourceTriangles: partCount, unavailable: 0, nonTriangle: 0 });
  stream('geometry-ranges', ranges, { ranges: partCount, referencedVertices: 6, triangles: partCount });
  stream('plan', placements, { parts: partCount, ranges: partCount, referencedVertices: 6, triangles: partCount,
    plannedEncodedBytesUpperBound: partCount * (8192 + barrierMultipartRangeBytes(3, 1)), nodeSealSha256: seals.get('nodes')!.sealSha256,
    fragmentSealSha256: seals.get('fragments')!.sealSha256, rangeSealSha256: seals.get('geometry-ranges')!.sealSha256 });
  const roots = { nodes: seals.get('nodes')!.sealSha256, fragments: seals.get('fragments')!.sealSha256,
    'geometry-ranges': seals.get('geometry-ranges')!.sealSha256, plan: seals.get('plan')!.sealSha256 };
  const session = barrierMultipartSessionSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-session.v2', id: intentId, projectId,
    state: 'staging', sessionRevision: '12', principal: { kind: 'current-login-admin', actorId: who.userId, loginId: who.loginId }, command,
    requestSha256: hash(barrierMultipartSessionCommandHashInput(command)), scopeSha256, profileSha256, createdAt: new Date(now - 1000).toISOString(),
    updatedAt: new Date(now).toISOString(), jobDeadline: new Date(now + 3599000).toISOString(), leaseDeadline: null,
    reservation: { ...command.reservation, chargedBytes: 32768, chargedFiles: 22 }, counts: { pages: 5, seals: 4, parts: partCount }, roots, ...unqualified });
  const frameBody = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1' as const, projectId, modelVersionId: scope.modelScope.modelVersionId,
    contentFingerprint: scope.modelScope.contentFingerprint, loadId: scope.modelLoadId, sdkVersion: '7.130.0' as const, matrixPrecision: 'binary64' as const,
    coordinateFrame: 'canonical-world-metres' as const, sourceUnits: 'm', metresPerDisplayUnit: 1, upVector: [0, 0, 1] as [number, number, number],
    globalOffsetDisplayUnits: [0, 0, 0] as [number, number, number], globalOffsetMetres: [0, 0, 0] as [number, number, number],
    displayToWorldMetres: matrix, modelTransform: null, placementTransform: null };
  const frame: BarrierFrameObservation = { ...frameBody, contentSha256: hashBytes(barrierCanonicalJson(frameBody)) };
  const verifiedContext: BarrierMultipartContext = { schemaVersion: 'wfc.pf.barrier-multipart-context.v2', session, context: { viewerSessionId: id(10),
    frameObservation: frame, producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE, contextSha256: '0'.repeat(64), effectiveDeadline: new Date(now + 1800000).toISOString() } };
  verifiedContext.context.contextSha256 = hashBytes(barrierCanonicalJson(barrierMultipartContextHashInput(verifiedContext)));
  const parts = Array.from({ length: partCount }, (_, index) => Buffer.from('Opaque synthetic part ' + index));
  const receipts = parts.map((bytes, index) => barrierMultipartStageReceiptSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-stage-receipt.v2',
    kind: 'part', intentId, sessionRevision: String(10 + index), commandSha256: String(index + 1).repeat(64), scopeSha256, profileSha256,
    partIndex: index, planSealSha256: roots.plan, stored: { blobId: id(20 + index), sha256: hashBytes(bytes), bytes: bytes.length,
      durability: 'file-and-directory-fsynced' }, duplicate: false, ...unqualified }) as PartReceipt);
  let previous = hash(barrierMultipartProducerPartChainSeedHashInput({ intentId, contextSha256: verifiedContext.context.contextSha256, scopeSha256,
    profileSha256, frameSha256: frame.contentSha256, roots }));
  for (const receipt of receipts) previous = hash(barrierMultipartProducerPartChainStepHashInput(previous, receipt));
  const completion = barrierMultipartProducerCompletionReceiptSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-producer-completion-receipt.v2',
    intentId, sessionRevision: '12', commandSha256: '9'.repeat(64), scopeSha256, profileSha256, contextSha256: verifiedContext.context.contextSha256,
    frameSha256: frame.contentSha256, roots, partCount, partsSha256: hash(barrierMultipartProducerPartChainFinalHashInput(previous, partCount)),
    bookendProfile: 'sdk7130-after-final-part-ack-hierarchy-frame-v1', recordedAt: session.updatedAt, duplicate: false,
    completionProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false, ...unqualified });
  const repository = {
    get: vi.fn(async () => structuredClone(session)), readCompletion: vi.fn(async () => structuredClone(completion)),
    readSeal: vi.fn(async (_project: string, _who: JobPrincipal, _intent: string, kind: Kind) => structuredClone(seals.get(kind)!)),
    readPage: vi.fn(async (_project: string, _who: JobPrincipal, _intent: string, kind: Kind, index: number) => {
      const result = pages.get(kind)?.[index]; if (!result) throw Error('Missing synthetic page'); return structuredClone(result);
    }),
    readPartEvidence: vi.fn(async (_project: string, _who: JobPrincipal, _intent: string, index: number) => ({ bytes: Buffer.from(parts[index]), receipt: structuredClone(receipts[index]) })),
  } satisfies BarrierMultipartCatalogRepository;
  const open = (signal?: AbortSignal) => openBarrierMultipartCatalogSource(repository, projectId, who, intentId, { verifiedContext, signal });
  return { projectId, intentId, who, session, verifiedContext, frame, completion, pages, seals, parts, receipts, repository, open };
}
async function drain(source: BarrierMultipartCatalogSource) {
  for (const stream of [source.Nodes, source.Fragments, source.GeometryRanges, source.Plan]) for await (const _page of stream.PagesUtf8) { /* One bounded page. */ }
  for await (const _part of source.Parts) { /* One bounded part. */ }
}

describe('internal protected multipart catalog source', () => {
  it('exports exact frame/scope/profile inputs, four complete seals and original part receipts lazily with final currentness', async () => {
    const f = fixture(), source = await f.open();
    expect(f.repository.readSeal).toHaveBeenCalledTimes(4); expect(f.repository.readPage).not.toHaveBeenCalled(); expect(f.repository.readPartEvidence).not.toHaveBeenCalled();
    expect(hashBytes(source.ScopeHashInputUtf8)).toBe(f.session.scopeSha256); expect(hashBytes(source.ProfileHashInputUtf8)).toBe(f.session.profileSha256);
    expect(hashBytes(source.FrameHashInputUtf8)).toBe(f.completion.frameSha256); expect(json(source.CompletionReceiptUtf8)).toEqual(f.completion);
    expect(source.Context).toMatchObject({ partIndex: 0, roots: f.completion.roots, sdkSourceBytesVerified: false, sourceGeometryProvenance: 'protected-producer-reported' });
    expect(source.SelectedParentCount).toBe(1);
    for (const [kind, stream] of kinds.map((kind, index) => [kind, [source.Nodes, source.Fragments, source.GeometryRanges, source.Plan][index]] as const)) {
      expect(json(stream.SealUtf8)).toEqual(f.seals.get(kind)); const actual = []; for await (const page of stream.PagesUtf8) actual.push(json(page)); expect(actual).toEqual(f.pages.get(kind));
    }
    let index = 0; for await (const part of source.Parts) { expect(part.PartIndex).toBe(index); expect(part.Payload).toEqual(f.parts[index]); expect(json(part.ReceiptUtf8)).toEqual(f.receipts[index++]); }
    expect(index).toBe(2); await expect(source.VerifyCurrent()).resolves.toBeUndefined();
    expect(f.repository.readPage).toHaveBeenCalledTimes(5); expect(f.repository.readPartEvidence).toHaveBeenCalledTimes(2);
    await expect(async () => { for await (const _page of source.Nodes.PagesUtf8) { /* Refuse replay. */ } }).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_REPLAY' });
  });
  it('requires authenticated caller context data and a stored current completion rather than synthesizing a frame or completion', async () => {
    const f = fixture(); f.verifiedContext.context.frameObservation.contentSha256 = 'f'.repeat(64);
    await expect(f.open()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_CONTEXT' }); expect(f.repository.readSeal).not.toHaveBeenCalled();
    const missing = fixture(); missing.repository.readCompletion.mockResolvedValue(null as never);
    await expect(missing.open()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_COMPLETION_REQUIRED' }); expect(missing.repository.readPage).not.toHaveBeenCalled();
    const stale = fixture(); stale.verifiedContext.session = { ...stale.session, sessionRevision: '11' };
    await expect(stale.open()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_SESSION' });
  });
  it('refuses missing roots, changed full seals and a mismatched frame/context digest before yielding geometry', async () => {
    const f = fixture(); f.seals.get('nodes')!.sealSha256 = 'e'.repeat(64); await expect(f.open()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_SEAL' });
    const changed = fixture(); changed.completion.frameSha256 = 'e'.repeat(64); await expect(changed.open()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_COMPLETION' });
    const context = fixture(); context.verifiedContext.context.contextSha256 = 'f'.repeat(64); await expect(context.open()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_CONTEXT' });
  });
  it('checks page ordinal/chain/digest while retiring any failed export', async () => {
    for (const field of ['firstOrdinal', 'previousPageSha256', 'pageSha256'] as const) {
      const f = fixture(), source = await f.open(), page = f.pages.get('nodes')![1];
      if (field === 'firstOrdinal') page.firstOrdinal = 2; else page[field] = 'e'.repeat(64);
      await expect(async () => { for await (const _page of source.Nodes.PagesUtf8) { /* Consume all. */ } }).rejects.toBeDefined();
      await expect(source.VerifyCurrent()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_FAILED' });
    }
  });
  it('checks the sealed tail at exact page EOF even when every replacement page is individually valid', async () => {
    const f = fixture(), source = await f.open(), pages = f.pages.get('nodes')!;
    (pages[0].records[0] as { dbId: number }).dbId = 5; pages[0].pageSha256 = hash(barrierMultipartPageHashInput(pages[0]));
    pages[1].previousPageSha256 = pages[0].pageSha256; pages[1].pageSha256 = hash(barrierMultipartPageHashInput(pages[1]));
    const iterator = source.Nodes.PagesUtf8[Symbol.asyncIterator](); expect((await iterator.next()).done).toBe(false); expect((await iterator.next()).done).toBe(false);
    await expect(iterator.next()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_PAGE_EOF' });
    await expect(source.VerifyCurrent()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_FAILED' });
  });
  it('refuses extra records instead of dropping them to fit the seal', async () => {
    const f = fixture(), source = await f.open(), second = f.pages.get('nodes')![1];
    (second.records as { dbId: number; membershipMask: string }[]).push({ dbId: 5, membershipMask: '0'.repeat(31) + '1' });
    second.pageSha256 = hash(barrierMultipartPageHashInput(second));
    await expect(async () => { for await (const _page of source.Nodes.PagesUtf8) { /* Every record must fit the seal. */ } }).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_PAGE_COUNT' });
  });
  it('propagates a protected page failure instead of reporting a completed stream or final catalog', async () => {
    const f = fixture(), source = await f.open(); f.repository.readPage.mockRejectedValueOnce(Object.assign(Error('Revoked'), { code: 'ACCESS_REVOKED' }));
    await expect(async () => { for await (const _page of source.Nodes.PagesUtf8) { /* Consume all. */ } }).rejects.toMatchObject({ code: 'ACCESS_REVOKED' });
    await expect(source.VerifyCurrent()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_FAILED' });
  });
  it('requires original part order, receipt hash/bytes and completion-chain EOF, with no repair or silent truncation', async () => {
    for (const change of ['index', 'bytes', 'receipt', 'revision', 'chain'] as const) {
      const f = fixture(), source = await f.open();
      if (change === 'index') f.receipts[1].partIndex = 0;
      if (change === 'bytes') f.parts[1][0] ^= 1;
      if (change === 'receipt') f.receipts[1].duplicate = true;
      if (change === 'revision') f.receipts[1].sessionRevision = '99';
      if (change === 'chain') f.receipts[1].commandSha256 = 'e'.repeat(64);
      await expect(async () => { for await (const _part of source.Parts) { /* Consume every original receipt. */ } }).rejects.toBeDefined();
      await expect(source.VerifyCurrent()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_FAILED' });
    }
  });
  it('refuses consumer early return, incomplete streams and cancellation without a final currentness result', async () => {
    const f = fixture(), source = await f.open(); await expect(source.VerifyCurrent()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_INCOMPLETE' });
    const iterator = source.Nodes.PagesUtf8[Symbol.asyncIterator](); await iterator.next(); await iterator.return?.();
    await expect(source.VerifyCurrent()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_FAILED' });
    const cancelled = fixture(), abort = new AbortController(), cancelledSource = await cancelled.open(abort.signal); abort.abort();
    await expect(drain(cancelledSource)).rejects.toBeDefined(); expect(cancelled.repository.readPage).not.toHaveBeenCalled();
  });
  it('rechecks the immutable completion after EOF and immediately before final consumer use', async () => {
    const f = fixture(), source = await f.open(); await drain(source); f.completion.commandSha256 = 'a'.repeat(64);
    await expect(source.VerifyCurrent()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_COMPLETION_CHANGED' });
    const eof = fixture(), eofSource = await eof.open(), iterator = eofSource.Parts[Symbol.asyncIterator](); await iterator.next(); await iterator.next();
    eof.completion.commandSha256 = 'a'.repeat(64); await expect(iterator.next()).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_COMPLETION_CHANGED' });
  });
  it('never extends the captured effective deadline while a consumer pauses between pages', async () => {
    const f = fixture(), source = await f.open(), clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(f.verifiedContext.context.effectiveDeadline));
    try { await expect(drain(source)).rejects.toMatchObject({ code: 'BARRIER_MULTIPART_EXPORT_EXPIRED' }); expect(f.repository.readPage).not.toHaveBeenCalled(); }
    finally { clock.mockRestore(); }
  });
});
