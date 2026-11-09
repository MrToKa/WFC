import { describe, it, expect } from 'vitest';
import { modelLocationMatchFixture } from './modelLocationMatchFixtures.js';
import { endpointFixtureId as id } from './endpointBindingFixtures.js';
import { readCableEndpointDisplay } from './cableEndpointDisplay.js';
import { evaluateEndpointMigration } from '../../shared/pathfinderEndpointAttachment.js';
import { evaluateEndpointMigrationV2 } from '../../shared/pathfinderEndpointAttachmentV2.js';
import { createEndpointBindingRepository } from './endpointBindingRepository.js';
import { endpointCalculationPoint } from './endpointCalculationProvenance.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import { cableEndpointContextSchema } from '../../shared/pathfinderCableEndpoints.js';

const sourceIdentity = { guid: '7586ffbb-1d0a-5942-b687-06884123c866', sourceFile: '01-50_msr_kabeltassen.dwg' };

async function groupedFixture() {
  const f = await modelLocationMatchFixture(), input = f.command(), first = input.scan.candidates[0];
  first.objectIdentity = sourceIdentity;
  input.scan.candidates.push({ ...first, objectId: 100, bounds: { minimum: [2, 4, 1], maximum: [6, 8, 7] }, bottomCentre: [4, 6, 1] },
    { ...first, objectId: 50, bounds: { minimum: [0, 1, 2], maximum: [4, 6, 4] }, bottomCentre: [2, 3.5, 2] });
  return { ...f, input, name: input.names[0] };
}

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
  it('preserves a manual binding even when its newly discovered source group has more than 512 parts', async () => {
    const f = await groupedFixture(), manual = createEndpointBindingRepository(f.pool);
    const result = await manual.confirm(f.projectId, f.who, f.locationId, {
      schemaVersion: 'wfc.pf.endpoint-binding-write.v1', expectedRegistryRevision: f.state.registry, expectedLocationRevision: null, expectedHeadId: null,
      expectedSelectionRevision: f.context.current.selectionRevision, modelVersionId: f.context.current.modelVersionId, aggregateId: f.context.current.aggregateId,
      projectionSha256: f.context.current.projectionSha256, captureFrameId: f.context.current.captureFrameId, idempotencyKey: id(999), reason: 'Manual shared point',
      location: { name: 'Equipment', aliases: ['Alias'] }, mode: 'fixed-world', pointProjectMetres: [9, 8, 7], derivation: 'manual-world-point', provenanceObject: null,
    });
    const first = f.input.scan.candidates[0];
    f.input.expectedRegistryRevision = f.state.registry;
    f.input.scan.candidates = Array.from({ length: 513 }, (_, i) => ({ ...first, objectId: i + 1 }));
    const receipt = await f.repo.assign(f.projectId, f.who, f.input);
    expect(receipt.results[0].status).toBe('preserved');
    expect(f.state.heads.get(f.locationId)).toBe(result.binding.id);
    expect(f.state.bindings.get(result.binding.id)?.pointProjectMetres).toEqual([9, 8, 7]);
  });
  it('counts unavailable candidates for ambiguity and reports missing separately', async () => {
    const f = await modelLocationMatchFixture(), input = f.command();
    const [first, second] = input.scan.candidates; input.scan.candidates = [{ ...first, bounds: null, bottomCentre: null }, { ...second }, { ...second, objectId: 100, bounds: null, bottomCentre: null }];
    const result = await f.repo.assign(f.projectId, f.who, input);
    expect(result.results.map(r => r.status)).toEqual(['unavailable', 'ambiguous', 'missing']); expect(f.state.heads.size).toBe(0);
  });
  it('assigns one source item represented by several SDK objects and recovers all its foreground IDs', async () => {
    const f = await groupedFixture(), result = await f.repo.assign(f.projectId, f.who, f.input);
    expect(result.results[0]).toMatchObject({ status: 'assigned', candidateObjectIds: [1] });
    const locationId = f.resolved(f.name), location = { ...f.state.locations.get(locationId)!, aliases: [] }, head = f.state.bindings.get(f.state.heads.get(locationId)!)!;
    expect(head).toMatchObject({ pointProjectMetres: [3, 4.5, 1], autoMatchEvidence: { sdkObjectId: 1,
      bounds: { minimum: [0, 1, 1], maximum: [6, 8, 7] }, objectGroup: { ...sourceIdentity, objectIds: [1, 50, 100] } } });
    const display = await readCableEndpointDisplay(f.client as never, { projectId: f.projectId, current: f.context.current, location, head }, () => undefined);
    expect(display).toMatchObject({ sdkObjectId: 1, sdkObjectIds: [1, 50, 100], pointProjectMetres: [3, 4.5, 1] });
    const context = { schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId: f.projectId, cableId: id(10), end: 'from', cableWriteRevision: '7',
      logicalName: f.name, logicalKey: f.name.normalize('NFC').trim().toUpperCase(), mto: 'LV', canBind: true, reasonCodes: [], registryRevision: f.state.registry,
      location, head, current: f.context.current, confirmedDisplaySelection: display, contextSha256: 'c'.repeat(64) };
    expect(cableEndpointContextSchema.safeParse(context).success).toBe(true);
    for (const sdkObjectIds of [undefined, [1, 100], [1, 50, 101]])
      expect(cableEndpointContextSchema.safeParse({ ...context, confirmedDisplaySelection: { ...display, sdkObjectIds } }).success).toBe(false);
    const saved = f.state.commands.get(f.who.userId + ':' + f.input.idempotencyKey)!;
    expect((saved.request as { command: { scan: { candidates: unknown[] } } }).command.scan.candidates).toHaveLength(5);
  });
  it.each(['missing', 'guid', 'source'] as const)('keeps a different or %s source item ambiguous', async kind => {
    const f = await groupedFixture(), other = f.input.scan.candidates.at(-1)!;
    if (kind === 'missing') delete other.objectIdentity;
    if (kind === 'guid') other.objectIdentity = { ...sourceIdentity, guid: '00000000-0000-4000-8000-000000000999' };
    if (kind === 'source') other.objectIdentity = { ...sourceIdentity, sourceFile: 'other.dwg' };
    const result = await f.repo.assign(f.projectId, f.who, f.input);
    expect(result.results[0]).toMatchObject({ status: 'ambiguous', candidateObjectIds: [1, 50] });
    expect(result.results.slice(1).every(value => value.status === 'assigned')).toBe(true);
  });
  it('does not assign a source group with incomplete member bounds', async () => {
    const f = await groupedFixture(), last = f.input.scan.candidates.at(-1)!; last.bounds = last.bottomCentre = null;
    expect((await f.repo.assign(f.projectId, f.who, f.input)).results[0]).toMatchObject({ status: 'unavailable', candidateObjectIds: [1],
      reasonCode: 'MODEL_LOCATION_MATCH_BOUNDS_UNAVAILABLE' });
  });
  it.each([0, 1, 2])('assigns and displays every part of a 513-member source item alongside other names (name %i)', async nameIndex => {
    const f = await groupedFixture(), first = f.input.scan.candidates[0];
    const name = f.input.names[nameIndex], objectIds = Array.from({ length: 513 }, (_, i) => i + 1000);
    f.input.scan.candidates = [...f.command().scan.candidates.filter(candidate => !candidate.matchedNames.includes(name)),
      ...objectIds.map(objectId => ({ ...first, objectId, matchedNames: [name] }))];
    const receipt = await f.repo.assign(f.projectId, f.who, f.input);
    expect(receipt.results[nameIndex]).toMatchObject({ name, status: 'assigned', candidateObjectIds: [1000], reasonCode: null });
    expect(receipt.results.every(result => result.status === 'assigned')).toBe(true);
    expect(f.state.bindings.size).toBe(3); expect(f.state.commands.size).toBe(1);
    const locationId = f.resolved(name), location = { ...f.state.locations.get(locationId)!, aliases: [] }, head = f.state.bindings.get(f.state.heads.get(locationId)!)!;
    expect(head.autoMatchEvidence?.objectGroup).toEqual({ ...sourceIdentity, objectIds });
    expect(await readCableEndpointDisplay(f.client as never, { projectId: f.projectId, current: f.context.current, location, head }, () => undefined))
      .toMatchObject({ sdkObjectId: 1000, sdkObjectIds: objectIds });
    const saved = f.state.commands.get(f.who.userId + ':' + f.input.idempotencyKey)!;
    expect((saved.request as { command: { scan: { candidates: unknown[] } } }).command.scan.candidates).toHaveLength(515);
    expect(await f.repo.assign(f.projectId, f.who, f.input)).toEqual({ ...receipt, duplicate: true });
  });
  it('does not recover display from evidence exceeding the whole-operation raw scan limit', async () => {
    const f = await groupedFixture(); await f.repo.assign(f.projectId, f.who, f.input);
    const locationId = f.resolved(f.name), location = { ...f.state.locations.get(locationId)!, aliases: [] }, head = structuredClone(f.state.bindings.get(f.state.heads.get(locationId)!)!);
    const saved = f.state.commands.get(f.who.userId + ':' + f.input.idempotencyKey)!;
    const request = saved.request as { command: typeof f.input }, first = request.command.scan.candidates[0];
    request.command.scan.candidates.push(...Array.from({ length: 4092 }, (_, i) => ({ ...first, objectId: i + 2000 })));
    saved.request_sha256 = endpointBindingHash(request);
    head.autoMatchEvidence!.commandSha256 = endpointBindingHash(request.command);
    head.autoMatchEvidence!.scanSha256 = endpointBindingHash(request.command.scan);
    (saved.receipt as { commandSha256: string }).commandSha256 = head.autoMatchEvidence!.commandSha256;
    const { contentSha256: _before, ...body } = head; head.contentSha256 = endpointBindingHash(body);
    expect(await readCableEndpointDisplay(f.client as never, { projectId: f.projectId, current: f.context.current, location, head }, () => undefined)).toBeNull();
  });
  it('refuses incomplete group scans before assigning any locations', async () => {
    const f = await groupedFixture();
    await expect(f.repo.assign(f.projectId, f.who, { ...f.input, scan: { ...f.input.scan, complete: false } })).rejects.toBeTruthy();
    expect(f.state.bindings.size).toBe(0);
  });
  it.each(['group members', 'group identity', 'bounds', 'raw identity'] as const)('does not recover display after tampered %s evidence', async kind => {
    const f = await groupedFixture(); await f.repo.assign(f.projectId, f.who, f.input);
    const locationId = f.resolved(f.name), location = { ...f.state.locations.get(locationId)!, aliases: [] }, original = f.state.bindings.get(f.state.heads.get(locationId)!)!, head = structuredClone(original);
    if (kind === 'group members') head.autoMatchEvidence!.objectGroup!.objectIds = [1, 50];
    if (kind === 'group identity') head.autoMatchEvidence!.objectGroup!.sourceFile = 'another.dwg';
    if (kind === 'bounds') { head.autoMatchEvidence!.bounds.maximum[0] = 8; head.autoMatchEvidence!.bottomCentre[0] = head.pointProjectMetres[0] = 4; }
    if (kind === 'raw identity') {
      const saved = f.state.commands.get(f.who.userId + ':' + f.input.idempotencyKey)!;
      const request = saved.request as { command: typeof f.input }; request.command.scan.candidates.at(-1)!.objectIdentity = { ...sourceIdentity, sourceFile: 'another.dwg' };
      // Even a self-consistent command ledger cannot change the source evidence
      // bound to this immutable binding.
      saved.request_sha256 = endpointBindingHash(request);
      head.autoMatchEvidence!.commandSha256 = endpointBindingHash(request.command);
      head.autoMatchEvidence!.scanSha256 = endpointBindingHash(request.command.scan);
      const receipt = saved.receipt as { commandSha256: string }; receipt.commandSha256 = head.autoMatchEvidence!.commandSha256;
    }
    const { contentSha256: _before, ...body } = head; head.contentSha256 = endpointBindingHash(body);
    expect(await readCableEndpointDisplay(f.client as never, { projectId: f.projectId, current: f.context.current, location, head }, () => undefined)).toBeNull();
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
