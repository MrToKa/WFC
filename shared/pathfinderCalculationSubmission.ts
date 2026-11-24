import { z } from 'zod';

export const BULK_CALCULATION_SUBMISSION_LIMITS = Object.freeze({
  admissionMilliseconds: 120_000,
  responseMilliseconds: 150_000,
  dependencyBytesPerCable: 256 * 1024,
});

/** This invocation did not commit a calculation job. Registry matching may
 * already have committed; this is not evidence about any earlier invocation. */
export const calculationSubmissionRefusalSchema = z.object({
  schemaVersion: z.literal('wfc.pf.calculation-submission-refusal.v1'),
  calculationSubmitted: z.literal(false),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/),
  error: z.string().max(4096),
}).strict();

export function calculationSubmissionRefusalMessage(code: string): string {
  if (code === 'ACCEPTED_BASELINES_TIMEOUT')
    return 'The database timed out while reading the last accepted cable routes. This attempt did not start a calculation. You can retry.';
  if (code === 'LOGIN_EXPIRED' || code === 'LOGIN_REVOKED' || code === 'LOGIN_REFRESH_REQUIRED')
    return 'The login that authorized this calculation is no longer active. Sign in again and start a new recalculation.';
  if (code === 'ADMIN_REQUIRED') return 'Preparing this calculation requires current administrator access.';
  if (code === 'RECALCULATION_COLLECTION_DEADLINE')
    return 'The preparation time limit was reached before calculation started. You can start another recalculation.';
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
