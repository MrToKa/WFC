import { z } from 'zod';
import { endpointModeSchema, endpointPointSchema, type EndpointBinding } from '../../shared/pathfinderEndpointBindings.js';
import { policyHashSchema as hash, policyRevisionSchema as revision, policyUuidSchema as uuid } from '../../shared/pathfinderPurposePolicy.js';

/** Only versioned provenance enters new cable calculations. Historical v2 stays readable. */
export const endpointCalculationPointSchema = z.object({
  locationId: uuid, locationRevision: revision, bindingRevision: revision,
  point: endpointPointSchema, bindingId: uuid, bindingContentSha256: hash,
  mode: endpointModeSchema, captureFrameId: uuid, qualifiedProjectFrameId: uuid.nullable(),
  aggregateId: uuid, projectionSha256: hash, sourceObjectRevisionId: uuid.nullable(),
  migrationDecisionId: uuid.nullable(),
}).strict();
export const endpointCalculationPreparationSchema = z.object({
  aggregateId: uuid, geometryRevision: revision, captureFrameId: uuid, projectionSha256: hash,
}).strict();
export type EndpointCalculationPoint = z.infer<typeof endpointCalculationPointSchema>;
export type EndpointCalculationPreparation = z.infer<typeof endpointCalculationPreparationSchema>;
export function endpointCalculationPoint(binding: EndpointBinding): EndpointCalculationPoint {
  return endpointCalculationPointSchema.parse({locationId: binding.locationId, locationRevision: binding.locationRevision,
    bindingRevision: binding.bindingRevision, point: binding.pointProjectMetres, bindingId: binding.id,
    bindingContentSha256: binding.contentSha256, mode: binding.mode, captureFrameId: binding.captureFrameId,
    qualifiedProjectFrameId: binding.qualifiedProjectFrameId, aggregateId: binding.aggregateId,
    projectionSha256: binding.projectionSha256, sourceObjectRevisionId: binding.sourceObject?.objectRevisionId ?? null,
    migrationDecisionId: binding.sourceDecisionId});
}

/** Select only this independently versioned authority envelope; routing validates its own scope. */
export function hasCurrentEndpointCalculationProvenance(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 'pathfinder.dependencies.v3') return false;
  const prep = endpointCalculationPreparationSchema.safeParse(input.preparation);
  const from = endpointCalculationPointSchema.safeParse(input.from);
  const to = endpointCalculationPointSchema.safeParse(input.to);
  if (!prep.success || !from.success || !to.success) return false;
  return [from.data, to.data].every(endpoint =>
    endpoint.aggregateId === prep.data.aggregateId &&
    endpoint.projectionSha256 === prep.data.projectionSha256 &&
    endpoint.captureFrameId === prep.data.captureFrameId &&
    (endpoint.mode !== 'object-attached' || endpoint.qualifiedProjectFrameId !== null && endpoint.sourceObjectRevisionId !== null),
  );
}
