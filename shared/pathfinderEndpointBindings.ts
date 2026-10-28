import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

export const ENDPOINT_BINDING_LIMITS = Object.freeze({ controlBytes: 65536, responseBytes: 1024 * 1024, pageSize: 100, aliases: 100, name: 500, reason: 2048, candidates: 100 });
export const ENDPOINT_ATTACHMENT_POLICY = 'wfc.pf.endpoint-attachment-policy.v1' as const;
export const ENDPOINT_MATCHING_POLICY = 'nfc-trim-uppercase-v1' as const;
export const ENDPOINT_ANCHOR_RULE = 'equipment-bottom-aabb.v1' as const;
export const ENDPOINT_MODEL_MATCH_DERIVATION = 'matched-model-bottom-aabb.v1' as const;
const uuid = policyUuidSchema, revision = policyRevisionSchema, hash = policyHashSchema;
const wellFormed = (value: string) => [...value].every(c => c.length !== 1 || c.charCodeAt(0) < 0xd800 || c.charCodeAt(0) > 0xdfff);
const text = (maximum: number) => z.string().max(maximum).refine(v => wellFormed(v) && !/[\u0000-\u001f\u007f-\u009f]/u.test(v));
const nonempty = (maximum: number) => text(maximum).refine(v => v.trim().length > 0);
export const normalizeEndpointLocation = (value: string): string => value.normalize('NFC').trim().toUpperCase();
export const endpointLocationNameSchema = nonempty(ENDPOINT_BINDING_LIMITS.name).refine(v => v === v.normalize('NFC').trim());
const aliases = z.array(endpointLocationNameSchema).max(ENDPOINT_BINDING_LIMITS.aliases).refine(v => new Set(v.map(normalizeEndpointLocation)).size === v.length);
const timestamp = z.string().datetime().refine(v => v.endsWith('Z'));
const code = z.string().min(1).max(96).refine(v => /^[A-Z][A-Z0-9_]*$/.exec(v)?.[0] === v);
const codes = z.array(code).max(100).refine(v => new Set(v).size === v.length);
export const endpointPointSchema = z.tuple([z.number().finite().min(-1e9).max(1e9), z.number().finite().min(-1e9).max(1e9), z.number().finite().min(-1e9).max(1e9)]);
export const endpointDisplacementVectorSchema = z.tuple([z.number().finite().min(-2e9).max(2e9), z.number().finite().min(-2e9).max(2e9), z.number().finite().min(-2e9).max(2e9)]);
export const endpointModeSchema = z.enum(['fixed-world', 'object-derived', 'object-attached']);
export const endpointStatusSchema = z.enum(['confirmed', 'suggested', 'missing', 'ambiguous', 'stale', 'unsupported-attachment']);
export const endpointObjectRefSchema = z.object({ traceId: uuid, objectRevisionId: uuid, recordSha256: hash }).strict();
export const endpointCurrentScopeSchema = z.object({ modelVersionId: uuid, selectionRevision: revision, contentFingerprint: hash, aggregateId: uuid, artifactId: uuid, projectionSha256: hash, captureFrameId: uuid, geometryRevision: revision, traceId: uuid.nullable() }).strict();
export const endpointModelMatchBoundsSchema = z.object({ minimum: endpointPointSchema, maximum: endpointPointSchema }).strict()
  .refine(v => v.minimum.every((n, i) => n <= v.maximum[i]) && v.minimum.some((n, i) => n < v.maximum[i]));
/** An explicitly requested model-name batch observes approximate fixed points.
 * It neither claims retained mesh evidence nor follows later model revisions. */
export const endpointModelMatchEvidenceSchema = z.object({
  schemaVersion: z.literal('wfc.pf.model-location-match-evidence.v1'),
  operationId: uuid, commandSha256: hash, scanSha256: hash, namesSha256: hash,
  current: endpointCurrentScopeSchema, logicalKey: endpointLocationNameSchema,
  sdkObjectId: z.number().int().positive().max(2147483647), objectName: nonempty(2048),
  bounds: endpointModelMatchBoundsSchema, bottomCentre: endpointPointSchema,
  matchingPolicyVersion: z.literal('wfc.pf.project-exact-candidates.v3'), visibilityScopeSha256: hash,
  approximate: z.literal(true), engineeringAccepted: z.literal(false),
}).strict().refine(v => v.logicalKey === normalizeEndpointLocation(v.logicalKey)
  && v.bottomCentre[0] === (v.bounds.minimum[0] + v.bounds.maximum[0]) / 2
  && v.bottomCentre[1] === (v.bounds.minimum[1] + v.bounds.maximum[1]) / 2
  && v.bottomCentre[2] === v.bounds.minimum[2]);
export const endpointLocationSchema = z.object({ id: uuid, name: endpointLocationNameSchema, aliases, revision }).strict().refine(v => !v.aliases.some(a => normalizeEndpointLocation(a) === normalizeEndpointLocation(v.name)));
export const endpointReadinessSchema = z.object({ status: endpointStatusSchema, calculationReady: z.boolean(), reasonCodes: codes }).strict().refine(v => !v.calculationReady || v.status === 'confirmed' && v.reasonCodes.length === 0);
export const endpointUsageSchema = z.object({ fromOccurrences: z.number().int().nonnegative().max(10_000_000), toOccurrences: z.number().int().nonnegative().max(10_000_000), distinctCables: z.number().int().nonnegative().max(10_000_000) }).strict();
export const endpointCapabilitySchema = z.object({ mode: endpointModeSchema, supported: z.boolean(), reasonCodes: codes }).strict().refine(v => v.supported ? v.reasonCodes.length === 0 : v.reasonCodes.length > 0);
export const endpointAttachmentSchema = z.object({ evidenceId: uuid, evidenceSha256: hash, logicalObjectId: uuid, localPointMetres: endpointPointSchema, connectorId: nonempty(500).nullable(), sourceShapeSha256: hash, sourcePlacementSha256: hash, transformPolicyVersion: z.literal(ENDPOINT_ATTACHMENT_POLICY), frameDecisionId: uuid }).strict();
const attachment = endpointAttachmentSchema;
const bindingFields = {
  schemaVersion: z.literal('wfc.pf.endpoint-binding.v1'), id: uuid, projectId: uuid, locationId: uuid,
  locationRevision: revision, bindingRevision: revision, locationRegistryRevision: revision,
  modelVersionId: uuid, aggregateId: uuid, artifactId: uuid, projectionSha256: hash, captureFrameId: uuid, qualifiedProjectFrameId: uuid.nullable(),
  status: endpointStatusSchema, mode: endpointModeSchema, pointProjectMetres: endpointPointSchema,
  derivation: z.enum(['manual-world-point', 'picked-surface-point', ENDPOINT_ANCHOR_RULE, ENDPOINT_MODEL_MATCH_DERIVATION, 'qualified-local-point.v1', 'durable-connector.v1']),
  autoMatchEvidence: endpointModelMatchEvidenceSchema.optional(),
  sourceObject: endpointObjectRefSchema.nullable(), attachment: attachment.nullable(), sourceDecisionId: uuid.nullable(), supersedesBindingId: uuid.nullable(), legacyObservationId: uuid.nullable(),
  priorPointProjectMetres: endpointPointSchema.nullable(), priorCaptureFrameId: uuid.nullable(), displacementBasis: z.enum(['none', 'same-capture-frame', 'unverified-frames']), displacementVectorMetres: endpointDisplacementVectorSchema.nullable(), displacementMetres: z.number().finite().nonnegative().nullable(),
  confirmedBy: uuid.nullable(), confirmedAt: timestamp.nullable(), reason: nonempty(ENDPOINT_BINDING_LIMITS.reason), contentSha256: hash,
};
export const endpointBindingSchema = z.object(bindingFields).strict().superRefine((v, ctx) => {
  if (v.status === 'confirmed' && (!v.confirmedBy || !v.confirmedAt)) ctx.addIssue({ code: 'custom', message: 'Confirmed bindings retain the confirming principal and time.' });
  if (v.mode === 'fixed-world' && (v.attachment !== null || !['manual-world-point', 'picked-surface-point', ENDPOINT_MODEL_MATCH_DERIVATION].includes(v.derivation))) ctx.addIssue({ code: 'custom', message: 'Fixed points do not follow an object.' });
  if (v.derivation === ENDPOINT_MODEL_MATCH_DERIVATION) {
    const e = v.autoMatchEvidence, c = e?.current;
    if (!e || !c || v.mode !== 'fixed-world' || v.sourceObject !== null || v.attachment !== null || v.sourceDecisionId !== null
      || v.qualifiedProjectFrameId !== null || c.modelVersionId !== v.modelVersionId || c.aggregateId !== v.aggregateId
      || c.artifactId !== v.artifactId || c.projectionSha256 !== v.projectionSha256 || c.captureFrameId !== v.captureFrameId
      || canonicalPurposeJson(e.bottomCentre) !== canonicalPurposeJson(v.pointProjectMetres))
      ctx.addIssue({ code: 'custom', message: 'A matched fixed point requires its own complete current model observation.' });
  } else if (v.autoMatchEvidence !== undefined) ctx.addIssue({ code: 'custom', message: 'Only a matched fixed point carries model-match observation evidence.' });
  if (v.mode === 'object-derived' && (!v.sourceObject || v.attachment !== null || v.derivation !== ENDPOINT_ANCHOR_RULE)) ctx.addIssue({ code: 'custom', message: 'Derived anchors require exact immutable object evidence.' });
  if (v.mode === 'object-attached' && (!v.sourceObject || !v.attachment || !v.qualifiedProjectFrameId || !['qualified-local-point.v1', 'durable-connector.v1'].includes(v.derivation))) ctx.addIssue({ code: 'custom', message: 'Attachments require separately qualified frame and identity evidence.' });
  if (v.mode === 'object-attached' && v.attachment && (v.derivation === 'durable-connector.v1') !== (v.attachment.connectorId !== null)) ctx.addIssue({ code: 'custom', message: 'Connector derivation and durable connector evidence must agree.' });
  if (!v.priorPointProjectMetres) {
    if (v.priorCaptureFrameId !== null || v.displacementBasis !== 'none' || v.displacementVectorMetres !== null || v.displacementMetres !== null) ctx.addIssue({ code: 'custom', message: 'A first binding has no prior frame or displacement.' });
  } else {
    if (v.supersedesBindingId === null && v.legacyObservationId === null || v.displacementBasis === 'none') ctx.addIssue({ code: 'custom', message: 'A prior point requires its exact historical binding or legacy observation.' });
    if (v.displacementBasis === 'same-capture-frame') {
      if (v.priorCaptureFrameId !== v.captureFrameId || !v.displacementVectorMetres || v.displacementMetres === null || v.displacementVectorMetres.some((n, i) => n !== v.pointProjectMetres[i] - v.priorPointProjectMetres![i]) || v.displacementMetres !== Math.hypot(...v.displacementVectorMetres)) ctx.addIssue({ code: 'custom', message: 'Only an identical capture frame supports exact raw-coordinate displacement.' });
    } else if (v.displacementBasis === 'unverified-frames' && (v.priorCaptureFrameId === v.captureFrameId || v.displacementVectorMetres !== null || v.displacementMetres !== null)) ctx.addIssue({ code: 'custom', message: 'Unverified/different frames retain points without inventing a physical displacement.' });
  }
});
export const endpointBindingSummarySchema = z.object({ id: uuid, bindingRevision: revision, status: endpointStatusSchema, mode: endpointModeSchema, pointProjectMetres: endpointPointSchema, modelVersionId: uuid, aggregateId: uuid, captureFrameId: uuid, sourceObjectRevisionId: uuid.nullable(), confirmedBy: uuid.nullable(), confirmedAt: timestamp.nullable(), contentSha256: hash }).strict();
const writeCommon = z.object({
  schemaVersion: z.literal('wfc.pf.endpoint-binding-write.v1'), expectedRegistryRevision: revision, expectedLocationRevision: revision.nullable(), expectedHeadId: uuid.nullable(),
  expectedSelectionRevision: revision, modelVersionId: uuid, aggregateId: uuid, projectionSha256: hash, captureFrameId: uuid,
  idempotencyKey: uuid, reason: nonempty(ENDPOINT_BINDING_LIMITS.reason), location: z.object({ name: endpointLocationNameSchema, aliases }).strict().refine(v => !v.aliases.some(a => normalizeEndpointLocation(a) === normalizeEndpointLocation(v.name))),
});
export const endpointBindingWriteSchema = z.discriminatedUnion('mode', [
  writeCommon.extend({ mode: z.literal('fixed-world'), pointProjectMetres: endpointPointSchema, derivation: z.enum(['manual-world-point', 'picked-surface-point']), provenanceObject: endpointObjectRefSchema.nullable() }).strict(),
  writeCommon.extend({ mode: z.literal('object-derived'), object: endpointObjectRefSchema, anchorRule: z.literal(ENDPOINT_ANCHOR_RULE) }).strict(),
  writeCommon.extend({ mode: z.literal('object-attached'), object: endpointObjectRefSchema, attachmentEvidenceId: uuid, pickedPointProjectMetres: endpointPointSchema.nullable(), connectorId: nonempty(500).nullable() }).strict(),
]).refine(v => v.expectedLocationRevision !== null || v.expectedHeadId === null).refine(v => v.mode !== 'object-attached' || (v.pickedPointProjectMetres !== null) === (v.connectorId === null), 'Choose an exact picked point or a durable connector, never both.');
export const endpointBindingContextSchema = z.object({
  schemaVersion: z.literal('wfc.pf.endpoint-binding-context.v1'), projectId: uuid, locationId: uuid, registryRevision: revision,
  location: endpointLocationSchema.nullable(), current: endpointCurrentScopeSchema.nullable(), head: endpointBindingSchema.nullable(),
  legacy: z.object({ modelVersionId: uuid, revision, pointProjectMetres: endpointPointSchema, objectId: nonempty(1024).nullable(), derivation: z.enum(['manual-world-point', 'picked-surface-point', 'equipment-bottom-aabb']) }).strict().nullable(),
  capabilities: z.array(endpointCapabilitySchema).length(3).refine(v => new Set(v.map(c => c.mode)).size === 3), readiness: endpointReadinessSchema, usage: endpointUsageSchema,
}).strict().superRefine((v, ctx) => {
  if (v.location && v.location.id !== v.locationId || v.head && (v.head.projectId !== v.projectId || v.head.locationId !== v.locationId) || v.head && !v.location) ctx.addIssue({ code: 'custom', message: 'The location context must remain within its project/location.' });
  if (v.readiness.calculationReady && (!v.head || !v.current || !v.location || v.head.status !== 'confirmed' || v.head.locationRevision !== v.location.revision || v.head.modelVersionId !== v.current.modelVersionId || v.head.aggregateId !== v.current.aggregateId || v.head.artifactId !== v.current.artifactId || v.head.projectionSha256 !== v.current.projectionSha256 || v.head.captureFrameId !== v.current.captureFrameId)) ctx.addIssue({ code: 'custom', message: 'Only an exact current confirmed head is calculation-ready.' });
});
export const endpointBindingPageSchema = z.object({ schemaVersion: z.literal('wfc.pf.endpoint-binding-page.v1'), projectId: uuid, registryRevision: revision, offset: z.number().int().nonnegative().max(1_000_000), limit: z.number().int().min(1).max(100), total: z.number().int().nonnegative().max(1_000_000), nextOffset: z.number().int().nonnegative().max(1_000_000).nullable(), locations: z.array(z.object({ location: endpointLocationSchema, head: endpointBindingSummarySchema.nullable(), readiness: endpointReadinessSchema, usage: endpointUsageSchema }).strict()).max(100) }).strict().refine(v => v.locations.length <= v.limit && new Set(v.locations.map(l => l.location.id)).size === v.locations.length && v.locations.every(l => !l.readiness.calculationReady || l.head?.status === 'confirmed') && v.nextOffset === (v.offset + v.locations.length < v.total ? v.offset + v.locations.length : null));
export const endpointBindingReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.endpoint-binding-receipt.v1'), projectId: uuid, locationId: uuid, registryRevision: revision, locationRevision: revision, binding: endpointBindingSchema, duplicate: z.boolean() }).strict().refine(v => v.binding.projectId === v.projectId && v.binding.locationId === v.locationId && v.binding.locationRegistryRevision === v.registryRevision && v.binding.locationRevision === v.locationRevision);
export const endpointBindingHistorySchema = z.object({ schemaVersion: z.literal('wfc.pf.endpoint-binding-history.v1'), projectId: uuid, locationId: uuid, bindings: z.array(endpointBindingSchema).max(100), nextBeforeRevision: revision.nullable() }).strict().refine(v => new Set(v.bindings.map(b => b.id)).size === v.bindings.length && v.bindings.every(b => b.projectId === v.projectId && b.locationId === v.locationId));
export const endpointMigrationDispositionSchema = z.enum(['carried-fixed', 'carried-rigid', 'rederived', 'suggested-review', 'missing', 'ambiguous', 'split', 'merged', 'replaced', 'deformed', 'connector-missing', 'frame-unverified', 'unsupported-transform']);
export const endpointMigrationProposalSchema = z.object({ mode: endpointModeSchema, derivation: z.enum(['manual-world-point', 'picked-surface-point', ENDPOINT_ANCHOR_RULE, 'qualified-local-point.v1', 'durable-connector.v1']), sourceObject: endpointObjectRefSchema.nullable(), attachment: endpointAttachmentSchema.nullable(), qualifiedProjectFrameId: uuid.nullable() }).strict();
export const endpointMigrationEvaluationSchema = z.object({
  schemaVersion: z.literal('wfc.pf.endpoint-migration-evaluation.v1'), sourceBindingId: uuid,
  sourcePointProjectMetres: endpointPointSchema, sourcePointInTargetFrameMetres: endpointPointSchema.nullable(), targetPointProjectMetres: endpointPointSchema.nullable(),
  displacementVectorMetres: endpointDisplacementVectorSchema.nullable(), displacementMetres: z.number().finite().nonnegative().nullable(),
  proposal: endpointMigrationProposalSchema.nullable(), disposition: endpointMigrationDispositionSchema,
  status: z.enum(['suggested', 'missing', 'ambiguous', 'stale', 'unsupported-attachment']), reasonCodes: codes,
  candidateObjectRevisionIds: z.array(uuid).max(100).refine(v => new Set(v).size === v.length), evidenceIds: z.array(uuid).max(100).refine(v => new Set(v).size === v.length),
  evidenceReferences: z.array(z.object({ id: uuid, sha256: hash, kind: z.enum(['frame-mapping', 'object-mapping', 'rigid-policy', 'qualified-object']) }).strict()).max(100),
  requiresConfirmation: z.literal(true), attachmentPolicyVersion: z.literal(ENDPOINT_ATTACHMENT_POLICY),
}).strict().superRefine((v, ctx) => {
  const has = v.targetPointProjectMetres !== null;
  if (has !== (v.displacementVectorMetres !== null) || has !== (v.displacementMetres !== null) || has !== (v.proposal !== null) || has && v.sourcePointInTargetFrameMetres === null) ctx.addIssue({ code: 'custom', message: 'A proposal needs the source normalized into its target frame before displacement.' });
  if (v.targetPointProjectMetres && v.sourcePointInTargetFrameMetres && v.displacementVectorMetres && (v.displacementVectorMetres.some((n, i) => n !== v.targetPointProjectMetres![i] - v.sourcePointInTargetFrameMetres![i]) || v.displacementMetres !== Math.hypot(...v.displacementVectorMetres))) ctx.addIssue({ code: 'custom', message: 'Migration displacement uses normalized comparable coordinates, never unrelated raw frames.' });
  if (v.evidenceReferences.length !== v.evidenceIds.length || v.evidenceReferences.some((r, i) => r.id !== v.evidenceIds[i])) ctx.addIssue({ code: 'custom', message: 'Every evidence ID retains its immutable content hash and kind in order.' });
});
export const endpointMigrationWriteSchema = z.object({ schemaVersion: z.literal('wfc.pf.endpoint-migration-write.v1'), sourceBindingId: uuid, expectedRegistryRevision: revision, expectedLocationRevision: revision, expectedHeadId: uuid, expectedSelectionRevision: revision, targetModelVersionId: uuid, targetAggregateId: uuid, targetProjectionSha256: hash, targetCaptureFrameId: uuid, objectDecisionId: uuid.nullable(), frameDecisionId: uuid.nullable(), idempotencyKey: uuid, reason: nonempty(2048) }).strict();
export const endpointMigrationDecisionSchema = z.object({ schemaVersion: z.literal('wfc.pf.endpoint-migration-decision.v1'), id: uuid, projectId: uuid, locationId: uuid, sourceBindingId: uuid, sourceHeadId: uuid, expectedLocationRevision: revision, expectedRegistryRevision: revision, target: endpointCurrentScopeSchema, evaluation: endpointMigrationEvaluationSchema, createdBy: uuid, createdAt: timestamp, reason: nonempty(2048), contentSha256: hash }).strict().refine(v => v.sourceBindingId === v.evaluation.sourceBindingId);
export const endpointMigrationConfirmSchema = z.object({ schemaVersion: z.literal('wfc.pf.endpoint-migration-confirm.v1'), expectedDecisionSha256: hash, expectedRegistryRevision: revision, expectedLocationRevision: revision, expectedHeadId: uuid, expectedSelectionRevision: revision, idempotencyKey: uuid, reason: nonempty(2048) }).strict();
export const endpointBindingErrorSchema = z.object({ schemaVersion: z.literal('wfc.pf.endpoint-binding-error.v1'), code, message: text(2048), outcome: z.enum(['refused', 'unknown']) }).strict();
export const endpointBindingCanonicalJson = canonicalPurposeJson;
export function endpointBindingContentHashInput(value: EndpointBinding): unknown { const { contentSha256: _hash, ...input } = value; return input; }
export function endpointMigrationContentHashInput(value: EndpointMigrationDecision): unknown { const { contentSha256: _hash, ...input } = value; return input; }
export type EndpointBinding = z.infer<typeof endpointBindingSchema>;
export type EndpointBindingWrite = z.infer<typeof endpointBindingWriteSchema>;
export type EndpointBindingContext = z.infer<typeof endpointBindingContextSchema>;
export type EndpointCurrentScope = z.infer<typeof endpointCurrentScopeSchema>;
export type EndpointObjectRef = z.infer<typeof endpointObjectRefSchema>;
export type EndpointBindingSummary = z.infer<typeof endpointBindingSummarySchema>;
export type EndpointBindingPage = z.infer<typeof endpointBindingPageSchema>;
export type EndpointBindingReceipt = z.infer<typeof endpointBindingReceiptSchema>;
export type EndpointBindingHistory = z.infer<typeof endpointBindingHistorySchema>;
export type EndpointMigrationWrite = z.infer<typeof endpointMigrationWriteSchema>;
export type EndpointMigrationConfirm = z.infer<typeof endpointMigrationConfirmSchema>;
export type EndpointMigrationDecision = z.infer<typeof endpointMigrationDecisionSchema>;
export type EndpointMigrationEvaluation = z.infer<typeof endpointMigrationEvaluationSchema>;
export type EndpointBindingError = z.infer<typeof endpointBindingErrorSchema>;
