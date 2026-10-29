import { z } from 'zod';

/** This invocation did not commit a calculation job. Registry matching may
 * already have committed; this is not evidence about any earlier invocation. */
export const calculationSubmissionRefusalSchema = z.object({
  schemaVersion: z.literal('wfc.pf.calculation-submission-refusal.v1'),
  calculationSubmitted: z.literal(false),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/),
  error: z.string().max(4096),
}).strict();

export function calculationSubmissionRefusalMessage(code: string): string {
  if (code === 'ENDPOINT_PREPARATION_REQUIRED' || code === 'ROUTING_PREPARATION_REQUIRED')
    return 'The current model preparation needs to be refreshed before this cable can be calculated. No calculation job was created.';
  if (code.startsWith('BARRIER_'))
    return 'The current obstacles could not be confirmed for this calculation. Refresh barriers and check the routing settings, then calculate again. No calculation job was created.';
  if (code === 'REGISTRY_CONFLICT')
    return 'The saved locations changed. Refresh From/To and cable status, then calculate again. No calculation job was created.';
  if (code === 'NO_CABLES')
    return 'This cable is no longer available in the calculation scope. Refresh cable status. No calculation job was created.';
  return 'The calculation request was refused before a job was created. Refresh cable status and check the current routing settings, then choose Calculate routing again.';
}
