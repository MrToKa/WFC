import { z } from 'zod';

const count = z.number().int().nonnegative();
export const gvlPilotQualitySchema = z.object({
  schemaVersion: z.literal('wfc.gvl244.stage6.view.v1'),
  projectId: z.string().uuid(),
  modelVersionId: z.string().uuid(),
  capturedAt: z.string().datetime({ offset: true }),
  pagesTotal: count, pagesAnalyzed: count,
  locationsChecked: count, verifiedBindings: count, reviewLocations: count,
  apiAttempts: count, estimatedUsd: z.number().finite().nonnegative(),
  ceilingUsd: z.number().finite().nonnegative(), cacheHitRate: z.number().min(0).max(1).nullable(),
  checksPassed: count, checksTotal: count,
}).strict().refine(v => v.pagesAnalyzed <= v.pagesTotal && v.checksPassed <= v.checksTotal
  && v.verifiedBindings + v.reviewLocations <= v.locationsChecked);
