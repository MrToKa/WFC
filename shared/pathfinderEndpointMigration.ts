import { z } from 'zod';
import {
  endpointMigrationDecisionSchema as legacyDecisionSchema,
  endpointMigrationEvaluationSchema as legacyEvaluationSchema,
} from './pathfinderEndpointBindings.js';
import { endpointMigrationEvaluationV2Schema } from './pathfinderEndpointAttachmentV2.js';

/** Historical v1 evidence stays readable. New qualifications use a distinct policy. */
export const endpointMigrationEvaluationSchema = z.union([
  legacyEvaluationSchema, endpointMigrationEvaluationV2Schema,
]);
export const endpointMigrationDecisionV2Schema = z.object({
  ...legacyDecisionSchema.innerType().shape,
  schemaVersion: z.literal('wfc.pf.endpoint-migration-decision.v2'),
  evaluation: endpointMigrationEvaluationV2Schema,
}).strict().superRefine((value, context) => {
  if (value.sourceBindingId !== value.evaluation.sourceBindingId ||
      value.target.aggregateId !== value.evaluation.comparisonScope.targetAggregateId)
    context.addIssue({ code: 'custom', message: 'The original source binding and exact target comparison are retained.' });
});
export const endpointMigrationDecisionSchema = z.union([
  legacyDecisionSchema, endpointMigrationDecisionV2Schema,
]);
export type EndpointMigrationEvaluation = z.infer<typeof endpointMigrationEvaluationSchema>;
export type EndpointMigrationDecision = z.infer<typeof endpointMigrationDecisionSchema>;
export function endpointMigrationContentHashInput(value: EndpointMigrationDecision): unknown {
  const { contentSha256: _hash, ...input } = value;
  return input;
}
