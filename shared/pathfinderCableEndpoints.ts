import { z } from 'zod';
import { isPathFinderCableEligible } from './pathfinderCableEligibility.js';
import { canonicalPurposeJson, policyHashSchema, policyUuidSchema, policyRevisionSchema } from './pathfinderPurposePolicy.js';
import { endpointBindingSchema, endpointBindingReceiptSchema, endpointCurrentScopeSchema, endpointLocationSchema,
  endpointLocationNameSchema, endpointObjectRefSchema, endpointPointSchema } from './pathfinderEndpointBindings.js';
import { geometryObjectSummarySchema } from './pathfinderGeometryTrace.js';
import { recalculationReasonSchema } from './pathfinderRecalculation.js';
import { locationImpactCalculationSchema, locationImpactReferenceSchema } from './pathfinderLocationImpacts.js';
import { initialFillPolicySchema, initialFillMandateReferenceSchema } from './pathfinderInitialFill.js';
import { automaticPairPolicySchema } from './pathfinderAutomaticPair.js';

export const CABLE_ENDPOINT_LIMITS = Object.freeze({ controlBytes: 65536, responseBytes: 1024 * 1024, projectCables: 10000, impactTextBytes: 8 * 1024 * 1024, reasonCodes: 64 });
export const cableEndpointEndSchema = z.enum(['from', 'to']);
export const cableEndpointSdkObjectIdSchema = z.number().int().min(1).max(2147483647);
export const cableEndpointDisplayObjectNameSchema = z.string().min(1).max(500).refine(value => value.trim().length > 0
  && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff));
const reasonCodes = z.array(recalculationReasonSchema).max(CABLE_ENDPOINT_LIMITS.reasonCodes).refine(values => new Set(values).size === values.length);
const logicalName = z.string().max(4096).nullable();
export const cableEndpointAutomaticSelectionSchema = z.object({ source: z.literal('automatic-unconfirmed'),
  sdkObjectId: cableEndpointSdkObjectIdSchema, name: z.string().max(2048), object: endpointObjectRefSchema,
  pointProjectMetres: endpointPointSchema, approximate: z.literal(true), confirmed: z.literal(false) }).strict();
export const cableEndpointConfirmedSelectionSchema = cableEndpointAutomaticSelectionSchema.omit({ source: true, confirmed: true }).extend({
  source: z.literal('confirmed'), confirmed: z.literal(true),
}).strict();
/** A display hint is not retained geometry, an attachment or automatic matching authority. */
export const cableEndpointConfirmedDisplaySelectionSchema = z.object({ source: z.literal('confirmed-display-only'), mode: z.literal('fixed-world'),
  sdkObjectId: cableEndpointSdkObjectIdSchema, name: cableEndpointDisplayObjectNameSchema.optional(), pointProjectMetres: endpointPointSchema,
  current: endpointCurrentScopeSchema, bindingId: policyUuidSchema, bindingContentSha256: policyHashSchema, commandSha256: policyHashSchema }).strict();
export const cableEndpointContextSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-context.v1'),
  projectId: policyUuidSchema, cableId: policyUuidSchema, end: cableEndpointEndSchema, cableWriteRevision: policyRevisionSchema,
  logicalName, logicalKey: logicalName, mto: z.string().max(96).nullable(), canBind: z.boolean(), reasonCodes,
  registryRevision: policyRevisionSchema, location: endpointLocationSchema.nullable(), head: endpointBindingSchema.nullable(),
  current: endpointCurrentScopeSchema.nullable(), automaticSelection: cableEndpointAutomaticSelectionSchema.nullable().optional(),
  confirmedSelection: cableEndpointConfirmedSelectionSchema.nullable().optional(),
  confirmedDisplaySelection: cableEndpointConfirmedDisplaySelectionSchema.nullable().optional(),
  contextSha256: policyHashSchema }).strict().superRefine((value, context) => {
  if (value.logicalName !== null && value.logicalName !== value.logicalName.normalize('NFC').trim()
    || value.logicalKey !== (value.logicalName?.normalize('NFC').trim().toUpperCase() || null))
    context.addIssue({ code: 'custom', message: 'The logical endpoint retains its normalized cable name.' });
  if (value.head && (!value.location || value.head.projectId !== value.projectId || value.head.locationId !== value.location.id))
    context.addIssue({ code: 'custom', message: 'Shared endpoint evidence must belong to this project/location.' });
  if (value.canBind && (!endpointLocationNameSchema.safeParse(value.logicalName).success || !value.current || value.reasonCodes.length !== 0 || !isPathFinderCableEligible(value.mto)))
    context.addIssue({ code: 'custom', message: 'Bindable display context requires a named eligible cable and current preparation.' });
  if (value.automaticSelection && (!value.canBind || value.head !== null || !value.current?.traceId || value.automaticSelection.object.traceId !== value.current.traceId))
    context.addIssue({ code: 'custom', message: 'An unconfirmed automatic candidate never replaces a saved head or a different model scope.' });
  if (value.confirmedSelection && (!value.canBind || !value.head || value.head.status !== 'confirmed' || value.head.mode !== 'object-derived'
    || value.head.modelVersionId !== value.current?.modelVersionId || value.head.aggregateId !== value.current?.aggregateId
    || value.head.artifactId !== value.current?.artifactId || value.head.projectionSha256 !== value.current?.projectionSha256
    || value.head.captureFrameId !== value.current?.captureFrameId || value.confirmedSelection.object.traceId !== value.current?.traceId
    || canonicalPurposeJson(value.confirmedSelection.object) !== canonicalPurposeJson(value.head.sourceObject)
    || canonicalPurposeJson(value.confirmedSelection.pointProjectMetres) !== canonicalPurposeJson(value.head.pointProjectMetres)))
    context.addIssue({ code: 'custom', message: 'Confirmed model display belongs to the exact current object-derived head.' });
  const display = value.confirmedDisplaySelection;
  if (display && (!value.canBind || !value.current || !value.head || !value.location || value.head.status !== 'confirmed'
    || value.head.mode !== 'fixed-world' || value.head.sourceObject !== null || value.head.attachment !== null
    || value.head.locationRevision !== value.location.revision || display.bindingId !== value.head.id || display.bindingContentSha256 !== value.head.contentSha256
    || canonicalPurposeJson(display.current) !== canonicalPurposeJson(value.current)
    || value.head.modelVersionId !== value.current.modelVersionId || value.head.artifactId !== value.current.artifactId
    || value.head.aggregateId !== value.current.aggregateId || value.head.captureFrameId !== value.current.captureFrameId
    || value.head.projectionSha256 !== value.current.projectionSha256
    || canonicalPurposeJson(display.pointProjectMetres) !== canonicalPurposeJson(value.head.pointProjectMetres)))
    context.addIssue({ code: 'custom', message: 'A display-only hint belongs to the exact current confirmed fixed-world head.' });
});
export type CableEndpointContext = z.infer<typeof cableEndpointContextSchema>;
export function cableEndpointContextHashInput(value: CableEndpointContext) {
  const { contextSha256: _hash, ...body } = value; return body;
}
export const cableEndpointSelectionEvidenceSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-selection.v1'),
  projectId: policyUuidSchema, current: endpointCurrentScopeSchema, sdkObjectId: cableEndpointSdkObjectIdSchema,
  status: z.enum(['available', 'unavailable', 'ambiguous', 'unsupported']), reasonCodes,
  object: endpointObjectRefSchema.nullable(), pointProjectMetres: endpointPointSchema.nullable(),
  bounds: geometryObjectSummarySchema.shape.bounds.nullable(), approximate: z.literal(true),
  derivation: z.literal('equipment-bottom-aabb.v1').nullable() }).strict().superRefine((value, context) => {
  if (value.status === 'available' ? value.object === null || value.pointProjectMetres === null || value.bounds === null || value.derivation === null || value.reasonCodes.length !== 0
    : value.object !== null || value.pointProjectMetres !== null || value.bounds !== null || value.derivation !== null || value.reasonCodes.length === 0)
    context.addIssue({ code: 'custom', message: 'Only exact retained selection evidence supplies an object-derived anchor.' });
});
export type CableEndpointSelectionEvidence = z.infer<typeof cableEndpointSelectionEvidenceSchema>;
export const cableEndpointSelectionResponseSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-selection-response.v1'),
  projectId: policyUuidSchema, cableId: policyUuidSchema, end: cableEndpointEndSchema, contextSha256: policyHashSchema,
  selection: cableEndpointSelectionEvidenceSchema }).strict().refine(value => value.selection.projectId === value.projectId);
export type CableEndpointSelectionResponse = z.infer<typeof cableEndpointSelectionResponseSchema>;
const common = { schemaVersion: z.literal('wfc.pf.cable-endpoint-command.v1'), idempotencyKey: policyUuidSchema,
  expectedContextSha256: policyHashSchema, expectedCableWriteRevision: policyRevisionSchema, expectedLogicalName: endpointLocationNameSchema,
  expectedRegistryRevision: policyRevisionSchema, expectedLocationId: policyUuidSchema.nullable(), expectedLocationRevision: policyRevisionSchema.nullable(),
  expectedHeadId: policyUuidSchema.nullable(), expectedCurrent: endpointCurrentScopeSchema,
  reason: z.string().min(1).max(2048).refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff)) };
const selection = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('object-derived'), sdkObjectId: cableEndpointSdkObjectIdSchema, object: endpointObjectRefSchema }).strict(),
  z.object({ mode: z.literal('fixed-world'), pointProjectMetres: endpointPointSchema, derivation: z.enum(['manual-world-point', 'picked-surface-point']),
    displaySdkObjectId: cableEndpointSdkObjectIdSchema.nullable(), displayObjectName: cableEndpointDisplayObjectNameSchema.optional() }).strict(),
]).refine(value => value.mode !== 'fixed-world' || value.displayObjectName === undefined || value.displaySdkObjectId !== null);
const locationExpectation = (value: { expectedLocationId: string | null; expectedLocationRevision: string | null; expectedHeadId: string | null }) => value.expectedLocationId === null ? value.expectedLocationRevision === null && value.expectedHeadId === null : value.expectedLocationRevision !== null;
const legacyCommand = z.object({ ...common, selection }).strict().refine(locationExpectation);
const impactCommand = z.object({ ...common, schemaVersion: z.literal('wfc.pf.cable-endpoint-command.v2'), selection,
  calculation: locationImpactCalculationSchema.nullable() }).strict().refine(locationExpectation);
const initialFillCommand = z.object({ ...common, schemaVersion: z.literal('wfc.pf.cable-endpoint-command.v3'), selection,
  calculation: locationImpactCalculationSchema.nullable(), initialFill: initialFillPolicySchema.nullable() }).strict().refine(locationExpectation);
const automaticPairCommand = z.object({ ...common, schemaVersion: z.literal('wfc.pf.cable-endpoint-command.v4'), selection,
  calculation: locationImpactCalculationSchema.nullable(), initialFill: z.null(), automaticPairPolicy: automaticPairPolicySchema.nullable(),
}).strict().refine(locationExpectation).refine(value => value.automaticPairPolicy === null || value.calculation !== null,
  'Automatic cable updates require an explicit calculation policy.');
/** Legacy pending bodies retain their exact v1 shape, without inserted defaults or new authority. */
export const cableEndpointCommandSchema = z.union([legacyCommand, impactCommand, initialFillCommand, automaticPairCommand]);
export type CableEndpointCommand = z.infer<typeof cableEndpointCommandSchema>;
/** The exact strict command, including its idempotency key, is the pending-command hash input. */
export function cableEndpointCommandHashInput(value: CableEndpointCommand) { return cableEndpointCommandSchema.parse(value); }
const count = z.number().int().min(0).max(CABLE_ENDPOINT_LIMITS.projectCables);
export const cableEndpointImpactSchema = z.object({ fromOccurrences: count, toOccurrences: count, distinctCables: count,
  cableIds: z.array(policyUuidSchema).max(CABLE_ENDPOINT_LIMITS.projectCables) }).strict().refine(value => value.distinctCables === value.cableIds.length
    && value.fromOccurrences <= value.distinctCables && value.toOccurrences <= value.distinctCables
    && value.cableIds.every((id, index) => index === 0 || value.cableIds[index - 1] < id));
export const cableEndpointReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-receipt.v1'),
  projectId: policyUuidSchema, actorId: policyUuidSchema, cableId: policyUuidSchema, end: cableEndpointEndSchema, logicalName: endpointLocationNameSchema,
  idempotencyKey: policyUuidSchema, commandSha256: policyHashSchema, expectedCableWriteRevision: policyRevisionSchema,
  expectedContextSha256: policyHashSchema, locationId: policyUuidSchema, binding: endpointBindingReceiptSchema,
  impact: cableEndpointImpactSchema, locationImpact: locationImpactReferenceSchema.optional(), initialFillMandate: initialFillMandateReferenceSchema.optional(), duplicate: z.boolean() }).strict()
  .refine(value => value.binding.projectId === value.projectId && value.binding.locationId === value.locationId
    && (!value.initialFillMandate || value.initialFillMandate.impactId === value.locationImpact?.id));
export type CableEndpointReceipt = z.infer<typeof cableEndpointReceiptSchema>;
export const cableEndpointClosedSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-closed.v1'),
  projectId: policyUuidSchema, actorId: policyUuidSchema, cableId: policyUuidSchema, end: cableEndpointEndSchema, idempotencyKey: policyUuidSchema,
  commandSha256: policyHashSchema, expectedCableWriteRevision: policyRevisionSchema, expectedContextSha256: policyHashSchema }).strict();
export const cableEndpointRecoverySchema = z.discriminatedUnion('status', [
  z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-recovery.v1'), status: z.literal('saved'), receipt: cableEndpointReceiptSchema }).strict(),
  z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-recovery.v1'), status: z.literal('closed'), closure: cableEndpointClosedSchema }).strict(),
]);
export type CableEndpointRecovery = z.infer<typeof cableEndpointRecoverySchema>;
export const cableEndpointErrorSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-error.v1'), code: recalculationReasonSchema,
  message: z.string().max(2048), outcome: z.enum(['refused', 'unknown']) }).strict();
