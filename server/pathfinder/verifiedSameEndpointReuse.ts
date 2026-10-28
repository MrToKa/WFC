import type { PoolClient } from 'pg';
import type { EngineInvocation } from './engineSession.js';
import { trayCapacityResultSchema, type BarrierDependencySnapshot, type DependencySnapshot, type EngineResponse } from './jobContracts.js';
import { collectBarrierCommonMetadata, collectDependenciesWithVerifiedCommon, hash,
  type BarrierCommonCalculationCollection, type CollectedDependencies } from './dependencies.js';
import { barrierCalculationEngineIdentity, mixedBarrierCalculationEngineIdentity } from './calculationEngineIdentity.js';
import { createSameEndpointCalculationReuse, sameEndpointComputationKey, SAME_ENDPOINT_REUSE_LIMITS } from './sameEndpointCalculationReuse.js';

type Metadata = { common: BarrierCommonCalculationCollection; fingerprint: string };
type Facts = { identity: BarrierDependencySnapshot['engineIdentity']; current: CollectedDependencies;
  recheck: (client: PoolClient, signal?: AbortSignal) => Promise<boolean> };
const capabilities = new WeakMap<object, Facts>();
declare const verifiedCurrentBrand: unique symbol;
export type VerifiedSameEndpointCurrent = { readonly [verifiedCurrentBrand]: true };
/** A parsed body or boolean cannot manufacture this private process capability. */
export const readVerifiedSameEndpointCurrent = (value: unknown): Facts | null => value !== null && typeof value === 'object'
  ? capabilities.get(value) ?? null : null;
type Source = { dependencies: BarrierDependencySnapshot; request: EngineInvocation; response: EngineResponse; metadata: Metadata };
type Entry = { dependencies: BarrierDependencySnapshot; request: EngineInvocation; fingerprint: string };
type Configuration = { request: (dependencies: DependencySnapshot, requestId: string, milliseconds: number) => EngineInvocation;
  readMetadata?: typeof readSameEndpointMetadata; collect?: typeof collectDependenciesWithVerifiedCommon };

/** Capacity diagnostics are a separately assessed server observation, not native
 * route geometry. Validate their policy/outcome before comparing native bodies;
 * immutable proposal/result hashes are never stripped or rewritten here. */
function capacityNativeBody(value: unknown, dependencies: BarrierDependencySnapshot, request: EngineInvocation): Record<string, unknown> | null {
  const policy = dependencies.settings.trayCapacity, balance = dependencies.settings.routingBalance;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !policy && !balance
    || balance && balance.mode !== 'destination-groups-v1') return null;
  const body = value as Record<string, unknown>, route = body.route as { success?: unknown; routeCodes?: unknown } | undefined;
  if (body.status !== 'calculated' || route?.success !== true || !body.design || !Array.isArray(route.routeCodes)
    || !route.routeCodes.every(code => typeof code === 'string')) return null;
  const parsed = trayCapacityResultSchema.safeParse(body.trayCapacity); if (!parsed.success) return null;
  const capacity = parsed.data, restricted = policy !== undefined;
  const codes = Object.hasOwn(request, 'excludedRouteCodes') ? request.excludedRouteCodes : [];
  const validCodes = (input: unknown): input is string[] => Array.isArray(input) && input.length <= 4096
    && input.every(code => typeof code === 'string' && code.length <= 256 && /^\/[A-Z0-9][A-Z0-9_.-]*$/.test(code))
    && new Set(input).size === input.length;
  const weights = Object.hasOwn(request, 'routeCostMultipliers') ? request.routeCostMultipliers : [];
  if (!Array.isArray(weights) || weights.length > 4096 || weights.some(weight => !weight || typeof weight !== 'object'
    || Array.isArray(weight) || Object.keys(weight).sort().join(',') !== 'multiplier,routeCode'
    || !validCodes([weight.routeCode]) || typeof weight.multiplier !== 'number' || !Number.isFinite(weight.multiplier)
    || weight.multiplier < 1 || weight.multiplier > 1000) || new Set(weights.map(weight => weight.routeCode)).size !== weights.length) return null;
  if (!validCodes(codes) || !validCodes(capacity.excludedRouteCodes) || hash(codes) !== hash(capacity.excludedRouteCodes)
    || restricted && capacity.minimumFreeSpacePercent !== policy.minimumFreeSpacePercent
    || capacity.effectiveMinimumFreeSpacePercent !== (capacity.minimumFreeSpacePercent === null ? null
      : Math.max(0, capacity.minimumFreeSpacePercent - 3))
    || capacity.tolerancePercentagePoints !== 3 || capacity.attempts < 1 || capacity.blockedRouteCodes.length
    || restricted && capacity.restrictionEnabled === false || !restricted && capacity.restrictionEnabled !== false
    || balance && capacity.restrictionEnabled !== restricted || !restricted && codes.length) return null;
  if (balance && !capacity.query) return null;
  if (capacity.query && (hash(capacity.query) !== hash({ timeoutMilliseconds: request.timeoutMilliseconds,
    excludedRouteCodes: codes, routeCostMultipliers: weights }) || !validCodes(capacity.query.excludedRouteCodes))) return null;
  const unknown = capacity.unavailableRouteCodes.length > 0 || capacity.policyIssue !== undefined;
  if (capacity.outcome !== (unknown ? 'unavailable' : !restricted ? 'balanced' : codes.length ? 'rerouted' : 'fits')) return null;
  const nativeCodes = new Set((route.routeCodes as string[]).map(code => '/' + code.normalize('NFC').trim().replace(/^\/+/, '').trim().toUpperCase())
    .filter(code => code !== '/SECONDARY'));
  if (codes.some(code => nativeCodes.has(code))) return null;
  const seen = new Set<string>();
  for (const tray of capacity.trays) {
    if (!nativeCodes.has(tray.routeCode) || seen.has(tray.routeCode) || tray.status === 'below-minimum') return null;
    seen.add(tray.routeCode);
    if (tray.status === 'unavailable' ? tray.freeSpacePercent !== null
      : tray.freeSpacePercent === null || restricted && (capacity.effectiveMinimumFreeSpacePercent === null
        || tray.freeSpacePercent + 1e-9 < capacity.effectiveMinimumFreeSpacePercent)) return null;
  }
  if (capacity.policyIssue !== 'CAPACITY_INPUT_LIMIT' && seen.size !== nativeCodes.size) return null;
  if (hash(capacity.unavailableRouteCodes) !== hash(capacity.trays.filter(tray => tray.status === 'unavailable').map(tray => tray.routeCode))) return null;
  const { trayCapacity: _observation, ...native } = body;
  return native;
}

/** All columns below are metadata/immutable publication identities. No model,
 * capture or triangle file is read, qualified or collision-checked here. The
 * caller retains the ordinary project mutex and authority through its commit. */
export async function readSameEndpointMetadata(client: PoolClient, dependencies: BarrierDependencySnapshot,
  signal?: AbortSignal): Promise<Metadata | null> {
  signal?.throwIfAborted();
  const identity = await (dependencies.barriers.schemaVersion === 'wfc.pf.barrier-runtime.v2'
    ? mixedBarrierCalculationEngineIdentity() : barrierCalculationEngineIdentity());
  if (hash(identity) !== hash(dependencies.engineIdentity)) return null;
  const metadata = await collectBarrierCommonMetadata(client, dependencies.projectId, dependencies.options, identity);
  if (!metadata.inputs) return null;
  const { registryRevision: _registry, ...math } = metadata.inputs;
  const { schemaVersion: _version, cableId: _cable, cableWriteRevision: _revision, cableInputs: _inputs,
    from: _from, to: _to, endpointResolution: _resolution, cablePurposeRouting:_purposeRouting, barriers, barrierQualification: _qualification, ...expected } = dependencies;
  if (hash(math) !== hash(expected)) return null;
  const rows = (await client.query<Record<string, unknown>>(`/* same-endpoint:publication-metadata */
    SELECT h.revision::text,h.snapshot_id,s.model_version_id,s.registry_revision::text AS snapshot_revision,
      s.storage_intent_id,s.manifest_blob,s.manifest->>'contentSha256' AS snapshot_sha256,
      i.state AS intent_state,i.capture_sha256,i.request_sha256,i.frozen->>'captureBlobId' AS capture_blob_id,
      i.frozen->>'manifestBlobId' AS manifest_blob_id,i.frozen->>'id' AS frozen_intent_id,
      i.frozen->>'snapshotId' AS frozen_snapshot_id,i.request AS intent_request,i.frozen->'command' AS frozen_command,
      i.actor_id,i.login_id,i.frozen->>'createdBy' AS frozen_actor_id,i.frozen->>'loginId' AS frozen_login_id,
      s.manifest->'capture'->>'captureId' AS manifest_capture_id,
      s.manifest->'capture'->>'payloadSha256' AS manifest_capture_sha256
    FROM pf_barrier_heads h LEFT JOIN pf_barrier_snapshots s ON s.project_id=h.project_id AND s.id=h.snapshot_id
    LEFT JOIN pf_barrier_capture_intents i ON i.project_id=s.project_id AND i.id=s.storage_intent_id
    WHERE h.project_id=$1 FOR SHARE OF h`, [dependencies.projectId])).rows;
  if (rows.length > 1) return null;
  const head = rows[0] ?? { revision: '0', snapshot_id: null };
  if (head.revision !== barriers.binding.registryRevision || head.snapshot_id !== (barriers.binding.snapshot?.snapshotId ?? null)) return null;
  if (barriers.binding.snapshot && (head.model_version_id !== dependencies.model.id
    || head.snapshot_revision !== barriers.binding.registryRevision || head.snapshot_sha256 !== barriers.binding.snapshot.contentSha256
    || head.storage_intent_id !== barriers.storage?.intentId || hash(head.manifest_blob) !== hash(barriers.storage?.manifest))) return null;
  if (barriers.storage?.capture) {
    const command=head.frozen_command as Record<string,unknown>|null;
    if(!command||typeof command!=='object'||Array.isArray(command)||!Object.hasOwn(command,'scope')||head.intent_request==null)return null;
    if(head.intent_state!=='complete'||head.capture_sha256!==barriers.storage.capture.sha256
      ||head.capture_blob_id!==barriers.storage.capture.blobId||head.manifest_blob_id!==barriers.storage.manifest.blobId
      ||head.frozen_intent_id!==barriers.storage.intentId||head.frozen_snapshot_id!==head.snapshot_id
      ||head.manifest_capture_id!==barriers.storage.intentId||head.manifest_capture_sha256!==barriers.storage.capture.sha256
      ||head.actor_id!==head.frozen_actor_id||head.login_id!==head.frozen_login_id
      ||hash(command)!==head.request_sha256||hash(head.intent_request)!==head.request_sha256
      ||hash(command.scope)!==hash(barriers.binding.scope)
      ||typeof command.expectedRegistryRevision!=='string'||!/^(0|[1-9][0-9]*)$/.test(command.expectedRegistryRevision)
      ||BigInt(command.expectedRegistryRevision)+1n!==BigInt(barriers.binding.registryRevision))return null;
  }
  signal?.throwIfAborted();
  const common: BarrierCommonCalculationCollection = { ...metadata, inputs: { ...metadata.inputs, barriers,
    ...(Object.hasOwn(dependencies, 'barrierQualification') ? { barrierQualification: dependencies.barrierQualification } : {}) } };
  return { common, fingerprint: hash({ math, bindingContext: metadata.bindingContext, publication: head }) };
}

/** Shared only between this runtime's owned worker and automatic writer. Every
 * source token follows a successful full source pipeline and confirmed commit.
 * Replicas check current DB metadata and their own endpoint/cable/admission
 * bookkeeping; they do not reread or requalify the shared geometry. */
export function createVerifiedSameEndpointReuse(configuration: Configuration) {
  const cache = createSameEndpointCalculationReuse(), entries = new Map<string, Entry>(), prepared = new WeakMap<object, Source>();
  const metadata = configuration.readMetadata ?? readSameEndpointMetadata;
  const collect = configuration.collect ?? collectDependenciesWithVerifiedCommon;
  const select = (dependencies: DependencySnapshot, request?: EngineInvocation, result?: unknown) => {
    if (dependencies.schemaVersion !== 'pathfinder.dependencies.v8') return null;
    for (const [key, entry] of entries) {
      const reconstructed = request ?? configuration.request(dependencies, entry.request.requestId, entry.request.timeoutMilliseconds);
      const observedScope = dependencies.settings.trayCapacity || dependencies.settings.routingBalance;
      const targetRequest = !request && observedScope ? { ...reconstructed,
        ...(Object.hasOwn(entry.request, 'excludedRouteCodes') ? { excludedRouteCodes: structuredClone(entry.request.excludedRouteCodes) } : {}),
        ...(Object.hasOwn(entry.request, 'routeCostMultipliers') ? { routeCostMultipliers: structuredClone(entry.request.routeCostMultipliers) } : {}) } : reconstructed;
      if (sameEndpointComputationKey(dependencies, targetRequest) !== key) continue;
      const response = cache.get(dependencies, targetRequest); if (!response) { entries.delete(key); continue; }
      if (observedScope) {
        const nativeResponse = capacityNativeBody(response, dependencies, targetRequest);
        if (!nativeResponse) continue;
        if (result !== undefined) {
          const nativeResult = capacityNativeBody(result, dependencies, targetRequest);
          if (!nativeResult || hash({ ...nativeResponse, calculationMode: 'calculate' }) !== hash(nativeResult)) continue;
        }
      } else if (result !== undefined && hash({ ...response, calculationMode: 'calculate' }) !== hash(result)) continue;
      return { key, entry, response };
    }
    return null;
  };
  const stillCurrent = async (client: PoolClient, dependencies: BarrierDependencySnapshot, entry: Entry, signal?: AbortSignal) => {
    const current = await metadata(client, dependencies, signal);
    return current?.fingerprint === entry.fingerprint ? current : null;
  };
  return {
    async prepareSource(client: PoolClient, dependencies: DependencySnapshot, request: EngineInvocation, response: EngineResponse, signal?: AbortSignal): Promise<object | null> {
      if (dependencies.schemaVersion !== 'pathfinder.dependencies.v8' || !sameEndpointComputationKey(dependencies, request)
        || response.status !== 'calculated' || !response.route?.success || !response.design
        || (dependencies.settings.trayCapacity || dependencies.settings.routingBalance) && !capacityNativeBody(response, dependencies, request)) return null;
      const current = await metadata(client, dependencies, signal); if (!current) return null;
      const token = {}; prepared.set(token, { dependencies: structuredClone(dependencies), request: structuredClone(request),
        response: structuredClone(response), metadata: current }); return token;
    },
    commitSource(token: object) {
      const source = prepared.get(token); prepared.delete(token); if (!source) return;
      const { dependencies, request, response, metadata: current } = source;
      if (!cache.put(dependencies, request, response)) return;
      const key = sameEndpointComputationKey(dependencies, request)!;
      entries.delete(key); while (entries.size >= SAME_ENDPOINT_REUSE_LIMITS.entries) entries.delete(entries.keys().next().value!);
      entries.set(key, { dependencies, request, fingerprint: current.fingerprint });
    },
    find(dependencies: DependencySnapshot, request: EngineInvocation) { return select(dependencies, request)?.response ?? null; },
    async current(client: PoolClient, dependencies: DependencySnapshot, request?: EngineInvocation, result?: unknown, signal?: AbortSignal): Promise<VerifiedSameEndpointCurrent | null> {
      const selected = select(dependencies, request, result);
      if (!selected || dependencies.schemaVersion !== 'pathfinder.dependencies.v8') return null;
      const value = await stillCurrent(client, dependencies, selected.entry, signal); if (!value) return null;
      const current = await collect(client, dependencies.projectId, dependencies.cableId, dependencies.options, value.common, true);
      if (!current.dependencies || hash(current.dependencies) !== hash(dependencies)) return null;
      const token = {} as VerifiedSameEndpointCurrent;
      capabilities.set(token, Object.freeze({ identity: structuredClone(dependencies.engineIdentity), current:structuredClone(current),
        recheck: async (next, nextSignal) => Boolean(select(dependencies, request, result)
          && await stillCurrent(next, dependencies, selected.entry, nextSignal)) }));
      return token;
    },
    clear() { cache.clear(); entries.clear(); },
  };
}
export type VerifiedSameEndpointReuse = ReturnType<typeof createVerifiedSameEndpointReuse>;
