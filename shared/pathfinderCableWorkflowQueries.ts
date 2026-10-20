import { z } from 'zod';
import { CABLE_WORKFLOW_LIMITS, cableWorkflowRowSchema } from './pathfinderCableWorkflow.js';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import { recalculationReasonSchema } from './pathfinderRecalculation.js';

export const CABLE_WORKFLOW_READ_LIMITS = Object.freeze({ responseBytes: 8 * 1024 ** 2, searchCharacters: 256, deadlineMilliseconds: 15_000 });
const cursor = z.string().min(1).max(CABLE_WORKFLOW_LIMITS.cursorCharacters).regex(/^[A-Za-z0-9_-]+$(?![\s\S])/);
const search = z.string().max(CABLE_WORKFLOW_READ_LIMITS.searchCharacters).refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff))
  .transform(value => value.normalize('NFC').trim());
const preferences = {
  secondaryDistanceMeters: z.number().finite().min(0).max(1_000_000).default(2),
  preferVerticalApproach: z.boolean().default(true),
};
export const cableWorkflowFilterSchema = z.enum(['needs-routing', 'calculating', 'ready-for-review', 'up-to-date', 'all']);
export const cableWorkflowQuerySchema = z.object({ filter: cableWorkflowFilterSchema.default('needs-routing'), search: search.default(''),
  limit: z.number().int().min(1).max(CABLE_WORKFLOW_LIMITS.pageSize).default(100), ...preferences, cursor: cursor.optional() }).strict();
export const cableWorkflowDetailQuerySchema = z.object(preferences).strict();
export type CableWorkflowQuery = z.infer<typeof cableWorkflowQuerySchema>;
export type CableWorkflowDetailQuery = z.infer<typeof cableWorkflowDetailQuerySchema>;
const httpPreferences = {
  secondaryDistanceMeters: z.string().max(32).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$(?![\s\S])/).transform(Number).optional(),
  preferVerticalApproach: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
};
export function parseCableWorkflowHttpQuery(value: unknown): CableWorkflowQuery {
  const parsed = z.object({ filter: cableWorkflowFilterSchema.optional(), search: search.optional(),
    limit: z.string().regex(/^(?:[1-9]|[1-9][0-9]|100)$(?![\s\S])/).transform(Number).optional(), ...httpPreferences, cursor: cursor.optional() }).strict().parse(value);
  return cableWorkflowQuerySchema.parse(parsed);
}
export function parseCableWorkflowDetailHttpQuery(value: unknown): CableWorkflowDetailQuery {
  return cableWorkflowDetailQuerySchema.parse(z.object(httpPreferences).strict().parse(value));
}
/** Cursor is transport state; every filter/search/preference/page-size input is bound independently. */
export function cableWorkflowQueryHashInput(value: CableWorkflowQuery) {
  const { cursor: _cursor, ...query } = cableWorkflowQuerySchema.parse(value);
  return { schemaVersion: 'wfc.pf.cable-workflow-query.v1', ...query };
}
export function cableWorkflowDetailQueryHashInput(value: CableWorkflowDetailQuery) {
  return { schemaVersion: 'wfc.pf.cable-workflow-detail-query.v1', ...cableWorkflowDetailQuerySchema.parse(value) };
}
/** Literal NFC/case-insensitive matching; wildcard characters have no special meaning. */
export function cableWorkflowRowMatchesSearch(row: { cable: Pick<z.infer<typeof cableWorkflowRowSchema>['cable'], 'tag' | 'fromLocation' | 'toLocation'> }, value: string): boolean {
  const needle = search.parse(value).toUpperCase();
  return needle === '' || [row.cable.tag, row.cable.fromLocation, row.cable.toLocation]
    .some(text => text !== null && text.normalize('NFC').toUpperCase().includes(needle));
}
export const cableWorkflowDetailSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-workflow-detail.v1'),
  projectId: policyUuidSchema, cableId: policyUuidSchema, querySha256: policyHashSchema, contextSha256: policyHashSchema, row: cableWorkflowRowSchema }).strict()
  .refine(value => value.row.projectId === value.projectId && value.row.cable.id === value.cableId);
export const cableWorkflowErrorSchema = z.object({ code: recalculationReasonSchema, error: z.string().max(2048) }).strict();
export type CableWorkflowDetail = z.infer<typeof cableWorkflowDetailSchema>;
