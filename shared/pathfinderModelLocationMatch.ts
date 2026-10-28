import { z } from 'zod';
import { endpointCurrentScopeSchema, endpointLocationNameSchema, endpointModelMatchBoundsSchema, endpointPointSchema, normalizeEndpointLocation } from './pathfinderEndpointBindings.js';
import { endpointVisibilitySchema } from './pathfinderPreparation.js';
import { canonicalPurposeJson, policyHashSchema as hash, policyRevisionSchema as revision, policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';

export const MODEL_LOCATION_MATCH_LIMITS = Object.freeze({ names: 4096, pageNames: 128, candidates: 4096, bodyBytes: 1024 * 1024, responseBytes: 1024 * 1024 });
const uniqueNames = (v: string[]) => new Set(v.map(normalizeEndpointLocation)).size === v.length;
const matchName = endpointLocationNameSchema.refine(v => v.length <= 256);
const names = z.array(matchName).max(MODEL_LOCATION_MATCH_LIMITS.names).refine(uniqueNames);
const count = z.number().int().nonnegative().max(1_000_000);
export const modelLocationMatchContextSchema = z.object({
  schemaVersion: z.literal('wfc.pf.model-location-match-context.v1'), projectId: uuid, current: endpointCurrentScopeSchema,
  registryRevision: revision, names, namesSha256: hash,
}).strict();
export const modelLocationMatchCandidateSchema = z.object({
  objectId: z.number().int().nonnegative().max(2147483647), name: z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/u)
    .refine(v => v.trim().length > 0 && [...v].every(c => c.length !== 1 || c.charCodeAt(0) < 0xd800 || c.charCodeAt(0) > 0xdfff)),
  matchedNames: z.array(matchName).min(1).max(MODEL_LOCATION_MATCH_LIMITS.pageNames).refine(uniqueNames),
  bounds: endpointModelMatchBoundsSchema.nullable(), bottomCentre: endpointPointSchema.nullable(),
}).strict().refine(v => (v.bounds === null) === (v.bottomCentre === null) && (!v.bounds || !v.bottomCentre || (
  v.bottomCentre[0] === (v.bounds.minimum[0] + v.bounds.maximum[0]) / 2
  && v.bottomCentre[1] === (v.bounds.minimum[1] + v.bounds.maximum[1]) / 2 && v.bottomCentre[2] === v.bounds.minimum[2])));
export const modelLocationMatchScanSchema = z.object({
  matchingPolicyVersion: z.literal('wfc.pf.project-exact-candidates.v3'), visibilityScope: endpointVisibilitySchema,
  indexedObjectCount: count, propertyScan: z.object({ attemptedObjectCount: count, returnedObjectCount: count, omittedObjectCount: z.literal(0), complete: z.literal(true) }).strict(),
  complete: z.literal(true), candidates: z.array(modelLocationMatchCandidateSchema).max(MODEL_LOCATION_MATCH_LIMITS.candidates)
    .refine(v => new Set(v.map(c => c.objectId)).size === v.length),
}).strict().refine(v => v.indexedObjectCount === v.propertyScan.attemptedObjectCount && v.indexedObjectCount === v.propertyScan.returnedObjectCount);
export const modelLocationMatchAssignSchema = z.object({
  schemaVersion: z.literal('wfc.pf.model-location-match-assign.v1'), current: endpointCurrentScopeSchema, namesSha256: hash,
  expectedRegistryRevision: revision, idempotencyKey: uuid,
  names: names.refine(v => v.length > 0 && v.length <= MODEL_LOCATION_MATCH_LIMITS.pageNames), scan: modelLocationMatchScanSchema,
}).strict().refine(v => v.scan.candidates.every(c => c.matchedNames.every(n => v.names.some(p => normalizeEndpointLocation(p) === normalizeEndpointLocation(n)))));
export const modelLocationMatchResultSchema = z.object({
  name: endpointLocationNameSchema, status: z.enum(['assigned', 'preserved', 'missing', 'ambiguous', 'unavailable']),
  candidateObjectIds: z.array(z.number().int().nonnegative().max(2147483647)).max(MODEL_LOCATION_MATCH_LIMITS.candidates).refine(v => new Set(v).size === v.length),
  locationId: uuid.nullable(), bindingId: uuid.nullable(), reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/).nullable(),
}).strict().refine(v => v.status === 'assigned' ? v.locationId !== null && v.bindingId !== null && v.candidateObjectIds.length === 1 && v.candidateObjectIds[0] > 0 && v.reasonCode === null
  : v.status === 'preserved' ? v.locationId !== null && v.reasonCode !== null
    : v.reasonCode !== null && (v.status === 'missing' ? v.candidateObjectIds.length === 0 : v.status === 'ambiguous' ? v.candidateObjectIds.length > 1 : v.candidateObjectIds.length === 1));
export const modelLocationMatchReceiptSchema = z.object({
  schemaVersion: z.literal('wfc.pf.model-location-match-receipt.v1'), projectId: uuid, idempotencyKey: uuid, commandSha256: hash,
  registryRevision: revision, results: z.array(modelLocationMatchResultSchema).max(MODEL_LOCATION_MATCH_LIMITS.pageNames)
    .refine(v => uniqueNames(v.map(r => r.name))), duplicate: z.boolean(),
}).strict();
export const modelLocationMatchNamesHashInput = (value: string[]) => [...value].map(normalizeEndpointLocation).sort();
export const modelLocationMatchCanonicalJson = canonicalPurposeJson;
export type ModelLocationMatchContext = z.infer<typeof modelLocationMatchContextSchema>;
export type ModelLocationMatchAssign = z.infer<typeof modelLocationMatchAssignSchema>;
export type ModelLocationMatchReceipt = z.infer<typeof modelLocationMatchReceiptSchema>;
export type ModelLocationMatchResult = z.infer<typeof modelLocationMatchResultSchema>;
