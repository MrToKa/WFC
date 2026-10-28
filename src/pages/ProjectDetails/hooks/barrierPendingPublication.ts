import { z } from 'zod';
import { barrierCanonicalJson, barrierModelScopeSchema, type BarrierModelScope } from '../../../../shared/pathfinderBarriers';
import { policyHashSchema, policyUuidSchema } from '../../../../shared/pathfinderPurposePolicy';
import { parsePurposeJson } from '../../../../shared/pathfinderPurposePolicy';
import { MIXED_BARRIER_POLICY } from '../../../../shared/pathfinderBarrierMixed';
import { supportedBarrierCaptureCommandSchema, supportedBarrierRegistryCommandSchema,
  supportedBarrierCaptureOutcomeSchema as barrierCaptureOutcomeSchema, type AnyBarrierCaptureOutcome as BarrierCaptureOutcome } from '../../../../shared/pathfinderBarrierSupported';
import { barrierCommandClosureHashInput, barrierCommandRecoveryResponseSchema, barrierCommandRecoveryTargetHashInput,
  barrierCommandRecoveryTargetSchema, matchBarrierCommandRecovery, type BarrierCommandRecoveryTarget } from '../../../../shared/pathfinderBarrierRecovery';

export const BARRIER_PENDING_STORAGE_KEY = 'wfc.pathfinder.barrier-publication-pending.v1';
const MAX_BYTES = 32_768, MAX_COMMANDS = 8;
const common = {
  schemaVersion: z.literal('wfc.pf.barrier-pending-command.v1'),
  projectId: policyUuidSchema, tokenSha256: policyHashSchema, commandSha256: policyHashSchema,
  scope: barrierModelScopeSchema, createdAt: z.string().datetime(), recordSha256: policyHashSchema,
};
const sentinel = z.object({ ...common, kind: z.enum(['capture-intent', 'empty']),
  actorId: policyUuidSchema.nullable(), loginId: policyUuidSchema.nullable(),
  intentId: policyUuidSchema.nullable(), snapshotId: policyUuidSchema.nullable(),
}).strict().refine(value => [value.actorId, value.loginId, value.intentId, value.snapshotId].every(item => item === null)
  || value.kind === 'capture-intent' && [value.actorId, value.loginId, value.intentId, value.snapshotId].every(item => item !== null));
const publication = z.object({ ...common, kind: z.literal('publication'), actorId: policyUuidSchema, loginId: policyUuidSchema,
  intentId: policyUuidSchema, snapshotId: policyUuidSchema, captureSha256: policyHashSchema,
  frameSha256: policyHashSchema, loadId: policyUuidSchema,
}).strict();
const mixedCommon = { ...common, schemaVersion: z.literal('wfc.pf.barrier-pending-command.v2'), geometryPolicy: z.literal(MIXED_BARRIER_POLICY) };
const mixedSentinel = z.object({ ...mixedCommon, kind: z.enum(['capture-intent', 'empty']),
  actorId: policyUuidSchema.nullable(), loginId: policyUuidSchema.nullable(), intentId: policyUuidSchema.nullable(), snapshotId: policyUuidSchema.nullable(),
}).strict().refine(value => [value.actorId, value.loginId, value.intentId, value.snapshotId].every(item => item === null)
  || value.kind === 'capture-intent' && [value.actorId, value.loginId, value.intentId, value.snapshotId].every(item => item !== null));
const mixedPublication = z.object({ ...mixedCommon, kind: z.literal('publication'), actorId: policyUuidSchema, loginId: policyUuidSchema,
  intentId: policyUuidSchema, snapshotId: policyUuidSchema, captureSha256: policyHashSchema, frameSha256: policyHashSchema, loadId: policyUuidSchema }).strict();
export const barrierPendingCommandSchema = z.union([sentinel, publication, mixedSentinel, mixedPublication]).refine(value => value.projectId === value.scope.projectId);
export type BarrierPendingCommand = z.infer<typeof barrierPendingCommandSchema>;
export type BarrierPendingPublication = Extract<BarrierPendingCommand, { kind: 'publication' }>;
const storeSchema = z.object({ version: z.literal(1), commands: z.array(barrierPendingCommandSchema).max(MAX_COMMANDS) }).strict()
  .refine(value => new Set(value.commands.map(item => item.projectId)).size === value.commands.length);
const same = (a: unknown, b: unknown) => barrierCanonicalJson(a) === barrierCanonicalJson(b);
const recordDomain = (value: BarrierPendingCommand) => value.schemaVersion === 'wfc.pf.barrier-pending-command.v2'
  ? 'wfc.pf.barrier-pending-record.v2' : 'wfc.pf.barrier-pending-record.v1';
export async function barrierPendingHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(barrierCanonicalJson(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function barrierPendingTokenHash(token: string): Promise<string> {
  if (!token || token.length > 65_536) throw new Error('BARRIER_PENDING_TOKEN_INVALID');
  return barrierPendingHash({ domain: 'wfc.pf.barrier-pending-login.v1', token });
}
function readStore(storage: Storage) {
  const raw = storage.getItem(BARRIER_PENDING_STORAGE_KEY);
  if (raw === null) return { version: 1 as const, commands: [] as BarrierPendingCommand[] };
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error('BARRIER_PENDING_STORAGE_LIMIT');
  return storeSchema.parse(parsePurposeJson(raw, { maximumBytes: MAX_BYTES }));
}
function writeStore(storage: Storage, value: z.infer<typeof storeSchema>) {
  const raw = JSON.stringify(storeSchema.parse(value));
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error('BARRIER_PENDING_STORAGE_LIMIT');
  storage.setItem(BARRIER_PENDING_STORAGE_KEY, raw);
  if (storage.getItem(BARRIER_PENDING_STORAGE_KEY) !== raw) throw new Error('BARRIER_PENDING_STORAGE_UNCONFIRMED');
}
export async function sealPendingBarrierCommand(input: unknown): Promise<BarrierPendingCommand> {
  const parsed = barrierPendingCommandSchema.parse({ ...(input as object), recordSha256: '0'.repeat(64) });
  const { recordSha256: _ignored, ...body } = parsed;
  return barrierPendingCommandSchema.parse({ ...body, recordSha256: await barrierPendingHash({ domain: recordDomain(parsed), body }) });
}
export async function readPendingBarrierCommand(storage: Storage, projectId: string): Promise<BarrierPendingCommand | null> {
  policyUuidSchema.parse(projectId);
  const store = readStore(storage);
  for (const value of store.commands) {
    const { recordSha256, ...body } = value;
    if (recordSha256 !== await barrierPendingHash({ domain: recordDomain(value), body })) throw new Error('BARRIER_PENDING_STORAGE_CHANGED');
  }
  return store.commands.find(value => value.projectId === projectId) ?? null;
}
/** Compare-and-replace only this exact retained command. No names, credentials,
 * geometry, URL or path can enter the closed persisted representation. */
export function retainPendingBarrierCommand(storage: Storage, value: BarrierPendingCommand, expected: BarrierPendingCommand | null): void {
  const next = barrierPendingCommandSchema.parse(value), store = readStore(storage);
  const old = store.commands.find(item => item.projectId === next.projectId) ?? null;
  if (!same(old, expected) || expected && (expected.schemaVersion !== next.schemaVersion || expected.commandSha256 !== next.commandSha256 || !same(expected.scope, next.scope)
    || expected.tokenSha256 !== next.tokenSha256 || expected.createdAt !== next.createdAt)) throw new Error('BARRIER_PENDING_COMMAND_CHANGED');
  if (!old && store.commands.length >= MAX_COMMANDS) throw new Error('BARRIER_PENDING_STORAGE_FULL');
  writeStore(storage, { version: 1, commands: [...store.commands.filter(item => item.projectId !== next.projectId), next] });
}
export function clearPendingBarrierCommand(storage: Storage, expected: BarrierPendingCommand): void {
  const store = readStore(storage), old = store.commands.find(item => item.projectId === expected.projectId);
  if (!old || !same(old, expected)) throw new Error('BARRIER_PENDING_COMMAND_CHANGED');
  writeStore(storage, { version: 1, commands: store.commands.filter(item => item.projectId !== expected.projectId) });
}
export async function createBarrierCommandSentinel(kind: 'capture-intent' | 'empty', command: unknown,
  scope: BarrierModelScope, token: string): Promise<BarrierPendingCommand> {
  const original = kind === 'capture-intent' ? supportedBarrierCaptureCommandSchema.parse(command) : supportedBarrierRegistryCommandSchema.parse(command);
  if (!same(original.scope, scope) || kind === 'empty' && (!('action' in original) || original.action !== 'declare-empty')) throw new Error('BARRIER_PENDING_COMMAND_CHANGED');
  const mixed = original.schemaVersion === 'wfc.pf.barrier-capture-command.v2' || original.schemaVersion === 'wfc.pf.barrier-registry-command.v2';
  return sealPendingBarrierCommand({ schemaVersion: mixed ? 'wfc.pf.barrier-pending-command.v2' : 'wfc.pf.barrier-pending-command.v1',
    ...(mixed ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}), kind,
    projectId: scope.projectId, scope, commandSha256: await barrierPendingHash(original), tokenSha256: await barrierPendingTokenHash(token),
    actorId: null, loginId: null, intentId: null, snapshotId: null, createdAt: new Date().toISOString() });
}
/** A terminal fact settles the original command only. In particular, the
 * published legacy envelope cannot attest a full SDK frame or current model. */
export function matchBarrierCaptureOutcome(expected: BarrierPendingPublication, raw: unknown): BarrierCaptureOutcome | null {
  const parsed = barrierCaptureOutcomeSchema.safeParse(raw);
  if (!parsed.success) throw new Error('BARRIER_OUTCOME_INVALID');
  const value = parsed.data;
  if (value === null) return null;
  if (value.intentId !== expected.intentId || value.commandSha256 !== expected.commandSha256 || value.captureSha256 !== expected.captureSha256)
    throw new Error('BARRIER_OUTCOME_CHANGED');
  if (value.outcome === 'not-published') {
    if (value.frameSha256 !== expected.frameSha256) throw new Error('BARRIER_OUTCOME_FRAME_CHANGED');
  } else if ((value.schemaVersion === 'wfc.pf.barrier-capture-outcome.v2') !== (expected.schemaVersion === 'wfc.pf.barrier-pending-command.v2')
    || value.publication.snapshot.snapshotId !== expected.snapshotId
    || value.publication.snapshot.mode !== (expected.schemaVersion === 'wfc.pf.barrier-pending-command.v2' ? 'mixed-mesh-set' : 'mesh-set')
    || !same(value.publication.snapshot.scope, expected.scope)) throw new Error('BARRIER_OUTCOME_SNAPSHOT_CHANGED');
  return value;
}

/** Project the exact hash-verified persisted source lane. A legacy record is
 * never upgraded to the current policy, and credentials never enter the URL. */
export async function createPendingBarrierRecoveryTarget(value: BarrierPendingCommand): Promise<BarrierCommandRecoveryTarget> {
  const parsed = barrierPendingCommandSchema.parse(value), { recordSha256, ...body } = parsed;
  if (recordSha256 !== await barrierPendingHash({ domain: recordDomain(parsed), body })) throw Error('BARRIER_PENDING_STORAGE_CHANGED');
  const base = { schemaVersion: 'wfc.pf.barrier-command-recovery-target.v1', projectId: parsed.projectId,
    commandSha256: parsed.commandSha256, scope: parsed.scope, pendingRecordSha256: recordSha256,
    pendingRecordVersion: parsed.schemaVersion,
    ...(parsed.schemaVersion === 'wfc.pf.barrier-pending-command.v2' ? { geometryPolicy: parsed.geometryPolicy } : {}) };
  const knownIntent = parsed.actorId === null ? null : { actorId: parsed.actorId, loginId: parsed.loginId, intentId: parsed.intentId, snapshotId: parsed.snapshotId };
  if (parsed.kind === 'publication') return barrierCommandRecoveryTargetSchema.parse({ ...base, kind: parsed.kind,
    knownIntent, captureSha256: parsed.captureSha256, frameSha256: parsed.frameSha256, loadId: parsed.loadId });
  return barrierCommandRecoveryTargetSchema.parse(parsed.kind === 'empty' ? { ...base, kind: 'empty' } : { ...base, kind: parsed.kind, knownIntent });
}
/** Browser SHA-256 is asynchronous; precompute only the two closed canonical
 * hash inputs used by the shared synchronous matcher, with no digest fallback. */
export async function matchPendingBarrierCommandRecovery(expected: BarrierPendingCommand, raw: unknown) {
  const target = await createPendingBarrierRecoveryTarget(expected);
  if (raw === null) return null;
  const response = barrierCommandRecoveryResponseSchema.parse(raw);
  const inputs = [barrierCommandRecoveryTargetHashInput(target),
    ...(response.outcome === 'closed' ? [barrierCommandClosureHashInput(response.closure)] : [])];
  const hashes = new Map<string, string>();
  for (const input of inputs) hashes.set(barrierCanonicalJson(input), await barrierPendingHash(input));
  return matchBarrierCommandRecovery(target, response, input => {
    const digest = hashes.get(input); if (!digest) throw Error('BARRIER_RECOVERY_HASH_INPUT_CHANGED'); return digest;
  });
}
