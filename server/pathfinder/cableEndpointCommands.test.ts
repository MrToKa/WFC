// @vitest-environment node
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpointBindingFixture, endpointFixtureId as id } from './endpointBindingFixtures.js';
import { createCableEndpointCommands } from './cableEndpointCommands.js';
import { endpointBindingHash, confirmEndpointBindingChangeInTransaction, endpointBindingTransaction } from './endpointBindingRepository.js';
import { cableEndpointContextHashInput, type CableEndpointContext, type CableEndpointCommand } from '../../shared/pathfinderCableEndpoints.js';
const mocks = vi.hoisted(() => ({ selection: vi.fn() }));
vi.mock('./cableEndpointSelection.js', () => ({ readCableEndpointSelection: mocks.selection }));
beforeEach(() => vi.resetAllMocks());
/** Extends the existing mock SQL protocol; all binding mutations still exercise the real transaction/helper. */
function fixture() {
  const f = endpointBindingFixture(), settings = { cableRevision: '7', mto: 'LV' as string | null, oversized: false, budget: false, missing: false, impactBytes: '1024' };
  const original = f.client.query;
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith('BEGIN ISOLATION')) return original('BEGIN');
    if (sql.startsWith('/* cable-endpoint:')) {
      f.queries.push(sql); f.parameters.push(args); const p = args as string[];
      if (sql.startsWith('/* cable-endpoint:cable */')) { const c = f.state.cables.find(c => c.id === p[1]); return { rows: c && !settings.missing ? [{ ...c, cable_write_revision: settings.cableRevision, mto: settings.mto, oversized: settings.oversized }] : [] }; }
      if (sql.startsWith('/* cable-endpoint:context-budget */')) return { rows: [{ oversized: settings.budget }] };
      if (sql.startsWith('/* cable-endpoint:alias */')) return { rows: [...f.state.aliases.values()].filter(a => a.normalized_alias === p[1]).map(a => ({ location_id: a.location_id })) };
      if (sql.startsWith('/* cable-endpoint:location */')) { const l = f.state.locations.get(p[1]); return { rows: l ? [{ ...l, oversized: false }] : [] }; }
      if (sql.startsWith('/* cable-endpoint:aliases */')) return { rows: [...f.state.aliases.values()].filter(a => a.location_id === p[1]).map(a => ({ ...a, oversized: false })) };
      if (sql.startsWith('/* cable-endpoint:head */')) { const b = f.state.bindings.get(f.state.heads.get(p[1]) ?? ''); return { rows: b ? [{ binding_id: b.id, binding_revision: b.bindingRevision, record_sha256: b.contentSha256, record: b }] : [] }; }
      if (sql.startsWith('/* cable-endpoint:impact */')) return { rows: f.state.cables.map(c => ({ ...c, oversized: false, total_text_bytes: settings.impactBytes })) };
      if (sql.startsWith('/* cable-endpoint:command */')) { const c = f.state.commands.get(p[1] + ':' + p[2]); return { rows: c ? [c] : [] }; }
    }
    return original(sql, args);
  });
  const client = { query, release: f.release }, pool = { connect: vi.fn(async () => client) } as unknown as Pool, repo = createCableEndpointCommands(pool);
  const projectId = f.f.aggregate.projectId, cableId = id(10);
  let key = 500;
  const read = (cable = cableId, end: 'from' | 'to' = 'from') => repo.context(projectId, f.who, cable, end);
  const command = (c: CableEndpointContext): CableEndpointCommand => ({ schemaVersion: 'wfc.pf.cable-endpoint-command.v1', idempotencyKey: id(key++),
    expectedContextSha256: c.contextSha256, expectedCableWriteRevision: c.cableWriteRevision, expectedLogicalName: c.logicalName!,
    expectedRegistryRevision: c.registryRevision, expectedLocationId: c.location?.id ?? null, expectedLocationRevision: c.location?.revision ?? null,
    expectedHeadId: c.head?.id ?? null, expectedCurrent: c.current!, reason: 'Explicit synthetic endpoint selection',
    selection: { mode: 'fixed-world', pointProjectMetres: [2, 3, 4], derivation: 'manual-world-point', displaySdkObjectId: null } });
  const save = (c: CableEndpointCommand, cable = cableId, end: 'from' | 'to' = 'from', signal?: AbortSignal) => repo.save(projectId, f.who, cable, end, c, signal);
  const close = (c: CableEndpointCommand) => repo.close(projectId, f.who, cableId, 'from', c);
  const object = f.built.records.find(r => r.geometry.role === 'object')!, summary = f.built.summaries.find(s => s.id === object.id)!;
  const ref = { traceId: object.traceId, objectRevisionId: object.id, recordSha256: summary.recordSha256 };
  mocks.selection.mockImplementation(async (_client, input, check) => { check(); return { schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId, current: input.current,
    sdkObjectId: input.sdkObjectId, status: 'available', reasonCodes: [], object: ref, pointProjectMetres: object.geometry.equipmentAnchor!.pointMetres,
    bounds: object.geometry.bounds, approximate: true, derivation: 'equipment-bottom-aabb.v1' }; });
  return { ...f, settings, query, client, pool, repo, projectId, cableId, read, legacyCommand: f.command, command, save, close, object, ref };
}
describe('cable endpoint commands with synthetic SQL; selection reader independently tested', () => {
  it('reads exact cable-owned names and SHA context without login initialization or other DML', async () => {
    const f = fixture(), c = await f.read(); expect(c.logicalName).toBe('EQUIPMENT'); expect(c.canBind).toBe(true); expect(c.location).toBe(null);
    expect(c.contextSha256).toBe(endpointBindingHash(cableEndpointContextHashInput(c))); expect(f.queries.some(q => /^\s*(?:INSERT|UPDATE|DELETE|CREATE)\b/i.test(q))).toBe(false);
  });
  it('creates one shared location and binding with one transaction and no cable/engine writes', async () => {
    const f = fixture(), c = f.command(await f.read()); f.queries.length = 0; const receipt = await f.save(c);
    expect(receipt.logicalName).toBe('EQUIPMENT'); expect(receipt.actorId).toBe(f.who.userId); expect(receipt.binding.binding.pointProjectMetres).toEqual([2, 3, 4]);
    expect(receipt.impact).toEqual({ fromOccurrences: 1, toOccurrences: 1, distinctCables: 2, cableIds: [id(10), id(11)] });
    expect(f.state.registry).toBe('5'); expect(f.state.locations.size).toBe(1); expect(f.state.commands.size).toBe(1);
    expect(f.queries.filter(q => q === 'BEGIN')).toHaveLength(1); expect(f.queries.filter(q => q === 'COMMIT')).toHaveLength(1);
    expect(f.queries.join('\n')).not.toMatch(/UPDATE cables|INSERT INTO pf_jobs|UPDATE pf_location_bindings|UPDATE pf_preparation/);
  });
  it('reuses a known alias and canonical names across From/To and every cable without renaming the location', async () => {
    const f = fixture();
    await endpointBindingTransaction(f.pool, f.projectId, f.who, client => confirmEndpointBindingChangeInTransaction(client, f.projectId, f.who, f.locationId, f.legacyCommand()));
    const c = await f.read(id(11)); expect(c.logicalName).toBe('Alias'); expect(c.location?.name).toBe('Equipment'); expect(c.location?.aliases).toEqual(['Alias']);
    const receipt = await f.save(f.command(c), id(11)); expect(receipt.locationId).toBe(f.locationId); expect(receipt.binding.duplicate).toBe(true);
    expect(receipt.binding.binding.confirmedBy).toBe(f.who.userId); expect(receipt.impact).toEqual({ fromOccurrences: 2, toOccurrences: 2, distinctCables: 2, cableIds: [id(10), id(11)] });
    expect(f.state.locations.size).toBe(1); expect(f.state.locations.get(f.locationId)?.name).toBe('Equipment'); expect(f.state.registry).toBe('5');
  });
  it('keeps command actor distinct from a no-op binding historical confirmer', async () => {
    const f = fixture(), first = await f.save(f.command(await f.read())), old = f.state.bindings.get(first.binding.binding.id)!;
    const { contentSha256: _hash, ...body } = old, changed = { ...body, confirmedBy: id(999) };
    f.state.bindings.set(old.id, { ...changed, contentSha256: endpointBindingHash(changed) });
    const receipt = await f.save(f.command(await f.read())); expect(receipt.actorId).toBe(f.who.userId); expect(receipt.binding.binding.confirmedBy).toBe(id(999)); expect(receipt.binding.duplicate).toBe(true);
  });
  it.each(['LV', 'Control', 'Instrumentation'])('allows named %s, never inferring category from geometry', async mto => {
    const f = fixture(); f.settings.mto = mto; expect((await f.read()).canBind).toBe(true);
  });
  it.each([['MV', 'CABLE_ENDPOINT_MV_EXCLUDED'], [null, 'CABLE_ENDPOINT_CATEGORY_REQUIRED'], ['Other', 'CABLE_ENDPOINT_CATEGORY_REQUIRED']])('blocks category %s explicitly', async (mto, reason) => {
    const f = fixture(); f.settings.mto = mto; const c = await f.read(); expect(c.canBind).toBe(false); expect(c.reasonCodes).toContain(reason);
    await expect(f.save(f.command(c))).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_UNAVAILABLE' }); expect(f.state.bindings.size).toBe(0);
  });
  it('shows an empty logical name as blocked and asks for a cable-list name instead of inventing one', async () => {
    const f = fixture(); f.state.cables[0].from_location = '  '; const c = await f.read(); expect(c.logicalName).toBe(null); expect(c.logicalKey).toBe(null);
    expect(c.canBind).toBe(false); expect(c.reasonCodes).toContain('CABLE_ENDPOINT_NAME_REQUIRED'); expect(f.state.locations.size).toBe(0);
  });
  it.each(['x'.repeat(501), 'bad\u0001name'])('retains invalid historical cable names as non-bindable diagnostics', async name => {
    const f = fixture(); f.state.cables[0].from_location = name; const c = await f.read(); expect(c.logicalName).toBe(name); expect(c.canBind).toBe(false);
  });
  it('binds only selected To while retaining its exact logical cable name', async () => {
    const f = fixture(), c = await f.read(f.cableId, 'to'), receipt = await f.save(f.command(c), f.cableId, 'to');
    expect(receipt.end).toBe('to'); expect(receipt.logicalName).toBe('Alias'); expect(receipt.binding.binding.sourceObject).toBe(null);
  });
  it.each(['revision', 'name', 'registry', 'selection', 'hash', 'head', 'location'] as const)('refuses changed %s context without partial mutations', async kind => {
    const f = fixture(), command = f.command(await f.read());
    if (kind === 'revision') f.settings.cableRevision = '8'; if (kind === 'name') f.state.cables[0].from_location = 'Moved';
    if (kind === 'registry') f.state.registry = '9'; if (kind === 'selection') f.state.selectedRevision = '2';
    if (kind === 'hash') command.expectedContextSha256 = 'f'.repeat(64); if (kind === 'head') { command.expectedLocationId = id(776); command.expectedLocationRevision = '1'; command.expectedHeadId = id(777); }
    if (kind === 'location') { command.expectedLocationId = id(778); command.expectedLocationRevision = '1'; }
    await expect(f.save(command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_CONTEXT_CHANGED' });
    expect(f.state.bindings.size).toBe(0); expect(f.state.locations.size).toBe(0); expect(f.state.commands.size).toBe(0);
  });
  it('re-resolves exact SDK evidence then computes the equipment anchor on the server', async () => {
    const f = fixture(), c = await f.read(), command = f.command(c); command.selection = { mode: 'object-derived', sdkObjectId: 345, object: f.ref };
    const receipt = await f.save(command); expect(mocks.selection).toHaveBeenCalledExactlyOnceWith(expect.any(Object), { projectId: f.projectId, current: c.current, sdkObjectId: 345 }, expect.any(Function));
    expect(receipt.binding.binding.pointProjectMetres).toEqual(f.object.geometry.equipmentAnchor!.pointMetres); expect(receipt.binding.binding.sourceObject).toEqual(f.ref);
  });
  it.each(['unavailable', 'different-record'])('refuses %s exact selection evidence without fallback guessing', async kind => {
    const f = fixture(), command = f.command(await f.read()); command.selection = { mode: 'object-derived', sdkObjectId: 345, object: f.ref };
    mocks.selection.mockResolvedValue(kind === 'unavailable' ? { status: 'unavailable', object: null } : { status: 'available', object: { ...f.ref, recordSha256: 'f'.repeat(64) } });
    await expect(f.save(command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_SELECTION_CHANGED' }); expect(f.state.bindings.size).toBe(0);
  });
  it('does not promote a fixed-world display SDK id to attachment or source-object provenance', async () => {
    const f = fixture(), command = f.command(await f.read()); command.selection = { mode: 'fixed-world', pointProjectMetres: [9, 8, 7], derivation: 'picked-surface-point', displaySdkObjectId: 456 };
    const receipt = await f.save(command); expect(receipt.binding.binding.mode).toBe('fixed-world'); expect(receipt.binding.binding.sourceObject).toBe(null); expect(mocks.selection).not.toHaveBeenCalled();
  });
  it('reads exact selection only for its current cable context and fails a changed context before lookup', async () => {
    const f = fixture(), c = await f.read(); const response = await f.repo.selection(f.projectId, f.who, f.cableId, 'from', 12, c.contextSha256);
    expect(response.selection.sdkObjectId).toBe(12); f.state.selectedRevision = '2';
    await expect(f.repo.selection(f.projectId, f.who, f.cableId, 'from', 12, c.contextSha256)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_CONTEXT_CHANGED' });
    expect(mocks.selection).toHaveBeenCalledTimes(1);
  });
  it('replays a saved command before stale model/name/revision checks with no additional write', async () => {
    const f = fixture(), command = f.command(await f.read()), receipt = await f.save(command); f.state.prepared = false; f.settings.cableRevision = '99'; f.state.cables[0].from_location = 'Changed';
    expect(await f.save(command)).toEqual({ ...receipt, duplicate: true }); expect(f.state.bindings.size).toBe(1); expect(f.state.registry).toBe('5');
    await expect(f.save({ ...command, reason: 'Different body' })).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_IDEMPOTENCY_CONFLICT' });
    await expect(f.save(command, f.cableId, 'to')).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_IDEMPOTENCY_CONFLICT' });
  });
  it('does not reinterpret legacy binding-command receipts using the cable version', async () => {
    const f = fixture(), command = f.command(await f.read()); f.state.commands.set(f.who.userId + ':' + command.idempotencyKey, { kind: 'confirm', request_sha256: endpointBindingHash(command), request: command, receipt: { schemaVersion: 'wfc.pf.endpoint-binding-receipt.v1' } });
    await expect(f.save(command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_IDEMPOTENCY_CONFLICT' }); expect(f.state.bindings.size).toBe(0);
  });
  it('returns saved receipt on close after a lost acknowledgement instead of closing an already committed save', async () => {
    const f = fixture(), command = f.command(await f.read()), receipt = await f.save(command), result = await f.close(command);
    expect(result).toEqual({ schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'saved', receipt: { ...receipt, duplicate: true } });
    expect(f.state.commands.size).toBe(1);
  });
  it('closes an exact unsaved command durably under the same lock, even after model/name changes; a late PUT cannot write', async () => {
    const f = fixture(), command = f.command(await f.read()); f.state.prepared = false; f.settings.cableRevision = '8'; f.state.cables[0].from_location = 'Changed';
    const result = await f.close(command); expect(result.status).toBe('closed'); if (result.status !== 'closed') throw Error('fixture');
    expect(result.closure.actorId).toBe(f.who.userId); expect(result.closure.commandSha256).toBe(endpointBindingHash(command));
    expect(await f.close(command)).toEqual(result); await expect(f.save(command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_COMMAND_CLOSED' });
    expect(f.state.bindings.size).toBe(0); expect(f.state.locations.size).toBe(0); expect(f.state.commands.size).toBe(1);
  });
  it.each(['admin', 'login', 'expiry', 'abort'] as const)('current %s refusal protects both save and exact recovery', async kind => {
    const f = fixture(), command = f.command(await f.read()), controller = new AbortController();
    if (kind === 'admin') f.state.admin = false; if (kind === 'login') f.state.revoked = true; if (kind === 'expiry') f.who.loginExpiresAt = Date.now() - 1; if (kind === 'abort') controller.abort();
    await expect(f.save(command, f.cableId, 'from', controller.signal)).rejects.toBeDefined();
    if (kind !== 'abort') await expect(f.close(command)).rejects.toMatchObject({ status: kind === 'admin' ? 403 : 401 });
    expect(f.state.bindings.size).toBe(0); expect(f.state.commands.size).toBe(0);
  });
  it('rolls back a partial binding failure and permits the same original command to reconcile normally', async () => {
    const f = fixture(), command = f.command(await f.read()); f.state.failInsert = true; await expect(f.save(command)).rejects.toThrow('synthetic insertion failure');
    expect(f.state.locations.size).toBe(0); expect(f.state.aliases.size).toBe(0); expect(f.state.commands.size).toBe(0); f.state.failInsert = false;
    expect((await f.save(command)).duplicate).toBe(false);
  });
  it('keeps an uncertain COMMIT error distinguishable and resolves it by exact immutable replay', async () => {
    const f = fixture(), command = f.command(await f.read()); f.state.commitFails = true;
    await expect(f.save(command)).rejects.toMatchObject({ code: 'ENDPOINT_COMMIT_OUTCOME_UNKNOWN' }); expect(f.release).toHaveBeenCalledWith(true);
  });
  it('bounds context transfer and project impact before binding changes', async () => {
    const f = fixture(); f.settings.budget = true; await expect(f.read()).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_CONTEXT_LIMIT' }); f.settings.budget = false;
    const command = f.command(await f.read()); f.state.cables = Array.from({ length: 10001 }, (_, index) => ({ id: id(index + 1000), from_location: 'Other', to_location: null }));
    f.state.cables[0] = { id: f.cableId, from_location: 'EQUIPMENT', to_location: 'Alias' };
    await expect(f.save(command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_PROJECT_CABLE_LIMIT' }); expect(f.state.bindings.size).toBe(0);
  });
  it('the extracted legacy helper opens no transaction or command ledger and retains all ordinary guards', async () => {
    const f = fixture(); await endpointBindingTransaction(f.pool, f.projectId, f.who, client => confirmEndpointBindingChangeInTransaction(client, f.projectId, f.who, f.locationId, f.legacyCommand()));
    expect(f.queries.filter(q => q === 'BEGIN')).toHaveLength(1); expect(f.state.commands.size).toBe(0); expect(f.state.bindings.size).toBe(1);
  });
  it('refuses cumulative impact text before binding writes and suppresses oversized transfer in the locked SQL scan', async () => {
    const f = fixture(), command = f.command(await f.read()); f.settings.impactBytes = '8388609';
    await expect(f.save(command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_IMPACT_LIMIT' }); expect(f.state.bindings.size).toBe(0);
    const query = f.queries.find(q => q.startsWith('/* cable-endpoint:impact */'))!;
    expect(query).toContain('CASE WHEN total_text_bytes<=8388608'); expect(query).toContain('LIMIT 10001 FOR SHARE'); expect(query).toContain('OVER()');
  });
  it.each(['expiry', 'abort'] as const)('treats %s during COMMIT as unknown and reconciles the exact already saved key', async kind => {
    const f = fixture(), command = f.command(await f.read()), controller = new AbortController(), original = f.query.getMockImplementation()!;
    let once = true; const expiry = f.who.loginExpiresAt;
    f.query.mockImplementation(async (sql, args = []) => { const result = await original(sql, args);
      if (sql === 'COMMIT' && once) { once = false; if (kind === 'expiry') f.who.loginExpiresAt = Date.now() - 1; else controller.abort(); } return result; });
    await expect(f.save(command, f.cableId, 'from', controller.signal)).rejects.toMatchObject({ code: 'ENDPOINT_COMMIT_OUTCOME_UNKNOWN' });
    expect(f.state.commands.size).toBe(1); expect(f.state.bindings.size).toBe(1); f.who.loginExpiresAt = expiry;
    const recovered = await f.save(command); expect(recovered.duplicate).toBe(true); expect(f.state.bindings.size).toBe(1); expect(f.state.registry).toBe('5');
  });
});
