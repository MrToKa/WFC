import { z } from 'zod';
import { parsePurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { cableEndpointPairCommandSchema, type CableEndpointPairCommand } from '../../shared/pathfinderCableEndpointPair';
import { LEGACY_CABLE_ENDPOINT_PENDING_PREFIX, CABLE_ENDPOINT_PAIR_PENDING_PREFIX } from './cableEndpointPendingKeys';
export { CABLE_ENDPOINT_PAIR_PENDING_PREFIX } from './cableEndpointPendingKeys';

const ownerSchema = z.object({ accountId: policyUuidSchema, projectId: policyUuidSchema }).strict();
const pendingSchema = ownerSchema.extend({ schemaVersion: z.literal('wfc.pf.pending-cable-endpoint-pair.v1'),
  cableId: policyUuidSchema, createdAt: z.string().datetime(), command: cableEndpointPairCommandSchema }).strict();
export type CableEndpointPairPendingOwner = z.infer<typeof ownerSchema>;
export type PendingCableEndpointPair = z.infer<typeof pendingSchema>;
export class CableEndpointPairStorageError extends Error {}
const key = (owner: CableEndpointPairPendingOwner, prefix = CABLE_ENDPOINT_PAIR_PENDING_PREFIX) => {
  const parsed = ownerSchema.parse(owner); return `${prefix}${parsed.accountId}:${parsed.projectId}`;
};
const same = (left: PendingCableEndpointPair, right: PendingCableEndpointPair) => JSON.stringify(pendingSchema.parse(left)) === JSON.stringify(pendingSchema.parse(right));
export function readPendingCableEndpointPair(owner: CableEndpointPairPendingOwner): PendingCableEndpointPair | null {
  const raw = localStorage.getItem(key(owner)); if (raw === null) return null;
  const parsed = pendingSchema.parse(parsePurposeJson(raw, { maximumBytes: 256 * 1024 }));
  if (parsed.accountId !== owner.accountId || parsed.projectId !== owner.projectId) throw new CableEndpointPairStorageError('Pending Save ownership could not be verified.');
  return parsed;
}
async function locked<T>(owner: CableEndpointPairPendingOwner, work: () => T): Promise<T> {
  if (!navigator.locks?.request) throw new CableEndpointPairStorageError('Safe Save recovery requires browser storage and Web Locks. No Save was sent.');
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
  try {
    // Existing per-endpoint writers use the legacy lock; pair writers acquire
    // that same lock first, then their own, so neither pending kind races past it.
    return await navigator.locks.request(key(owner, LEGACY_CABLE_ENDPOINT_PENDING_PREFIX), { mode: 'exclusive', signal: abort.signal },
      () => navigator.locks.request(key(owner), { mode: 'exclusive', signal: abort.signal }, work));
  } finally { clearTimeout(timer); }
}
export function retainPendingCableEndpointPair(owner: CableEndpointPairPendingOwner, cableId: string, command: CableEndpointPairCommand): Promise<PendingCableEndpointPair> {
  return locked(owner, () => {
    if (localStorage.getItem(key(owner, LEGACY_CABLE_ENDPOINT_PENDING_PREFIX)) !== null || readPendingCableEndpointPair(owner))
      throw new CableEndpointPairStorageError('An endpoint Save is already pending. Reconcile it first.');
    const pending = pendingSchema.parse({ ...ownerSchema.parse(owner), schemaVersion: 'wfc.pf.pending-cable-endpoint-pair.v1',
      cableId, createdAt: new Date().toISOString(), command });
    const encoded = JSON.stringify(pending);
    if (new TextEncoder().encode(encoded).byteLength > 256 * 1024) throw new CableEndpointPairStorageError('The pending Save exceeds its supported size.');
    localStorage.setItem(key(owner), encoded);
    if (localStorage.getItem(key(owner)) !== encoded) throw new CableEndpointPairStorageError('The exact Save could not be retained. No Save was sent.');
    return structuredClone(pending);
  });
}
export function verifyPendingCableEndpointPair(owner: CableEndpointPairPendingOwner, expected: PendingCableEndpointPair): Promise<PendingCableEndpointPair> {
  return locked(owner, () => {
    const actual = readPendingCableEndpointPair(owner);
    if (!actual || !same(actual, expected)) throw new CableEndpointPairStorageError('The pending Save changed. Do not send a replacement.');
    return actual;
  });
}
export function clearPendingCableEndpointPair(owner: CableEndpointPairPendingOwner, expected: PendingCableEndpointPair): Promise<void> {
  return locked(owner, () => {
    const actual = readPendingCableEndpointPair(owner);
    if (!actual || !same(actual, expected)) throw new CableEndpointPairStorageError('Preserve the pending Save for reconciliation.');
    localStorage.removeItem(key(owner));
    if (localStorage.getItem(key(owner)) !== null) throw new CableEndpointPairStorageError('The confirmed Save could not be recorded locally.');
  });
}
