import { z } from 'zod';
import { isPathFinderCableEligible } from './pathfinderCableEligibility.js';
import { policyHashSchema as hash, policyRevisionSchema as revision, policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';
import { endpointCurrentScopeSchema } from './pathfinderEndpointBindings.js';
import { recalculationPreferencesSchema, recalculationReasonSchema, recalculationTimeoutSchema } from './pathfinderRecalculation.js';
import { automaticPairPolicySchema } from './pathfinderAutomaticPair.js';

export const LOCATION_IMPACT_LIMITS = Object.freeze({ cables: 10000, chunk: 250, recordBytes: 1024 * 1024, itemBytes: 32768,
  collectionBytes: 32 * 1024 * 1024, history: 10000, pageSize: 100, attempts: 3, authorityMilliseconds: 1800000, leaseMilliseconds: 60000 });
const timestamp = z.string().datetime().refine(value => value.endsWith('Z'));
const count = z.number().int().min(0).max(LOCATION_IMPACT_LIMITS.cables);
const ids = z.array(uuid).max(LOCATION_IMPACT_LIMITS.cables).refine(values => values.every((value, at) => at === 0 || values[at - 1] < value));
const codes = z.array(recalculationReasonSchema).max(64).refine(values => new Set(values).size === values.length);
export const locationImpactCalculationSchema = z.object({ preferences: recalculationPreferencesSchema, timeoutMilliseconds: recalculationTimeoutSchema }).strict();
export type LocationImpactCalculation = z.infer<typeof locationImpactCalculationSchema>;
const sameBarrierScope = (projectId: string, current: z.infer<typeof endpointCurrentScopeSchema>, calculation: LocationImpactCalculation | null): boolean => {
  const scope = calculation?.preferences.barrierRouting?.scope;
  return !scope || scope.projectId === projectId && scope.modelVersionId === current.modelVersionId
    && scope.selectionRevision === current.selectionRevision && scope.contentFingerprint === current.contentFingerprint
    && scope.captureFrameId === current.captureFrameId;
};
export const locationImpactReferenceSchema = z.object({ id: uuid, status: z.enum(['pending', 'blocked']), eligibleCables: count,
  excludedMvCables: count, blockedCategoryCables: count }).strict();
const locationImpactRecordBody = z.object({ id: uuid, projectId: uuid,
  actorId: uuid, actorAdminRevision: revision, loginId: uuid, loginExpiresAt: timestamp, authorityExpiresAt: timestamp, installationEpoch: uuid,
  idempotencyKey: uuid, commandSha256: hash, locationId: uuid, bindingId: uuid, bindingContentSha256: hash, observedRegistryRevision: revision,
  current: endpointCurrentScopeSchema, calculation: locationImpactCalculationSchema.nullable(),
  eligibleCableIds: ids, excludedMvCableIds: ids, blockedCategoryCableIds: ids, createdAt: timestamp, contentSha256: hash }).strict();
export const locationImpactRecordSchema = z.discriminatedUnion('schemaVersion',[
  locationImpactRecordBody.extend({schemaVersion:z.literal('wfc.pf.location-impact-record.v1')}),
  locationImpactRecordBody.extend({schemaVersion:z.literal('wfc.pf.location-impact-record.v2'),originCableId:uuid}),
  locationImpactRecordBody.extend({schemaVersion:z.literal('wfc.pf.location-impact-record.v3'),originCableId:uuid,
    automaticPairPolicy:automaticPairPolicySchema.nullable()}),
]).superRefine((value, context) => {
  const all = [...value.eligibleCableIds, ...value.excludedMvCableIds, ...value.blockedCategoryCableIds];
  if (all.length > LOCATION_IMPACT_LIMITS.cables || new Set(all).size !== all.length || Date.parse(value.authorityExpiresAt) > Date.parse(value.loginExpiresAt)
    || Date.parse(value.authorityExpiresAt) - Date.parse(value.createdAt) > LOCATION_IMPACT_LIMITS.authorityMilliseconds
    || !sameBarrierScope(value.projectId, value.current, value.calculation)
    || value.schemaVersion === 'wfc.pf.location-impact-record.v3' && value.automaticPairPolicy !== null && value.calculation === null
    || value.schemaVersion !== 'wfc.pf.location-impact-record.v1' && !value.eligibleCableIds.includes(value.originCableId))
    context.addIssue({ code: 'custom', message: 'A bounded impact retains a disjoint complete scope and finite original-login authority.' });
});
export type LocationImpactRecord = z.infer<typeof locationImpactRecordSchema>;
export const locationImpactItemSchema = z.object({ schemaVersion: z.literal('wfc.pf.location-impact-item.v1'), projectId: uuid, impactId: uuid,
  cableId: uuid, generation: revision, cableWriteRevision: revision, fromLogicalKey: z.string().max(8192).nullable(), toLogicalKey: z.string().max(8192).nullable(),
  category: z.string().max(96).nullable(), eligible: z.boolean(), contentSha256: hash }).strict().refine(value =>
  // Retain pre-MTO-independent blocked items as immutable historical evidence.
  (value.eligible ? isPathFinderCableEligible(value.category) : !['LV', 'Control', 'Instrumentation'].includes(value.category ?? '')) && value.category !== 'MV'
  && BigInt(value.generation) > 0n
  && [value.fromLogicalKey, value.toLogicalKey].every(key => key === null || key === key.trim().toUpperCase()));
export type LocationImpactItem = z.infer<typeof locationImpactItemSchema>;
export const locationImpactStatusSchema = z.enum(['pending', 'collecting', 'queued', 'running', 'complete', 'blocked', 'superseded', 'cancelled', 'failed', 'awaiting-authority', 'restore-fenced']);
export const locationImpactSummarySchema = z.object({ id: uuid, projectId: uuid, actorId: uuid, modelVersionId: uuid, selectionRevision: revision,
  contentFingerprint: hash, current: endpointCurrentScopeSchema, calculation: locationImpactCalculationSchema.nullable(), status: locationImpactStatusSchema, reasonCodes: codes,
  eligibleCables: count, excludedMvCables: count, blockedCategoryCables: count, currentTargetCables: count,
  completed: count, total: count, readyCables: count, blockedCables: count, jobId: uuid.nullable(), createdAt: timestamp, updatedAt: timestamp,
  admittedAt: timestamp.nullable(), authorityExpiresAt: timestamp, currentAuthority: z.boolean(),
  elapsedMilliseconds: z.number().int().nonnegative(), admissionElapsedMilliseconds: z.number().int().nonnegative().nullable() }).strict().superRefine((value, context) => {
  if (value.completed > value.total || value.readyCables + value.blockedCables > value.total || value.currentTargetCables > value.eligibleCables
    || value.eligibleCables + value.excludedMvCables + value.blockedCategoryCables > LOCATION_IMPACT_LIMITS.cables
    || value.current.modelVersionId !== value.modelVersionId || value.current.selectionRevision !== value.selectionRevision || value.current.contentFingerprint !== value.contentFingerprint
    || !sameBarrierScope(value.projectId, value.current, value.calculation))
    context.addIssue({ code: 'custom', message: 'Observed impact progress cannot exceed its exact bounded scope.' });
});
export type LocationImpactSummary = z.infer<typeof locationImpactSummarySchema>;
export const locationImpactProgressSchema = z.object({ schemaVersion: z.literal('wfc.pf.location-impact-progress.v1'), projectId: uuid,
  impact: locationImpactSummarySchema }).strict().refine(value => value.impact.projectId === value.projectId);
export type LocationImpactProgress = z.infer<typeof locationImpactProgressSchema>;
export const locationImpactPageSchema = z.object({ schemaVersion: z.literal('wfc.pf.location-impact-page.v1'), projectId: uuid,
  impacts: z.array(locationImpactSummarySchema).max(LOCATION_IMPACT_LIMITS.pageSize), nextBeforeId: uuid.nullable() }).strict().refine(value =>
  value.impacts.every(item => item.projectId === value.projectId) && new Set(value.impacts.map(item => item.id)).size === value.impacts.length
  && (value.nextBeforeId === null || value.nextBeforeId === value.impacts.at(-1)?.id));
export type LocationImpactPage = z.infer<typeof locationImpactPageSchema>;
export const locationImpactPageQuerySchema = z.object({ beforeId: uuid.optional(), limit: z.number().int().min(1).max(LOCATION_IMPACT_LIMITS.pageSize).default(25) }).strict();
export type LocationImpactPageQuery = z.input<typeof locationImpactPageQuerySchema>;
