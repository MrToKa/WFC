// @vitest-environment node
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { endpointFixtureId as id } from './endpointBindingFixtures.js';
import { modelLocationMatchFixture } from './modelLocationMatchFixtures.js';
import { createEndpointBindingRepository, endpointBindingHash } from './endpointBindingRepository.js';
import { readMatchedLocationDisplay, readPreservedLocationDisplay } from './modelLocationMatchDisplay.js';
import { readCableEndpointDisplay } from './cableEndpointDisplay.js';
import { normalizeEndpointLocation } from '../../shared/pathfinderEndpointBindings.js';
import { cableEndpointCommandSchema, cableEndpointReceiptSchema } from '../../shared/pathfinderCableEndpoints.js';

const identity = { guid: '7586ffbb-1d0a-5942-b687-06884123c866', sourceFile: 'models/instruments.dwg' };
const point: [number, number, number] = [10.633498219775824, 75.5099999010227, 13.07999998941831];

async function fixture(members = 1) {
  const f = await modelLocationMatchFixture(), manual = createEndpointBindingRepository(f.pool), input = f.command();
  const saved = await manual.confirm(f.projectId, f.who, f.locationId, {
    schemaVersion: 'wfc.pf.endpoint-binding-write.v1', expectedRegistryRevision: f.state.registry,
    expectedLocationRevision: null, expectedHeadId: null, expectedSelectionRevision: f.context.current.selectionRevision,
    modelVersionId: f.context.current.modelVersionId, aggregateId: f.context.current.aggregateId,
    projectionSha256: f.context.current.projectionSha256, captureFrameId: f.context.current.captureFrameId,
    idempotencyKey: id(999), reason: 'Synthetic manual point preserved by Find.',
    location: { name: 'Equipment', aliases: ['Alias'] }, mode: 'fixed-world', pointProjectMetres: point,
    derivation: 'manual-world-point', provenanceObject: null,
  });
  input.expectedRegistryRevision = f.state.registry;
  const matchedNames = input.names.filter(name => ['EQUIPMENT', 'ALIAS'].includes(normalizeEndpointLocation(name)));
  input.scan.candidates = [
    ...input.scan.candidates.filter(candidate => !candidate.matchedNames.some(name => matchedNames.includes(name))),
    ...Array.from({ length: members }, (_, index) => ({ objectId: 100 + index, name: 'JB_Prod12_04', matchedNames,
      objectIdentity: { ...identity }, bounds: { minimum: [point[0] - .5, point[1] - .5, point[2]] as [number, number, number],
        maximum: [point[0] + .5, point[1] + .5, point[2] + 1] as [number, number, number] }, bottomCentre: [...point] as [number, number, number] })),
  ];
  const receipt = await f.repo.assign(f.projectId, f.who, input), stored = f.state.commands.get(f.who.userId + ':' + input.idempotencyKey)!;
  const row = { actor_id: f.who.userId, idempotency_key: input.idempotencyKey, ...structuredClone(stored) };
  const location = { ...f.state.locations.get(f.locationId)!, aliases: ['Alias'] }, head = f.state.bindings.get(saved.binding.id)!;
  const value = { projectId: f.projectId, current: f.context.current, location, head };
  const query = vi.fn(async (_sql: string, _args?: unknown[]) => ({ rows: [row] })), client = { query } as unknown as PoolClient, check = vi.fn();
  const rehash = () => {
    const request = row.request as { command: typeof input }, result = row.receipt as typeof receipt;
    row.request_sha256 = endpointBindingHash(request); result.commandSha256 = endpointBindingHash(request.command);
  };
  const read = () => readPreservedLocationDisplay(client, value, check);
  return { f, input, receipt, row, value, query, client, check, rehash, read, binding: saved };
}

async function fixtureWithCableCommand() {
  const f = await fixture(), command = cableEndpointCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-command.v1',
    idempotencyKey: id(777), expectedContextSha256: 'a'.repeat(64), expectedCableWriteRevision: '7',
    expectedLogicalName: f.value.location.name, expectedRegistryRevision: f.value.head.locationRegistryRevision,
    expectedLocationId: f.value.location.id, expectedLocationRevision: f.value.location.revision,
    expectedHeadId: f.value.head.id, expectedCurrent: f.value.current, reason: 'Synthetic explicit display clear.',
    selection: { mode: 'fixed-world', pointProjectMetres: point, derivation: 'manual-world-point', displaySdkObjectId: null } });
  const request = { schemaVersion: 'wfc.pf.cable-endpoint-command-owner.v1', cableId: id(10), end: 'from', command };
  const receipt = cableEndpointReceiptSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1',
    projectId: f.value.projectId, actorId: id(888), cableId: request.cableId, end: request.end,
    logicalName: command.expectedLogicalName, idempotencyKey: command.idempotencyKey, commandSha256: endpointBindingHash(command),
    expectedCableWriteRevision: command.expectedCableWriteRevision, expectedContextSha256: command.expectedContextSha256,
    locationId: f.value.location.id, binding: f.binding,
    impact: { fromOccurrences: 1, toOccurrences: 1, distinctCables: 2, cableIds: [id(10), id(11)] }, duplicate: false });
  const cableRow = { actor_id: receipt.actorId, idempotency_key: receipt.idempotencyKey, kind: 'confirm',
    request_sha256: endpointBindingHash(request), request, receipt: { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'saved', receipt } };
  return { ...f, cableRow, cableCommand: command, cableReceipt: receipt };
}

describe('current preserved manual location display recovery', () => {
  it('recovers a singleton from the successful current Find without changing the manual binding or coordinates', async () => {
    const f = await fixture(), before = structuredClone(f.value);
    expect(await f.read()).toEqual({ source: 'confirmed-display-only', mode: 'fixed-world', sdkObjectId: 100,
      name: 'JB_Prod12_04', pointProjectMetres: point, current: f.value.current, bindingId: f.value.head.id,
      bindingContentSha256: f.value.head.contentSha256, commandSha256: f.receipt.commandSha256 });
    expect(f.value).toEqual(before); expect(f.query).toHaveBeenCalledOnce();
    expect(f.query.mock.calls[0][0]).not.toMatch(/INSERT|UPDATE|DELETE/);
  });
  it('carries every current GUID/source group member in separately qualified presentation evidence', async () => {
    const f = await fixture(3);
    expect(await f.read()).toMatchObject({ sdkObjectId: 100, sdkObjectIds: [100, 101, 102],
      preservedMatchObjectGroup: { ...identity, objectIds: [100, 101, 102] }, pointProjectMetres: point });
    expect(f.value.head.autoMatchEvidence).toBeUndefined();
  });
  it('omits an oversized model label while retaining a valid preserved point and object identity', async () => {
    const f = await fixture(), request = f.row.request as { command: typeof f.input };
    request.command.scan.candidates.find(candidate => candidate.objectId === 100)!.name = 'x'.repeat(501); f.rehash();
    const result = await f.read();
    expect(result?.sdkObjectId).toBe(100); expect(result?.pointProjectMetres).toEqual(point); expect(result).not.toHaveProperty('name');
  });
  it('also omits an oversized label from an existing automatic match display instead of blocking its context', async () => {
    const f = await modelLocationMatchFixture(), input = f.command();
    input.scan.candidates.forEach(candidate => { candidate.name = 'x'.repeat(501); });
    await f.repo.assign(f.projectId, f.who, input);
    const locationId = f.resolved('EQUIPMENT'), head = f.state.bindings.get(f.state.heads.get(locationId)!)!,
      stored = f.state.commands.get(f.who.userId + ':' + input.idempotencyKey)!,
      query = vi.fn(async () => ({ rows: [{ actor_id: f.who.userId, idempotency_key: input.idempotencyKey, ...stored }] }));
    const result = await readMatchedLocationDisplay({ query } as unknown as PoolClient, { projectId: f.projectId,
      current: f.context.current, location: { ...f.state.locations.get(locationId)!, aliases: [] }, head }, () => undefined);
    expect(result?.sdkObjectId).toBe(head.autoMatchEvidence!.sdkObjectId); expect(result).not.toHaveProperty('name');
  });
  it('permits only a Find newer than the latest successful cable display command', async () => {
    const f = await fixture(), after = { actorId: id(44), idempotencyKey: id(45) };
    await readPreservedLocationDisplay(f.client, f.value, f.check, after);
    const [sql, args] = f.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('(created_at,actor_id,idempotency_key)>');
    expect(sql).toContain('WHERE project_id=$1 AND actor_id=$5 AND idempotency_key=$6');
    expect(sql).toContain('ORDER BY created_at DESC,actor_id DESC,idempotency_key DESC LIMIT 1 FOR SHARE');
    expect(args.slice(4)).toEqual([after.actorId, after.idempotencyKey]);
  });
  it('allows only numerical rounding within one micrometre, preserving the exact saved point', async () => {
    const f = await fixture(), request = f.row.request as { command: typeof f.input };
    const candidate = request.command.scan.candidates.find(value => value.objectId === 100)!;
    candidate.bounds!.minimum[0] += 5e-7; candidate.bounds!.maximum[0] += 5e-7;
    candidate.bottomCentre![0] = (candidate.bounds!.minimum[0] + candidate.bounds!.maximum[0]) / 2; f.rehash();
    expect((await f.read())?.pointProjectMetres).toEqual(point);
  });
  it.each(['request-hash', 'receipt-hash', 'project', 'operation', 'current-model', 'current-trace', 'head', 'location',
    'reason', 'status', 'raw-ids', 'incomplete-scan', 'missing-identity', 'different-guid', 'different-source', 'no-bounds',
    'changed-point', 'registry-before-head', 'receipt-registry', 'missing-result', 'root-zero'] as const)(
    'refuses %s evidence without reusing another result', async kind => {
      const f = await fixture(kind === 'different-guid' || kind === 'different-source' ? 2 : 1),
        request = f.row.request as { command: typeof f.input }, receipt = f.row.receipt as typeof f.receipt,
        result = receipt.results.find(value => value.locationId === f.value.location.id)!,
        candidate = request.command.scan.candidates.find(value => value.objectId === 100)!;
      if (kind === 'project') receipt.projectId = id(55);
      if (kind === 'operation') f.row.idempotency_key = id(55);
      if (kind === 'current-model') request.command.current.modelVersionId = id(55);
      if (kind === 'current-trace') request.command.current.traceId = id(55);
      if (kind === 'head') result.bindingId = id(55);
      if (kind === 'location') result.locationId = id(55);
      if (kind === 'reason') result.reasonCode = 'SOMETHING_ELSE';
      if (kind === 'status') result.status = 'assigned';
      if (kind === 'raw-ids') result.candidateObjectIds = [101];
      if (kind === 'incomplete-scan') (request.command.scan.propertyScan as { complete: boolean }).complete = false;
      if (kind === 'missing-identity') delete candidate.objectIdentity;
      if (kind === 'different-guid') request.command.scan.candidates.at(-1)!.objectIdentity!.guid = id(55);
      if (kind === 'different-source') request.command.scan.candidates.at(-1)!.objectIdentity!.sourceFile = 'other/instruments.dwg';
      if (kind === 'no-bounds') candidate.bounds = candidate.bottomCentre = null;
      if (kind === 'changed-point') { candidate.bounds!.minimum[0] += .01; candidate.bounds!.maximum[0] += .01;
        candidate.bottomCentre![0] = (candidate.bounds!.minimum[0] + candidate.bounds!.maximum[0]) / 2; }
      if (kind === 'registry-before-head') request.command.expectedRegistryRevision = '0';
      if (kind === 'receipt-registry') receipt.registryRevision = '0';
      if (kind === 'missing-result') receipt.results.pop();
      if (kind === 'root-zero') { candidate.objectId = 0; for (const item of receipt.results.filter(value => value.locationId === f.value.location.id)) item.candidateObjectIds = [0]; }
      f.rehash();
      if (kind === 'request-hash') f.row.request_sha256 = 'f'.repeat(64);
      if (kind === 'receipt-hash') receipt.commandSha256 = 'f'.repeat(64);
      expect(await f.read()).toBeNull();
    });
  it('does not use a stale manual head merely because a current Find exists', async () => {
    const f = await fixture(); f.value.current = { ...f.value.current, aggregateId: id(99) };
    expect(await f.read()).toBeNull(); expect(f.query).not.toHaveBeenCalled();
  });
  it('uses the preserved Find when a current manual binding has no successful cable display command', async () => {
    const f = await fixture(), query = vi.fn(async (sql: string) => ({ rows: sql.includes('preserved-display') ? [f.row] : [] }));
    expect((await readCableEndpointDisplay({ query } as unknown as PoolClient, f.value, f.check))?.sdkObjectId).toBe(100);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('an explicit null stays clear unless the SQL ordering finds a later Find (%s)', async findIsNewer => {
    const f = await fixtureWithCableCommand(), query = vi.fn(async (sql: string, _args: unknown[]) => ({
      rows: sql.includes('preserved-display') ? findIsNewer ? [f.row] : [] : [f.cableRow],
    }));
    const result = await readCableEndpointDisplay({ query } as unknown as PoolClient, f.value, f.check);
    expect(result?.sdkObjectId ?? null).toBe(findIsNewer ? 100 : null);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1].slice(4)).toEqual([f.cableReceipt.actorId, f.cableCommand.idempotencyKey]);
  });
  it('keeps an exact explicit cable display hint preferred without reading a Find receipt', async () => {
    const f = await fixtureWithCableCommand();
    if (f.cableCommand.selection.mode !== 'fixed-world') throw Error('Synthetic fixed point required.');
    f.cableCommand.selection.displaySdkObjectId = 456;
    f.cableReceipt.commandSha256 = endpointBindingHash(f.cableCommand);
    f.cableRow.request_sha256 = endpointBindingHash(f.cableRow.request);
    const query = vi.fn(async () => ({ rows: [f.cableRow] }));
    expect((await readCableEndpointDisplay({ query } as unknown as PoolClient, f.value, f.check))?.sdkObjectId).toBe(456);
    expect(query).toHaveBeenCalledOnce();
  });
  it('does not turn a failed or cancelled read into display proof', async () => {
    const f = await fixture(); f.check.mockImplementation(() => { throw new DOMException('Stopped', 'AbortError'); });
    await expect(f.read()).rejects.toMatchObject({ name: 'AbortError' }); expect(f.query).not.toHaveBeenCalled();
    f.check.mockReset(); f.query.mockRejectedValueOnce(Error('database unavailable')); await expect(f.read()).rejects.toThrow('database unavailable');
  });
});
