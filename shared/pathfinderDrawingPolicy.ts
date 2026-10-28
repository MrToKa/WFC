import { z } from 'zod';
import { PURPOSE_POLICY_LIMITS, policyUuidSchema, policyRevisionSchema, policyHashSchema, purposeKeySchema, type CatalogDiagnostic } from './pathfinderPurposePolicy.js';

export const DRAWING_CATEGORY_ORDER = ['mv', 'power', 'vfd', 'control'] as const;
export const drawingSideModeSchema = z.enum(['use-default', 'left', 'right']);
export const drawingCategoryModesSchema = z.object({ mv: drawingSideModeSchema, power: drawingSideModeSchema, vfd: drawingSideModeSchema, control: drawingSideModeSchema }).strict();
export type DrawingCategoryModes = z.infer<typeof drawingCategoryModesSchema>;
export const DEFAULT_DRAWING_MODES: Readonly<DrawingCategoryModes> = Object.freeze({ mv: 'use-default', power: 'use-default', vfd: 'use-default', control: 'use-default' });
export const isDefaultDrawingModes = (modes: DrawingCategoryModes): boolean => DRAWING_CATEGORY_ORDER.every(category => modes[category] === 'use-default');
export const drawingPurposeRuleSchema = z.object({ purposeKey: purposeKeySchema, categoryModes: drawingCategoryModesSchema }).strict();
const unique = (rules: { purposeKey: string }[]) => new Set(rules.map(rule => rule.purposeKey)).size === rules.length;
const rules = z.array(drawingPurposeRuleSchema).max(PURPOSE_POLICY_LIMITS.purposes).refine(unique, 'Each purpose must occur once.');
export const drawingPurposePolicySchema = z.object({ schemaVersion: z.literal('pathfinder.drawing-purpose-policy.v1'), projectId: policyUuidSchema, catalogRevision: policyRevisionSchema, drawingPolicyRevision: policyRevisionSchema, rules }).strict();
export const drawingPurposeWriteSchema = z.object({ schemaVersion: z.literal('pathfinder.drawing-purpose-policy.write.v1'), expectedCatalogRevision: policyRevisionSchema, expectedRevision: policyRevisionSchema, idempotencyKey: policyUuidSchema, changes: z.array(drawingPurposeRuleSchema).min(1).max(PURPOSE_POLICY_LIMITS.purposes).refine(unique, 'Each purpose must occur once.') }).strict();
export const drawingPolicySaveSchema = z.object({ schemaVersion: z.literal('pathfinder.policy-save.v1'), projectId: policyUuidSchema, domain: z.literal('drawing'), catalogRevision: policyRevisionSchema, previousRevision: policyRevisionSchema, revision: policyRevisionSchema, auditId: policyUuidSchema, duplicate: z.boolean() }).strict();
const occurredAt = z.string().datetime({ offset: false }).refine(value => value.endsWith('Z') && !/[\u0000-\u0020]/u.test(value));
export const drawingPolicyAuditSchema = z.object({ auditId: policyUuidSchema, projectId: policyUuidSchema, domain: z.literal('drawing'), actorId: policyUuidSchema, loginId: policyUuidSchema, occurredAt, catalogRevision: policyRevisionSchema, previousRevision: policyRevisionSchema, revision: policyRevisionSchema, idempotencyKey: policyUuidSchema, requestSha256: policyHashSchema, beforeRules: rules, afterRules: rules }).strict();
export const drawingPolicyHistorySchema = z.object({ schemaVersion: z.literal('pathfinder.policy-history.v1'), projectId: policyUuidSchema, domain: z.literal('drawing'), events: z.array(drawingPolicyAuditSchema).max(PURPOSE_POLICY_LIMITS.historyRows), nextBeforeRevision: policyRevisionSchema.nullable() }).strict();
export type DrawingPurposeRule = z.infer<typeof drawingPurposeRuleSchema>;
export type DrawingPurposePolicy = z.infer<typeof drawingPurposePolicySchema>;
export type DrawingPurposeWrite = z.infer<typeof drawingPurposeWriteSchema>;
export type DrawingPolicySaveReceipt = z.infer<typeof drawingPolicySaveSchema>;
export type DrawingPolicyHistory = z.infer<typeof drawingPolicyHistorySchema>;

const purposeDiagnostics = new Set(['MISSING_TRAY_PURPOSE', 'INVALID_TRAY_PURPOSE', 'PURPOSE_NORMALIZATION_COLLISION']);
/** Side authoring needs a valid purpose, independently from route-name or drawing-input diagnostics. */
export const drawingPurposeDiagnostics = (diagnostics: CatalogDiagnostic[]): CatalogDiagnostic[] => diagnostics.filter(diagnostic => purposeDiagnostics.has(diagnostic.code));

export const drawingErrorSchema = z.object({ schemaVersion: z.literal('pathfinder.drawing-error.v1'), code: z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/), message: z.string().max(2048), currentRevisions: z.object({ catalogRevision: policyRevisionSchema, drawingPolicyRevision: policyRevisionSchema, drawingInputRevision: policyRevisionSchema }).strict().nullable() }).strict();
