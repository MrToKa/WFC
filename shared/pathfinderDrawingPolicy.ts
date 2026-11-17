import { z } from 'zod';
import { cablePurposeSchema, cablePurposesSchema, normalizeCablePurpose } from './routingCablePurposes.js';
import { PURPOSE_POLICY_LIMITS, policyUuidSchema, policyRevisionSchema, policyHashSchema, purposeKeySchema, type CatalogDiagnostic } from './pathfinderPurposePolicy.js';

export const DRAWING_CATEGORY_ORDER = ['mv', 'power', 'vfd', 'control'] as const;
export const drawingSideModeSchema = z.enum(['use-default', 'left', 'right']);
export const drawingCategoryModesSchema = z.object({ mv: drawingSideModeSchema, power: drawingSideModeSchema, vfd: drawingSideModeSchema, control: drawingSideModeSchema }).strict();
// z.record drops __proto__; purpose names must retain every valid own key.
export const drawingPurposeModesSchema = z.custom<Record<string, unknown>>(value =>
  value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)),
  'Use a cable purpose mode object.')
  .superRefine((value, ctx) => {
    const entries = Object.entries(value);
    if (entries.length > PURPOSE_POLICY_LIMITS.purposes) {
      ctx.addIssue({ code: 'custom', message: 'Too many cable purposes.' });
      return;
    }
    for (const [purpose, mode] of entries) {
      if (!cablePurposeSchema.safeParse(purpose).success) ctx.addIssue({ code: 'custom', path: [purpose], message: 'Use a normalized cable purpose.' });
      if (!drawingSideModeSchema.safeParse(mode).success) ctx.addIssue({ code: 'custom', path: [purpose], message: 'Use a valid drawing side.' });
    }
  })
  .transform(value => Object.fromEntries(Object.entries(value)) as Record<string, z.infer<typeof drawingSideModeSchema>>);
export type DrawingPurposeModes = z.infer<typeof drawingPurposeModesSchema>;
export type DrawingSideMode = z.infer<typeof drawingSideModeSchema>;
export type DrawingCategoryModes = z.infer<typeof drawingCategoryModesSchema>;
export const DEFAULT_DRAWING_MODES: Readonly<DrawingCategoryModes> = Object.freeze({ mv: 'use-default', power: 'use-default', vfd: 'use-default', control: 'use-default' });
export const isDefaultDrawingModes = (modes: DrawingCategoryModes): boolean => DRAWING_CATEGORY_ORDER.every(category => modes[category] === 'use-default');
export const drawingPurposeRuleSchema = z.object({ purposeKey: purposeKeySchema, categoryModes: drawingCategoryModesSchema, purposeModes: drawingPurposeModesSchema.optional() }).strict();
const unique = (rules: { purposeKey: string }[]) => new Set(rules.map(rule => rule.purposeKey)).size === rules.length;
const rules = z.array(drawingPurposeRuleSchema).max(PURPOSE_POLICY_LIMITS.purposes).refine(unique, 'Each purpose must occur once.');
export const drawingPurposePolicySchema = z.object({ schemaVersion: z.literal('pathfinder.drawing-purpose-policy.v1'), projectId: policyUuidSchema, catalogRevision: policyRevisionSchema, drawingPolicyRevision: policyRevisionSchema, rules, cablePurposes: cablePurposesSchema.optional(), cablePurposesSha256: policyHashSchema.optional(), invalidCablePurposeCount: z.number().int().min(0).optional() }).strict();
export const drawingPurposeWriteSchema = z.object({ schemaVersion: z.literal('pathfinder.drawing-purpose-policy.write.v1'), expectedCatalogRevision: policyRevisionSchema, expectedRevision: policyRevisionSchema, expectedCablePurposesSha256: policyHashSchema.optional(), idempotencyKey: policyUuidSchema, changes: z.array(drawingPurposeRuleSchema).min(1).max(PURPOSE_POLICY_LIMITS.purposes).refine(unique, 'Each purpose must occur once.') }).strict();
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

/** Exact purpose choices take precedence over historical drawing-family choices. */
export function resolveDrawingPurposeMode(rule: { categoryModes: DrawingCategoryModes; purposeModes?: DrawingPurposeModes } | undefined, cablePurpose: string): DrawingSideMode {
  const purpose = normalizeCablePurpose(cablePurpose);
  if (rule?.purposeModes && Object.hasOwn(rule.purposeModes, purpose)) return rule.purposeModes[purpose];
  const p = purpose.toLowerCase();
  const family = p.includes('ground') || p.startsWith('mv') || p.includes('medium voltage') ? 'mv'
    : p.includes('vfd') ? 'vfd' : p.startsWith('power') || p.includes(' power') ? 'power' : p.includes('control') ? 'control' : null;
  return family ? rule?.categoryModes[family] ?? 'use-default' : 'use-default';
}
