import { z } from 'zod';
import { barrierCanonicalJson, barrierModelScopeSchema } from './pathfinderBarriers.js';
import { MIXED_BARRIER_POLICY } from './pathfinderBarrierMixed.js';
import { supportedBarrierPublicationReceiptSchema } from './pathfinderBarrierSupported.js';
import { barrierPublicationRefusalReceiptSchema } from './pathfinderBarrierOutcomes.js';
import { parsePurposeJson, policyHashSchema as hash, policyRevisionSchema as revision, policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';

/** Additive recovery only. These schemas never admit capture work, a new policy,
 * a current frame, an empty barrier declaration, or a calculation. */
export const BARRIER_RECOVERY_LIMITS = Object.freeze({ targetBytes: 8192, responseBytes: 16384 });
export const BARRIER_RECOVERY_TARGET_DOMAIN = 'wfc.pf.barrier-command-recovery-target.v1' as const;
export const BARRIER_COMMAND_CLOSURE_DOMAIN = 'wfc.pf.barrier-command-closure.v1' as const;
export const BARRIER_COMMAND_HASH_FENCE = 'all-command-kinds-and-policy-lanes-by-project-and-command-sha256' as const;
const same = (left: unknown, right: unknown) => barrierCanonicalJson(left) === barrierCanonicalJson(right);
const bytes = (value: unknown) => new TextEncoder().encode(barrierCanonicalJson(value)).byteLength;
const nextRevisionMatches = (before: string, after: string) => { try { return (BigInt(before) + 1n).toString() === after; } catch { return false; } };
const problem = (context: z.RefinementCtx, message: string) => context.addIssue({ code: 'custom', message });
const ids = z.object({ actorId: uuid, loginId: uuid, intentId: uuid, snapshotId: uuid }).strict();
const targetCommon = { schemaVersion: z.literal('wfc.pf.barrier-command-recovery-target.v1'), projectId: uuid,
  commandSha256: hash, scope: barrierModelScopeSchema, pendingRecordSha256: hash };
const legacyTarget = { ...targetCommon, pendingRecordVersion: z.literal('wfc.pf.barrier-pending-command.v1') };
const mixedTarget = { ...targetCommon, pendingRecordVersion: z.literal('wfc.pf.barrier-pending-command.v2'), geometryPolicy: z.literal(MIXED_BARRIER_POLICY) };
const publication = { kind: z.literal('publication'), knownIntent: ids, captureSha256: hash, frameSha256: hash, loadId: uuid };
/** A v1 record is a requested legacy constraint, not proof of absent server
 * command bytes. Existing rows MUST independently prove the exact tag/lane.
 * No fallback or conversion between the old and mixed pending record exists. */
export const barrierCommandRecoveryTargetSchema = z.union([
  z.object({ ...legacyTarget, kind: z.literal('capture-intent'), knownIntent: ids.nullable() }).strict(),
  z.object({ ...legacyTarget, kind: z.literal('empty') }).strict(),
  z.object({ ...legacyTarget, ...publication }).strict(),
  z.object({ ...mixedTarget, kind: z.literal('capture-intent'), knownIntent: ids.nullable() }).strict(),
  z.object({ ...mixedTarget, kind: z.literal('empty') }).strict(),
  z.object({ ...mixedTarget, ...publication }).strict(),
]).superRefine((value, context) => {
  if (value.projectId !== value.scope.projectId) problem(context, 'Recovery stays in one exact project.');
  if (bytes(value) > BARRIER_RECOVERY_LIMITS.targetBytes) problem(context, 'Recovery target exceeds its fixed byte budget.');
});
export type BarrierCommandRecoveryTarget = z.infer<typeof barrierCommandRecoveryTargetSchema>;
export type BarrierRecoveryLane = 'legacy-v1' | 'mixed-v2';
export type BarrierRecoveryCommandKind = 'capture' | 'declare-empty';
export function barrierRecoveryTargetLane(target: BarrierCommandRecoveryTarget): BarrierRecoveryLane {
  return target.pendingRecordVersion === 'wfc.pf.barrier-pending-command.v2' ? 'mixed-v2' : 'legacy-v1';
}
export function barrierRecoveryTargetKind(target: BarrierCommandRecoveryTarget): BarrierRecoveryCommandKind {
  return target.kind === 'empty' ? 'declare-empty' : 'capture';
}
export function barrierCommandRecoveryTargetHashInput(value: BarrierCommandRecoveryTarget) {
  return { domain: BARRIER_RECOVERY_TARGET_DOMAIN, value: barrierCommandRecoveryTargetSchema.parse(value) };
}
/** GET /barriers/recovery/outcome?target=<canonical JSON>. The target contains
 * only hashes, opaque IDs and scope, never names, raw tokens or geometry. */
export const barrierCommandRecoveryQuerySchema = z.object({ target: z.string().min(1).max(BARRIER_RECOVERY_LIMITS.targetBytes) }).strict();
export function parseBarrierCommandRecoveryQuery(value: unknown): BarrierCommandRecoveryTarget {
  const query = barrierCommandRecoveryQuerySchema.parse(value);
  return barrierCommandRecoveryTargetSchema.parse(parsePurposeJson(query.target, { maximumBytes: BARRIER_RECOVERY_LIMITS.targetBytes }));
}
/** Repeating this exact body is idempotent by the original project+command hash.
 * A lost close ACK does not need a new key, command, capture or Viewer session. */
export const barrierCommandCloseSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-command-close.v1'),
  target: barrierCommandRecoveryTargetSchema }).strict();

const recordedCommon = { commandSha256: hash, scope: barrierModelScopeSchema, actorId: uuid, loginId: uuid, expectedRegistryRevision: revision };
const recordedCapture = { ...recordedCommon, kind: z.literal('capture'), intentId: uuid, snapshotId: uuid, captureSha256: hash.nullable() };
const recordedEmpty = { ...recordedCommon, kind: z.literal('declare-empty'), snapshotId: uuid };
/** Minted only after the server checks immutable request bytes/hash, original
 * owner and exact intent/receipt/manifest joins. Shape alone is not authority. */
export const barrierRecordedCommandSchema = z.union([
  z.object({ ...recordedCapture, commandSchemaVersion: z.literal('wfc.pf.barrier-capture-command.v1') }).strict(),
  z.object({ ...recordedCapture, commandSchemaVersion: z.literal('wfc.pf.barrier-capture-command.v2'), geometryPolicy: z.literal(MIXED_BARRIER_POLICY) }).strict(),
  z.object({ ...recordedEmpty, commandSchemaVersion: z.literal('wfc.pf.barrier-registry-command.v1') }).strict(),
  z.object({ ...recordedEmpty, commandSchemaVersion: z.literal('wfc.pf.barrier-registry-command.v2'), geometryPolicy: z.literal(MIXED_BARRIER_POLICY) }).strict(),
]);
export type BarrierRecordedCommand = z.infer<typeof barrierRecordedCommandSchema>;
const recordedLane = (value: BarrierRecordedCommand): BarrierRecoveryLane => value.commandSchemaVersion.endsWith('.v2') ? 'mixed-v2' : 'legacy-v1';
const requestedCommand = z.object({ lane: z.enum(['legacy-v1', 'mixed-v2']), kind: z.enum(['capture', 'declare-empty']), scope: barrierModelScopeSchema }).strict();
const original = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not-recorded') }).strict(),
  z.object({ state: z.literal('recorded'), command: barrierRecordedCommandSchema }).strict(),
]);
/** Immutable all-lanes hash fence. requestedCommand records the close target;
 * it must never be reported as authenticated original bytes when not-recorded.
 * A conflicting later body with this same hash is REFUSED, never ignored. */
export const barrierCommandClosureSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-command-closure.v1'),
  closureId: uuid, projectId: uuid, commandSha256: hash, requestedCommand, original,
  outcome: z.literal('closed-not-published'), fence: z.literal(BARRIER_COMMAND_HASH_FENCE),
  closedBy: z.object({ authority: z.literal('current-project-administrator-close-only'), actorId: uuid, loginId: uuid }).strict(),
  closedAt: z.string().max(64).datetime(), mayResumeCapture: z.literal(false), mayPublish: z.literal(false), establishesCurrentFrame: z.literal(false),
  grantsCalculation: z.literal(false), contentSha256: hash,
}).strict().superRefine((value, context) => {
  if (value.projectId !== value.requestedCommand.scope.projectId) problem(context, 'Closure stays in the requested project.');
  if (value.original.state === 'recorded' && (value.original.command.commandSha256 !== value.commandSha256
    || !same(value.original.command.scope, value.requestedCommand.scope) || value.original.command.kind !== value.requestedCommand.kind
    || recordedLane(value.original.command) !== value.requestedCommand.lane || value.original.command.kind !== 'capture'))
    problem(context, 'A recorded command must exactly match the proved original capture; a recorded empty publication already has a success terminal.');
});
export type BarrierCommandClosure = z.infer<typeof barrierCommandClosureSchema>;
export function barrierCommandClosureHashInput(value: BarrierCommandClosure) {
  const { contentSha256: _ignored, ...body } = barrierCommandClosureSchema.parse(value);
  return { domain: BARRIER_COMMAND_CLOSURE_DOMAIN, value: body };
}
export function verifyBarrierCommandClosure(value: unknown, hashCanonical: (value: string) => string): value is BarrierCommandClosure {
  const parsed = barrierCommandClosureSchema.safeParse(value);
  try { return parsed.success && hashCanonical(barrierCanonicalJson(barrierCommandClosureHashInput(parsed.data))) === parsed.data.contentSha256; }
  catch { return false; }
}

const responseCommon = { schemaVersion: z.literal('wfc.pf.barrier-command-recovery.v1'), targetSha256: hash, pendingRecordSha256: hash };
const published = z.object({ ...responseCommon, outcome: z.literal('published'), original: barrierRecordedCommandSchema,
  publication: supportedBarrierPublicationReceiptSchema, frameBinding: z.literal('not-recorded'), frameSha256: z.null() }).strict()
  .superRefine((value, context) => {
    const source = value.original, snapshot = value.publication.snapshot, mixed = recordedLane(source) === 'mixed-v2';
    if (!same(source.scope, snapshot.scope) || source.snapshotId !== snapshot.snapshotId
      || (value.publication.schemaVersion === 'wfc.pf.barrier-publication-receipt.v2') !== mixed
      || !nextRevisionMatches(source.expectedRegistryRevision, snapshot.registryRevision)
      || snapshot.mode !== (source.kind === 'declare-empty' ? 'explicit-empty' : mixed ? 'mixed-mesh-set' : 'mesh-set')
      || source.kind === 'capture' && source.captureSha256 === null) problem(context, 'Publication keeps the exact original tag, command generation, capture and snapshot scope.');
  });
const refused = z.object({ ...responseCommon, outcome: z.literal('geometry-refused'), original: barrierRecordedCommandSchema,
  refusal: barrierPublicationRefusalReceiptSchema }).strict().superRefine((value, context) => {
    if (value.original.kind !== 'capture' || value.original.commandSha256 !== value.refusal.commandSha256
      || value.original.intentId !== value.refusal.intentId || value.original.captureSha256 !== value.refusal.captureSha256)
      problem(context, 'Geometry refusal remains bound to its original capture; closure is a separate outcome.');
  });
const closed = z.object({ ...responseCommon, outcome: z.literal('closed'), closure: barrierCommandClosureSchema }).strict();
export const barrierCommandRecoveryTerminalSchema = z.union([published, refused, closed]);
export const barrierCommandRecoveryResponseSchema = z.union([
  z.object({ ...responseCommon, outcome: z.literal('not-recorded') }).strict(),
  z.object({ ...responseCommon, outcome: z.literal('pending'), original: barrierRecordedCommandSchema }).strict()
    .refine(value => value.original.kind === 'capture', 'Empty declarations commit atomically or have no recorded command.'),
  barrierCommandRecoveryTerminalSchema,
]).refine(value => bytes(value) <= BARRIER_RECOVERY_LIMITS.responseBytes, 'Recovery response exceeds its fixed byte budget.');
export type BarrierCommandRecoveryResponse = z.infer<typeof barrierCommandRecoveryResponseSchema>;
export type BarrierCommandRecoveryTerminal = z.infer<typeof barrierCommandRecoveryTerminalSchema>;

function recordedMatches(target: BarrierCommandRecoveryTarget, source: BarrierRecordedCommand): boolean {
  if (source.commandSha256 !== target.commandSha256 || !same(source.scope, target.scope)
    || source.kind !== barrierRecoveryTargetKind(target) || recordedLane(source) !== barrierRecoveryTargetLane(target)) return false;
  if (target.kind === 'empty') return source.kind === 'declare-empty';
  if (source.kind !== 'capture') return false;
  const known = target.knownIntent;
  if (known && (known.actorId !== source.actorId || known.loginId !== source.loginId || known.intentId !== source.intentId || known.snapshotId !== source.snapshotId)) return false;
  return target.kind !== 'publication' || source.captureSha256 === target.captureSha256;
}
/** Pure binding/integrity matcher only. Call only for a response from the current
 * authenticated recovery API, and retain the epoch/current-auth fence separately.
 * null means nonterminal; mismatch throws and NEVER authorizes local deletion. */
export function matchBarrierCommandRecovery(targetValue: BarrierCommandRecoveryTarget, responseValue: unknown,
  hashCanonical: (value: string) => string): BarrierCommandRecoveryTerminal | null {
  const target = barrierCommandRecoveryTargetSchema.parse(targetValue), response = barrierCommandRecoveryResponseSchema.parse(responseValue);
  if (response.pendingRecordSha256 !== target.pendingRecordSha256
    || response.targetSha256 !== hashCanonical(barrierCanonicalJson(barrierCommandRecoveryTargetHashInput(target)))) throw Error('BARRIER_RECOVERY_TARGET_CHANGED');
  if (response.outcome === 'not-recorded') return null;
  if (response.outcome === 'closed') {
    const closure = response.closure;
    if (!verifyBarrierCommandClosure(closure, hashCanonical) || closure.projectId !== target.projectId || closure.commandSha256 !== target.commandSha256
      || !same(closure.requestedCommand.scope, target.scope) || closure.requestedCommand.kind !== barrierRecoveryTargetKind(target)
      || closure.requestedCommand.lane !== barrierRecoveryTargetLane(target)
      || closure.original.state === 'recorded' && !recordedMatches(target, closure.original.command)
      || closure.original.state === 'not-recorded' && target.kind !== 'empty' && target.knownIntent !== null)
      throw Error('BARRIER_RECOVERY_CLOSURE_CHANGED');
    return response;
  }
  if (!recordedMatches(target, response.original)) throw Error('BARRIER_RECOVERY_ORIGINAL_CHANGED');
  if (response.outcome === 'pending') return null;
  if (response.outcome === 'geometry-refused' && target.kind === 'publication' && response.refusal.frameSha256 !== target.frameSha256)
    throw Error('BARRIER_RECOVERY_FRAME_CHANGED');
  return response;
}
