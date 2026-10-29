import { z } from 'zod';
import { geometryObjectRevisionSchema, geometryPointSchema, type GeometryObjectRevision } from './pathfinderGeometryTrace.js';
import { policyHashSchema as hash, policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';
import { endpointFrameMappingSchema, endpointRigidPolicySchema, validateEndpointRigidTransform } from './pathfinderEndpointAttachment.js';
import { REVISION_COMPARISON_LIMITS, revisionComparisonChangeSchema, revisionComparisonDecisionSchema, revisionComparisonInputSchema, revisionComparisonReadinessSchema, type RevisionComparisonChange, type RevisionComparisonDecision, type RevisionComparisonReadiness, type RevisionEvidenceReference, type RevisionChangeFlag } from './pathfinderRevisionComparison.js';

/** Server-resolved immutable evidence only. Public mapping reviews cannot create these facts. */
export const revisionQualifiedObjectSchema = z.object({
  schemaVersion: z.literal('wfc.pf.revision-qualified-object.v1'), id: uuid, contentSha256: hash,
  projectId: uuid, objectRevisionId: uuid, recordSha256: hash, aggregateId: uuid, captureFrameId: uuid,
  logicalObjectId: uuid, sourceDocumentId: z.string().min(1).max(2048), sourceInstancePath: z.string().min(1).max(2048), stableExportEntityId: z.string().min(1).max(2048),
  qualifiedProjectFrameId: uuid, intrinsicShapeSha256: hash.nullable(), placementSha256: hash.nullable(), originInCommonFrameMetres: geometryPointSchema.nullable(), physicalLengthMetres: z.number().finite().nonnegative().nullable(),
  connectivitySha256: hash.nullable(), connectivityContextSha256: hash.nullable(),
}).strict().refine(v => (v.connectivitySha256 === null) === (v.connectivityContextSha256 === null));
export const revisionComparisonDatasetSchema = z.object({ input: revisionComparisonInputSchema, objects: z.array(geometryObjectRevisionSchema).max(REVISION_COMPARISON_LIMITS.objectsPerSide), qualifications: z.array(revisionQualifiedObjectSchema).max(REVISION_COMPARISON_LIMITS.objectsPerSide) }).strict();
export const revisionComparatorInputSchema = z.object({ projectId: uuid, source: revisionComparisonDatasetSchema, target: revisionComparisonDatasetSchema, decisions: z.array(revisionComparisonDecisionSchema).max(REVISION_COMPARISON_LIMITS.decisions), frame: endpointFrameMappingSchema.nullable(), validationPolicy: endpointRigidPolicySchema.nullable() }).strict();
export type RevisionQualifiedObject = z.infer<typeof revisionQualifiedObjectSchema>;
export type RevisionComparatorInput = z.infer<typeof revisionComparatorInputSchema>;
export type RevisionComparatorResult = { changes: RevisionComparisonChange[]; counts: { sourceObjects: number; targetObjects: number; changes: number; candidateEdges: number; matched: number; unresolved: number }; readiness: RevisionComparisonReadiness };
type Options = { hash?: (value: unknown) => string; signal?: AbortSignal };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const identityKey = (q: RevisionQualifiedObject) => JSON.stringify([q.sourceDocumentId, q.sourceInstancePath, q.stableExportEntityId, q.logicalObjectId]);
const nameKey = (v: string) => v.normalize('NFC').trim();
const fail = (code: string): never => { throw Error(code); };
const keyAdd = (index: Map<string, string[]>, key: string | null, id: string) => { if (key !== null && key !== '') { const old = index.get(key); if (old) old.push(id); else index.set(key, [id]); } };
const declared = (o: GeometryObjectRevision | undefined) => o?.audit.declaredLength?.valueMm ?? null;

/** Deterministic diagnostic comparison. It never edits geometry or establishes endpoint readiness. */
export function compareModelRevisions(raw: RevisionComparatorInput, options: Options = {}): RevisionComparatorResult {
  const value = revisionComparatorInputSchema.parse(raw), { source, target } = value;
  if (source.input.aggregateId === target.input.aggregateId) fail('REVISION_PAIR_MUST_DIFFER');
  let work = 0;
  const check = () => { if (++work % 64 === 0 && options.signal?.aborted || options.signal?.aborted) fail('REVISION_COMPARISON_CANCELLED'); };
  const validateDataset = (dataset: typeof source) => {
    if (dataset.objects.length !== dataset.input.coverage.includedObjects || new Set(dataset.objects.map(o => o.id)).size !== dataset.objects.length) fail('REVISION_OBJECT_COUNT_OR_DUPLICATE');
    const objects = new Map(dataset.objects.map(o => [o.id, o])), qualified = new Map<string, RevisionQualifiedObject>();
    for (const object of dataset.objects) {
      check();
      if (object.projectId !== value.projectId || object.aggregateId !== dataset.input.aggregateId || object.traceId !== dataset.input.traceId || object.modelVersionId !== dataset.input.modelVersionId || object.coordinates.captureFrameId !== dataset.input.captureFrameId || object.provenance.projectionSha256 !== dataset.input.projectionSha256) fail('REVISION_OBJECT_SCOPE_MISMATCH');
    }
    for (const q of dataset.qualifications) {
      check(); const object = objects.get(q.objectRevisionId);
      if (!object || qualified.has(q.objectRevisionId) || q.projectId !== value.projectId || q.aggregateId !== dataset.input.aggregateId || q.captureFrameId !== dataset.input.captureFrameId || !options.hash || options.hash(object) !== q.recordSha256 || options.hash((({ contentSha256: _hash, ...rest }) => rest)(q)) !== q.contentSha256) fail('REVISION_QUALIFICATION_SCOPE_OR_HASH_MISMATCH');
      qualified.set(q.objectRevisionId, q);
    }
    return { objects, qualified };
  };
  const a = validateDataset(source), b = validateDataset(target);
  if ([...a.objects.keys()].some(id => b.objects.has(id))) fail('REVISION_OBJECT_REVISION_REUSED_BETWEEN_INPUTS');
  const idsA = new Map<string, string[]>(), idsB = new Map<string, string[]>(), names = new Map<string, string[]>(), trays = new Map<string, string[]>(), external = new Map<string, string[]>();
  for (const q of a.qualified.values()) keyAdd(idsA, identityKey(q), q.objectRevisionId);
  for (const q of b.qualified.values()) keyAdd(idsB, identityKey(q), q.objectRevisionId);
  for (const o of target.objects) { check(); keyAdd(names, nameKey(o.historicalModel.name), o.id); keyAdd(trays, o.catalog.projectTrayId, o.id); keyAdd(external, o.identity.externalId, o.id); }
  const mappingBySource = new Map<string, RevisionComparisonDecision>(), mappedTargets = new Set<string>();
  for (const decision of value.decisions) {
    check(); if (decision.projectId !== value.projectId) fail('REVISION_DECISION_PROJECT_MISMATCH');
    if (decision.kind !== 'object-mapping') continue;
    for (const id of decision.body.sourceObjectRevisionIds) { if (!a.objects.has(id) || mappingBySource.has(id)) fail('REVISION_MAPPING_SOURCE_CONFLICT'); mappingBySource.set(id, decision); }
    for (const id of decision.body.targetObjectRevisionIds) { if (!b.objects.has(id) || mappedTargets.has(id)) fail('REVISION_MAPPING_TARGET_CONFLICT'); mappedTargets.add(id); }
  }
  const frame = value.frame, policy = value.validationPolicy;
  const frameValid = !!(frame && policy && frame.qualification === 'reviewed-rigid' && frame.reviewedBy && frame.reviewedAt && frame.projectId === value.projectId && frame.sourceAggregateId === source.input.aggregateId && frame.targetAggregateId === target.input.aggregateId && frame.sourceCaptureFrameId === source.input.captureFrameId && frame.targetCaptureFrameId === target.input.captureFrameId && validateEndpointRigidTransform(frame.sourceCaptureToTargetCaptureMetres, policy).supported);
  const comparableCoverage = source.input.coverage.requestedScopeComplete && target.input.coverage.requestedScopeComplete && source.input.coverage.comparableScopeSha256 !== null && source.input.coverage.comparableScopeSha256 === target.input.coverage.comparableScopeSha256 && a.qualified.size === a.objects.size && b.qualified.size === b.objects.size;
  const changes: RevisionComparisonChange[] = [], consumedA = new Set<string>(), consumedB = new Set<string>();
  let candidateEdges = 0, matched = 0, unresolved = 0;
  const baseMeasurements = (old: GeometryObjectRevision | undefined, next: GeometryObjectRevision | undefined): RevisionComparisonChange['measurements'] => {
    const av = old?.geometry.fitted?.geometricLengthMetres ?? null, bv = next?.geometry.fitted?.geometricLengthMetres ?? null;
    return { sourceFittedLengthMetres: av, targetFittedLengthMetres: bv, fittedLengthDeltaMetres: av === null || bv === null ? null : bv - av, sourceDeclaredLengthMm: declared(old), targetDeclaredLengthMm: declared(next), displacementVectorMetres: null, displacementMetres: null };
  };
  const emit = (row: Omit<RevisionComparisonChange, 'rowIndex' | 'automaticBindingCarryEligible'>) => { if (changes.length >= REVISION_COMPARISON_LIMITS.changes) fail('REVISION_CHANGE_LIMIT'); changes.push(revisionComparisonChangeSchema.parse({ ...row, rowIndex: changes.length, automaticBindingCarryEligible: false })); if (row.requiresReview) unresolved++; };
  for (const old of source.objects) {
    check(); if (consumedA.has(old.id)) continue;
    const decision = mappingBySource.get(old.id), sourceIds = decision?.kind === 'object-mapping' ? decision.body.sourceObjectRevisionIds : [old.id];
    let targetIds: string[] = [], basis: RevisionComparisonChange['relation']['basis'] = 'unmatched', disposition: RevisionComparisonChange['relation']['disposition'] = 'missing';
    if (decision?.kind === 'object-mapping') { targetIds = decision.body.targetObjectRevisionIds; basis = 'admin-reviewed-correspondence'; disposition = decision.body.disposition; }
    else {
      const q = a.qualified.get(old.id), identity = q ? identityKey(q) : null;
      const matches = identity === null ? [] : idsB.get(identity) ?? [];
      if (identity !== null && idsA.get(identity)?.length === 1 && matches.length === 1 && !mappedTargets.has(matches[0])) { targetIds = matches; basis = 'proven-scoped-identity'; disposition = 'unique'; }
    }
    for (const id of sourceIds) consumedA.add(id);
    if (targetIds.some(id => consumedB.has(id))) fail('REVISION_TARGET_REUSED');
    for (const id of targetIds) consumedB.add(id);
    const next = targetIds.length === 1 ? b.objects.get(targetIds[0]) : undefined;
    const flags: RevisionChangeFlag[] = [], reasons: string[] = [], evidence: RevisionEvidenceReference[] = [];
    const add = (flag: RevisionChangeFlag) => { if (!flags.includes(flag)) flags.push(flag); };
    const measurements = baseMeasurements(sourceIds.length === 1 ? old : undefined, next);
    const candidates = new Map<string, string[]>();
    if (targetIds.length === 0 && !decision) {
      const collect = (index: Map<string, string[]>, key: string | null, code: string) => { for (const id of key === null ? [] : index.get(key) ?? []) { check(); const present = candidates.get(id); if (present) { if (!present.includes(code)) present.push(code); } else { if (candidates.size >= REVISION_COMPARISON_LIMITS.candidatesPerObject || ++candidateEdges > REVISION_COMPARISON_LIMITS.candidateEdges) fail('REVISION_CANDIDATE_LIMIT'); candidates.set(id, [code]); } } };
      collect(names, nameKey(old.historicalModel.name), 'EXACT_NAME_CANDIDATE'); collect(trays, old.catalog.projectTrayId, 'PROJECT_TRAY_CANDIDATE'); collect(external, old.identity.externalId, 'UNSCOPED_EXTERNAL_ID_CANDIDATE');
      if (candidates.size) { basis = 'candidate-only'; disposition = candidates.size > 1 ? 'ambiguous' : 'missing'; add('correspondence-unverified'); reasons.push('CANDIDATES_ARE_NOT_IDENTITY'); if (candidates.size > 1) add('ambiguous'); }
      else { add(comparableCoverage && a.qualified.has(old.id) ? 'removed' : 'absent-from-scope'); reasons.push(comparableCoverage ? 'COMPLETE_COMPARABLE_IDENTITY_COVERAGE' : 'IDENTITY_OR_COVERAGE_NOT_PROVED'); }
    } else if (disposition !== 'unique') {
      if (disposition === 'split') add('split'); else if (disposition === 'merged') add('merged'); else if (disposition === 'replaced') add('replaced'); else if (disposition === 'ambiguous') add('ambiguous'); else add('correspondence-unverified');
      reasons.push('REVIEWED_RELATION_DOES_NOT_QUALIFY_LOCAL_GEOMETRY');
    } else if (next) {
      matched++;
      const aq = a.qualified.get(old.id), bq = b.qualified.get(next.id);
      if (decision) evidence.push({ id: decision.id, sha256: decision.contentSha256, kind: 'object-mapping' });
      if (aq) evidence.push({ id: aq.id, sha256: aq.contentSha256, kind: 'qualified-object' });
      if (bq) evidence.push({ id: bq.id, sha256: bq.contentSha256, kind: 'qualified-object' });
      if (old.signatures.worldRepresentationSha256 !== next.signatures.worldRepresentationSha256) add('representation-changed');
      if (measurements.fittedLengthDeltaMetres !== null && measurements.fittedLengthDeltaMetres !== 0) add('observed-fitted-length-changed');
      if (old.geometry.fitted && next.geometry.fitted && !equal(old.geometry.fitted.pointsMetres, next.geometry.fitted.pointsMetres)) add('observed-fitted-path-changed');
      if (old.signatures.portsSha256 !== null && next.signatures.portsSha256 !== null && old.signatures.portsSha256 !== next.signatures.portsSha256) add('ports-changed');
      if (old.catalog.projectTrayId !== next.catalog.projectTrayId) add('project-tray-association-changed');
      if (old.catalog.projectTrayId !== null && old.catalog.projectTrayId === next.catalog.projectTrayId && old.catalog.purposeKey !== next.catalog.purposeKey) add('project-purpose-changed');
      if (!equal([...new Set(old.historicalModel.observedModelPurposes)].sort(), [...new Set(next.historicalModel.observedModelPurposes)].sort())) add('model-purpose-changed');
      if (!equal(old.catalog.allowedCategories, next.catalog.allowedCategories)) add('policy-changed');
      const common = frameValid && aq && bq && identityKey(aq) === identityKey(bq) && aq.qualifiedProjectFrameId === frame!.qualifiedProjectFrameId && bq.qualifiedProjectFrameId === frame!.qualifiedProjectFrameId;
      if (!common) { add('coordinate-frame-unverified'); reasons.push('QUALIFIED_COMMON_FRAME_AND_SCOPED_IDENTITY_REQUIRED'); }
      else {
        evidence.push({ id: frame!.id, sha256: frame!.contentSha256, kind: 'frame-mapping' }, { id: policy!.id, sha256: policy!.contentSha256, kind: 'rigid-policy' });
        if (aq.originInCommonFrameMetres && bq.originInCommonFrameMetres) { measurements.displacementVectorMetres = bq.originInCommonFrameMetres.map((v, i) => v - aq.originInCommonFrameMetres![i]) as [number, number, number]; measurements.displacementMetres = Math.hypot(...measurements.displacementVectorMetres); if (policy!.engineeringToleranceMetres !== null && measurements.displacementMetres > policy!.engineeringToleranceMetres) add('moved'); }
        if (aq.placementSha256 !== null && bq.placementSha256 !== null && aq.placementSha256 !== bq.placementSha256) add('moved');
        if (aq.intrinsicShapeSha256 !== null && bq.intrinsicShapeSha256 !== null && aq.intrinsicShapeSha256 !== bq.intrinsicShapeSha256) add('geometry-changed');
        if (aq.physicalLengthMetres !== null && bq.physicalLengthMetres !== null && policy!.engineeringToleranceMetres !== null && Math.abs(aq.physicalLengthMetres - bq.physicalLengthMetres) > policy!.engineeringToleranceMetres) add('length-changed');
        if (aq.connectivitySha256 !== null && bq.connectivitySha256 !== null && aq.connectivityContextSha256 === bq.connectivityContextSha256 && aq.connectivitySha256 !== bq.connectivitySha256) add('connectivity-changed');
        const equalShape = aq.intrinsicShapeSha256 !== null && aq.intrinsicShapeSha256 === bq.intrinsicShapeSha256;
        const equalConnectivity = aq.connectivitySha256 !== null && aq.connectivitySha256 === bq.connectivitySha256 && aq.connectivityContextSha256 === bq.connectivityContextSha256;
        const equalPlacement = aq.placementSha256 !== null && aq.placementSha256 === bq.placementSha256;
        if (equalShape && equalConnectivity && equalPlacement && policy!.engineeringToleranceMetres !== null && measurements.displacementMetres !== null && measurements.displacementMetres <= policy!.engineeringToleranceMetres && aq.physicalLengthMetres !== null && bq.physicalLengthMetres !== null && Math.abs(aq.physicalLengthMetres - bq.physicalLengthMetres) <= policy!.engineeringToleranceMetres && !flags.some(f => ['geometry-changed', 'moved', 'length-changed', 'connectivity-changed', 'project-purpose-changed', 'model-purpose-changed', 'project-tray-association-changed', 'policy-changed'].includes(f))) add('unchanged');
        if (!equalShape || !equalConnectivity || !equalPlacement || policy!.engineeringToleranceMetres === null || measurements.displacementMetres === null) reasons.push('PHYSICAL_EQUIVALENCE_EVIDENCE_INCOMPLETE');
      }
    }
    if (!flags.length) { add('correspondence-unverified'); reasons.push('POSITIVE_EQUIVALENCE_EVIDENCE_REQUIRED'); }
    emit({ sourceObjectRevisionIds: sourceIds, targetObjectRevisionIds: targetIds, relation: { basis, disposition, decisionId: decision?.id ?? null }, flags, candidates: [...candidates].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([objectRevisionId, reasonCodes]) => ({ objectRevisionId, reasonCodes })), measurements, evidenceReferences: evidence, reasonCodes: reasons, requiresReview: !flags.includes('unchanged') || flags.some(f => f !== 'unchanged') });
  }
  for (const next of target.objects) {
    check(); if (consumedB.has(next.id)) continue;
    emit({ sourceObjectRevisionIds: [], targetObjectRevisionIds: [next.id], relation: { basis: 'unmatched', disposition: 'missing', decisionId: null }, flags: [comparableCoverage && b.qualified.has(next.id) ? 'added' : 'absent-from-scope'], candidates: [], measurements: baseMeasurements(undefined, next), evidenceReferences: [], reasonCodes: [comparableCoverage ? 'COMPLETE_COMPARABLE_IDENTITY_COVERAGE' : 'IDENTITY_OR_COVERAGE_NOT_PROVED'], requiresReview: true });
  }
  return { changes, counts: { sourceObjects: source.objects.length, targetObjects: target.objects.length, changes: changes.length, candidateEdges, matched, unresolved }, readiness: revisionComparisonReadinessSchema.parse({ package: 'historical', geometry: 'ready', frame: frameValid ? 'qualified' : 'unverified', mappings: unresolved ? 'requires-review' : 'resolved', endpoints: 'not-evaluated', calculation: 'not-evaluated', review: 'required-per-proposal', apply: 'requires-fresh-human-review', reasonCodes: [...(!frameValid ? ['COMMON_FRAME_UNVERIFIED'] : []), ...(unresolved ? ['CHANGE_REVIEW_REQUIRED'] : [])] }) };
}
