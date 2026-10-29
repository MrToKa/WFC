// @vitest-environment node
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { endpointBindingFixture, endpointFixtureId as id } from './endpointBindingFixtures.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import { cableEndpointCommandSchema, cableEndpointReceiptSchema } from '../../shared/pathfinderCableEndpoints.js';
import { readCableEndpointDisplay } from './cableEndpointDisplay.js';

async function fixture() {
  const f = endpointBindingFixture(), projectId = f.f.aggregate.projectId;
  const binding = await f.repo.confirm(projectId, f.who, f.locationId, f.command());
  const context = await f.repo.context(projectId, f.who, f.locationId), head = binding.binding;
  const current = context.current!, location = context.location!;
  const command = cableEndpointCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-command.v1', idempotencyKey: id(700),
    expectedContextSha256: 'a'.repeat(64), expectedCableWriteRevision: '7', expectedLogicalName: 'Equipment', expectedRegistryRevision: '4',
    expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null, expectedCurrent: current, reason: 'Synthetic explicit parent selection.',
    selection: { mode: 'fixed-world', pointProjectMetres: head.pointProjectMetres, derivation: head.derivation, displaySdkObjectId: 456 } });
  const request = { schemaVersion: 'wfc.pf.cable-endpoint-command-owner.v1', cableId: id(10), end: 'from', command };
  const proof = cableEndpointReceiptSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1', projectId, actorId: f.who.userId,
    cableId: request.cableId, end: request.end, logicalName: command.expectedLogicalName, idempotencyKey: command.idempotencyKey,
    commandSha256: endpointBindingHash(command), expectedCableWriteRevision: command.expectedCableWriteRevision,
    expectedContextSha256: command.expectedContextSha256, locationId: location.id, binding,
    impact: { fromOccurrences: 1, toOccurrences: 1, distinctCables: 2, cableIds: [id(10), id(11)] }, duplicate: false });
  const row = { actor_id: proof.actorId, idempotency_key: proof.idempotencyKey, kind: 'confirm', request_sha256: endpointBindingHash(request),
    request, receipt: { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'saved', receipt: proof } };
  const query = vi.fn(async () => ({ rows: [row] })), client = { query } as unknown as PoolClient;
  const check = vi.fn(), input = { projectId, head, current, location }, read = () => readCableEndpointDisplay(client, input, check);
  const rehash = () => { row.request_sha256 = endpointBindingHash(request); proof.commandSha256 = endpointBindingHash(command); };
  return { ...f, input, command, request, proof, row, query, check, read, rehash };
}

describe('fixed-world endpoint command display recovery', () => {
  it('recovers an old exact parent SDK hint without geometry, mutation or invented label', async () => {
    const f = await fixture(), before = structuredClone(f.input);
    expect(await f.read()).toEqual({ source: 'confirmed-display-only', mode: 'fixed-world', sdkObjectId: 456,
      current: f.input.current, pointProjectMetres: [2, 3, 4], bindingId: f.input.head.id,
      bindingContentSha256: f.input.head.contentSha256, commandSha256: f.proof.commandSha256 });
    expect(f.input).toEqual(before); expect(f.input.head.sourceObject).toBe(null); expect(f.input.head.attachment).toBe(null);
    const [sql, args] = f.query.mock.calls[0] as unknown as [string, string[]];
    expect(sql).toContain('LIMIT 1 FOR SHARE'); expect(sql).toContain('octet_length(request::text)<=65536'); expect(sql).toContain('octet_length(receipt::text)<=1048576');
    expect(sql).toContain("receipt->>'status'='saved'"); expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/); expect(args).toEqual([f.input.projectId, f.input.location.id, f.input.head.id, f.input.head.contentSha256]);
  });
  it('retains only an explicitly supplied bounded object name', async () => {
    const f = await fixture(); if (f.command.selection.mode !== 'fixed-world') throw Error('fixture');
    f.command.selection.displayObjectName = '/Equipment parent'; f.rehash(); expect((await f.read())?.name).toBe('/Equipment parent');
  });
  it('does not confuse a later administrator no-op save with the historical binding confirmer', async () => {
    const f = await fixture(); f.row.actor_id = id(999); f.proof.actorId = id(999);
    expect(f.input.head.confirmedBy).not.toBe(f.row.actor_id); expect((await f.read())?.sdkObjectId).toBe(456);
  });
  it('shares display evidence by location/head, including an alias originating on the opposite cable end', async () => {
    const f = await fixture(); f.request.end = 'to'; f.proof.end = 'to'; f.command.expectedLogicalName = 'Alias'; f.proof.logicalName = 'Alias'; f.rehash();
    expect((await f.read())?.sdkObjectId).toBe(456); expect(f.query.mock.calls[0]).toHaveLength(2);
  });
  it('uses an explicit newest null display hint as a clear and does not search older commands', async () => {
    const f = await fixture(); if (f.command.selection.mode !== 'fixed-world') throw Error('fixture');
    f.command.selection.displaySdkObjectId = null; f.rehash(); expect(await f.read()).toBe(null); expect(f.query).toHaveBeenCalledOnce();
  });
  it.each(['request-hash', 'command-hash', 'actor', 'key', 'end', 'cable', 'logical-name', 'head', 'point', 'model', 'selection', 'fingerprint', 'frame', 'aggregate', 'artifact', 'trace', 'oversize', 'pair', 'closed'])(
    'omits invalid %s ledger evidence without fallback or attachment promotion', async field => {
      const f = await fixture();
      if (field === 'request-hash') f.row.request_sha256 = 'f'.repeat(64);
      if (field === 'command-hash') f.proof.commandSha256 = 'f'.repeat(64);
      if (field === 'actor') f.row.actor_id = id(999);
      if (field === 'key') f.row.idempotency_key = id(999);
      if (field === 'end') f.proof.end = 'to';
      if (field === 'cable') f.proof.cableId = id(999);
      if (field === 'logical-name') { f.proof.logicalName = 'Unrelated'; f.command.expectedLogicalName = 'Unrelated'; f.rehash(); }
      if (field === 'head') f.input.head = { ...f.input.head, id: id(999) };
      if (field === 'point' && f.command.selection.mode === 'fixed-world') { f.command.selection.pointProjectMetres = [9, 8, 7]; f.rehash(); }
      if (field === 'model') f.input.current = { ...f.input.current, modelVersionId: id(999) };
      if (field === 'selection') f.input.current = { ...f.input.current, selectionRevision: '999' };
      if (field === 'fingerprint') f.input.current = { ...f.input.current, contentFingerprint: 'f'.repeat(64) };
      if (field === 'frame') f.input.current = { ...f.input.current, captureFrameId: id(999) };
      if (field === 'aggregate') f.input.current = { ...f.input.current, aggregateId: id(999) };
      if (field === 'artifact') f.input.current = { ...f.input.current, artifactId: id(999) };
      if (field === 'trace') f.input.current = { ...f.input.current, traceId: id(999) };
      if (field === 'oversize') Object.assign(f.row, { request: null });
      if (field === 'pair') Object.assign(f.row, { request: { schemaVersion: 'wfc.pf.cable-endpoint-pair-owner.v1' } });
      if (field === 'closed') Object.assign(f.row, { receipt: { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'closed' } });
      expect(await f.read()).toBe(null); expect(f.input.head.attachment).toBe(null);
    });
  it('does not swallow deadline/cancellation or database errors', async () => {
    const f = await fixture(), error = new DOMException('Stopped', 'AbortError'); f.check.mockImplementation(() => { throw error; });
    await expect(f.read()).rejects.toBe(error); expect(f.query).not.toHaveBeenCalled();
    f.check.mockReset(); f.query.mockRejectedValueOnce(Error('database unavailable')); await expect(f.read()).rejects.toThrow('database unavailable');
  });
});
