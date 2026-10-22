import { z } from 'zod';
import { barrierCanonicalJson, barrierModelScopeSchema, type BarrierModelScope } from '../../../../shared/pathfinderBarriers';
import { policyHashSchema, policyUuidSchema } from '../../../../shared/pathfinderPurposePolicy';
import { parsePurposeJson } from '../../../../shared/pathfinderPurposePolicy';
import { barrierCaptureOutcomeSchema, type BarrierCaptureOutcome } from '../../../../shared/pathfinderBarrierOutcomes';

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
export const barrierPendingCommandSchema = z.union([sentinel, publication]).refine(value => value.projectId === value.scope.projectId);
export type BarrierPendingCommand = z.infer<typeof barrierPendingCommandSchema>;
export type BarrierPendingPublication = Extract<BarrierPendingCommand, { kind: 'publication' }>;
const storeSchema = z.object({ version: z.literal(1), commands: z.array(barrierPendingCommandSchema).max(MAX_COMMANDS) }).strict()
  .refine(value => new Set(value.commands.map(item => item.projectId)).size === value.commands.length);
const same = (a: unknown, b: unknown) => barrierCanonicalJson(a) === barrierCanonicalJson(b);
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
  return barrierPendingCommandSchema.parse({ ...body, recordSha256: await barrierPendingHash({ domain: 'wfc.pf.barrier-pending-record.v1', body }) });
}
export async function readPendingBarrierCommand(storage: Storage, projectId: string): Promise<BarrierPendingCommand | null> {
  policyUuidSchema.parse(projectId);
  const store = readStore(storage);
  for (const value of store.commands) {
    const { recordSha256, ...body } = value;
    if (recordSha256 !== await barrierPendingHash({ domain: 'wfc.pf.barrier-pending-record.v1', body })) throw new Error('BARRIER_PENDING_STORAGE_CHANGED');
  }
  return store.commands.find(value => value.projectId === projectId) ?? null;
}
/** Compare-and-replace only this exact retained command. No names, credentials,
 * geometry, URL or path can enter the closed persisted representation. */
export function retainPendingBarrierCommand(storage: Storage, value: BarrierPendingCommand, expected: BarrierPendingCommand | null): void {
  const next = barrierPendingCommandSchema.parse(value), store = readStore(storage);
  const old = store.commands.find(item => item.projectId === next.projectId) ?? null;
  if (!same(old, expected) || expected && (expected.commandSha256 !== next.commandSha256 || !same(expected.scope, next.scope)
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
  return sealPendingBarrierCommand({ schemaVersion: 'wfc.pf.barrier-pending-command.v1', kind,
    projectId: scope.projectId, scope, commandSha256: await barrierPendingHash(command), tokenSha256: await barrierPendingTokenHash(token),
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
  } else if (value.publication.snapshot.snapshotId !== expected.snapshotId || value.publication.snapshot.mode !== 'mesh-set'
    || !same(value.publication.snapshot.scope, expected.scope)) throw new Error('BARRIER_OUTCOME_SNAPSHOT_CHANGED');
  return value;
}
