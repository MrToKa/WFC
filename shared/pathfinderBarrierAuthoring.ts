import { z } from 'zod';
import { supportedBarrierRegistrySchema, supportedBarrierSnapshotSchema, supportedBarrierSnapshotReference } from './pathfinderBarrierSupported.js';
import { barrierCanonicalJson } from './pathfinderBarriers.js';

/** Authoring metadata only. This response never establishes routing readiness. */
export const barrierAuthoringRecoverySchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-authoring-recovery.v1'),
  registry: supportedBarrierRegistrySchema,
  savedManifest: supportedBarrierSnapshotSchema,
  geometryAvailable: z.literal(false),
}).strict().refine(value => value.registry.state === 'stale'
  && value.registry.reasonCodes.includes('BARRIER_BLOB_MISSING')
  && value.registry.scope.projectId === value.savedManifest.scope.projectId
  && barrierCanonicalJson(value.registry.snapshot) === barrierCanonicalJson(supportedBarrierSnapshotReference(value.savedManifest))
  && barrierCanonicalJson(value.registry.selectedParents) === barrierCanonicalJson(value.savedManifest.selectedParents));
