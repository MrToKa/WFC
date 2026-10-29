import { z } from 'zod';
import { policyHashSchema, policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import { lengthLedgerSchema } from './pathfinderLengthLedger.js';
import { sealedCableItemApplicabilitySchema } from './pathfinderItemApplicability.js';

export const REVISION_RESULTS_LIMITS = Object.freeze({ pageSize: 100, responseBytes: 32 * 1024 ** 2, pageBytes: 8 * 1024 ** 2,
  detailBytes: 32 * 1024 ** 2, baselineBytes: 65536, envelopeBytes: 131072, admissionBytes: 64 * 1024 ** 2, cables: 10000, chunk: 200 });
/** Geometry deltas use recorded binary64 lengths; design/unrounded deltas use exact fixed-point text subtraction. Neither proves a physical move. */
export const REVISION_DELTA_NUMERIC_CONTRACT = 'recorded-binary64-geometry-and-exact-fixed-decimal-v1' as const;
const timestamp = z.string().datetime({ offset: false }).refine(v => v.endsWith('Z'));
const text = z.string().max(8000);
const nullableText = text.nullable();
export const revisionStoredDecimalSchema = z.string().max(100).regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$(?![\s\S])/);
const nullableDecimal = revisionStoredDecimalSchema.nullable();
export const revisionModelRefSchema = z.object({ id: policyUuidSchema, selectionRevision: policyRevisionSchema, contentFingerprint: policyHashSchema }).strict();
export const revisionCableSnapshotSchema = z.object({ id: policyUuidSchema, tag: z.string().max(4096).nullable(), fromLocation: z.string().max(4096).nullable(),
  toLocation: z.string().max(4096).nullable(), routing: nullableText, designLength: nullableDecimal, installLength: nullableDecimal, cableWriteRevision: policyRevisionSchema }).strict();
export const revisionAcceptedApplySchema = z.object({ receiptId: policyUuidSchema, proposalId: policyUuidSchema, proposalHash: policyHashSchema,
  dependencyHash: policyHashSchema, engineResultSha256: policyHashSchema.nullable(), revisionResultSha256: policyHashSchema.nullable(), modelRef: revisionModelRefSchema.nullable(),
  routeText: nullableText, rawLengthMeters: z.number().finite().nonnegative().nullable(), designLengthMeters: nullableDecimal, unroundedMeters: nullableDecimal,
  ledgerHash: policyHashSchema.nullable(), appliedAt: timestamp, afterCableWriteRevision: policyRevisionSchema.nullable(), afterRouting: nullableText, afterDesignLength: nullableDecimal }).strict();
export const revisionBaselineSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-revision-baseline.v1'), currentCable: revisionCableSnapshotSchema,
  lastAcceptedApply: revisionAcceptedApplySchema.nullable(), acceptedMatchesCurrent: z.boolean() }).strict()
  .refine(v => !v.acceptedMatchesCurrent || v.lastAcceptedApply !== null);
export const revisionAdmissionSchema = z.object({ id: policyUuidSchema, projectId: policyUuidSchema, jobId: policyUuidSchema.nullable(),
  generation: policyRevisionSchema.nullable(), kind: z.enum(['manual', 'automatic', 'location-impact']), inputSha256: policyHashSchema,
  total: z.number().int().min(1).max(REVISION_RESULTS_LIMITS.cables), modelRef: revisionModelRefSchema.nullable(), createdAt: timestamp }).strict()
  .refine(v => v.kind === 'automatic' ? v.generation !== null : v.generation === null && v.jobId !== null);
export const revisionCurrentnessSchema = z.object({ state: z.enum(['current', 'changed', 'missing', 'unavailable']),
  reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/)).max(64) }).strict();
export const revisionDeltaSchema = z.object({ rawLengthMeters: z.number().finite().nullable(), designLengthMeters: nullableDecimal,
  unroundedMeters: nullableDecimal, baseline: z.enum(['accepted-current', 'current-values', 'unavailable']) }).strict();
export const revisionResultSummarySchema = z.object({ calculationMode: z.enum(['calculate', 'design']), newModel: revisionModelRefSchema.nullable(),
  routeText: nullableText, rawLengthMeters: z.number().finite().nonnegative().nullable(), designLengthMeters: nullableDecimal, unroundedMeters: nullableDecimal,
  delta: revisionDeltaSchema, reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/)).max(64) }).strict();
export const revisionResultEnvelopeSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-revision-result.v1'), id: policyUuidSchema,
  projectId: policyUuidSchema, admissionId: policyUuidSchema, jobId: policyUuidSchema, cableId: policyUuidSchema, proposalId: policyUuidSchema,
  proposalHash: policyHashSchema, baselineHash: policyHashSchema, dependencyHash: policyHashSchema, engineResultSha256: policyHashSchema,
  ledgerHash: policyHashSchema.nullable(), oldModel: revisionModelRefSchema.nullable(), summary: revisionResultSummarySchema,
  comparisonRef: z.object({ comparisonId: policyUuidSchema, comparisonRevision: policyRevisionSchema, decisionSetSha256: policyHashSchema }).strict().nullable(),
  observedEvents: z.array(z.object({ generation: policyRevisionSchema, domain: z.string().max(32), reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/),
    sourceRevisionSha256: policyHashSchema.nullable() }).strict()).max(64), lengthLedger: lengthLedgerSchema.nullable(),
  physicalChangeProven: z.literal(false), createdAt: timestamp, revisionResultSha256: policyHashSchema }).strict();
export const revisionResultRowSchema = z.object({ cableId: policyUuidSchema, baseline: revisionBaselineSchema, baselineHash: policyHashSchema,
  status: z.string().min(1).max(96), message: z.string().max(32768), result: revisionResultSummarySchema.extend({ proposalId: policyUuidSchema,
    proposalHash: policyHashSchema, revisionResultSha256: policyHashSchema, engineResultSha256: policyHashSchema, ledgerHash: policyHashSchema.nullable(), dependencyHash: policyHashSchema }).strict().nullable(),
  currentness: revisionCurrentnessSchema,itemApplicability:sealedCableItemApplicabilitySchema.nullable().optional() }).strict()
  .refine(v => v.cableId === v.baseline.currentCable.id && (!v.itemApplicability || v.itemApplicability.cableId===v.cableId
    && v.itemApplicability.proposalId===v.result?.proposalId && v.itemApplicability.dependencyHash===v.result?.dependencyHash));
const cursor = z.string().max(512).regex(/^[A-Za-z0-9_-]+$(?![\s\S])/);
export const revisionAdmissionsPageSchema = z.object({ schemaVersion: z.literal('wfc.pf.revision-admissions-page.v1'), projectId: policyUuidSchema,
  admissions: z.array(revisionAdmissionSchema).max(REVISION_RESULTS_LIMITS.pageSize), nextCursor: cursor.nullable() }).strict()
  .refine(v => v.admissions.every(a => a.projectId === v.projectId) && new Set(v.admissions.map(a => a.id)).size === v.admissions.length);
export const revisionResultsPageSchema = z.object({ schemaVersion: z.literal('wfc.pf.revision-results-page.v1'), projectId: policyUuidSchema,
  admissionId: policyUuidSchema, rows: z.array(revisionResultRowSchema).max(REVISION_RESULTS_LIMITS.pageSize), nextAfterCableId: policyUuidSchema.nullable() }).strict()
  .refine(v => new Set(v.rows.map(r => r.cableId)).size === v.rows.length && v.rows.every((r, i) => i === 0 || v.rows[i - 1].cableId < r.cableId));
export const revisionResultDetailSchema = z.object({ schemaVersion: z.literal('wfc.pf.revision-result-detail.v1'), projectId: policyUuidSchema,
  admissionId: policyUuidSchema, row: revisionResultRowSchema, envelope: revisionResultEnvelopeSchema.nullable(), engineResult: z.unknown().nullable(), dependencies: z.unknown().nullable() }).strict()
  .refine(v => v.envelope === null ? v.row.result === null : v.envelope.projectId === v.projectId && v.envelope.admissionId === v.admissionId
    && v.envelope.cableId === v.row.cableId && v.envelope.baselineHash === v.row.baselineHash && v.envelope.revisionResultSha256 === v.row.result?.revisionResultSha256
    && v.envelope.proposalId === v.row.result?.proposalId && v.envelope.proposalHash === v.row.result?.proposalHash
    && v.envelope.engineResultSha256 === v.row.result?.engineResultSha256 && v.envelope.dependencyHash === v.row.result?.dependencyHash
    && v.envelope.ledgerHash === v.row.result?.ledgerHash);
export type RevisionBaseline = z.infer<typeof revisionBaselineSchema>;
export type RevisionAdmission = z.infer<typeof revisionAdmissionSchema>;
export type RevisionModelRef = z.infer<typeof revisionModelRefSchema>;
export type RevisionResultEnvelope = z.infer<typeof revisionResultEnvelopeSchema>;
export type RevisionResultRow = z.infer<typeof revisionResultRowSchema>;
export type RevisionCurrentness = z.infer<typeof revisionCurrentnessSchema>;
export type RevisionAdmissionsPage = z.infer<typeof revisionAdmissionsPageSchema>;
export type RevisionResultsPage = z.infer<typeof revisionResultsPageSchema>;
export type RevisionResultDetail = z.infer<typeof revisionResultDetailSchema>;
