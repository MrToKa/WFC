import { z } from 'zod';

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
export const snapshotObject = z.object({
  id: identity, parentId: identity.nullable().optional(), externalId: z.string().min(1).max(1024).nullable().optional(),
  dbId: z.number().int().nonnegative().max(2_147_483_647).nullable().optional(), name: text,
  geometryRole: z.enum(['hierarchy', 'object', 'routing-leaf']), leafToRootNames: z.array(text).min(1).max(512),
  properties: z.array(z.object({ category: text, name: text, value: text }).strict()).max(1024),
  nativeHidden: z.boolean().nullable(), planningExcluded: z.boolean(), routeName: text.nullable().optional(), shapeName: text.nullable().optional(), routeBoundaryId: identity.optional(),
  categoryAssignmentSource: z.enum(['unassigned', 'explicit-planning', 'native-reference-selection', 'synthetic']),
  allowedCategories: z.array(z.enum(['MV', 'LV', 'Control'])).max(3), bounds,
  fragments: z.array(fragment).max(100_000),
  faceExtents: z.array(z.object({ face: z.enum(['MinX', 'MaxX', 'MinY', 'MaxY', 'MinZ', 'MaxZ']), bounds, sampleCount: z.number().int().nonnegative() }).strict()).max(6).nullable().optional(),
}).strict().superRefine((value,ctx)=>{
  if (value.routeBoundaryId!==undefined && (value.geometryRole!=='routing-leaf' || value.routeName!==undefined || value.shapeName!==undefined))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'A route boundary belongs only to a routing leaf and cannot compete with explicit route or shape names.'});
});
export const snapshotSchema = z.object({
  schemaVersion: z.literal('pathfinder.model.snapshot.v1'),
  model: z.object({ projectId: identity, modelVersionId: identity, contentSha256: hash, sourceContentSha256: hash.nullable().optional() }).strict(),
  capture: z.object({ adapterVersion: z.string().min(1).max(256), sourceKind: z.enum(['converted', 'native', 'synthetic']),
    inventoryComplete: z.boolean(), geometryComplete: z.boolean(), unitsVerified: z.boolean(), transformsVerified: z.boolean(),
    planningVisibilityKnown: z.boolean(), sourceLinkVerified: z.boolean(), evidenceSha256: z.array(hash).max(256) }).strict(),
  coordinates: z.object({ vertexFrame: z.literal('canonical-world-metres'), sourceUnits: z.string().min(1).max(64),
    metresPerSourceUnit: z.number().finite().positive().max(1e9).nullable(), sourceToWorldMetres: matrix.nullable(),
    globalOffsetMetres: point, displayToWorldMetres: matrix }).strict(),
  objects: z.array(snapshotObject).min(1).max(1_000_000),
}).strict();
export type ComputationalSnapshot = z.infer<typeof snapshotSchema>;
export type SnapshotObject = z.infer<typeof snapshotObject>;
const locationName = z.string().trim().min(1).max(500).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/u);
export const createLocationSchema = z.object({ name: locationName, aliases: z.array(locationName).max(100), expectedRegistryRevision: revision }).strict();
export const bindLocationSchema = z.object({ modelVersionId: uuid, expectedSelectionRevision: revision, expectedRegistryRevision: revision,
  point, objectId: identity.nullable(), externalId: z.string().min(1).max(1024).nullable(),
  derivation:z.enum(['manual-world-point','picked-surface-point','equipment-bottom-aabb']).optional() }).strict();
export const artifactSchema = z.object({ modelVersionId: uuid, expectedSelectionRevision: revision, expectedRegistryRevision: revision, snapshot: snapshotSchema }).strict();

export type LocationMatch = { status: 'matched' | 'missing' | 'ambiguous' | 'stale'; locationId: string | null; candidates: string[] };
export type LocationDto = { id: string; name: string; aliases: string[]; revision: string; matching?: { status: 'missing' | 'ambiguous' | 'unverified'; candidateObjectIds: string[] }; binding: null | {
  modelVersionId: string; revision: string; point: [number, number, number]; objectId: string | null; externalId: string | null;
  source: 'manual' | 'automatic'; status: 'confirmed' | 'stale';
  derivation?:'manual-world-point'|'picked-surface-point'|'equipment-bottom-aabb';coordinateFrame?:'canonical-world-metres';
} };
