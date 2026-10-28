import { z } from 'zod';

/** Display-only evidence; this field never authorizes calculation, Review or Apply. */
export const CALCULATION_AVAILABILITY_LIMITS = Object.freeze({ candidateObjectIds: 2048 });
export const calculationAvailabilitySchema = z.object({
  status: z.enum(['confirmed-ready', 'automatic-ready', 'missing', 'ambiguous',
    'saved-binding-required', 'object-unverified', 'preparation-required', 'not-evaluated']),
  pointAvailable: z.boolean(),
  source: z.enum(['confirmed-shared-location', 'automatic-model-candidate']).nullable(),
  approximate: z.boolean(),
  candidateObjectIds: z.array(z.string().min(1).max(256)).max(CALCULATION_AVAILABILITY_LIMITS.candidateObjectIds),
  reasonCode: z.string().min(1).max(96).refine(value => /^[A-Z][A-Z0-9_]*$/.exec(value)?.[0] === value).nullable(),
  engineeringAccepted: z.literal(false),
}).strict().superRefine((value, context) => {
  const confirmed = value.status === 'confirmed-ready';
  const automatic = value.status === 'automatic-ready';
  const ready = confirmed || automatic;
  if (value.pointAvailable !== ready || value.approximate !== automatic ||
      value.source !== (confirmed ? 'confirmed-shared-location' : automatic ? 'automatic-model-candidate' : null) ||
      (ready ? value.reasonCode !== null : value.reasonCode === null) ||
      (automatic && value.candidateObjectIds.length !== 1) ||
      new Set(value.candidateObjectIds).size !== value.candidateObjectIds.length)
    context.addIssue({ code: 'custom', message: 'Calculation-point availability must agree with its evidence source and status.' });
});
export type CalculationAvailability = z.infer<typeof calculationAvailabilitySchema>;
export function notEvaluatedCalculationAvailability(reasonCode = 'AVAILABILITY_NOT_EVALUATED'): CalculationAvailability {
  return calculationAvailabilitySchema.parse({ status: 'not-evaluated', pointAvailable: false,
    source: null, approximate: false, candidateObjectIds: [], reasonCode, engineeringAccepted: false });
}
