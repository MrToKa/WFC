import { z } from 'zod';

const routing = z.string().max(16384).refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value));
export const cableRoutingControlSchema = z.object({
  schemaVersion: z.literal('wfc.cable-routing-control.v1'),
  // Persisted legacy text stays readable and correctable; mutations validate below.
  manualRouting: z.string().nullable(), manualProtected: z.boolean(),
  executionLocked: z.boolean(), executionRouting: z.string().nullable(),
}).strict();
export type CableRoutingControl = z.infer<typeof cableRoutingControlSchema>;
export type CableExecutionFacts = { installLength: number | null; pullDate: string | null;
  connectedFrom: string | null; connectedTo: string | null; tested: string | null };
export const ROUTING_EXECUTION_REASONS = ['INSTALL_LENGTH_RECORDED', 'PULL_DATE_RECORDED', 'CONNECTED_FROM_RECORDED', 'CONNECTED_TO_RECORDED', 'TESTED_DATE_RECORDED', 'EXECUTION_LOCK_RETAINED'] as const;
export type RoutingExecutionReason = typeof ROUTING_EXECUTION_REASONS[number];
export const emptyRoutingControl = (): CableRoutingControl => ({ schemaVersion: 'wfc.cable-routing-control.v1',
  manualRouting: null, manualProtected: false, executionLocked: false, executionRouting: null });
export const normalizeRouting = (value: string | null): string | null => {
  if (value === null) return null;
  const parsed = routing.parse(value.normalize('NFC').trim());
  return parsed || null;
};
export function executionRoutingReasons(facts: CableExecutionFacts, latched = false): RoutingExecutionReason[] {
  const reasons: RoutingExecutionReason[] = [];
  if (facts.installLength !== null && Number.isFinite(facts.installLength) && facts.installLength > 0) reasons.push('INSTALL_LENGTH_RECORDED');
  for (const [key, reason] of [['pullDate', 'PULL_DATE_RECORDED'], ['connectedFrom', 'CONNECTED_FROM_RECORDED'],
    ['connectedTo', 'CONNECTED_TO_RECORDED'], ['tested', 'TESTED_DATE_RECORDED']] as const)
    if (facts[key]?.trim()) reasons.push(reason);
  if (!reasons.length && latched) reasons.push('EXECUTION_LOCK_RETAINED');
  return reasons;
}
export function effectiveCableRouting(control: CableRoutingControl, automaticRouting: string | null): string | null {
  if (control.executionLocked) return control.executionRouting;
  return control.manualProtected ? control.manualRouting : automaticRouting?.normalize('NFC').trim() || null;
}
export function automaticRoutingWriteAllowed(control: CableRoutingControl, facts: CableExecutionFacts): boolean {
  return !control.manualProtected && executionRoutingReasons(facts, control.executionLocked).length === 0;
}
/** Presence, empty value and import protection are separate user intentions. */
export type CableRoutingMutation = { kind: 'manual'; routing: string | null; manualProtected?: boolean }
  | { kind: 'import'; present: boolean; routing: string | null; protect: boolean };
export function applyCableRoutingMutation(input: { control: CableRoutingControl; facts: CableExecutionFacts;
  automaticRouting: string | null; mutation: CableRoutingMutation }) {
  const previous = cableRoutingControlSchema.parse(input.control), mutation = input.mutation;
  const reasons = executionRoutingReasons(input.facts, previous.executionLocked);
  const value = normalizeRouting(mutation.routing);
  const noop = mutation.kind === 'import' && (!mutation.present || value === null && !mutation.protect);
  if (noop) return { control: previous, changed: false, blockedReasons: [] as RoutingExecutionReason[] };
  const next = { ...previous };
  if (mutation.kind === 'manual') {
    next.manualRouting = value;
    next.manualProtected = value !== null && (mutation.manualProtected ?? true);
  } else if (value === null) {
    next.manualRouting = null; next.manualProtected = false;
  } else {
    next.manualRouting = value;
    next.manualProtected = mutation.protect || previous.manualProtected;
  }
  const changed = next.manualRouting !== previous.manualRouting || next.manualProtected !== previous.manualProtected;
  if (changed && reasons.length) return { control: previous, changed: false, blockedReasons: reasons };
  return { control: next, changed, blockedReasons: [] as RoutingExecutionReason[] };
}
/** Latch AFTER accepting a first execution report and its permitted route edit. */
export function latchExecutionRouting(control: CableRoutingControl, facts: CableExecutionFacts, effectiveRouting: string | null): CableRoutingControl {
  if (control.executionLocked || !executionRoutingReasons(facts).length) return control;
  return { ...control, executionLocked: true, executionRouting: effectiveRouting };
}
export function releaseExecutionRouting(control: CableRoutingControl, facts: CableExecutionFacts, reason: string): CableRoutingControl {
  if (!reason.trim()) throw new Error('ROUTING_UNLOCK_REASON_REQUIRED');
  if (executionRoutingReasons(facts).length) throw new Error('ROUTING_EXECUTION_FACTS_PRESENT');
  return { ...control, executionLocked: false, executionRouting: null };
}
/** Preserve occurrence order and repetitions; cosmetic separator spacing alone is irrelevant. */
export function routingSegments(value: string | null): string[] {
  const text = normalizeRouting(value);
  if (!text) return [];
  return text.split('/').map(part => part.trim()).filter(Boolean);
}
export const routingTextsMatch = (left: string | null, right: string | null) => {
  const displaySegments = (value: string | null) => (value?.normalize('NFC') ?? '').split('/').map(part => part.trim()).filter(Boolean);
  return JSON.stringify(displaySegments(left)) === JSON.stringify(displaySegments(right));
};
export type CableRoutingTone = 'automatic' | 'manual' | 'execution' | 'warning';
export const CABLE_ROUTING_PALETTE: Record<CableRoutingTone, { light: string; dark: string; textLight: string; textDark: string; label: string }> = {
  automatic: { light: '#EAF3FC', dark: '#203246', textLight: '#173753', textDark: '#D6E8F9', label: 'Automatic route' },
  manual: { light: '#EDF7ED', dark: '#243B2A', textLight: '#23432B', textDark: '#DEF0DE', label: 'Protected manual route' },
  execution: { light: '#F2F3F5', dark: '#34363A', textLight: '#393D44', textDark: '#E8E9EC', label: 'Protected execution route' },
  warning: { light: '#FFF2DB', dark: '#493820', textLight: '#64430C', textDark: '#FFE7BC', label: 'Route needs attention' },
};
export function cableRoutingTone(control: CableRoutingControl, automaticRouting: string | null, warning = false, usedRouting?: string | null): CableRoutingTone {
  const effective = usedRouting !== undefined ? usedRouting : effectiveCableRouting(control, automaticRouting);
  if (warning || effective !== null && automaticRouting !== null && !routingTextsMatch(effective, automaticRouting)) return 'warning';
  return control.executionLocked ? 'execution' : control.manualProtected ? 'manual' : 'automatic';
}
