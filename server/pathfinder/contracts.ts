import { z } from 'zod';
import { equipmentEligibilitySchema } from '../../shared/pathfinderPreparation.js';

export const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const revision = z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(value => BigInt(value) <= 9223372036854775807n);
const coordinate = z.number().finite().min(-1e9).max(1e9);
export const point = z.tuple([coordinate, coordinate, coordinate]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(2048).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/u);
const identity = z.string().trim().min(1).max(256).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/u);
const matrix = z.array(z.number().finite()).length(16);
const bounds = z.object({ minimum: point, maximum: point }).strict().refine(value => value.minimum.every((v, i) => v <= value.maximum[i]));
const fragment = z.object({
  id: identity, vertices: z.array(point).max(5_000_000), triangleIndices: z.array(z.number().int().nonnegative()).max(15_000_000),
  fragmentToWorldMetres: matrix.nullable(), transformAlreadyApplied: z.literal(true),
}).strict().superRefine((value, ctx) => {
  if (value.triangleIndices.length % 3 !== 0 || value.triangleIndices.some(index => index >= value.vertices.length))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Triangle indices are invalid.' });
});
/** Reported input/SDK row coverage; this never grants native or engineering proof. */
export const captureInputScopeSchema = z.object({
  schemaVersion: z.literal('wfc.capture.input.v1'),
  equipmentNameCount: z.number().int().nonnegative().max(4096),
  chunkCount: z.number().int().nonnegative().max(16),
  inputUtf8Bytes: z.number().int().positive().max(1024 * 1024),
  scopeSha256: hash,
  equipmentNamesSha256: hash,
  propertyScan: z.object({
    indexedObjectCount: z.number().int().positive().max(1_000_000),
    attemptedObjectCount: z.number().int().nonnegative().max(1_000_000),
    returnedObjectCount: z.number().int().nonnegative().max(1_000_000),
    omittedObjectCount: z.number().int().nonnegative().max(1_000_000),
    complete: z.boolean(),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const scan = value.propertyScan;
  if ((value.equipmentNameCount === 0) !== (value.chunkCount === 0) || value.chunkCount > value.equipmentNameCount || value.equipmentNameCount > value.chunkCount * 256)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Input chunk counts disagree with the requested equipment scope.' });
  if (scan.returnedObjectCount > scan.attemptedObjectCount || scan.attemptedObjectCount > scan.indexedObjectCount || scan.omittedObjectCount !== scan.attemptedObjectCount - scan.returnedObjectCount)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Reported SDK row coverage counts disagree.' });
  if (scan.complete !== (value.equipmentNameCount > 0 && scan.attemptedObjectCount === scan.indexedObjectCount && scan.omittedObjectCount === 0))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Reported SDK row coverage completion disagrees with its counts.' });
});
export const snapshotObject = z.object({
  id: identity, parentId: identity.nullable().optional(), externalId: z.string().min(1).max(1024).nullable().optional(),
  dbId: z.number().int().nonnegative().max(2_147_483_647).nullable().optional(), name: text,
  geometryRole: z.enum(['hierarchy', 'object', 'routing-leaf']), leafToRootNames: z.array(text).min(1).max(512),
  properties: z.array(z.object({ category: text, name: text, value: text }).strict()).max(1024),
  equipmentEligibility: equipmentEligibilitySchema.optional(),
  nativeHidden: z.boolean().nullable(), planningExcluded: z.boolean(), routeName: text.nullable().optional(), shapeName: text.nullable().optional(), routeBoundaryId: identity.optional(),
  categoryAssignmentSource: z.enum(['unassigned', 'explicit-planning', 'native-reference-selection', 'synthetic', 'lookup-all-categories']),
  allowedCategories: z.array(z.enum(['MV', 'LV', 'Control'])).max(3), bounds,
  fragments: z.array(fragment).max(100_000),
  faceExtents: z.array(z.object({ face: z.enum(['MinX', 'MaxX', 'MinY', 'MaxY', 'MinZ', 'MaxZ']), bounds, sampleCount: z.number().int().nonnegative() }).strict()).max(6).nullable().optional(),
}).strict().superRefine((value,ctx)=>{
  if (value.equipmentEligibility && (value.geometryRole !== 'object' || value.nativeHidden !== null || value.planningExcluded))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Display eligibility belongs only to an equipment object without contradictory native/planning exclusion.'});
  if (value.routeBoundaryId!==undefined && (value.geometryRole!=='routing-leaf' || value.routeName!==undefined || value.shapeName!==undefined))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'A route boundary belongs only to a routing leaf and cannot compete with explicit route or shape names.'});
  if (value.categoryAssignmentSource==='lookup-all-categories' && (value.geometryRole!=='routing-leaf' || value.allowedCategories.length!==3 || !['MV','LV','Control'].every(category=>value.allowedCategories.includes(category as 'MV'|'LV'|'Control'))))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Lookup geometry must carry all three categories independently of planning rules.'});
});
const snapshotShapeSchema = z.object({
  schemaVersion: z.literal('pathfinder.model.snapshot.v1'),
  model: z.object({ projectId: identity, modelVersionId: identity, contentSha256: hash, sourceContentSha256: hash.nullable().optional() }).strict(),
  capture: z.object({ adapterVersion: z.string().min(1).max(256), sourceKind: z.enum(['converted', 'native', 'synthetic']),
    inventoryComplete: z.boolean(), geometryComplete: z.boolean(), unitsVerified: z.boolean(), transformsVerified: z.boolean(),
    planningVisibilityKnown: z.boolean(), sourceLinkVerified: z.boolean(), evidenceSha256: z.array(hash).max(256),
    lookupRouteCodes:z.array(z.string().max(256).regex(/^\/[A-Z0-9][A-Z0-9_.-]*$/)).min(1).max(100).optional(),
    inputScope: captureInputScopeSchema.optional() }).strict().superRefine((value, ctx) => {
      if (value.inputScope && (value.lookupRouteCodes !== undefined || value.sourceKind !== 'converted' || value.adapterVersion !== 'wfc.protected-selected-capture.v1' || value.inventoryComplete || value.geometryComplete || value.unitsVerified || value.transformsVerified || value.planningVisibilityKnown || value.sourceLinkVerified))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Input coverage metadata cannot grant completeness or native proofs.' });
    }),
  coordinates: z.object({ vertexFrame: z.literal('canonical-world-metres'), sourceUnits: z.string().min(1).max(64),
    metresPerSourceUnit: z.number().finite().positive().max(1e9).nullable(), sourceToWorldMetres: matrix.nullable(),
    globalOffsetMetres: point, displayToWorldMetres: matrix }).strict(),
  objects: z.array(snapshotObject).min(1).max(1_000_000),
}).strict();
/** Reused by the owned streaming parser after its strict header/object reads;
 * checking this context must not allocate another mesh-sized snapshot graph. */
export function hasValidEquipmentEligibilityEnvelope(value: Pick<z.infer<typeof snapshotShapeSchema>, 'capture' | 'objects'>): boolean {
  let hasEligibility = false;
  for (const object of value.objects) if (object.equipmentEligibility) {
    hasEligibility = true;
    if (object.geometryRole !== 'object' || object.nativeHidden !== null || object.planningExcluded) return false;
  }
  if (!hasEligibility) return true;
  const capture = value.capture;
  return capture.sourceKind === 'converted' && ['wfc.protected-selected-capture.v1', 'wfc.project-preparation-aggregate.v1'].includes(capture.adapterVersion) &&
    capture.lookupRouteCodes === undefined && !capture.inventoryComplete && !capture.geometryComplete && !capture.unitsVerified &&
    !capture.transformsVerified && !capture.planningVisibilityKnown && !capture.sourceLinkVerified;
}
export const snapshotSchema = snapshotShapeSchema.superRefine((value, ctx) => {
  if (!hasValidEquipmentEligibilityEnvelope(value))
    ctx.addIssue({code:z.ZodIssueCode.custom,path:['capture'],message:'SDK display eligibility requires a converted selected or aggregate capture without native or completeness claims.'});
});
export type ComputationalSnapshot = z.infer<typeof snapshotSchema>;
export type SnapshotObject = z.infer<typeof snapshotObject>;
const locationName = z.string().trim().min(1).max(500).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/u);
export const createLocationSchema = z.object({ name: locationName, aliases: z.array(locationName).max(100), expectedRegistryRevision: revision }).strict();
export const bindLocationSchema = z.object({ modelVersionId: uuid, expectedSelectionRevision: revision, expectedRegistryRevision: revision,
  point, objectId: identity.nullable(), externalId: z.string().min(1).max(1024).nullable(),
  derivation:z.enum(['manual-world-point','picked-surface-point','equipment-bottom-aabb']).optional() }).strict();
export const artifactSchema = z.object({ modelVersionId: uuid, expectedSelectionRevision: revision, expectedRegistryRevision: revision,
  snapshot: snapshotSchema.refine(value=>value.capture.lookupRouteCodes===undefined && !value.objects.some(object=>object.categoryAssignmentSource==='lookup-all-categories'),'Lookup-only capture cannot become a planning artifact.') }).strict();

export type LocationMatch = { status: 'matched' | 'missing' | 'ambiguous' | 'stale'; locationId: string | null; candidates: string[] };
export type LocationDto = { id: string; name: string; aliases: string[]; revision: string; matching?: { status: 'missing' | 'ambiguous' | 'unverified'; candidateObjectIds: string[] }; binding: null | {
  modelVersionId: string; revision: string; point: [number, number, number]; objectId: string | null; externalId: string | null;
  source: 'manual' | 'automatic'; status: 'confirmed' | 'stale';
  derivation?:'manual-world-point'|'picked-surface-point'|'equipment-bottom-aabb';coordinateFrame?:'canonical-world-metres';
} };
