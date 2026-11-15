import type { RoutingExecutionReason } from './cableRoutingControl.js';
export type CableRoutingImportConflict = { cableId: number; tag: string | null; reasons: RoutingExecutionReason[] };
export type CableRoutingImportSummary = { inserted: number; updated: number; unchanged?: number; skipped: number;
  blockedRouting?: CableRoutingImportConflict[]; routesProtected?: number; routesCleared?: number; executionLocksAdded?: number };
export type CableRoutingImportOptions = { protectRouting?: boolean; preview?: boolean; expectedRevisionDigest?: string };
export const ROUTING_EXECUTION_LABELS: Record<RoutingExecutionReason, string> = {
  INSTALL_LENGTH_RECORDED: 'Install length is recorded', PULL_DATE_RECORDED: 'Pull date is recorded',
  CONNECTED_FROM_RECORDED: 'Connected From is recorded', CONNECTED_TO_RECORDED: 'Connected To is recorded',
  TESTED_DATE_RECORDED: 'Cable tested date is recorded', EXECUTION_LOCK_RETAINED: 'Execution protection remains active',
};
export function describeRoutingImportConflict(conflict: CableRoutingImportConflict): string {
  return `${conflict.tag || `Cable ${conflict.cableId}`}: ${conflict.reasons.map(reason => ROUTING_EXECUTION_LABELS[reason]).join('; ')}`;
}
