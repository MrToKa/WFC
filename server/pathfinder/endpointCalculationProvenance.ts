import { z } from 'zod';
import { endpointModeSchema, endpointPointSchema, type EndpointBinding } from '../../shared/pathfinderEndpointBindings.js';
import { policyHashSchema as hash, policyRevisionSchema as revision, policyUuidSchema as uuid } from '../../shared/pathfinderPurposePolicy.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { createHash } from 'node:crypto';

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
/** Machine-derived inputs are proposals, never a fabricated human confirmation. */
export const automaticEndpointCalculationPointSchema = z.object({
  kind: z.literal('automatic-equipment-anchor'), locationId: uuid, locationRevision: revision,
  point: endpointPointSchema, modelVersionId: uuid, artifactId: uuid, aggregateId: uuid,
  captureFrameId: uuid, projectionSha256: hash, traceId: uuid, traceContentSha256: hash,
  sourceObjectRevisionId: uuid, sourceObjectId: z.string().regex(/^dbid:(?:0|[1-9][0-9]*)$/).max(16)
    .refine(value => Number(value.slice(5)) <= 2147483647),
  sourceObjectRecordSha256: hash, orderedPlanSha256: hash, matchingEvidenceSha256: hash,
  matchingPolicyVersion: z.enum(['wfc.pf.project-exact-candidates.v1', 'wfc.pf.project-exact-candidates.v2']),
  matchedNames: z.array(z.string().min(1).max(500).refine(value => value === value.normalize('NFC').trim().toUpperCase() &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value))).min(1).max(4096)
    .refine(values => values.every((value, index) => index === 0 || values[index - 1] < value)),
  derivation: z.literal('equipment-bottom-aabb.v1'), approximate: z.literal(true),
  engineeringAccepted: z.literal(false), contentSha256: hash,
}).strict();
export type AutomaticEndpointCalculationPoint = z.infer<typeof automaticEndpointCalculationPointSchema>;
export type CurrentEndpointCalculationPoint = EndpointCalculationPoint | AutomaticEndpointCalculationPoint;
export const isAutomaticEndpointCalculationPoint = (value: CurrentEndpointCalculationPoint): value is AutomaticEndpointCalculationPoint =>
  'kind' in value && value.kind === 'automatic-equipment-anchor';
export function automaticEndpointContentHash(value: Omit<AutomaticEndpointCalculationPoint, 'contentSha256'>): string {
  return createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
}
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
  if (!['pathfinder.dependencies.v3', 'pathfinder.dependencies.v4', 'pathfinder.dependencies.v5', 'pathfinder.dependencies.v6'].includes(String(input.schemaVersion))) return false;
  const prep = endpointCalculationPreparationSchema.safeParse(input.preparation);
  const automatic = input.schemaVersion === 'pathfinder.dependencies.v6';
  const schema = automatic ? z.union([endpointCalculationPointSchema, automaticEndpointCalculationPointSchema]) : endpointCalculationPointSchema;
  const from = schema.safeParse(input.from);
  const to = schema.safeParse(input.to);
  if (!prep.success || !from.success || !to.success) return false;
  if (automatic && ![from.data, to.data].some(isAutomaticEndpointCalculationPoint)) return false;
  return [from.data, to.data].every(endpoint =>
    endpoint.aggregateId === prep.data.aggregateId &&
    endpoint.projectionSha256 === prep.data.projectionSha256 &&
    endpoint.captureFrameId === prep.data.captureFrameId &&
    (isAutomaticEndpointCalculationPoint(endpoint)
      ? (() => { const { contentSha256, ...body } = endpoint;
        const model = input.model as {id?: unknown} | undefined, artifact = input.artifact as {id?: unknown;sha256?: unknown} | undefined;
        return contentSha256 === automaticEndpointContentHash(body) && endpoint.modelVersionId === model?.id &&
          endpoint.artifactId === artifact?.id && endpoint.projectionSha256 === artifact?.sha256; })()
      : endpoint.mode !== 'object-attached' || endpoint.qualifiedProjectFrameId !== null && endpoint.sourceObjectRevisionId !== null),
  );
}
