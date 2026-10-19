import { z } from 'zod';
import { policyHashSchema as hash, policyUuidSchema as uuid, policyRevisionSchema as revision } from './pathfinderPurposePolicy.js';
import { endpointBindingSchema, endpointCurrentScopeSchema, endpointDisplacementVectorSchema, endpointMigrationDispositionSchema, endpointMigrationProposalSchema, endpointPointSchema } from './pathfinderEndpointBindings.js';
import { deriveEquipmentBottomAnchor, endpointFrameMappingSchema, endpointMigrationObjectSchema, endpointObjectMappingSchema, endpointRigidPolicySchema, evaluateEndpointMigration, transformEndpointPoint, validateEndpointRigidTransform, type EndpointMigrationInput } from './pathfinderEndpointAttachment.js';
import { revisionComparisonScopeSchema, type RevisionComparisonScope } from './pathfinderRevisionComparison.js';

export const ENDPOINT_ATTACHMENT_POLICY_V2 = 'wfc.pf.endpoint-attachment-policy.v2' as const;
const nonempty = z.string().min(1).max(2048).refine(v => v.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(v));
const timestamp = z.string().datetime().refine(v => v.endsWith('Z'));
const code = z.string().min(1).max(128).refine(v => /^[A-Z][A-Z0-9_]*$/.exec(v)?.[0] === v);
/** Separate immutable review evidence. It never changes the source binding's NULL frame. */
export const sourceBindingFrameQualificationSchema = z.object({ schemaVersion: z.literal('wfc.pf.source-binding-frame-qualification.v1'), id: uuid, contentSha256: hash, projectId: uuid, sourceBindingId: uuid, sourceBindingSha256: hash, sourceAggregateId: uuid, sourceCaptureFrameId: uuid, qualifiedProjectFrameId: uuid, frameDecisionId: uuid, frameDecisionSha256: hash, comparisonId: uuid, comparisonRevision: revision, decisionSetSha256: hash, reviewedBy: uuid, reviewedAt: timestamp, reason: nonempty }).strict();
export type SourceBindingFrameQualification = z.infer<typeof sourceBindingFrameQualificationSchema>;
export const endpointMigrationEvaluationV2Schema = z.object({
  schemaVersion: z.literal('wfc.pf.endpoint-migration-evaluation.v2'), sourceBindingId: uuid, sourceBindingSha256: hash,
  sourcePointProjectMetres: endpointPointSchema, sourcePointInTargetFrameMetres: endpointPointSchema.nullable(), targetPointProjectMetres: endpointPointSchema.nullable(), displacementVectorMetres: endpointDisplacementVectorSchema.nullable(), displacementMetres: z.number().finite().nonnegative().nullable(), proposal: endpointMigrationProposalSchema.nullable(), disposition: endpointMigrationDispositionSchema,
  status: z.enum(['suggested', 'missing', 'ambiguous', 'stale', 'unsupported-attachment']), reasonCodes: z.array(code).max(100).refine(v => new Set(v).size === v.length), candidateObjectRevisionIds: z.array(uuid).max(100).refine(v => new Set(v).size === v.length), evidenceIds: z.array(uuid).max(100).refine(v => new Set(v).size === v.length),
  evidenceReferences: z.array(z.object({ id: uuid, sha256: hash, kind: z.enum(['frame-mapping', 'object-mapping', 'rigid-policy', 'qualified-object', 'binding-frame-qualification']) }).strict()).max(100),
  comparisonScope: revisionComparisonScopeSchema, sourceBindingFrameQualification: z.object({ id: uuid, sha256: hash }).strict().nullable(), requiresConfirmation: z.literal(true), attachmentPolicyVersion: z.literal(ENDPOINT_ATTACHMENT_POLICY_V2),
}).strict().superRefine((v, ctx) => {
  const has = v.targetPointProjectMetres !== null;
  if (has !== (v.displacementVectorMetres !== null) || has !== (v.displacementMetres !== null) || has !== (v.proposal !== null) || has && v.sourcePointInTargetFrameMetres === null) ctx.addIssue({ code: 'custom', message: 'A qualified migration proposal retains a normalized comparable source point.' });
  if (v.targetPointProjectMetres && v.sourcePointInTargetFrameMetres && v.displacementVectorMetres && (v.displacementVectorMetres.some((n, i) => n !== v.targetPointProjectMetres![i] - v.sourcePointInTargetFrameMetres![i]) || v.displacementMetres !== Math.hypot(...v.displacementVectorMetres))) ctx.addIssue({ code: 'custom', message: 'Displacement is measured in the target frame.' });
  if (v.evidenceIds.length !== v.evidenceReferences.length || v.evidenceReferences.some((e, i) => e.id !== v.evidenceIds[i]) || v.sourceBindingFrameQualification && !v.evidenceReferences.some(e => e.kind === 'binding-frame-qualification' && e.id === v.sourceBindingFrameQualification!.id && e.sha256 === v.sourceBindingFrameQualification!.sha256)) ctx.addIssue({ code: 'custom', message: 'Every immutable qualification remains hash-bound.' });
});
export type EndpointMigrationEvaluationV2 = z.infer<typeof endpointMigrationEvaluationV2Schema>;
export type EndpointMigrationInputV2 = EndpointMigrationInput & { comparisonScope: RevisionComparisonScope; sourceBindingFrameQualification: SourceBindingFrameQualification | null };

/** New policy version, original source preserved. All outputs are suggestions requiring confirmation. */
export function evaluateEndpointMigrationV2(raw: EndpointMigrationInputV2): EndpointMigrationEvaluationV2 {
  const source = endpointBindingSchema.parse(raw.sourceBinding), target = endpointCurrentScopeSchema.parse(raw.targetAggregate), scope = revisionComparisonScopeSchema.parse(raw.comparisonScope);
  const frame = raw.frameMapping === null ? null : endpointFrameMappingSchema.parse(raw.frameMapping), mapping = raw.objectMapping === null ? null : endpointObjectMappingSchema.parse(raw.objectMapping), policy = raw.validationPolicy === null ? null : endpointRigidPolicySchema.parse(raw.validationPolicy);
  const qualification = raw.sourceBindingFrameQualification === null ? null : sourceBindingFrameQualificationSchema.parse(raw.sourceBindingFrameQualification);
  const old = raw.sourceObject === null ? null : endpointMigrationObjectSchema.parse(raw.sourceObject), next = raw.targetObject === null ? null : endpointMigrationObjectSchema.parse(raw.targetObject);
  let normalized: [number, number, number] | null = null;
  const refs: EndpointMigrationEvaluationV2['evidenceReferences'] = [];
  const add = (id: string, sha256: string, kind: EndpointMigrationEvaluationV2['evidenceReferences'][number]['kind']) => { const found = refs.find(r => r.id === id); if (found && (found.sha256 !== sha256 || found.kind !== kind)) throw Error('CONTRADICTORY_IMMUTABLE_EVIDENCE_REFERENCE'); if (!found) refs.push({ id, sha256, kind }); };
  const result = (disposition: EndpointMigrationEvaluationV2['disposition'], reasonCodes: string[], point: [number, number, number] | null = null, proposal: EndpointMigrationEvaluationV2['proposal'] = null): EndpointMigrationEvaluationV2 => endpointMigrationEvaluationV2Schema.parse({
    schemaVersion: 'wfc.pf.endpoint-migration-evaluation.v2', sourceBindingId: source.id, sourceBindingSha256: source.contentSha256, sourcePointProjectMetres: source.pointProjectMetres, sourcePointInTargetFrameMetres: normalized, targetPointProjectMetres: point, displacementVectorMetres: point ? point.map((n, i) => n - normalized![i]) : null, displacementMetres: point ? Math.hypot(...point.map((n, i) => n - normalized![i])) : null, proposal, disposition,
    status: disposition === 'missing' ? 'missing' : ['ambiguous', 'split', 'merged'].includes(disposition) ? 'ambiguous' : ['carried-fixed', 'carried-rigid', 'rederived', 'suggested-review'].includes(disposition) ? 'suggested' : disposition === 'unsupported-transform' ? 'unsupported-attachment' : 'stale', reasonCodes, candidateObjectRevisionIds: mapping?.targetObjectRevisionIds ?? [], evidenceIds: refs.map(r => r.id), evidenceReferences: refs,
    comparisonScope: scope, sourceBindingFrameQualification: qualification ? { id: qualification.id, sha256: qualification.contentSha256 } : null, requiresConfirmation: true, attachmentPolicyVersion: ENDPOINT_ATTACHMENT_POLICY_V2,
  });
  if (qualification) add(qualification.id, qualification.contentSha256, 'binding-frame-qualification');
  if (source.status !== 'confirmed') return result('suggested-review', ['SOURCE_BINDING_NOT_CONFIRMED']);
  if (scope.sourceAggregateId !== source.aggregateId || scope.targetAggregateId !== target.aggregateId) return result('frame-unverified', ['COMPARISON_PAIR_MISMATCH']);
  if (frame) add(frame.id, frame.contentSha256, 'frame-mapping');
  if (!frame || frame.qualification !== 'reviewed-rigid' || !frame.reviewedBy || !frame.reviewedAt || frame.projectId !== source.projectId || frame.sourceAggregateId !== source.aggregateId || frame.targetAggregateId !== target.aggregateId || frame.sourceCaptureFrameId !== source.captureFrameId || frame.targetCaptureFrameId !== target.captureFrameId) return result('frame-unverified', ['COMMON_FRAME_MAPPING_UNVERIFIED']);
  // The server resolves the current subject head and exact live frame/object basis.
  // Unrelated decisions do not rewrite/revoke this qualifier's historical creation scope.
  // The NEW evaluation still freezes the complete current scope for confirmation CAS.
  const exactQualification = qualification && qualification.projectId === source.projectId && qualification.sourceBindingId === source.id && qualification.sourceBindingSha256 === source.contentSha256 && qualification.sourceAggregateId === source.aggregateId && qualification.sourceCaptureFrameId === source.captureFrameId && qualification.qualifiedProjectFrameId === frame.qualifiedProjectFrameId && qualification.frameDecisionId === frame.id && qualification.frameDecisionSha256 === frame.contentSha256 && qualification.comparisonId === scope.comparisonId && BigInt(qualification.comparisonRevision) <= BigInt(scope.comparisonRevision);
  if (qualification && !exactQualification || source.qualifiedProjectFrameId === null && !exactQualification || source.qualifiedProjectFrameId !== null && source.qualifiedProjectFrameId !== frame.qualifiedProjectFrameId) return result('frame-unverified', ['EXACT_SOURCE_BINDING_FRAME_QUALIFICATION_REQUIRED']);
  if (!policy) return result('unsupported-transform', ['TRANSFORM_VALIDATION_POLICY_UNAVAILABLE']);
  add(policy.id, policy.contentSha256, 'rigid-policy');
  const rigid = validateEndpointRigidTransform(frame.sourceCaptureToTargetCaptureMetres, policy);
  if (!rigid.supported) return result('unsupported-transform', [rigid.reasonCode]);
  try { normalized = transformEndpointPoint(frame.sourceCaptureToTargetCaptureMetres, source.pointProjectMetres); } catch { return result('unsupported-transform', ['SOURCE_FRAME_POINT_OUT_OF_RANGE']); }
  if (source.mode === 'fixed-world') return result('carried-fixed', [], normalized, { mode: 'fixed-world', derivation: source.derivation, sourceObject: null, attachment: null, qualifiedProjectFrameId: frame.qualifiedProjectFrameId });
  if (source.mode === 'object-attached') {
    // A source-frame review does not create object-local coordinates or a source identity.
    if (source.qualifiedProjectFrameId === null || !source.attachment || !old?.qualifiedAttachment || !next?.qualifiedAttachment) return result('unsupported-transform', ['QUALIFIED_OBJECT_LOCAL_BASIS_UNAVAILABLE']);
    const legacy = evaluateEndpointMigration(raw);
    for (const reference of legacy.evidenceReferences) add(reference.id, reference.sha256, reference.kind);
    normalized = legacy.sourcePointInTargetFrameMetres;
    return result(legacy.disposition, legacy.reasonCodes, legacy.targetPointProjectMetres, legacy.proposal);
  }
  if (mapping) add(mapping.id, mapping.contentSha256, 'object-mapping');
  if (!mapping || mapping.projectId !== source.projectId || mapping.sourceAggregateId !== source.aggregateId || mapping.targetAggregateId !== target.aggregateId || !source.sourceObject || !mapping.sourceObjectRevisionIds.includes(source.sourceObject.objectRevisionId)) return result('missing', ['OBJECT_MAPPING_UNAVAILABLE']);
  if (mapping.disposition !== 'unique') return result(mapping.disposition, ['OBJECT_' + mapping.disposition.toUpperCase().replaceAll('-', '_')]);
  if (mapping.qualification !== 'reviewed-identity' || !mapping.reviewedBy || !mapping.reviewedAt || mapping.sourceObjectRevisionIds.length !== 1 || mapping.targetObjectRevisionIds.length !== 1) return result('ambiguous', ['UNIQUE_REVIEWED_IDENTITY_REQUIRED']);
  if (!old || !next || old.projectId !== source.projectId || next.projectId !== source.projectId || old.modelVersionId !== source.modelVersionId || next.modelVersionId !== target.modelVersionId || old.aggregateId !== source.aggregateId || next.aggregateId !== target.aggregateId || old.captureFrameId !== source.captureFrameId || next.captureFrameId !== target.captureFrameId || old.reference.objectRevisionId !== source.sourceObject.objectRevisionId || old.reference.traceId !== source.sourceObject.traceId || old.reference.recordSha256 !== source.sourceObject.recordSha256 || next.reference.objectRevisionId !== mapping.targetObjectRevisionIds[0] || target.traceId !== null && next.reference.traceId !== target.traceId) return result('missing', ['EXACT_OBJECT_EVIDENCE_REQUIRED']);
  if (old.geometryRole !== 'object' || next.geometryRole !== 'object') return result('suggested-review', ['EQUIPMENT_ANCHOR_RULE_NOT_APPLICABLE']);
  if (old.intrinsicShapeSha256 === null || old.intrinsicShapeSha256 !== next.intrinsicShapeSha256) return result('suggested-review', ['SHAPE_CHANGE_OR_UNKNOWN_REQUIRES_REVIEW']);
  return result('rederived', [], deriveEquipmentBottomAnchor(next.bounds), { mode: 'object-derived', derivation: 'equipment-bottom-aabb.v1', sourceObject: next.reference, attachment: null, qualifiedProjectFrameId: frame.qualifiedProjectFrameId });
}

