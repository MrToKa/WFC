import { createHash } from 'node:crypto';
import {
  barrierMultipartCanonicalBytes, barrierMultipartCanonicalJson, barrierMultipartHashInput,
  barrierMultipartPageHashInput, barrierMultipartPageSchema, barrierMultipartSealHashInput, barrierMultipartSealSchema,
  type BarrierMultipartPage, type BarrierMultipartSeal,
} from '../../shared/pathfinderBarrierMultipart.js';
import {
  barrierMultipartProducerCompletionReceiptSchema, barrierMultipartProducerPartChainSeedHashInput,
  barrierMultipartProducerPartChainStepHashInput, barrierMultipartProducerPartChainFinalHashInput, barrierMultipartStageReceiptSchema,
  type BarrierMultipartProducerCompletionReceipt,
} from '../../shared/pathfinderBarrierMultipartSessions.js';
import { barrierPackedPartContextSchema, type BarrierPackedPartContext } from '../../shared/pathfinderBarrierPackedGeometry.js';
import { barrierCanonicalJson, barrierFrameObservationHashInput } from '../../viewer-runtime/barrier-capture.mjs';
import { barrierMultipartContextHashInput, validateBarrierMultipartContext, type BarrierMultipartContext } from '../../viewer-runtime/barrier-multipart-protocol.mjs';
import type { BarrierMultipartRepository } from './barrierMultipartRepository.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';

type Kind = BarrierMultipartPage['kind'];
const kinds = ['nodes', 'fragments', 'geometry-ranges', 'plan'] as const;
const hashBytes = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown) => hashBytes(barrierMultipartCanonicalBytes(value));
const same = (a: unknown, b: unknown) => barrierMultipartCanonicalJson(a) === barrierMultipartCanonicalJson(b);
const fail = (code: string): never => { throw new PathFinderError(code, 409, 'The internal surface catalog source is incomplete or changed. No routing or publication authority is granted.'); };

export type BarrierMultipartCatalogRepository = Pick<BarrierMultipartRepository, 'get' | 'readCompletion' | 'readSeal' | 'readPage' | 'readPartEvidence'>;
export type BarrierMultipartCatalogStream = Readonly<{ SealUtf8: Uint8Array; PagesUtf8: AsyncIterable<Uint8Array> }>;
export type BarrierMultipartCatalogPart = Readonly<{ PartIndex: number; Payload: Uint8Array; ReceiptUtf8: Uint8Array }>;
export type BarrierMultipartCatalogSource = Readonly<{
  Context: BarrierPackedPartContext; SelectedParentCount: number;
  ScopeHashInputUtf8: Uint8Array; ProfileHashInputUtf8: Uint8Array; FrameHashInputUtf8: Uint8Array; CompletionReceiptUtf8: Uint8Array;
  Nodes: BarrierMultipartCatalogStream; Fragments: BarrierMultipartCatalogStream; GeometryRanges: BarrierMultipartCatalogStream; Plan: BarrierMultipartCatalogStream;
  Parts: AsyncIterable<BarrierMultipartCatalogPart>; VerifyCurrent: () => Promise<void>;
}>;

/** Internal server seam only. The caller must obtain verifiedContext from its
 * owned protected Viewer factory; an object shape/hash cannot authenticate its
 * source. Never bind this argument to an HTTP body. No files, leases, sessions,
 * registry rows or cable values are created or changed by this export.
 *
 * Each stream is single-use and retains only its current bounded page/part.
 * Consumers must observe every EOF and await VerifyCurrent before completing
 * their own catalog. A catalog is structural surface data, not collision proof.
 */
export async function openBarrierMultipartCatalogSource(repository: BarrierMultipartCatalogRepository, projectId: string, principal: JobPrincipal,
  intentId: string, options: { verifiedContext: BarrierMultipartContext; signal?: AbortSignal }): Promise<BarrierMultipartCatalogSource> {
  const signal = options.signal;
  signal?.throwIfAborted();
  if (!validateBarrierMultipartContext(options.verifiedContext)) fail('BARRIER_MULTIPART_EXPORT_CONTEXT');
  // Native frame/context digests retain their existing canonical JSON contract.
  const verified: BarrierMultipartContext = JSON.parse(barrierCanonicalJson(options.verifiedContext));
  const who = Object.freeze({ ...principal });
  const session = await repository.get(projectId, who, intentId, signal);
  if (!same(session, verified.session) || session.id !== intentId || session.projectId !== projectId || session.state !== 'staging'
    || session.principal.actorId !== who.userId || session.principal.loginId !== who.loginId || session.counts.seals !== 4
    || session.counts.parts < 1 || Object.values(session.roots).some(root => root === null)) fail('BARRIER_MULTIPART_EXPORT_SESSION');
  const frame = verified.context.frameObservation, frameBytes = Buffer.from(barrierCanonicalJson(barrierFrameObservationHashInput(frame)));
  if (hashBytes(frameBytes) !== frame.contentSha256 || hashBytes(barrierCanonicalJson(barrierMultipartContextHashInput(verified))) !== verified.context.contextSha256
    || hash(barrierMultipartHashInput('scope', session.command.scope)) !== session.scopeSha256
    || hash(barrierMultipartHashInput('profile', session.command.profile)) !== session.profileSha256) fail('BARRIER_MULTIPART_EXPORT_CONTEXT');
  const deadline = Math.min(Date.parse(verified.context.effectiveDeadline), Date.parse(session.jobDeadline), who.loginExpiresAt);
  let failed = false;
  const finished = new Set<Kind | 'parts'>();
  function local() {
    signal?.throwIfAborted();
    if (failed) fail('BARRIER_MULTIPART_EXPORT_FAILED');
    if (!Number.isFinite(deadline) || deadline <= Date.now()) fail('BARRIER_MULTIPART_EXPORT_EXPIRED');
  }
  local();
  const first = await repository.readCompletion(projectId, who, intentId, signal);
  if (first === null) fail('BARRIER_MULTIPART_EXPORT_COMPLETION_REQUIRED');
  const completion: BarrierMultipartProducerCompletionReceipt = barrierMultipartProducerCompletionReceiptSchema.parse(first);
  if (completion.intentId !== intentId || completion.sessionRevision !== session.sessionRevision || completion.scopeSha256 !== session.scopeSha256
    || completion.profileSha256 !== session.profileSha256 || completion.contextSha256 !== verified.context.contextSha256
    || completion.frameSha256 !== frame.contentSha256 || completion.partCount !== session.counts.parts || !same(completion.roots, session.roots)
    || completion.duplicate) fail('BARRIER_MULTIPART_EXPORT_COMPLETION');
  const completionJson = barrierMultipartCanonicalJson(completion);
  async function current() {
    local(); const now = await repository.readCompletion(projectId, who, intentId, signal); local();
    if (now === null || barrierMultipartCanonicalJson(now) !== completionJson) fail('BARRIER_MULTIPART_EXPORT_COMPLETION_CHANGED');
  }
  const seals = new Map<Kind, BarrierMultipartSeal>();
  for (const kind of kinds) {
    local(); const seal = barrierMultipartSealSchema.parse(await repository.readSeal(projectId, who, intentId, kind, signal)); local();
    if (seal.kind !== kind || seal.scopeSha256 !== session.scopeSha256 || seal.profileSha256 !== session.profileSha256
      || hash(barrierMultipartSealHashInput(seal)) !== seal.sealSha256 || seal.sealSha256 !== completion.roots[kind]) fail('BARRIER_MULTIPART_EXPORT_SEAL');
    seals.set(kind, seal);
  }
  const plan = seals.get('plan')!;
  if (plan.kind !== 'plan' || plan.totals.parts !== completion.partCount || kinds.reduce((sum, kind) => sum + seals.get(kind)!.pageCount, 0) !== session.counts.pages
    || plan.totals.nodeSealSha256 !== completion.roots.nodes || plan.totals.fragmentSealSha256 !== completion.roots.fragments
    || plan.totals.rangeSealSha256 !== completion.roots['geometry-ranges']) fail('BARRIER_MULTIPART_EXPORT_SEALS');
  await current();
  const context = barrierPackedPartContextSchema.parse({ schemaVersion: 'wfc.pf.barrier-packed-part.v1', codecVersion: 'wfc.pf.barrier-packed-mesh.v1',
    intentId, contextSha256: completion.contextSha256, scopeSha256: completion.scopeSha256, profileSha256: completion.profileSha256,
    frameSha256: completion.frameSha256, producerProfile: verified.context.producerProfile, roots: completion.roots, partIndex: 0,
    sourceGeometryProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false });
  function stream(kind: Kind): BarrierMultipartCatalogStream {
    const seal = seals.get(kind)!; let used = false;
    return Object.freeze({ SealUtf8: barrierMultipartCanonicalBytes(seal), PagesUtf8: {
      async *[Symbol.asyncIterator]() {
        if (used) fail('BARRIER_MULTIPART_EXPORT_REPLAY'); used = true;
        let done = false, ordinal = 0, previous: string | null = null;
        try {
          for (let index = 0; index < seal.pageCount; index++) {
            local(); const page = barrierMultipartPageSchema.parse(await repository.readPage(projectId, who, intentId, kind, index, signal)); local();
            if (page.kind !== kind || page.index !== index || page.firstOrdinal !== ordinal || page.previousPageSha256 !== previous
              || page.scopeSha256 !== completion.scopeSha256 || page.profileSha256 !== completion.profileSha256
              || hash(barrierMultipartPageHashInput(page)) !== page.pageSha256) fail('BARRIER_MULTIPART_EXPORT_PAGE');
            ordinal += page.records.length; previous = page.pageSha256;
            if (ordinal > seal.recordCount) fail('BARRIER_MULTIPART_EXPORT_PAGE_COUNT');
            yield barrierMultipartCanonicalBytes(page);
          }
          if (ordinal !== seal.recordCount || previous !== seal.tailPageSha256) fail('BARRIER_MULTIPART_EXPORT_PAGE_EOF');
          await current(); done = true; finished.add(kind);
        } finally { if (!done) failed = true; }
      },
    } });
  }
  let partsUsed = false;
  const Parts: AsyncIterable<BarrierMultipartCatalogPart> = {
    async *[Symbol.asyncIterator]() {
      if (partsUsed) fail('BARRIER_MULTIPART_EXPORT_REPLAY'); partsUsed = true;
      let done = false, previous = hash(barrierMultipartProducerPartChainSeedHashInput({ intentId, contextSha256: completion.contextSha256,
        scopeSha256: completion.scopeSha256, profileSha256: completion.profileSha256, frameSha256: completion.frameSha256, roots: completion.roots }));
      let revision: string | null = null;
      try {
        for (let index = 0; index < completion.partCount; index++) {
          local(); const item = await repository.readPartEvidence(projectId, who, intentId, index, signal); local();
          const receipt = barrierMultipartStageReceiptSchema.parse(item.receipt);
          if (receipt.kind !== 'part' || receipt.intentId !== intentId || receipt.partIndex !== index || receipt.scopeSha256 !== completion.scopeSha256
            || receipt.profileSha256 !== completion.profileSha256 || receipt.planSealSha256 !== completion.roots.plan || receipt.duplicate
            || !Buffer.isBuffer(item.bytes) || item.bytes.length !== receipt.stored.bytes || hashBytes(item.bytes) !== receipt.stored.sha256
            || revision !== null && BigInt(receipt.sessionRevision) !== BigInt(revision) + 1n) fail('BARRIER_MULTIPART_EXPORT_PART');
          previous = hash(barrierMultipartProducerPartChainStepHashInput(previous, receipt)); revision = receipt.sessionRevision;
          yield Object.freeze({ PartIndex: index, Payload: item.bytes, ReceiptUtf8: barrierMultipartCanonicalBytes(receipt) });
        }
        if (hash(barrierMultipartProducerPartChainFinalHashInput(previous, completion.partCount)) !== completion.partsSha256
          || revision === null || BigInt(revision) + 1n !== BigInt(completion.sessionRevision)) fail('BARRIER_MULTIPART_EXPORT_PART_EOF');
        await current(); done = true; finished.add('parts');
      } finally { if (!done) failed = true; }
    },
  };
  return Object.freeze({ Context: Object.freeze(context), SelectedParentCount: session.command.scope.selectedParents.length,
    ScopeHashInputUtf8: barrierMultipartCanonicalBytes(barrierMultipartHashInput('scope', session.command.scope)),
    ProfileHashInputUtf8: barrierMultipartCanonicalBytes(barrierMultipartHashInput('profile', session.command.profile)),
    FrameHashInputUtf8: frameBytes, CompletionReceiptUtf8: Buffer.from(completionJson),
    Nodes: stream('nodes'), Fragments: stream('fragments'), GeometryRanges: stream('geometry-ranges'), Plan: stream('plan'), Parts,
    async VerifyCurrent() { local(); if (finished.size !== 5) fail('BARRIER_MULTIPART_EXPORT_INCOMPLETE'); await current(); },
  });
}
