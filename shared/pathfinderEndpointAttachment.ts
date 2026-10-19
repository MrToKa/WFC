import { z } from 'zod';
import { policyHashSchema as hash, policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';
import { ENDPOINT_ANCHOR_RULE, ENDPOINT_ATTACHMENT_POLICY, endpointBindingSchema, endpointCurrentScopeSchema, endpointMigrationEvaluationSchema, endpointObjectRefSchema, endpointPointSchema, type EndpointBinding, type EndpointCurrentScope, type EndpointMigrationEvaluation } from './pathfinderEndpointBindings.js';

/** These are server-resolved evidence DTOs, never public mutation authority. */
const matrix = z.array(z.number().finite()).length(16);
const point = endpointPointSchema;
const text = z.string().min(1).max(500).refine(v => !/[\u0000-\u001f\u007f-\u009f]/u.test(v));
export const endpointRigidPolicySchema = z.object({ schemaVersion: z.literal('wfc.pf.endpoint-rigid-policy.v1'), id: uuid, contentSha256: hash, version: z.literal(ENDPOINT_ATTACHMENT_POLICY), numericalTolerance: z.number().finite().positive().max(1e-6), engineeringToleranceMetres: z.number().finite().nonnegative().nullable() }).strict();
export const endpointQualifiedObjectEvidenceSchema = z.object({
  schemaVersion: z.literal('wfc.pf.qualified-object-attachment-evidence.v1'), id: uuid, contentSha256: hash, projectId: uuid,
  object: endpointObjectRefSchema, modelVersionId: uuid, aggregateId: uuid, captureFrameId: uuid, qualifiedProjectFrameId: uuid,
  logicalObjectId: uuid, sourceDocumentId: text, sourceInstancePath: text, stableExportEntityId: text,
  objectLocalToProjectMetres: matrix, intrinsicShapeSha256: hash, placementSha256: hash,
  deformation: z.enum(['rigid', 'deformed', 'unknown']), connectors: z.array(z.object({ id: text, localPointMetres: point }).strict()).max(100).refine(v => new Set(v.map(c => c.id)).size === v.length),
  reviewedBy: uuid, reviewedAt: z.string().datetime(),
}).strict();
export const endpointFrameMappingSchema = z.object({
  schemaVersion: z.literal('wfc.pf.endpoint-frame-mapping.v1'), id: uuid, contentSha256: hash, projectId: uuid,
  sourceAggregateId: uuid, targetAggregateId: uuid, sourceCaptureFrameId: uuid, targetCaptureFrameId: uuid,
  qualifiedProjectFrameId: uuid, sourceCaptureToTargetCaptureMetres: matrix,
  qualification: z.enum(['reviewed-rigid', 'unverified']), reviewedBy: uuid.nullable(), reviewedAt: z.string().datetime().nullable(),
}).strict();
export const endpointObjectMappingSchema = z.object({
  schemaVersion: z.literal('wfc.pf.endpoint-object-mapping.v1'), id: uuid, contentSha256: hash, projectId: uuid, sourceAggregateId: uuid, targetAggregateId: uuid,
  sourceObjectRevisionIds: z.array(uuid).min(1).max(100).refine(v => new Set(v).size === v.length), targetObjectRevisionIds: z.array(uuid).max(100).refine(v => new Set(v).size === v.length),
  disposition: z.enum(['unique', 'missing', 'ambiguous', 'split', 'merged', 'replaced', 'deformed', 'connector-missing']),
  qualification: z.enum(['reviewed-identity', 'candidate-only']), reviewedBy: uuid.nullable(), reviewedAt: z.string().datetime().nullable(),
}).strict();
export const endpointMigrationObjectSchema = z.object({
  reference: endpointObjectRefSchema, projectId: uuid, modelVersionId: uuid, aggregateId: uuid, captureFrameId: uuid,
  bounds: z.object({ minimum: point, maximum: point }).strict().refine(v => v.minimum.every((n, i) => n <= v.maximum[i])),
  geometryRole: z.enum(['object', 'routing-leaf', 'hierarchy']), worldRepresentationSha256: hash.nullable(), intrinsicShapeSha256: hash.nullable(),
  qualifiedAttachment: endpointQualifiedObjectEvidenceSchema.nullable(),
}).strict();
export type EndpointRigidPolicy = z.infer<typeof endpointRigidPolicySchema>;
export type EndpointQualifiedObjectEvidence = z.infer<typeof endpointQualifiedObjectEvidenceSchema>;
export type EndpointFrameMapping = z.infer<typeof endpointFrameMappingSchema>;
export type EndpointObjectMapping = z.infer<typeof endpointObjectMappingSchema>;
export type EndpointMigrationObject = z.infer<typeof endpointMigrationObjectSchema>;
type Point = [number, number, number];
type RigidResult = { supported: true; inverse: number[]; determinant: number; maximumResidual: number } | { supported: false; reasonCode: string };
const dot = (a: number[], b: number[]) => a.reduce((n, v, i) => n + v * b[i], 0);

/** Column-major affine proper rigid transform; no scale/shear/reflection accepted. */
export function validateEndpointRigidTransform(raw: unknown, rawPolicy: unknown): RigidResult {
  const parsed = matrix.safeParse(raw), policy = endpointRigidPolicySchema.safeParse(rawPolicy);
  if (!parsed.success || !policy.success) return { supported: false, reasonCode: 'TRANSFORM_POLICY_OR_MATRIX_UNAVAILABLE' };
  const m = parsed.data, tolerance = policy.data.numericalTolerance;
  if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) return { supported: false, reasonCode: 'NON_AFFINE_TRANSFORM' };
  const columns = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (!Number.isFinite(determinant) || determinant <= 0) return { supported: false, reasonCode: determinant < 0 ? 'REFLECTED_TRANSFORM' : 'SINGULAR_TRANSFORM' };
  const maximumResidual = Math.max(Math.abs(determinant - 1), ...columns.map(c => Math.abs(dot(c, c) - 1)), Math.abs(dot(columns[0], columns[1])), Math.abs(dot(columns[0], columns[2])), Math.abs(dot(columns[1], columns[2])));
  if (maximumResidual > tolerance) return { supported: false, reasonCode: 'NON_RIGID_OR_ILL_CONDITIONED_TRANSFORM' };
  // R^-1 = R^T only after validating a proper orthonormal basis.
  const inverse = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0,
    -(m[0] * m[12] + m[1] * m[13] + m[2] * m[14]), -(m[4] * m[12] + m[5] * m[13] + m[6] * m[14]), -(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]), 1];
  if (!inverse.every(Number.isFinite)) return { supported: false, reasonCode: 'NON_FINITE_INVERSE' };
  return { supported: true, inverse, determinant, maximumResidual };
}
export function transformEndpointPoint(matrixValue: number[], pointValue: Point): Point {
  const m = matrix.parse(matrixValue), p = point.parse(pointValue);
  return point.parse([m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]);
}
export function deriveEquipmentBottomAnchor(bounds: { minimum: Point; maximum: Point }): Point {
  const value = endpointMigrationObjectSchema.shape.bounds.parse(bounds);
  return point.parse([(value.minimum[0] + value.maximum[0]) / 2, (value.minimum[1] + value.maximum[1]) / 2, value.minimum[2]]);
}
/** Inverse-transform a picked point once, only after a separately reviewed basis. */
export function deriveEndpointLocalPoint(raw: unknown, worldPoint: Point, rawPolicy: unknown): Point {
  const evidence = endpointQualifiedObjectEvidenceSchema.parse(raw);
  if (evidence.deformation !== 'rigid') throw Error('ATTACHMENT_DEFORMATION_UNVERIFIED');
  const rigid = validateEndpointRigidTransform(evidence.objectLocalToProjectMetres, rawPolicy);
  if (!rigid.supported) throw Error(rigid.reasonCode);
  return transformEndpointPoint(rigid.inverse, worldPoint);
}
export type EndpointMigrationInput = {
  sourceBinding: EndpointBinding; targetAggregate: EndpointCurrentScope;
  objectMapping: EndpointObjectMapping | null; frameMapping: EndpointFrameMapping | null;
  sourceObject: EndpointMigrationObject | null; targetObject: EndpointMigrationObject | null;
  validationPolicy: EndpointRigidPolicy | null;
};

/** Produces proposals only. R6 must resolve and verify immutable server evidence first. */
export function evaluateEndpointMigration(raw: EndpointMigrationInput): EndpointMigrationEvaluation {
  const source = endpointBindingSchema.parse(raw.sourceBinding), target = endpointCurrentScopeSchema.parse(raw.targetAggregate), evidenceReferences: EndpointMigrationEvaluation['evidenceReferences'] = [];
  let sourcePointInTargetFrameMetres: Point | null = null;
  const addEvidence = (id: string, sha256: string, kind: EndpointMigrationEvaluation['evidenceReferences'][number]['kind']) => { const old = evidenceReferences.find(e => e.id === id); if (old) { if (old.sha256 !== sha256 || old.kind !== kind) throw Error('CONTRADICTORY_IMMUTABLE_EVIDENCE_REFERENCE'); } else evidenceReferences.push({ id, sha256, kind }); };
  const mapping = raw.objectMapping === null ? null : endpointObjectMappingSchema.parse(raw.objectMapping), frame = raw.frameMapping === null ? null : endpointFrameMappingSchema.parse(raw.frameMapping);
  const oldObject = raw.sourceObject === null ? null : endpointMigrationObjectSchema.parse(raw.sourceObject), newObject = raw.targetObject === null ? null : endpointMigrationObjectSchema.parse(raw.targetObject);
  const policy = raw.validationPolicy === null ? null : endpointRigidPolicySchema.parse(raw.validationPolicy);
  const candidates = mapping?.targetObjectRevisionIds ?? [];
  type Disposition = EndpointMigrationEvaluation['disposition'];
  const result = (disposition: Disposition, reasonCodes: string[], proposed: Point | null = null, proposal: EndpointMigrationEvaluation['proposal'] = null): EndpointMigrationEvaluation => endpointMigrationEvaluationSchema.parse({
    schemaVersion: 'wfc.pf.endpoint-migration-evaluation.v1', sourceBindingId: source.id, sourcePointProjectMetres: source.pointProjectMetres, sourcePointInTargetFrameMetres,
    targetPointProjectMetres: proposed, displacementVectorMetres: proposed?.map((v, i) => v - sourcePointInTargetFrameMetres![i]) ?? null,
    displacementMetres: proposed ? Math.hypot(...proposed.map((v, i) => v - sourcePointInTargetFrameMetres![i])) : null, proposal,
    disposition, status: disposition === 'missing' ? 'missing' : ['ambiguous', 'split', 'merged'].includes(disposition) ? 'ambiguous' : ['carried-fixed', 'carried-rigid', 'rederived', 'suggested-review'].includes(disposition) ? 'suggested' : disposition === 'unsupported-transform' ? 'unsupported-attachment' : 'stale',
    reasonCodes, candidateObjectRevisionIds: candidates, evidenceIds: evidenceReferences.map(e => e.id), evidenceReferences, requiresConfirmation: true, attachmentPolicyVersion: ENDPOINT_ATTACHMENT_POLICY,
  });
  if (source.status !== 'confirmed') return result('suggested-review', ['SOURCE_BINDING_NOT_CONFIRMED']);
  if (frame) addEvidence(frame.id, frame.contentSha256, 'frame-mapping');
  if (!frame || frame.qualification !== 'reviewed-rigid' || !frame.reviewedBy || !frame.reviewedAt || frame.projectId !== source.projectId || frame.sourceAggregateId !== source.aggregateId || frame.targetAggregateId !== target.aggregateId || frame.sourceCaptureFrameId !== source.captureFrameId || frame.targetCaptureFrameId !== target.captureFrameId || source.qualifiedProjectFrameId !== frame.qualifiedProjectFrameId) return result('frame-unverified', ['COMMON_FRAME_MAPPING_UNVERIFIED']);
  if (!policy) return result('unsupported-transform', ['TRANSFORM_VALIDATION_POLICY_UNAVAILABLE']);
  addEvidence(policy.id, policy.contentSha256, 'rigid-policy');
  const frameRigid = validateEndpointRigidTransform(frame.sourceCaptureToTargetCaptureMetres, policy);
  if (!frameRigid.supported) return result('unsupported-transform', [frameRigid.reasonCode]);
  try { sourcePointInTargetFrameMetres = transformEndpointPoint(frame.sourceCaptureToTargetCaptureMetres, source.pointProjectMetres); }
  catch { return result('unsupported-transform', ['SOURCE_FRAME_POINT_OUT_OF_RANGE']); }
  if (source.mode === 'fixed-world') {
    try { return result('carried-fixed', [], sourcePointInTargetFrameMetres, { mode: source.mode, derivation: source.derivation, sourceObject: null, attachment: null, qualifiedProjectFrameId: frame.qualifiedProjectFrameId }); }
    catch { return result('unsupported-transform', ['TARGET_POINT_OUT_OF_RANGE']); }
  }
  if (mapping) addEvidence(mapping.id, mapping.contentSha256, 'object-mapping');
  if (!mapping || mapping.projectId !== source.projectId || mapping.sourceAggregateId !== source.aggregateId || mapping.targetAggregateId !== target.aggregateId || !source.sourceObject || !mapping.sourceObjectRevisionIds.includes(source.sourceObject.objectRevisionId)) return result('missing', ['OBJECT_MAPPING_UNAVAILABLE']);
  if (mapping.disposition !== 'unique') return result(mapping.disposition, ['OBJECT_' + mapping.disposition.toUpperCase().replaceAll('-', '_')]);
  if (mapping.qualification !== 'reviewed-identity' || !mapping.reviewedBy || !mapping.reviewedAt || mapping.sourceObjectRevisionIds.length !== 1 || candidates.length !== 1) return result('ambiguous', ['UNIQUE_REVIEWED_IDENTITY_REQUIRED']);
  if (!oldObject || !newObject || oldObject.projectId !== source.projectId || newObject.projectId !== source.projectId || oldObject.reference.objectRevisionId !== source.sourceObject.objectRevisionId || oldObject.reference.recordSha256 !== source.sourceObject.recordSha256 || oldObject.reference.traceId !== source.sourceObject.traceId || newObject.reference.objectRevisionId !== candidates[0] || oldObject.aggregateId !== source.aggregateId || oldObject.modelVersionId !== source.modelVersionId || oldObject.captureFrameId !== source.captureFrameId || newObject.aggregateId !== target.aggregateId || newObject.modelVersionId !== target.modelVersionId || newObject.captureFrameId !== target.captureFrameId) return result('missing', ['EXACT_OBJECT_EVIDENCE_REQUIRED']);
  const unchanged = oldObject.intrinsicShapeSha256 !== null && oldObject.intrinsicShapeSha256 === newObject.intrinsicShapeSha256 || oldObject.worldRepresentationSha256 !== null && oldObject.worldRepresentationSha256 === newObject.worldRepresentationSha256;
  if (source.mode === 'object-derived') {
    if (oldObject.geometryRole !== 'object' || newObject.geometryRole !== 'object') return result('suggested-review', ['EQUIPMENT_ANCHOR_RULE_NOT_APPLICABLE']);
    if (!unchanged) return result('suggested-review', ['SHAPE_CHANGE_OR_UNKNOWN_REQUIRES_REVIEW']);
    return result('rederived', [], deriveEquipmentBottomAnchor(newObject.bounds), { mode: source.mode, derivation: ENDPOINT_ANCHOR_RULE, sourceObject: newObject.reference, attachment: null, qualifiedProjectFrameId: frame.qualifiedProjectFrameId });
  }
  const a = oldObject.qualifiedAttachment, b = newObject.qualifiedAttachment;
  if (!a || !b || !source.attachment) return result('unsupported-transform', ['QUALIFIED_OBJECT_LOCAL_BASIS_UNAVAILABLE']);
  addEvidence(a.id, a.contentSha256, 'qualified-object'); addEvidence(b.id, b.contentSha256, 'qualified-object');
  const exact = (e: EndpointQualifiedObjectEvidence, o: EndpointMigrationObject) => e.projectId === source.projectId && e.aggregateId === o.aggregateId && e.modelVersionId === o.modelVersionId && e.captureFrameId === o.captureFrameId && e.object.objectRevisionId === o.reference.objectRevisionId && e.object.recordSha256 === o.reference.recordSha256 && e.object.traceId === o.reference.traceId && e.qualifiedProjectFrameId === frame.qualifiedProjectFrameId;
  if (!exact(a, oldObject) || !exact(b, newObject) || a.id !== source.attachment.evidenceId || a.contentSha256 !== source.attachment.evidenceSha256 || a.logicalObjectId !== source.attachment.logicalObjectId || a.logicalObjectId !== b.logicalObjectId || a.sourceDocumentId !== b.sourceDocumentId || a.sourceInstancePath !== b.sourceInstancePath || a.stableExportEntityId !== b.stableExportEntityId) return result('ambiguous', ['QUALIFIED_SCOPED_IDENTITY_MISMATCH']);
  if (oldObject.intrinsicShapeSha256 !== null && oldObject.intrinsicShapeSha256 !== a.intrinsicShapeSha256 || newObject.intrinsicShapeSha256 !== null && newObject.intrinsicShapeSha256 !== b.intrinsicShapeSha256) return result('deformed', ['CONTRADICTORY_SHAPE_EVIDENCE']);
  if (a.deformation !== 'rigid' || b.deformation !== 'rigid' || a.intrinsicShapeSha256 !== b.intrinsicShapeSha256 || a.intrinsicShapeSha256 !== source.attachment.sourceShapeSha256 || a.placementSha256 !== source.attachment.sourcePlacementSha256) return result('deformed', ['SHAPE_OR_DEFORMATION_UNVERIFIED']);
  for (const e of [a, b]) { const rigid = validateEndpointRigidTransform(e.objectLocalToProjectMetres, policy); if (!rigid.supported) return result('unsupported-transform', [rigid.reasonCode]); }
  let local = source.attachment.localPointMetres;
  if (source.attachment.connectorId !== null) {
    const oldConnector = a.connectors.find(c => c.id === source.attachment!.connectorId), newConnector = b.connectors.find(c => c.id === source.attachment!.connectorId);
    if (!oldConnector || !newConnector) return result('connector-missing', ['DURABLE_CONNECTOR_UNAVAILABLE']);
    if (Math.hypot(...oldConnector.localPointMetres.map((v, i) => v - local[i])) > policy.numericalTolerance || Math.hypot(...newConnector.localPointMetres.map((v, i) => v - oldConnector.localPointMetres[i])) > policy.numericalTolerance) return result('deformed', ['CONNECTOR_LOCAL_GEOMETRY_CHANGED']);
    local = newConnector.localPointMetres;
  }
  try {
    const previous = transformEndpointPoint(a.objectLocalToProjectMetres, source.attachment.localPointMetres);
    if (Math.hypot(...previous.map((v, i) => v - source.pointProjectMetres[i])) > policy.numericalTolerance) return result('unsupported-transform', ['SOURCE_POINT_ATTACHMENT_MISMATCH']);
    return result('carried-rigid', [], transformEndpointPoint(b.objectLocalToProjectMetres, local), { mode: source.mode, derivation: source.derivation, sourceObject: newObject.reference, qualifiedProjectFrameId: frame.qualifiedProjectFrameId, attachment: { ...source.attachment, evidenceId: b.id, evidenceSha256: b.contentSha256, localPointMetres: local, sourceShapeSha256: b.intrinsicShapeSha256, sourcePlacementSha256: b.placementSha256, frameDecisionId: frame.id } });
  } catch { return result('unsupported-transform', ['TARGET_POINT_OUT_OF_RANGE']); }
}
