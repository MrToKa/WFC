// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { buildCableEngineRequest } from './worker.js';
import { createSameEndpointCalculationReuse, sameEndpointComputationKey, SAME_ENDPOINT_REUSE_LIMITS } from './sameEndpointCalculationReuse.js';
import type { DependencySnapshot, EngineResponse } from './jobContracts.js';

function fixture() {
  const { dependencies, result, id } = syntheticBarrierWriteInputs();
  const { calculationMode: _mode, ...response } = result;
  const request = buildCableEngineRequest(dependencies, response.requestId, 60000);
  return { dependencies, response, request, id };
}

describe('bounded exact same ordered logical endpoint computation reuse', () => {
  it('does not reuse an LV computation across independently permitted Power and VFD tray networks', () => {
    const f = fixture(), cache = createSameEndpointCalculationReuse();
    const power = { ...f.dependencies, cablePurposeRouting: { purpose:'Power', allowedRouteCodes:['/A'] } };
    const vfd = { ...f.dependencies, cablePurposeRouting: { purpose:'VFD', allowedRouteCodes:['/B'] } };
    const powerRequest = buildCableEngineRequest(power, f.response.requestId, 60000);
    expect(powerRequest.allowedPurposeRouteCodes).toEqual(['/A']);
    expect(cache.put(power, powerRequest, f.response)).toBe(true);
    const vfdRequest = buildCableEngineRequest(vfd, f.id(93), 60000);
    expect(vfdRequest.allowedPurposeRouteCodes).toEqual(['/B']);
    expect(cache.get(vfd, vfdRequest)).toBeNull();
    const excluded = buildCableEngineRequest({ ...vfd, cablePurposeRouting:{ purpose:'VFD', allowedRouteCodes:[] } }, f.id(94), 60000);
    expect(excluded.allowedPurposeRouteCodes).toEqual([]);
    expect(cache.get(vfd, excluded)).toBeNull();
  });
  it('reuses a cloned native body across different cable IDs, types and write revisions without rebinding its actual invocation', () => {
    const f = fixture(), cache = createSameEndpointCalculationReuse();
    expect(sameEndpointComputationKey(f.dependencies, f.request)).not.toBeNull();
    expect(cache.put(f.dependencies, f.request, f.response)).toBe(true);
    const target = { ...structuredClone(f.dependencies), cableId: f.id(91), cableWriteRevision: '900',
      cableInputs: { ...f.dependencies.cableInputs, cableTypeId: f.id(92) } };
    const request = buildCableEngineRequest(target, f.id(93), 60000), copy = cache.get(target, request);
    expect(copy).toEqual(f.response); expect(copy).not.toBe(f.response);
    expect(copy?.requestId).toBe(f.response.requestId); expect(copy?.requestId).not.toBe(request.requestId);
    copy!.route!.pathPoints[0].x = 999; copy!.design!.designLengthMeters = '999';
    expect(cache.get(target, request)).toEqual(f.response);
  });

  it.each(['from point', 'to point', 'ordered names', 'category', 'settings', 'settings revision', 'numeric options', 'native option',
    'model', 'snapshot', 'engine identity', 'endpoint provenance', 'barrier scope', 'barrier qualification', 'timeout'] as const)(
    'does not reuse after a changed %s', kind => {
      const f = fixture(), cache = createSameEndpointCalculationReuse(); expect(cache.put(f.dependencies, f.request, f.response)).toBe(true);
      const target = structuredClone(f.dependencies);
      if (kind === 'from point') target.from.point[0] += 0.001;
      if (kind === 'to point') target.to.point[2] += 0.001;
      if (kind === 'ordered names') { target.cableInputs.fromLocation = 'OTHER'; target.endpointResolution.from.logicalKey = 'OTHER'; }
      if (kind === 'category') target.cableInputs.mto = 'Control';
      if (kind === 'settings') target.settings.additionalBendingPercent = '11';
      if (kind === 'settings revision') target.settings.revision = '3';
      if (kind === 'numeric options') target.options.secondaryDistanceMeters = 99;
      if (kind === 'model') target.model.selectionRevision = '2';
      if (kind === 'snapshot') target.artifact.sha256 = '7'.repeat(64);
      if (kind === 'engine identity') target.engineIdentity.contentSha256 = '7'.repeat(64);
      if (kind === 'endpoint provenance' && 'bindingRevision' in target.from) target.from.bindingRevision = '9';
      if (kind === 'barrier scope') target.barriers.binding.registryRevision = '9';
      if (kind === 'barrier qualification') (target as unknown as Record<string, unknown>).barrierQualification = null;
      const request = buildCableEngineRequest(target, f.id(93), kind === 'timeout' ? 30000 : 60000);
      if (kind === 'native option') request.futureMathematicalOption = 'different';
      expect(cache.get(target, request)).toBeNull();
    });

  it('does not group different logical endpoints merely because their points coincide', () => {
    const f = fixture(), cache = createSameEndpointCalculationReuse(); cache.put(f.dependencies, f.request, f.response);
    const target = structuredClone(f.dependencies); target.endpointResolution.to.logicalKey = 'ANOTHER'; target.cableInputs.toLocation = 'ANOTHER';
    expect(cache.get(target, buildCableEngineRequest(target, f.id(93), 60000))).toBeNull();
  });
  it.each(['failed', 'unknown', 'missing ledger', 'wrong correlation', 'wrong route', 'wrong design', 'wrong barrier proof'] as const)(
    'never caches a %s response', kind => {
      const f = fixture(), cache = createSameEndpointCalculationReuse(), result = structuredClone(f.response);
      if (kind === 'failed') result.status = 'no_path';
      if (kind === 'unknown') (result as unknown as Record<string, unknown>).status = 'unknown';
      if (kind === 'missing ledger') delete result.lengthLedger;
      if (kind === 'wrong correlation') result.requestId = f.id(98);
      if (kind === 'wrong route') result.route!.pathPoints[0].x = 7;
      if (kind === 'wrong design') result.design!.designLengthMeters = '999';
      if (kind === 'wrong barrier proof' && result.schemaVersion === 'pathfinder.model.response.v3') result.barriers.proof = null;
      expect(cache.put(f.dependencies, f.request, result)).toBe(false); expect(cache.get(f.dependencies, f.request)).toBeNull();
    });
  it('retains existing legacy design-only behavior outside protected V8', () => {
    const f = fixture(), legacy = { ...f.dependencies, schemaVersion: 'pathfinder.dependencies.v7' } as unknown as DependencySnapshot;
    const cache = createSameEndpointCalculationReuse(); expect(cache.put(legacy, f.request, f.response)).toBe(false);
    expect(cache.get(legacy, f.request)).toBeNull();
  });
  it('expires successful work without letting cache hits renew its five-minute life', () => {
    const f = fixture(); let clock = 0; const cache = createSameEndpointCalculationReuse({ now: () => clock });
    cache.put(f.dependencies, f.request, f.response); clock = SAME_ENDPOINT_REUSE_LIMITS.milliseconds - 1;
    expect(cache.get(f.dependencies, f.request)).toEqual(f.response); clock++;
    expect(cache.get(f.dependencies, f.request)).toBeNull();
  });
  it('evicts least-recently-used work at its count limit', () => {
    const f = fixture(), cache = createSameEndpointCalculationReuse({ limits: { entries: 2 } });
    const requests = [0, 1, 2].map(at => ({ ...f.request, timeoutMilliseconds: 60000 - at }));
    expect(cache.put(f.dependencies, requests[0], f.response)).toBe(true);
    expect(cache.put(f.dependencies, requests[1], f.response)).toBe(true);
    expect(cache.get(f.dependencies, requests[0])).not.toBeNull();
    expect(cache.put(f.dependencies, requests[2], f.response)).toBe(true);
    expect(cache.get(f.dependencies, requests[1])).toBeNull(); expect(cache.get(f.dependencies, requests[0])).not.toBeNull();
    expect(cache.get(f.dependencies, requests[2])).not.toBeNull();
  });
  it('bounds retained JSON bytes and skips oversized successful bodies without failing the calculation', () => {
    const f = fixture(), size = Buffer.byteLength(JSON.stringify(f.response));
    const bounded = createSameEndpointCalculationReuse({ limits: { entryBytes: size, totalBytes: size } });
    expect(bounded.put(f.dependencies, f.request, f.response)).toBe(true);
    const second = { ...f.request, timeoutMilliseconds: 30000 }; expect(bounded.put(f.dependencies, second, f.response)).toBe(true);
    expect(bounded.get(f.dependencies, f.request)).toBeNull(); expect(bounded.get(f.dependencies, second)).not.toBeNull();
    const tooLarge: EngineResponse = { ...f.response, message: 'large '.repeat(5000) };
    expect(bounded.put(f.dependencies, f.request, tooLarge)).toBe(false); expect(bounded.get(f.dependencies, second)).not.toBeNull();
  });
  it('clears all work when the advisory-owned lifetime ends', () => {
    const f = fixture(), cache = createSameEndpointCalculationReuse(); cache.put(f.dependencies, f.request, f.response);
    cache.clear(); expect(cache.get(f.dependencies, f.request)).toBeNull();
  });
});
