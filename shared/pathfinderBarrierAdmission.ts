import { z } from 'zod';
import {
  barrierCanonicalJson, barrierModelScopeSchema, barrierRegistrySchema, barrierSnapshotReferenceSchema,
  type BarrierRegistry,
} from './pathfinderBarriers.js';
import { policyRevisionSchema } from './pathfinderPurposePolicy.js';

export const BARRIER_ADMISSION_INTENT_VERSION = 'wfc.pf.barrier-admission-intent.v1' as const;

/** An explicit submitted choice and expected current registry reference, never a
 * server-owned policy/hash or a geometric clearance certificate. Historical
 * request schemas remain unchanged. Fresh UI state alone defaults drilling off. */
export const barrierAdmissionIntentSchema = z.object({
  schemaVersion: z.literal(BARRIER_ADMISSION_INTENT_VERSION), scope: barrierModelScopeSchema,
  expectedRegistryRevision: policyRevisionSchema, expectedSnapshot: barrierSnapshotReferenceSchema.nullable(),
  drillThroughWalls: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.expectedSnapshot === null) {
    if (!value.drillThroughWalls) context.addIssue({ code: 'custom', message: 'An unpublished scope requires explicit drilling; null is never an empty barrier declaration.' });
  } else if (value.expectedSnapshot.registryRevision !== value.expectedRegistryRevision
    || barrierCanonicalJson(value.expectedSnapshot.scope) !== barrierCanonicalJson(value.scope)) {
    context.addIssue({ code: 'custom', message: 'Expected snapshot must name the exact current model/frame and registry revision.' });
  }
});
export type BarrierAdmissionIntent = z.infer<typeof barrierAdmissionIntentSchema>;

/** Snapshot current strict registry data. A stale/refused/partial/unknown set
 * cannot be silently dropped even when drilling is selected. The server must
 * independently recollect role, model, registry and all calculation dependencies. */
export function createBarrierAdmissionIntent(registry: BarrierRegistry | null | undefined, drillThroughWalls: boolean): BarrierAdmissionIntent | null {
  if (typeof drillThroughWalls !== 'boolean') return null;
  const current = barrierRegistrySchema.safeParse(registry);
  if (!current.success) return null;
  const value = current.data;
  if (value.state !== 'ready' && !(value.state === 'unconfigured' && drillThroughWalls)) return null;
  const result = barrierAdmissionIntentSchema.safeParse({ schemaVersion: BARRIER_ADMISSION_INTENT_VERSION, scope: value.scope,
    expectedRegistryRevision: value.registryRevision, expectedSnapshot: value.snapshot, drillThroughWalls });
  return result.success ? result.data : null;
}

/** Exact strict replay ownership comparison. Only two absent legacy fields can
 * compare equal without a versioned intent; malformed/null data is not legacy. */
export function sameBarrierAdmissionIntent(left: unknown, right: unknown): boolean {
  if (left === undefined && right === undefined) return true;
  const first = barrierAdmissionIntentSchema.safeParse(left), last = barrierAdmissionIntentSchema.safeParse(right);
  return first.success && last.success && barrierCanonicalJson(first.data) === barrierCanonicalJson(last.data);
}
