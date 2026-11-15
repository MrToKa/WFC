import { z } from 'zod';
import { parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { cableEndpointCommandSchema, cableEndpointEndSchema, type CableEndpointCommand } from '../../shared/pathfinderCableEndpoints';
import { LEGACY_CABLE_ENDPOINT_PENDING_PREFIX, CABLE_ENDPOINT_PAIR_PENDING_PREFIX } from './cableEndpointPendingKeys';
import { EndpointPendingLockError, withEndpointPendingLock } from './endpointPendingLock';

export const CABLE_ENDPOINT_PENDING_PREFIX = LEGACY_CABLE_ENDPOINT_PENDING_PREFIX;
const MAX_BYTES = 128 * 1024;
const ownerSchema = z.object({ accountId: policyUuidSchema, projectId: policyUuidSchema }).strict();
const pendingSchema = ownerSchema.extend({ schemaVersion: z.literal('wfc.pf.pending-cable-endpoint.v1'), cableId: policyUuidSchema,
  end: cableEndpointEndSchema, createdAt: z.string().datetime(), command: cableEndpointCommandSchema }).strict();
export type CableEndpointPendingOwner = z.infer<typeof ownerSchema>;
export type PendingCableEndpoint = z.infer<typeof pendingSchema>;
export class CableEndpointStorageError extends Error {}
const key = (owner: CableEndpointPendingOwner) => { const value = ownerSchema.parse(owner); return `${CABLE_ENDPOINT_PENDING_PREFIX}${value.accountId}:${value.projectId}`; };
const same = (a: PendingCableEndpoint, b: PendingCableEndpoint) => JSON.stringify(pendingSchema.parse(a)) === JSON.stringify(pendingSchema.parse(b));
export function readPendingCableEndpoint(owner: CableEndpointPendingOwner): PendingCableEndpoint | null {
  const raw = localStorage.getItem(key(owner)); if (raw === null) return null;
  const value = pendingSchema.parse(parsePurposeJson(raw, { maximumBytes: MAX_BYTES }));
  if (value.accountId !== owner.accountId || value.projectId !== owner.projectId) throw new CableEndpointStorageError('Pending endpoint ownership could not be verified.');
  return value;
}
async function locked<T>(owner: CableEndpointPendingOwner, work: () => T): Promise<T> {
  try { return await withEndpointPendingLock([key(owner)], work); }
  catch (error) {
    if (error instanceof EndpointPendingLockError) throw new CableEndpointStorageError(error.message);
    throw error;
  }
}
function writePending(owner: CableEndpointPendingOwner, value: PendingCableEndpoint) {
  const encoded = JSON.stringify(pendingSchema.parse(value));
  if (new TextEncoder().encode(encoded).byteLength > MAX_BYTES) throw new CableEndpointStorageError('Pending endpoint recovery exceeds its supported size.');
  localStorage.setItem(key(owner), encoded);
  if (localStorage.getItem(key(owner)) !== encoded) throw new CableEndpointStorageError('The exact endpoint command could not be retained. No save was sent.');
}
/** Must complete before PUT. A second tab cannot replace an unresolved command. */
export function retainPendingCableEndpoint(owner: CableEndpointPendingOwner, cableId: string, end: 'from' | 'to', command: CableEndpointCommand): Promise<PendingCableEndpoint> {
  return locked(owner, () => {
    if (localStorage.getItem(`${CABLE_ENDPOINT_PAIR_PENDING_PREFIX}${owner.accountId}:${owner.projectId}`) !== null)
      throw new CableEndpointStorageError('A cable endpoint Save is pending. Reconcile it before another assignment.');
    if (readPendingCableEndpoint(owner)) throw new CableEndpointStorageError('A shared endpoint save is already pending for this account and project. Reconcile it first.');
    const intent = pendingSchema.parse({ ...ownerSchema.parse(owner), schemaVersion: 'wfc.pf.pending-cable-endpoint.v1', cableId, end,
      createdAt: new Date().toISOString(), command: cableEndpointCommandSchema.parse(command) });
    writePending(owner, intent); return structuredClone(intent);
  });
}
export function verifyPendingCableEndpoint(owner: CableEndpointPendingOwner, expected: PendingCableEndpoint): Promise<PendingCableEndpoint> {
  return locked(owner, () => { const actual = readPendingCableEndpoint(owner);
    if (!actual || !same(actual, expected)) throw new CableEndpointStorageError('The retained endpoint command changed. Do not send a replacement.'); return actual; });
}
/** Call only after the matching save receipt or immutable server closure proof. */
export function clearPendingCableEndpoint(owner: CableEndpointPendingOwner, expected: PendingCableEndpoint): Promise<void> {
  return locked(owner, () => {
    const actual = readPendingCableEndpoint(owner); if (!actual || !same(actual, expected)) throw new CableEndpointStorageError('The retained endpoint command changed. Preserve recovery storage.');
    localStorage.removeItem(key(owner)); if (localStorage.getItem(key(owner)) !== null) throw new CableEndpointStorageError('The confirmed endpoint receipt could not be recorded locally.');
  });
}
