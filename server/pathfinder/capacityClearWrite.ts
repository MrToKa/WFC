import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { trayCapacityDiagnosticsSchema, effectiveTrayCapacityMinimum } from '../../shared/pathfinderTrayCapacity.js';
import { engineResponseSchema, type BarrierDependencySnapshot } from './jobContracts.js';
import { readTrayCapacityRouting } from './trayCapacityRouting.js';
import { readLocationImpactJobAuthority } from './locationImpactRepository.js';
import { readRecalculationJobAuthority } from './recalculationRepository.js';
import type { AutomaticPairMandate } from '../../shared/pathfinderAutomaticPair.js';
import { requireCurrentAutomaticPairMandate } from './automaticPairMandates.js';

type Row = Record<string, any>;
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const equal = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
export const capacityClearEvidenceSchema = z.object({ schemaVersion: z.literal('wfc.pf.capacity-clear-evidence.v1'),
  projectId: policyUuidSchema, cableId: policyUuidSchema, dependencySha256: policyHashSchema, engineResultSha256: policyHashSchema,
  verifiedExclusions: trayCapacityDiagnosticsSchema,
}).strict();
export type CapacityClearEvidence = z.infer<typeof capacityClearEvidenceSchema>;

/** Recognition is intentionally narrower than generic no_path or a search limit. */
export function isCapacityNoPathResult(dependencies: BarrierDependencySnapshot, raw: unknown): boolean {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const { calculationMode, ...body } = raw as Row, result = engineResponseSchema.parse(body), policy = dependencies.settings.trayCapacity;
    const c = result.trayCapacity;
    return calculationMode === 'calculate' && dependencies.schemaVersion === 'pathfinder.dependencies.v8'
      && policy?.enabled === true && typeof policy.minimumFreeSpacePercent === 'number'
      && result.schemaVersion === 'pathfinder.model.response.v3' && result.status === 'no_path' && result.route?.success !== true && !result.design
      && c?.outcome === 'no-capacity' && c.restrictionEnabled !== false && c.excludedRouteCodes.length > 0 && !c.policyIssue && c.unavailableRouteCodes.length === 0
      && c.minimumFreeSpacePercent === policy.minimumFreeSpacePercent
      && c.effectiveMinimumFreeSpacePercent === effectiveTrayCapacityMinimum(policy.minimumFreeSpacePercent)
      && c.tolerancePercentagePoints === 3;
  } catch { return false; }
}
export function validCapacityClearEvidence(dependencies: BarrierDependencySnapshot, raw: unknown, evidence: unknown): boolean {
  if (!isCapacityNoPathResult(dependencies, raw)) return false;
  const parsed = capacityClearEvidenceSchema.safeParse(evidence); if (!parsed.success) return false;
  const e = parsed.data, result = raw as Row, c = result.trayCapacity, checked = e.verifiedExclusions;
  return e.projectId === dependencies.projectId && e.cableId === dependencies.cableId && e.dependencySha256 === digest(dependencies)
    && e.engineResultSha256 === digest(raw) && checked.occupancySha256 === c.occupancySha256
    && checked.minimumFreeSpacePercent === c.minimumFreeSpacePercent && checked.effectiveMinimumFreeSpacePercent === c.effectiveMinimumFreeSpacePercent
    && checked.tolerancePercentagePoints === c.tolerancePercentagePoints && checked.groupCableCount === c.groupCableCount
    && checked.restrictionEnabled !== false && !checked.policyIssue && checked.unavailableRouteCodes.length === 0
    && equal([...new Set(checked.blockedRouteCodes)].sort(), [...new Set(c.excludedRouteCodes)].sort())
    && checked.trays.length === checked.blockedRouteCodes.length && checked.trays.every(t => t.status === 'below-minimum'
      && t.freeSpacePercent !== null && (t.freeSpacePercent < (checked.effectiveMinimumFreeSpacePercent ?? 0)
        || t.diagnosticCodes?.some(code => /OVERFLOW/.test(code))));
}
/** Recheck all excluded trays under the caller's project lock before withdrawing
 * an old automatic route. The evidence records occupancy, never geometry success. */
export async function readCurrentCapacityClearEvidence(client: PoolClient, input: { dependencies: BarrierDependencySnapshot;
  result: unknown; jobId: string }, signal?: AbortSignal): Promise<CapacityClearEvidence | null> {
  const { dependencies, result: raw, jobId } = input;
  signal?.throwIfAborted(); if (!isCapacityNoPathResult(dependencies, raw)) return null;
  const result = raw as Row;
  const context = await readTrayCapacityRouting(client, { projectId: dependencies.projectId, jobId, cableId: dependencies.cableId });
  signal?.throwIfAborted(); if (!context) return null;
  const evidence = { schemaVersion: 'wfc.pf.capacity-clear-evidence.v1' as const, projectId: dependencies.projectId, cableId: dependencies.cableId,
    dependencySha256: digest(dependencies), engineResultSha256: digest(raw), verifiedExclusions: context.evaluate(result.trayCapacity.excludedRouteCodes) };
  return validCapacityClearEvidence(dependencies, raw, evidence) ? evidence : null;
}
/** Check only current tray placement under the writer's project lock. Successful
 * geometry and the immutable native result remain the ordinary writer's concern.
 * Unknown placement inputs retain the worker's existing warning behavior. */
export async function readCurrentPositiveCapacity(client: PoolClient, input: { dependencies: BarrierDependencySnapshot;
  result: unknown; jobId: string }, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const { dependencies, jobId } = input, policy = dependencies.settings.trayCapacity;
  if (policy?.enabled !== true) return true;
  let result;
  try {
    if (!input.result || typeof input.result !== 'object' || Array.isArray(input.result)) return false;
    const { calculationMode, ...body } = input.result as Row;
    result = engineResponseSchema.parse(body);
    if (calculationMode !== 'calculate' || dependencies.schemaVersion !== 'pathfinder.dependencies.v8'
      || result.status !== 'calculated' || result.route?.success !== true) return false;
  } catch { return false; }
  const context = await readTrayCapacityRouting(client, { projectId: dependencies.projectId, jobId, cableId: dependencies.cableId });
  signal?.throwIfAborted();
  if (!context || context.policy.enabled !== true || context.minimumFreeSpacePercent !== policy.minimumFreeSpacePercent
    || context.effectiveMinimumFreeSpacePercent !== effectiveTrayCapacityMinimum(policy.minimumFreeSpacePercent)
    || context.tolerancePercentagePoints !== policy.tolerancePercentagePoints) return false;
  const checked = context.evaluate(result.route.routeCodes);
  return checked.restrictionEnabled !== false && checked.blockedRouteCodes.length === 0
    && checked.trays.every(tray => tray.status !== 'below-minimum');
}
export function automaticPairCapacityClearTransition(projectId: string, cableId: string, before: Row, after: Row): boolean {
  try {
    const allowed = new Set(['routing', 'design_length', 'updated_at', 'cable_write_revision']);
    return before?.id === cableId && after?.id === cableId && before.project_id === projectId && after.project_id === projectId
      && policyRevisionSchema.safeParse(before.cable_write_revision).success && policyRevisionSchema.safeParse(after.cable_write_revision).success
      && BigInt(after.cable_write_revision) === BigInt(before.cable_write_revision) + 1n && after.routing === null && after.design_length === null
      && Object.hasOwn(before, 'install_length') && Object.hasOwn(after, 'install_length')
      && equal(Object.keys(before).sort(), Object.keys(after).sort()) && Object.keys(before).every(k => allowed.has(k) || equal(before[k], after[k]));
  } catch { return false; }
}
export async function capacityClearItemApplicable(client: PoolClient, input: { projectId: string; jobId: string; cableId: string;
  jobState: string; cancelRequested: boolean }, automaticMandate?: AutomaticPairMandate): Promise<boolean> {
  if (input.cancelRequested || !['queued', 'running', 'complete'].includes(input.jobState)) return false;
  if (automaticMandate) {
    if (automaticMandate.projectId !== input.projectId || automaticMandate.jobId !== input.jobId || automaticMandate.cableId !== input.cableId) return false;
    await requireCurrentAutomaticPairMandate(client, automaticMandate);
    return true;
  }
  const scoped = await readLocationImpactJobAuthority(client, { ...input, lock: true });
  if (scoped) return scoped.enrolled && scoped.valid;
  const authority = await readRecalculationJobAuthority(client, { ...input, lock: true });
  return input.jobState === 'complete' && (!authority.enrolled || authority.valid);
}
