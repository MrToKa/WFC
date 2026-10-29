import { z } from 'zod';
import { policyUuidSchema as uuid, policyRevisionSchema as revision, policyHashSchema as hash, purposeKeySchema } from './pathfinderPurposePolicy.js';
import { drawingCategoryModesSchema } from './pathfinderDrawingPolicy.js';
import { trayLengthCalculationSchema, trayLengthSourceSchema } from './trayAutoLength.js';

const number = z.number().finite();
const text = z.string().max(20000);
const categorySetting = z.object({
  maxRows: number.int().min(1).max(1000).nullable(), maxColumns: number.int().min(1).max(1000).nullable(),
  bundleSpacing: z.enum(['0', '1D', '2D']).nullable(), trefoil: z.boolean().nullable(),
  trefoilSpacingBetweenBundles: z.boolean().nullable(), applyPhaseRotation: z.boolean().nullable(),
}).strict();
const range = z.object({ id: z.string().min(1).max(200), min: number.min(0).max(10000), max: number.positive().max(10000), maxRows: number.int().min(1).max(1000).nullable().optional() }).strict().refine(r => r.max > r.min);
const ranges = z.array(range).max(64).superRefine((values, ctx) => {
  const sorted = [...values].sort((a, b) => a.min - b.min);
  if (new Set(values.map(v => v.id)).size !== values.length || sorted.some((v, i) => i > 0 && sorted[i - 1].max >= v.min)) ctx.addIssue({ code: 'custom', message: 'Ranges must be distinct and must not overlap or touch.' });
});
const categoryMap = <T extends z.ZodTypeAny>(value: T) => z.object({ mv: value.optional(), power: value.optional(), vfd: value.optional(), control: value.optional() }).strict();
export const trayBundleOverrideSchema = z.object({ useCustom: z.boolean(), categories: categoryMap(categorySetting), customBundleRanges: categoryMap(ranges).optional() }).strict();
export const drawingSettingsWriteSchema = z.object({ schemaVersion: z.literal('pathfinder.tray-drawing-settings.write.v1'), expectedDrawingInputRevision: revision, expectedRevision: revision, idempotencyKey: uuid, value: trayBundleOverrideSchema.nullable() }).strict();
export const trayDrawingDiagnosticSchema = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/), cableIds: z.array(uuid).max(100000), message: z.string().max(2048) }).strict();
export const trayDrawingSnapshotSchema = z.object({
  schemaVersion: z.literal('pathfinder.tray-drawing-snapshot.v1'), projectId: uuid, projectTrayId: uuid, snapshotId: uuid,
  catalogRevision: revision, drawingPolicyRevision: revision, drawingInputRevision: revision,
  layoutAlgorithmVersion: z.literal('wfc-tray-placement-v2'), contentSha256: hash, purposeKey: purposeKeySchema.nullable(),
  categoryModes: drawingCategoryModesSchema, legacySidePolicyVersion: z.literal('wfc-tray-sides-v1'), settingsSha256: hash, inputSha256: hash,
  orderedCableIds: z.array(uuid).max(100000), state: z.enum(['ready', 'diagnostic', 'blocked']), diagnostics: z.array(trayDrawingDiagnosticSchema).max(1000),
}).strict();
const publicCategoryLayout = z.object({ cableSpacing: number.nonnegative().nullable(), considerBundleSpacingAsFree: z.boolean().nullable(), minFreeSpacePercent: number.nullable(), maxFreeSpacePercent: number.nullable(), autoRerouteForFreeSpace: z.boolean().optional(), mv: categorySetting.nullable(), power: categorySetting.nullable(), vfd: categorySetting.nullable(), control: categorySetting.nullable(), customBundleRanges: categoryMap(ranges).nullable() }).strict();
const dated = { createdAt: text, updatedAt: text };
export const drawingProjectSchema = z.object({ id: uuid, projectNumber: text, name: text, customer: text, manager: text.nullable(), description: text.nullable(), connectionGap: number.nonnegative(), secondaryTrayLength: number.nullable(), supportDistance: number.nullable(), supportWeight: number.nullable(), additionalBendingPercent: number, endConnectionLength: number, trayLoadSafetyFactor: number.nullable(), supportDistanceOverrides: z.record(z.object({ distance: number.nullable(), supportId: uuid.nullable(), supportType: text.nullable() }).strict()), trayPurposeTemplates: z.record(z.object({ fileId: uuid, fileName: text.nullable(), contentType: text.nullable() }).strict()), cableLayout: publicCategoryLayout, ...dated }).passthrough();
export const drawingTraySchema = z.object({ id: uuid, projectId: uuid, name: text, type: text.nullable(), purpose: text.nullable(), widthMm: number.nullable(), heightMm: number.nullable(), lengthMm: number.nullable(), lengthSource: trayLengthSourceSchema.optional(), lengthCalculation: trayLengthCalculationSchema.nullable().optional(), includeGroundingCable: z.boolean(), groundingCableTypeId: uuid.nullable(), useTrefoilClamps: z.boolean().optional(), trefoilClampSpacingMm: number.optional(), ...dated }).passthrough();
export const drawingCableSchema = z.object({ id: uuid, projectId: uuid, cableId: number.int(), cableTypeId: uuid, typeName: text, purpose: text.nullable(), diameterMm: number.nullable(), weightKgPerM: number.nullable(), fromLocation: text.nullable(), toLocation: text.nullable(), routing: text.nullable(), ...dated }).passthrough();
export const trayDrawingDataSchema = z.object({ project: drawingProjectSchema, tray: drawingTraySchema, reportTrays: z.array(drawingTraySchema).max(100000), cables: z.array(drawingCableSchema).max(100000), trayCables: z.array(drawingCableSchema).max(100000), materialTrays: z.array(z.object({ id: uuid, type: text, rungHeightMm: number.nullable() }).passthrough()).max(1),
  cableTypes: z.array(z.object({ id: uuid, projectId: uuid, name: text, purpose: text.nullable(), diameterMm: number.nullable(), weightKgPerM: number.nullable() }).passthrough()).max(100000),
  materialSupports: z.array(z.object({ id: uuid, type: text, weightKg: number.nullable(), lengthMm: number.nullable() }).passthrough()).max(10000),
  loadCurves: z.array(z.object({ id: uuid, name: text, points: z.array(z.object({ id: uuid, order: number.int(), spanM: number, loadKnPerM: number }).passthrough()).max(100000) }).passthrough()).max(1),
}).strict();
export const trayDrawingOverrideSchema = z.object({ revision, value: trayBundleOverrideSchema.nullable() }).strict();
export const trayDrawingResponseSchema = z.object({ schemaVersion: z.literal('pathfinder.tray-drawing-response.v1'), snapshot: trayDrawingSnapshotSchema, data: trayDrawingDataSchema, override: trayDrawingOverrideSchema, sourceSha256: hash, permissions: z.object({ canEdit: z.boolean() }).strict(), layout: z.unknown() }).strict().superRefine((v, ctx) => {
  if (v.snapshot.projectId !== v.data.project.id || v.snapshot.projectId !== v.data.tray.projectId || v.snapshot.projectTrayId !== v.data.tray.id || v.data.reportTrays.some(t => t.projectId !== v.snapshot.projectId) || new Set(v.data.reportTrays.map(t => t.id)).size !== v.data.reportTrays.length || !v.data.reportTrays.some(t => t.id === v.data.tray.id) || v.data.cables.some(c => c.projectId !== v.snapshot.projectId) || v.data.trayCables.some(c => c.projectId !== v.snapshot.projectId) || JSON.stringify(v.snapshot.orderedCableIds) !== JSON.stringify(v.data.trayCables.map(c => c.id))) ctx.addIssue({ code: 'custom', message: 'Drawing input scope does not match its snapshot.' });
});
export const DRAWING_EXPORT_BODY_BYTES = 90 * 1024 * 1024;
export const drawingExportWriteSchema = z.object({ schemaVersion: z.literal('pathfinder.tray-drawing-export.write.v1'), snapshotId: uuid, expectedContentSha256: hash, idempotencyKey: uuid, files: z.array(z.object({ kind: z.enum(['bundles', 'load-curve', 'report']), fileName: z.string().min(1).max(230).refine(v => !/[\u0000-\u001f\u007f/\\]/.test(v)), contentType: z.enum(['image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']), base64: z.string().max(36 * 1024 * 1024).refine(v => v.length > 0 && v.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(v) && !/=/.test(v.slice(0, -2)) && !v.endsWith('===')) }).strict()).length(3).refine(files => new Set(files.map(f => f.kind)).size === 3 && new Set(files.map(f => f.fileName.toLowerCase())).size === 3) }).strict();
export type TrayDrawingSnapshot = z.infer<typeof trayDrawingSnapshotSchema>;
export type TrayDrawingResponse = z.infer<typeof trayDrawingResponseSchema>;
export type TrayBundleOverride = z.infer<typeof trayBundleOverrideSchema>;
export type DrawingSettingsWrite = z.infer<typeof drawingSettingsWriteSchema>;
export type DrawingExportWrite = z.infer<typeof drawingExportWriteSchema>;
/** Shared explicit hash projections; source facts remain private, their digest is public. */
export const drawingInputHashInput = (data: TrayDrawingResponse['data'], sourceSha256: string) => ({ data, sourceSha256 });
export const drawingSettingsHashInput = (override: TrayDrawingResponse['override'], categoryModes: TrayDrawingSnapshot['categoryModes']) => ({ override, categoryModes });
export function drawingContentHashInput(snapshot: Omit<TrayDrawingSnapshot, 'snapshotId' | 'contentSha256'> | TrayDrawingSnapshot, layout: unknown) {
  const { snapshotId: _id, contentSha256: _hash, ...input } = snapshot as TrayDrawingSnapshot;
  return { ...input, layout };
}
export const drawingExportReceiptSchema = z.object({ schemaVersion: z.literal('pathfinder.tray-drawing-export.v1'), projectId: uuid, projectTrayId: uuid, snapshotId: uuid, contentSha256: hash, exportId: uuid, duplicate: z.boolean(), files: z.array(z.object({ kind: z.enum(['bundles', 'load-curve', 'report']), id: uuid, fileName: text, contentType: text, sizeBytes: number.nonnegative().int(), sha256: hash }).strict()).length(3) }).strict();
export const projectDrawingMetricsSchema = z.object({
  project: drawingProjectSchema, trays: z.array(drawingTraySchema).max(2000), freeSpaceByTrayId: z.record(uuid, number.min(0).max(100).nullable()),
  provenance: z.array(z.object({ trayId: uuid, layoutSha256: hash, inputSha256: hash, state: z.enum(['ready', 'blocked']) }).strict()).max(2000),
  revisions: z.object({ catalogRevision: revision, drawingPolicyRevision: revision, drawingInputRevision: revision }).strict(), layoutAlgorithmVersion: z.literal('wfc-tray-placement-v2'),
}).strict().superRefine((value, ctx) => {
  const ids = value.trays.map(v => v.id);
  if (new Set(ids).size !== ids.length || value.trays.some(t => t.projectId !== value.project.id) || JSON.stringify(Object.keys(value.freeSpaceByTrayId).sort()) !== JSON.stringify([...ids].sort()) || JSON.stringify(value.provenance.map(p => p.trayId).sort()) !== JSON.stringify([...ids].sort())) ctx.addIssue({ code: 'custom', message: 'Drawing metric scope is incomplete or inconsistent.' });
});
