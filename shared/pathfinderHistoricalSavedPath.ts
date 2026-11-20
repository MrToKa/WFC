import { z } from 'zod';
import { endpointCurrentScopeSchema, endpointPointSchema } from './pathfinderEndpointBindings.js';
import { policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

/** The exact geometry that produced the stored route, for viewing in this verified model frame. */
export const historicalSavedPathSchema = z.object({
  projectId: policyUuidSchema, cableId: policyUuidSchema, cableWriteRevision: policyRevisionSchema,
  routing: z.string().min(1).max(8000), designLength: z.string().max(100).regex(/^\d+(?:\.\d+)?$/),
  proposalId: policyUuidSchema, current: endpointCurrentScopeSchema, points: z.array(endpointPointSchema).min(2).max(20000),
  // Older servers returned only the line. Preserve the complete recorded
  // foreground when available, including CAD identities understood by callers.
  objectIds: z.array(z.string().max(256)).max(200000).optional(),
}).strict();
export type HistoricalSavedPath = z.infer<typeof historicalSavedPathSchema>;
