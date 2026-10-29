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
  matchingPolicyVersion: z.enum(['wfc.pf.project-exact-candidates.v1', 'wfc.pf.project-exact-candidates.v2', 'wfc.pf.project-exact-candidates.v3']),
  matchedNames: z.array(z.string().min(1).max(500).refine(value => value === value.normalize('NFC').trim().toUpperCase() &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value))).min(1).max(4096)
    .refine(values => values.every((value, index) => index === 0 || values[index - 1] < value)),
  derivation: z.literal('equipment-bottom-aabb.v1'), approximate: z.literal(true),
  engineeringAccepted: z.literal(false), contentSha256: hash,
}).strict();
export type AutomaticEndpointCalculationPoint = z.infer<typeof automaticEndpointCalculationPointSchema>;
export type CurrentEndpointCalculationPoint = EndpointCalculationPoint | AutomaticEndpointCalculationPoint;
// NFC is applied to the original name before uppercase. Uppercase can itself
// produce decomposed characters; applying NFC a second time changes that key.
const scopedLogicalKey = z.string().min(1).max(4096).refine(value => value === value.trim().toUpperCase()
  && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff));
const scopedResolvedEndpoint = z.object({ logicalKey: scopedLogicalKey, locationId: uuid }).strict();
export const scopedEndpointResolutionSchema = z.object({ schemaVersion: z.literal('pathfinder.endpoint-resolution.v1'),
  matchingPolicy: z.literal('nfc-trim-uppercase-v1'), from: scopedResolvedEndpoint, to: scopedResolvedEndpoint }).strict();
export type ScopedEndpointResolution = z.infer<typeof scopedEndpointResolutionSchema>;
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
  if (!['pathfinder.dependencies.v3', 'pathfinder.dependencies.v4', 'pathfinder.dependencies.v5', 'pathfinder.dependencies.v6', 'pathfinder.dependencies.v7', 'pathfinder.dependencies.v8'].includes(String(input.schemaVersion))) return false;
  const prep = endpointCalculationPreparationSchema.safeParse(input.preparation);
  const scoped = input.schemaVersion === 'pathfinder.dependencies.v7' || input.schemaVersion === 'pathfinder.dependencies.v8', automatic = input.schemaVersion === 'pathfinder.dependencies.v6' || scoped;
  const schema = automatic ? z.union([endpointCalculationPointSchema, automaticEndpointCalculationPointSchema]) : endpointCalculationPointSchema;
  const from = schema.safeParse(input.from);
  const to = schema.safeParse(input.to);
  if (!prep.success || !from.success || !to.success) return false;
  if (input.schemaVersion === 'pathfinder.dependencies.v6' && ![from.data, to.data].some(isAutomaticEndpointCalculationPoint)) return false;
  if (scoped) {
    const resolution = scopedEndpointResolutionSchema.safeParse(input.endpointResolution), cableInputs = input.cableInputs as { fromLocation?: unknown; toLocation?: unknown } | undefined;
    const artifact = input.artifact as { sha256?: unknown } | undefined;
    if (!resolution.success || Object.prototype.hasOwnProperty.call(input, 'registryRevision') || prep.data.projectionSha256 !== artifact?.sha256
      || typeof cableInputs?.fromLocation !== 'string' || typeof cableInputs?.toLocation !== 'string'
      || resolution.data.from.logicalKey !== cableInputs.fromLocation.normalize('NFC').trim().toUpperCase()
      || resolution.data.to.logicalKey !== cableInputs.toLocation.normalize('NFC').trim().toUpperCase()
      || resolution.data.from.locationId !== from.data.locationId || resolution.data.to.locationId !== to.data.locationId) return false;
  }
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
