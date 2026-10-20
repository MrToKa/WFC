import { z } from 'zod';
import { policyHashSchema, policyUuidSchema, policyRevisionSchema } from './pathfinderPurposePolicy.js';
import { endpointBindingSchema, endpointBindingReceiptSchema, endpointCurrentScopeSchema, endpointLocationSchema,
  endpointLocationNameSchema, endpointObjectRefSchema, endpointPointSchema } from './pathfinderEndpointBindings.js';
import { geometryObjectSummarySchema } from './pathfinderGeometryTrace.js';
import { recalculationReasonSchema } from './pathfinderRecalculation.js';
import { locationImpactCalculationSchema, locationImpactReferenceSchema } from './pathfinderLocationImpacts.js';

export const CABLE_ENDPOINT_LIMITS = Object.freeze({ controlBytes: 65536, responseBytes: 1024 * 1024, projectCables: 10000, impactTextBytes: 8 * 1024 * 1024, reasonCodes: 64 });
export const cableEndpointEndSchema = z.enum(['from', 'to']);
export const cableEndpointSdkObjectIdSchema = z.number().int().min(1).max(2147483647);
const reasonCodes = z.array(recalculationReasonSchema).max(CABLE_ENDPOINT_LIMITS.reasonCodes).refine(values => new Set(values).size === values.length);
const logicalName = z.string().max(4096).nullable();
export const cableEndpointContextSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-context.v1'),
  projectId: policyUuidSchema, cableId: policyUuidSchema, end: cableEndpointEndSchema, cableWriteRevision: policyRevisionSchema,
  logicalName, logicalKey: logicalName, mto: z.string().max(96).nullable(), canBind: z.boolean(), reasonCodes,
  registryRevision: policyRevisionSchema, location: endpointLocationSchema.nullable(), head: endpointBindingSchema.nullable(),
  current: endpointCurrentScopeSchema.nullable(), contextSha256: policyHashSchema }).strict().superRefine((value, context) => {
  if (value.logicalName !== null && value.logicalName !== value.logicalName.normalize('NFC').trim()
    || value.logicalKey !== (value.logicalName?.normalize('NFC').trim().toUpperCase() || null))
    context.addIssue({ code: 'custom', message: 'The logical endpoint retains its normalized cable name.' });
  if (value.head && (!value.location || value.head.projectId !== value.projectId || value.head.locationId !== value.location.id))
    context.addIssue({ code: 'custom', message: 'Shared endpoint evidence must belong to this project/location.' });
  if (value.canBind && (!endpointLocationNameSchema.safeParse(value.logicalName).success || !value.current || value.reasonCodes.length !== 0 || !['LV', 'Control', 'Instrumentation'].includes(value.mto ?? '')))
    context.addIssue({ code: 'custom', message: 'Bindable display context requires a named eligible cable and current preparation.' });
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
    displaySdkObjectId: cableEndpointSdkObjectIdSchema.nullable() }).strict(),
]);
const locationExpectation = (value: { expectedLocationId: string | null; expectedLocationRevision: string | null; expectedHeadId: string | null }) => value.expectedLocationId === null ? value.expectedLocationRevision === null && value.expectedHeadId === null : value.expectedLocationRevision !== null;
const legacyCommand = z.object({ ...common, selection }).strict().refine(locationExpectation);
const impactCommand = z.object({ ...common, schemaVersion: z.literal('wfc.pf.cable-endpoint-command.v2'), selection,
  calculation: locationImpactCalculationSchema.nullable() }).strict().refine(locationExpectation);
/** Legacy pending bodies retain their exact v1 shape, without inserted defaults or new authority. */
export const cableEndpointCommandSchema = z.union([legacyCommand, impactCommand]);
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
  impact: cableEndpointImpactSchema, locationImpact: locationImpactReferenceSchema.optional(), duplicate: z.boolean() }).strict().refine(value => value.binding.projectId === value.projectId && value.binding.locationId === value.locationId);
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
