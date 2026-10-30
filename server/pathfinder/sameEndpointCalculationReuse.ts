import { createHash } from 'node:crypto';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import type { EngineInvocation } from './engineSession.js';
import { engineResponseSchema, type BarrierDependencySnapshot, type DependencySnapshot, type EngineResponse } from './jobContracts.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { requireBarrierEngineStrategy } from './barrierStrategy.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import { routingEngineCategory } from '../../shared/pathfinderCableEligibility.js';
import { isPermittedCablePurposeRoute } from '../../shared/routingCablePurposes.js';

type Limits = { entries: number; totalBytes: number; entryBytes: number; milliseconds: number };
/** Small, ephemeral computation reuse only. No result, authority or login is persisted. */
export const SAME_ENDPOINT_REUSE_LIMITS: Readonly<Limits> = Object.freeze({
  entries: 16, totalBytes: 32 * 1024 ** 2, entryBytes: 8 * 1024 ** 2, milliseconds: 5 * 60_000,
});
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');

/** Exact ordered logical endpoints AND complete native inputs. Cable identity,
 * business revision and type are not native mathematical inputs; their separate
 * admission/currentness/seal checks still run for every recipient in the worker. */
export function sameEndpointComputationKey(dependencies: DependencySnapshot, request: EngineInvocation): string | null {
  if (dependencies.schemaVersion !== 'pathfinder.dependencies.v8' || request.schemaVersion !== 'pathfinder.model.runner.v2'
    || request.operation !== 'calculate' || request.projectId !== dependencies.projectId
    || request.modelVersionId !== dependencies.model.id || request.snapshotId !== dependencies.artifact.id
    || request.snapshotSha256 !== dependencies.artifact.sha256 || !request.includeLengthLedger) return null;
  try {
    requireVersionedCalculationScope(dependencies);
    const { requestId: _correlation, ...nativeInput } = request;
    return digest({ schemaVersion: 'wfc.pf.same-endpoint-computation.v1', engineIdentity: dependencies.engineIdentity,
      ...(dependencies.settings.trayCapacity?{trayCapacity:dependencies.settings.trayCapacity}:{}),
      ...(dependencies.settings.routingBalance?{routingBalance:dependencies.settings.routingBalance}:{}),
      endpointResolution: dependencies.endpointResolution, from: dependencies.from, to: dependencies.to,
      ...(Object.hasOwn(dependencies, 'barrierQualification') ? { barrierQualification: dependencies.barrierQualification } : {}), nativeInput });
  } catch { return null; }
}

function validatedResponse(dependencies: BarrierDependencySnapshot, raw: unknown): EngineResponse | null {
  try {
    const response = engineResponseSchema.parse(raw);
    if (response.schemaVersion !== 'pathfinder.model.response.v3' || response.status !== 'calculated'
      || !response.route?.success || !response.design || !response.lengthLedger) return null;
    if (dependencies.cablePurposeRouting && (response.route.routeText !== response.route.routeCodes.join('')
      || !isPermittedCablePurposeRoute(response.route.routeCodes,dependencies.cablePurposeRouting.allowedRouteCodes))) return null;
    requireBarrierEngineStrategy(response, { context: dependencies.barriers,
      ...(Object.hasOwn(dependencies, 'barrierQualification') ? { qualification: dependencies.barrierQualification } : {}),
      category: dependencies.cablePurposeRouting ? routingEngineCategory(dependencies.cableInputs.mto) : dependencies.cableInputs.mto,
      fromPoint: dependencies.from.point, toPoint: dependencies.to.point });
    requireCalculationLengthLedger(response, dependencies.settings);
    return response;
  } catch { return null; }
}

/** One instance belongs to one advisory-owned worker/engine lifetime and spans
 * its one-item scheduling slices. Only a confirmed successful source transaction
 * may seed it. A hit is a cloned native computation, never a borrowed proposal,
 * baseline, currentness decision, seal, review or cable-write authorization.
 * Preserve the donor requestId: it identifies the actual native invocation and
 * must not pretend that a recipient triggered another native computation. */
export function createSameEndpointCalculationReuse(options: { now?: () => number; limits?: Partial<Limits> } = {}) {
  const now = options.now ?? (() => performance.now()), limits = { ...SAME_ENDPOINT_REUSE_LIMITS, ...options.limits };
  if (Object.entries(limits).some(([name, value]) => !Number.isSafeInteger(value) || value < 1
    || value > SAME_ENDPOINT_REUSE_LIMITS[name as keyof Limits]) || limits.entryBytes > limits.totalBytes)
    throw new Error('Invalid bounded computation reuse limits.');
  const entries = new Map<string, { json: string; bytes: number; expires: number }>();
  let bytes = 0;
  const remove = (key: string) => { const entry = entries.get(key); if (entry) { bytes -= entry.bytes; entries.delete(key); } };
  const prune = () => { const at = now(); for (const [key, entry] of entries) if (entry.expires <= at) remove(key); };
  return {
    get(dependencies: DependencySnapshot, request: EngineInvocation): EngineResponse | null {
      prune(); const key = sameEndpointComputationKey(dependencies, request), entry = key ? entries.get(key) : undefined;
      if (!key || !entry || dependencies.schemaVersion !== 'pathfinder.dependencies.v8') return null;
      // The source was checked before a confirmed commit. Exact key equality
      // reuses that computation; do not repeat its collision/ledger verification.
      const response = JSON.parse(entry.json) as EngineResponse;
      // LRU ordering does not renew the finite source lifetime.
      entries.delete(key); entries.set(key, entry); return response;
    },
    put(dependencies: DependencySnapshot, request: EngineInvocation, raw: EngineResponse): boolean {
      prune(); const key = sameEndpointComputationKey(dependencies, request);
      if (!key || dependencies.schemaVersion !== 'pathfinder.dependencies.v8' || raw.requestId !== request.requestId) return false;
      const response = validatedResponse(dependencies, raw); if (!response) return false;
      const json = JSON.stringify(response), size = Buffer.byteLength(json);
      if (size > limits.entryBytes || size > limits.totalBytes) return false;
      remove(key);
      while (entries.size >= limits.entries || bytes + size > limits.totalBytes) remove(entries.keys().next().value!);
      entries.set(key, { json, bytes: size, expires: now() + limits.milliseconds }); bytes += size; return true;
    },
    clear() { entries.clear(); bytes = 0; },
  };
}
export type SameEndpointCalculationReuse = ReturnType<typeof createSameEndpointCalculationReuse>;
