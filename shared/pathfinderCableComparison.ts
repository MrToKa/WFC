import { z } from 'zod';
import { policyHashSchema, policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import { revisionCableSnapshotSchema } from './pathfinderRevisionResults.js';
import { canonicalDecimalString, decimalDifference } from './pathfinderLengthLedger.js';
import { classifyCableInitialFill } from './pathfinderCableWorkflow.js';

export const CABLE_COMPARISON_LIMITS = Object.freeze({ routeCharacters: 8000, decimalCharacters: 100, sequenceCells: 1_000_000 });
const route = z.string().max(CABLE_COMPARISON_LIMITS.routeCharacters).nullable();
const storedLength = z.string().max(CABLE_COMPARISON_LIMITS.decimalCharacters).nullable();
// A legacy stored empty string is a defined value. Never turn it into SQL NULL.
export const comparisonCableSnapshotSchema = revisionCableSnapshotSchema.extend({ designLength: storedLength });
export const cableComparisonInputSchema = z.object({
  projectId: policyUuidSchema, cableId: policyUuidSchema,
  current: z.object({ source: z.literal('live-cable-read'), contextSha256: policyHashSchema,
    mto: z.string().max(96).nullable(), cable: comparisonCableSnapshotSchema }).strict(),
  proposal: z.object({ projectId: policyUuidSchema, cableId: policyUuidSchema, proposalId: policyUuidSchema,
    proposalHash: policyHashSchema, revisionResultHash: policyHashSchema.nullable(), cableWriteRevision: policyRevisionSchema,
    routing: route, designLength: storedLength }).strict(),
  admissionBaseline: z.object({ admissionId: policyUuidSchema, baselineHash: policyHashSchema, cable: comparisonCableSnapshotSchema }).strict().nullable().optional(),
}).strict().refine(value => value.current.cable.id === value.cableId && value.proposal.cableId === value.cableId
  && value.proposal.projectId === value.projectId && (!value.admissionBaseline || value.admissionBaseline.cable.id === value.cableId));
export type CableComparisonInput = z.infer<typeof cableComparisonInputSchema>;
export type RouteOccurrence = { text: string; index: number };
export type ReorderedRouteOccurrence = { text: string; beforeIndex: number; afterIndex: number };
export type OrderedRouteComparison = {
  state: 'unchanged' | 'format-only' | 'changed' | 'missing' | 'not-compared';
  reason: 'SEQUENCE_WORK_LIMIT' | 'ROUTE_LIMIT' | null;
  before: string | null; after: string | null; beforeOccurrences: RouteOccurrence[]; afterOccurrences: RouteOccurrence[];
  added: RouteOccurrence[]; removed: RouteOccurrence[]; reordered: ReorderedRouteOccurrence[];
};
/** Display alignment only: preserve raw text, order, duplicates and SECONDARY. No model identity is inferred. */
export function compareOrderedRoutes(before: string | null, after: string | null): OrderedRouteComparison {
  const empty = { before, after, beforeOccurrences: [], afterOccurrences: [], added: [], removed: [], reordered: [] };
  if ((before?.length ?? 0) > CABLE_COMPARISON_LIMITS.routeCharacters || (after?.length ?? 0) > CABLE_COMPARISON_LIMITS.routeCharacters)
    return { ...empty, state: 'not-compared', reason: 'ROUTE_LIMIT' };
  const occurrences = (value: string | null) => (value ?? '').split('/').map(text => text.trim()).filter(Boolean).map((text, index) => ({ text, index }));
  const left = occurrences(before), right = occurrences(after), base = { ...empty, beforeOccurrences: left, afterOccurrences: right };
  if (before === null || after === null) return { ...base, state: 'missing', reason: null };
  if (left.length === right.length && left.every((item, index) => item.text === right[index].text))
    return { ...base, state: before === after ? 'unchanged' : 'format-only', reason: null };
  const width = right.length + 1;
  if ((left.length + 1) * width > CABLE_COMPARISON_LIMITS.sequenceCells) return { ...base, state: 'not-compared', reason: 'SEQUENCE_WORK_LIMIT' };
  const lengths = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--)
    lengths[i * width + j] = left[i].text === right[j].text ? 1 + lengths[(i + 1) * width + j + 1]
      : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
  const removed: RouteOccurrence[] = [], added: RouteOccurrence[] = []; let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i].text === right[j].text) { i++; j++; }
    else if (i < left.length && (j === right.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) removed.push(left[i++]);
    else added.push(right[j++]);
  }
  // Pair unmatched equal occurrences in stable order. These are display moves,
  // not evidence that a physical object moved between model revisions.
  const waiting = new Map<string, RouteOccurrence[]>();
  for (const item of added) { const values = waiting.get(item.text) ?? []; values.push(item); waiting.set(item.text, values); }
  const reordered: ReorderedRouteOccurrence[] = [], removedOnly: RouteOccurrence[] = [], movedAfter = new Set<number>();
  for (const item of removed) {
    const paired = waiting.get(item.text)?.shift();
    if (paired) { reordered.push({ text: item.text, beforeIndex: item.index, afterIndex: paired.index }); movedAfter.add(paired.index); }
    else removedOnly.push(item);
  }
  return { ...base, state: 'changed', reason: null, added: added.filter(item => !movedAfter.has(item.index)), removed: removedOnly, reordered };
}
function validDecimal(value: string | null) { if (value === null) return false; try { canonicalDecimalString(value); return true; } catch { return false; } }
export type CableValueComparison = {
  state: 'current' | 'stale' | 'unavailable'; reasonCodes: string[]; input: CableComparisonInput | null;
  initialFill: ReturnType<typeof classifyCableInitialFill> | null;
  routing: OrderedRouteComparison | null;
  length: { state: 'unchanged' | 'changed' | 'missing' | 'invalid'; deltaMeters: string | null } | null;
};
/** Read-only comparison. Eligibility and unchanged values never authorize a write. */
export function compareCableValues(value: unknown): CableValueComparison {
  const parsed = cableComparisonInputSchema.safeParse(value);
  if (!parsed.success) return { state: 'unavailable', reasonCodes: ['COMPARISON_INPUT_UNAVAILABLE'], input: null, initialFill: null, routing: null, length: null };
  const input = parsed.data, before = input.current.cable.designLength, after = input.proposal.designLength;
  const valid = validDecimal(before) && validDecimal(after), delta = valid ? decimalDifference(after!, before!) : null;
  const stale = input.current.cable.cableWriteRevision !== input.proposal.cableWriteRevision;
  return { state: stale ? 'stale' : 'current', reasonCodes: stale ? ['CABLE_WRITE_REVISION_CHANGED'] : [], input,
    initialFill: classifyCableInitialFill({ mto: input.current.mto, routing: input.current.cable.routing, designLength: before }),
    routing: compareOrderedRoutes(input.current.cable.routing, input.proposal.routing),
    length: { state: before === null || after === null ? 'missing' : !valid ? 'invalid' : delta === '0' ? 'unchanged' : 'changed', deltaMeters: delta } };
}
