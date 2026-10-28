import { describe, it, expect } from 'vitest';
import { modelLocationMatchFixture } from './modelLocationMatchFixtures.js';
import { endpointFixtureId as id } from './endpointBindingFixtures.js';
import { readCableEndpointDisplay } from './cableEndpointDisplay.js';
import { evaluateEndpointMigration } from '../../shared/pathfinderEndpointAttachment.js';
import { evaluateEndpointMigrationV2 } from '../../shared/pathfinderEndpointAttachmentV2.js';
import { createEndpointBindingRepository } from './endpointBindingRepository.js';
import { endpointCalculationPoint } from './endpointCalculationProvenance.js';

describe('standalone current-model From/To matching', () => {
  it('assigns unique observed points once per shared logical name without preparation or job writes', async () => {
    const f = await modelLocationMatchFixture(), result = await f.repo.assign(f.projectId, f.who, f.command());
    expect(result.results.map(r => r.status)).toEqual(['assigned', 'assigned', 'assigned']);
    expect(f.state.heads.size).toBe(3); expect(result.registryRevision).toBe('7');
    const binding = f.state.bindings.get(f.state.heads.get(f.resolved('Equipment'))!)!;
    expect(binding).toMatchObject({ mode: 'fixed-world', derivation: 'matched-model-bottom-aabb.v1', pointProjectMetres: [2, 3, 3], sourceObject: null,
      autoMatchEvidence: { approximate: true, engineeringAccepted: false, current: f.context.current } });
    const ready = await createEndpointBindingRepository(f.pool).context(f.projectId, f.who, binding.locationId);
    expect(ready.readiness).toEqual({ status: 'confirmed', calculationReady: true, reasonCodes: [] });
    expect(endpointCalculationPoint(binding)).toMatchObject({ mode: 'fixed-world', point: [2, 3, 3], bindingId: binding.id,
      sourceObjectRevisionId: null, migrationDecisionId: null });
    expect(f.queries.some(q => /INSERT INTO pf_(?:jobs|location_impacts|recalculation|model_objects|artifacts)/i.test(q))).toBe(false);
    expect(f.queries).toContain("SET LOCAL wfc.pathfinder_location_impact='1'");
    const before = f.state.bindings.size, next = f.command(); next.idempotencyKey = id(701);
    const again = await f.repo.assign(f.projectId, f.who, next);
    expect(again.results.every(r => r.status === 'preserved')).toBe(true); expect(f.state.bindings.size).toBe(before);
  });
  it('preserves manual heads and their aliases even when the SDK supplies another point', async () => {
    const f = await modelLocationMatchFixture(), manual = f.command; // preserve the original fixture manual command shape through its repository
    const command = { schemaVersion: 'wfc.pf.endpoint-binding-write.v1' as const, expectedRegistryRevision: f.state.registry, expectedLocationRevision: null, expectedHeadId: null,
      expectedSelectionRevision: f.context.current.selectionRevision, modelVersionId: f.context.current.modelVersionId, aggregateId: f.context.current.aggregateId,
      projectionSha256: f.context.current.projectionSha256, captureFrameId: f.context.current.captureFrameId, idempotencyKey: id(999), reason: 'Explicit manual point',
      location: { name: 'Equipment', aliases: ['Alias'] }, mode: 'fixed-world' as const, pointProjectMetres: [9, 8, 7] as [number, number, number], derivation: 'manual-world-point' as const, provenanceObject: null };
    const old = await createEndpointBindingRepository(f.pool).confirm(f.projectId, f.who, f.locationId, command);
    const input = manual(); input.idempotencyKey = id(701);
    const result = await f.repo.assign(f.projectId, f.who, input);
    expect(result.results.filter(r => ['Alias', 'EQUIPMENT'].includes(r.name)).every(r => r.status === 'preserved')).toBe(true);
    expect(f.state.heads.get(f.locationId)).toBe(old.binding.id); expect(f.state.bindings.get(old.binding.id)?.pointProjectMetres).toEqual([9, 8, 7]);
  });
  it('counts unavailable candidates for ambiguity and reports missing separately', async () => {
    const f = await modelLocationMatchFixture(), input = f.command();
    const [first, second] = input.scan.candidates; input.scan.candidates = [{ ...first, bounds: null, bottomCentre: null }, { ...second }, { ...second, objectId: 100, bounds: null, bottomCentre: null }];
    const result = await f.repo.assign(f.projectId, f.who, input);
    expect(result.results.map(r => r.status)).toEqual(['unavailable', 'ambiguous', 'missing']); expect(f.state.heads.size).toBe(0);
  });
  it('reports unsupported root zero without rejecting other unique names', async () => {
    const f = await modelLocationMatchFixture(), input = f.command(); input.scan.candidates[0].objectId = 0;
    const result = await f.repo.assign(f.projectId, f.who, input);
    expect(result.results[0]).toMatchObject({ status: 'unavailable', candidateObjectIds: [0], reasonCode: 'MODEL_LOCATION_MATCH_UNSUPPORTED_MODEL_OBJECT' });
    expect(result.results.slice(1).every(r => r.status === 'assigned')).toBe(true);
  });
  it.each(['registry', 'scope', 'names'] as const)('rejects changed %s without a write', async change => {
    const f = await modelLocationMatchFixture(), input = f.command();
    if (change === 'registry') input.expectedRegistryRevision = '0';
    if (change === 'scope') input.current.captureFrameId = id(908);
    if (change === 'names') input.namesSha256 = 'a'.repeat(64);
    await expect(f.repo.assign(f.projectId, f.who, input)).rejects.toMatchObject({ code: 'MODEL_LOCATION_MATCH_CONTEXT_CHANGED' });
    expect(f.state.bindings.size).toBe(0);
  });
  it('replays the exact command after the project context moves and refuses edited reuse', async () => {
    const f = await modelLocationMatchFixture(), input = f.command(), receipt = await f.repo.assign(f.projectId, f.who, input);
    f.state.selectedRevision = '2'; f.state.cables[0].from_location = 'Another name';
    expect(await f.repo.assign(f.projectId, f.who, input)).toEqual({ ...receipt, duplicate: true });
    const altered = structuredClone(input); altered.scan.candidates[0].objectId = 123;
    await expect(f.repo.assign(f.projectId, f.who, altered)).rejects.toMatchObject({ code: 'MODEL_LOCATION_MATCH_IDEMPOTENCY_CONFLICT' });
  });
  it('refreshes only its own stale automatic head after a new model selection', async () => {
    const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
    f.state.selectedRevision = '2'; const context = await f.repo.context(f.projectId, f.who), input = f.command();
    input.current = context.current; input.idempotencyKey = id(702);
    const oldHeads = [...f.state.heads.values()], receipt = await f.repo.assign(f.projectId, f.who, input);
    expect(receipt.results.every(r => r.status === 'assigned')).toBe(true);
    expect([...f.state.heads.values()].every(h => !oldHeads.includes(h))).toBe(true); expect(f.state.bindings.size).toBe(6);
  });
  it('refreshes its own observation when location metadata revision changed without changing the model', async () => {
    const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
    const locationId = f.resolved('EQUIPMENT'), old = f.state.heads.get(locationId)!;
    f.state.locations.get(locationId)!.revision = '99';
    const input = f.command(); input.idempotencyKey = id(703);
    const receipt = await f.repo.assign(f.projectId, f.who, input);
    expect(receipt.results.find(r => r.locationId === locationId)?.status).toBe('assigned');
    expect(f.state.heads.get(locationId)).not.toBe(old);
    expect(f.state.bindings.get(f.state.heads.get(locationId)!)?.locationRevision).toBe('100');
  });
  it('rolls back every point on a later insertion failure', async () => {
    const f = await modelLocationMatchFixture(); f.state.failInsert = true;
    await expect(f.repo.assign(f.projectId, f.who, f.command())).rejects.toBeTruthy();
    expect(f.state.bindings.size).toBe(0); expect(f.state.locations.size).toBe(0); expect(f.state.registry).toBe('4');
  });
  it('recovers Show object identity from its exact receipt, refusing tampered data', async () => {
    const f = await modelLocationMatchFixture(), input = f.command(); await f.repo.assign(f.projectId, f.who, input);
    const locationId = f.resolved('EQUIPMENT'), location = { ...f.state.locations.get(locationId)!, aliases: [] }, head = f.state.bindings.get(f.state.heads.get(locationId)!)!;
    const value = { projectId: f.projectId, current: f.context.current, location, head };
    expect(await readCableEndpointDisplay(f.client as never, value, () => undefined)).toMatchObject({ sdkObjectId: head.autoMatchEvidence!.sdkObjectId, bindingId: head.id, pointProjectMetres: [2, 3, 3] });
    const entry = f.state.commands.get(f.who.userId + ':' + input.idempotencyKey)!; entry.request_sha256 = 'f'.repeat(64);
    expect(await readCableEndpointDisplay(f.client as never, value, () => undefined)).toBeNull();
  });
  it('keeps read authority and expiry checks before any mutation', async () => {
    const f = await modelLocationMatchFixture(); f.state.admin = false;
    await expect(f.repo.assign(f.projectId, f.who, f.command())).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(f.state.bindings.size).toBe(0);
  });
  it('requires fresh matching rather than silently carrying observations through migration', async () => {
    const f = await modelLocationMatchFixture(); await f.repo.assign(f.projectId, f.who, f.command());
    const head = [...f.state.bindings.values()][0], input = { sourceBinding: head, targetAggregate: f.context.current, objectMapping: null, frameMapping: null, sourceObject: null, targetObject: null, validationPolicy: null };
    expect(evaluateEndpointMigration(input)).toMatchObject({ proposal: null, reasonCodes: ['MODEL_LOCATION_MATCH_RECHECK_REQUIRED'] });
    expect(evaluateEndpointMigrationV2({ ...input, comparisonScope: { comparisonId: id(900), comparisonRevision: '1', sourceAggregateId: head.aggregateId,
      targetAggregateId: f.context.current.aggregateId, decisionSetSha256: 'a'.repeat(64), contentSha256: 'b'.repeat(64) }, sourceBindingFrameQualification: null }))
      .toMatchObject({ proposal: null, reasonCodes: ['MODEL_LOCATION_MATCH_RECHECK_REQUIRED'] });
  });
});
