// @vitest-environment node
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endpointBindingFixture, endpointFixtureId as id } from './endpointBindingFixtures.js';
import { createCableEndpointCommands } from './cableEndpointCommands.js';
import { endpointBindingHash, confirmEndpointBindingChangeInTransaction, endpointBindingTransaction } from './endpointBindingRepository.js';
import { cableEndpointContextHashInput, type CableEndpointContext, type CableEndpointCommand } from '../../shared/pathfinderCableEndpoints.js';
import { cableEndpointPairCommandSchema, type CableEndpointPairCommand } from '../../shared/pathfinderCableEndpointPair.js';
const mocks = vi.hoisted(() => ({ selection: vi.fn(), automatic: vi.fn(), append: vi.fn(), mandate: vi.fn(), barriers: vi.fn() }));
vi.mock('./cableEndpointSelection.js', () => ({ readCableEndpointSelection: mocks.selection }));
vi.mock('./locationImpactRepository.js', () => ({ appendLocationImpactInTransaction: mocks.append }));
vi.mock('./initialFillMandates.js', () => ({ appendInitialFillMandateInTransaction: mocks.mandate }));
vi.mock('./automaticEndpointCandidates.js', () => ({ readAutomaticNamedEndpointCandidate: mocks.automatic }));
vi.mock('./barrierCalculationScope.js', () => ({ collectBarrierCalculationScope: mocks.barriers }));
beforeEach(() => { vi.resetAllMocks(); mocks.automatic.mockResolvedValue({ status: 'missing', candidateObjectIds: [], point: null, objectId: null }); mocks.barriers.mockResolvedValue({}); });
function calculationFor(projectId: string, current: NonNullable<CableEndpointContext['current']>) {
  const scope = { projectId, modelVersionId: current.modelVersionId, selectionRevision: current.selectionRevision, contentFingerprint: current.contentFingerprint,
    captureFrameId: current.captureFrameId, captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  return { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true, barrierRouting: { schemaVersion: 'wfc.pf.barrier-admission-intent.v1' as const,
    scope, expectedRegistryRevision: '3', expectedSnapshot: { snapshotId: id(700), scope, registryRevision: '3', contentSha256: 'c'.repeat(64), mode: 'explicit-empty' as const }, drillThroughWalls: false } }, timeoutMilliseconds: 60000 };
}
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
      if (sql.startsWith('/* cable-endpoint:display-command */')) return { rows: [...f.state.commands.entries()].reverse().flatMap(([key, value]) => {
        const stored = value.receipt as { status?: string; receipt?: { locationId?: string; binding?: { binding?: { id?: string; contentSha256?: string } } } };
        const request = value.request as { schemaVersion?: string };
        return request.schemaVersion === 'wfc.pf.cable-endpoint-command-owner.v1' && stored.status === 'saved' && stored.receipt?.locationId === p[1]
          && stored.receipt.binding?.binding?.id === p[2] && stored.receipt.binding.binding.contentSha256 === p[3]
          ? [{ ...value, actor_id: key.split(':')[0], idempotency_key: key.split(':')[1] }] : [];
      }).slice(0, 1) };
      if (sql.startsWith('/* cable-endpoint:impact */')) return { rows: f.state.cables.map(c => ({ ...c, oversized: false, total_text_bytes: settings.impactBytes })) };
      if (sql.startsWith('/* cable-endpoint:command */') || sql.startsWith('/* cable-endpoint:pair-command */')) { const c = f.state.commands.get(p[1] + ':' + p[2]); return { rows: c ? [c] : [] }; }
      if (sql.startsWith('/* cable-endpoint:automatic-name */')) { const record = f.built.records.find(item => item.id === p[2]); return { rows: record ? [{ name: record.historicalModel.name, sdk_object_id: record.identity.dbId }] : [] }; }
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
  it.each(['wfc.pf.cable-endpoint-command.v2','wfc.pf.cable-endpoint-command.v3'] as const)('refuses a fresh %s calculation without intent before any endpoint/outbox write',async schemaVersion=>{
    const f=fixture(),base=f.command(await f.read()),command={...base,schemaVersion,calculation:{preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000},...(schemaVersion.endsWith('v3')?{initialFill:null}:{})};
    await expect(f.save(command as CableEndpointCommand)).rejects.toMatchObject({code:'BARRIER_ROUTING_INTENT_REQUIRED'});
    expect(f.state.locations.size).toBe(0);expect(f.state.bindings.size).toBe(0);expect(f.state.commands.size).toBe(0);
    expect(mocks.barriers).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();expect(mocks.mandate).not.toHaveBeenCalled();
  });
  it('verifies the current published barrier scope before a fresh calculated endpoint save',async()=>{
    const f=fixture(),current=await f.read(),calculation=calculationFor(f.projectId,current.current!),command={...f.command(current),schemaVersion:'wfc.pf.cable-endpoint-command.v2' as const,calculation};
    mocks.append.mockResolvedValue({id:id(900),status:'pending',eligibleCables:2,excludedMvCables:0,blockedCategoryCables:0});
    mocks.barriers.mockImplementation(async(client,projectId,intent)=>{expect(client).toBe(f.client);expect(projectId).toBe(f.projectId);expect(intent).toEqual(calculation.preferences.barrierRouting);expect(f.state.bindings.size).toBe(0);expect(f.state.commands.size).toBe(0);return{};});
    await f.save(command);expect(mocks.barriers).toHaveBeenCalledExactlyOnceWith(f.client,f.projectId,calculation.preferences.barrierRouting,{signal:undefined});
    expect(mocks.append).toHaveBeenCalledOnce();
  });
  it('refuses a changed publication before committing a new location or queued impact',async()=>{
    const f=fixture(),current=await f.read(),command={...f.command(current),schemaVersion:'wfc.pf.cable-endpoint-command.v2' as const,calculation:calculationFor(f.projectId,current.current!)};
    mocks.barriers.mockRejectedValue(Object.assign(Error('Synthetic changed publication'),{code:'BARRIER_CALCULATION_SCOPE_CHANGED'}));
    await expect(f.save(command)).rejects.toMatchObject({code:'BARRIER_CALCULATION_SCOPE_CHANGED'});
    expect(f.state.bindings.size).toBe(0);expect(f.state.locations.size).toBe(0);expect(f.state.commands.size).toBe(0);expect(mocks.append).not.toHaveBeenCalled();
  });
  it('recovers an exact historical saved calculation command without requiring a now-missing intent or current publication',async()=>{
    const f=fixture(),base=f.command(await f.read()),savedCommand={...base,schemaVersion:'wfc.pf.cable-endpoint-command.v2' as const,calculation:null};
    mocks.append.mockResolvedValue({id:id(900),status:'blocked',eligibleCables:2,excludedMvCables:0,blockedCategoryCables:0});
    const saved=await f.save(savedCommand),historical={...savedCommand,calculation:{preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000}},receipt={...saved,commandSha256:endpointBindingHash(historical)};
    // Model the exact already-retained historical command and its verified
    // receipt in this SQL fixture; production never rewrites old rows.
    const request={schemaVersion:'wfc.pf.cable-endpoint-command-owner.v1',cableId:f.cableId,end:'from',command:historical};
    f.state.commands.set(f.who.userId+':'+historical.idempotencyKey,{kind:'confirm',request_sha256:endpointBindingHash(request),request,receipt:{schemaVersion:'wfc.pf.cable-endpoint-stored.v1',status:'saved',receipt}});
    f.state.prepared=false;mocks.barriers.mockRejectedValue(Error('Must not read current barriers'));
    expect(await f.save(historical)).toEqual({...receipt,duplicate:true});expect((await f.close(historical)).status).toBe('saved');
    expect(mocks.barriers).not.toHaveBeenCalled();expect(mocks.append).toHaveBeenCalledOnce();expect(f.state.bindings.size).toBe(1);
  });
  it('can close a historical unsaved missing-intent command without authorizing any delayed calculation',async()=>{
    const f=fixture(),command={...f.command(await f.read()),schemaVersion:'wfc.pf.cable-endpoint-command.v2' as const,calculation:{preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:60000}};
    expect((await f.close(command)).status).toBe('closed');await expect(f.save(command)).rejects.toMatchObject({code:'CABLE_ENDPOINT_COMMAND_CLOSED'});
    expect(mocks.barriers).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();expect(f.state.bindings.size).toBe(0);
  });
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
  it('legacy v1 preserves its exact command body without trigger suppression or an implicit calculation impact', async () => {
    const f = fixture(), command = f.command(await f.read()), receipt = await f.save(command);
    expect(receipt.locationImpact).toBeUndefined(); expect(mocks.append).not.toHaveBeenCalled(); expect(f.queries.join('\n')).not.toContain('wfc.pathfinder_location_impact');
    expect(f.state.commands.values().next().value?.request).toMatchObject({ command });
  });
  it.each([false, true])('v2 saves one durable impact with exact explicit configuration enabled=%s; replay and closure never append another', async enabled => {
    const f = fixture(), current = await f.read(), calculation = enabled ? calculationFor(f.projectId, current.current!) : null,
      command = { ...f.command(current), schemaVersion: 'wfc.pf.cable-endpoint-command.v2', calculation };
    const reference = { id: id(900), status: calculation ? 'pending' : 'blocked', eligibleCables: 2, excludedMvCables: 0, blockedCategoryCables: 0 }; mocks.append.mockResolvedValue(reference);
    const receipt = await f.save(command as CableEndpointCommand); expect(receipt.locationImpact).toEqual(reference);
    expect(mocks.append).toHaveBeenCalledExactlyOnceWith(expect.any(Object), expect.objectContaining({ calculation, affectedCableIds: [id(10), id(11)], commandSha256: endpointBindingHash(command) }), expect.any(Function));
    expect(f.queries.indexOf("SET LOCAL wfc.pathfinder_location_impact='1'")).toBeLessThan(f.queries.findIndex(q => q.startsWith('INSERT INTO pf_locations')));
    expect((await f.save(command as CableEndpointCommand)).duplicate).toBe(true); await f.close(command as CableEndpointCommand); expect(mocks.append).toHaveBeenCalledTimes(1);
  });
  it('rolls binding, aliases and command back if the same-transaction impact append fails', async () => {
    const f = fixture(), command = { ...f.command(await f.read()), schemaVersion: 'wfc.pf.cable-endpoint-command.v2', calculation: null };
    mocks.append.mockRejectedValue(new Error('synthetic outbox failure')); await expect(f.save(command as CableEndpointCommand)).rejects.toThrow('synthetic outbox failure');
    expect(f.state.bindings.size).toBe(0); expect(f.state.locations.size).toBe(0); expect(f.state.commands.size).toBe(0); expect(f.state.registry).toBe('4');
  });
  it('closing an unsaved v2 command appends no impact and a late save stays closed', async () => {
    const f = fixture(), command = { ...f.command(await f.read()), schemaVersion: 'wfc.pf.cable-endpoint-command.v2', calculation: null } as CableEndpointCommand;
    expect((await f.close(command)).status).toBe('closed'); await expect(f.save(command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_COMMAND_CLOSED' }); expect(mocks.append).not.toHaveBeenCalled();
  });
  it('explicit v3 atomically appends impact and mandate, and exact replay keeps the original policy and ref', async () => {
    const f = fixture(), command = { ...f.command(await f.read()), schemaVersion: 'wfc.pf.cable-endpoint-command.v3', calculation: null, initialFill: { mode: 'when-both-empty' } } as CableEndpointCommand;
    const impact = { id: id(900), status: 'blocked', eligibleCables: 2, excludedMvCables: 0, blockedCategoryCables: 0 }, mandate = { id: id(901), impactId: id(900), contentSha256: 'a'.repeat(64), mode: 'when-both-empty' };
    mocks.append.mockResolvedValue(impact); mocks.mandate.mockResolvedValue(mandate); const receipt = await f.save(command);
    expect(receipt.initialFillMandate).toEqual(mandate); expect(mocks.mandate).toHaveBeenCalledExactlyOnceWith(expect.any(Object), expect.objectContaining({ command, impactId: impact.id, commandSha256: endpointBindingHash(command) }), expect.any(Function));
    expect((await f.save(command)).initialFillMandate).toEqual(mandate); await f.close(command); expect(mocks.append).toHaveBeenCalledTimes(1); expect(mocks.mandate).toHaveBeenCalledTimes(1);
  });
  it('v3 null policy grants no mandate while preserving explicit calculation impact', async () => {
    const f = fixture(), command = { ...f.command(await f.read()), schemaVersion: 'wfc.pf.cable-endpoint-command.v3', calculation: null, initialFill: null } as CableEndpointCommand;
    mocks.append.mockResolvedValue({ id: id(900), status: 'blocked', eligibleCables: 2, excludedMvCables: 0, blockedCategoryCables: 0 });
    expect((await f.save(command)).initialFillMandate).toBeUndefined(); expect(mocks.mandate).not.toHaveBeenCalled();
  });
  it('mandate failure rolls back the same binding transaction; closed v3 never appends authority', async () => {
    const f = fixture(), command = { ...f.command(await f.read()), schemaVersion: 'wfc.pf.cable-endpoint-command.v3', calculation: null, initialFill: { mode: 'when-both-empty' } } as CableEndpointCommand;
    mocks.append.mockResolvedValue({ id: id(900), status: 'blocked', eligibleCables: 2, excludedMvCables: 0, blockedCategoryCables: 0 }); mocks.mandate.mockRejectedValue(Error('synthetic mandate failure'));
    await expect(f.save(command)).rejects.toThrow('synthetic mandate failure'); expect(f.state.locations.size).toBe(0); expect(f.state.bindings.size).toBe(0); expect(f.state.commands.size).toBe(0);
    await f.close(command); await expect(f.save(command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_COMMAND_CLOSED' }); expect(mocks.mandate).toHaveBeenCalledTimes(1);
  });
});

async function pairFixture(ends: ('from' | 'to')[] = ['from', 'to']) {
  const f = fixture(), originals = { from: await f.read(f.cableId, 'from'), to: await f.read(f.cableId, 'to') };
  const command = cableEndpointPairCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-pair-command.v1', idempotencyKey: id(800),
    expectedContexts: { from: originals.from.contextSha256, to: originals.to.contextSha256 }, endpoints: ends.map(end => ({ end,
      command: { ...f.command(originals[end]), schemaVersion: 'wfc.pf.cable-endpoint-command.v3',
        calculation: calculationFor(f.projectId, originals[end].current!), initialFill: { mode: 'when-both-empty' } },
    })) });
  let impactId = 900, mandateId = 950;
  mocks.append.mockImplementation(async (_client, input, check) => { check(); return { id: id(impactId++), status: input.calculation ? 'pending' : 'blocked', eligibleCables: input.affectedCableIds.length, excludedMvCables: 0, blockedCategoryCables: 0 }; });
  mocks.mandate.mockImplementation(async (_client, input, check) => { check(); return { id: id(mandateId++), impactId: input.impactId, contentSha256: 'a'.repeat(64), mode: 'when-both-empty' }; });
  return { ...f, originals, pair: command,
    savePair: (input: CableEndpointPairCommand = command, signal?: AbortSignal) => f.repo.savePair(f.projectId, f.who, f.cableId, input, signal),
    closePair: (input: CableEndpointPairCommand = command) => f.repo.closePair(f.projectId, f.who, f.cableId, input) };
}
describe('atomic cable endpoint pair saves using synthetic SQL', () => {
  it('saves only changed From with a saved To under explicit null policies, with blocked impact and no calculation or fill authority', async () => {
    const f = await pairFixture(['from']), toBefore = await f.read(f.cableId, 'to'), savedTo = await f.save(f.command(toBefore), f.cableId, 'to');
    const originals = { from: await f.read(f.cableId, 'from'), to: await f.read(f.cableId, 'to') };
    f.pair.expectedContexts = { from: originals.from.contextSha256, to: originals.to.contextSha256 };
    f.pair.endpoints[0].command = { ...f.command(originals.from), schemaVersion: 'wfc.pf.cable-endpoint-command.v3', calculation: null, initialFill: null };
    f.queries.length = 0; mocks.barriers.mockRejectedValue(Error('Endpoint-only Save must not calculate or require routing barriers'));
    mocks.mandate.mockRejectedValue(Error('Endpoint-only Save must not create initial-fill authority'));
    const result = await f.savePair();
    expect(result.expectedContexts).toEqual(f.pair.expectedContexts); expect(result.receipts).toHaveLength(1); expect(result.receipts[0].end).toBe('from');
    expect(result.receipts[0].expectedContextSha256).toBe(originals.from.contextSha256);
    expect(result.receipts[0].expectedCableWriteRevision).toBe(originals.from.cableWriteRevision);
    expect(result.receipts[0].locationImpact?.status).toBe('blocked'); expect(result.receipts[0].initialFillMandate).toBeUndefined();
    expect(mocks.append).toHaveBeenCalledExactlyOnceWith(expect.any(Object), expect.objectContaining({ calculation: null,
      commandSha256: endpointBindingHash(f.pair.endpoints[0].command) }), expect.any(Function));
    expect(mocks.barriers).not.toHaveBeenCalled(); expect(mocks.mandate).not.toHaveBeenCalled();
    expect(f.state.bindings.size).toBe(2); expect(f.queries.filter(sql => sql === 'BEGIN')).toHaveLength(1); expect(f.queries.filter(sql => sql === 'COMMIT')).toHaveLength(1);
    expect(f.queries.join('\n')).not.toMatch(/UPDATE cables|INSERT INTO pf_jobs|INSERT INTO pf_reviews|pf_initial_fill_mandates|pf_recalculation_dirty/);
    expect((await f.read(f.cableId, 'to')).head?.id).toBe(savedTo.binding.binding.id);
    expect((await f.savePair()).duplicate).toBe(true); expect(mocks.append).toHaveBeenCalledOnce(); expect(mocks.mandate).not.toHaveBeenCalled();
  });
  it('retains untouched To CAS checks for a null/null changed-From Save before any binding or impact write', async () => {
    const f = await pairFixture(['from']); f.pair.endpoints[0].command.calculation = null; f.pair.endpoints[0].command.initialFill = null;
    f.state.cables[0].to_location = 'Changed outside the endpoint-only editor';
    await expect(f.savePair()).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_CONTEXT_CHANGED' });
    expect(f.state.bindings.size).toBe(0); expect(f.state.locations.size).toBe(0); expect(f.state.commands.size).toBe(0);
    expect(mocks.append).not.toHaveBeenCalled(); expect(mocks.mandate).not.toHaveBeenCalled(); expect(mocks.barriers).not.toHaveBeenCalled();
  });
  it('checks the identical pair barrier intent once before either binding write',async()=>{
    const f=await pairFixture();mocks.barriers.mockImplementation(async()=>{expect(f.state.bindings.size).toBe(0);expect(f.state.locations.size).toBe(0);return{};});
    await f.savePair();expect(mocks.barriers).toHaveBeenCalledOnce();expect(f.state.bindings.size).toBe(2);
  });
  it('refuses a fresh pair with missing calculation intent without writing either head or queuing work',async()=>{
    const f=await pairFixture();for(const endpoint of f.pair.endpoints)delete endpoint.command.calculation!.preferences.barrierRouting;
    await expect(f.savePair()).rejects.toMatchObject({code:'BARRIER_ROUTING_INTENT_REQUIRED'});
    expect(f.state.bindings.size).toBe(0);expect(f.state.locations.size).toBe(0);expect(f.state.commands.size).toBe(0);expect(mocks.append).not.toHaveBeenCalled();
    expect((await f.closePair()).status).toBe('closed');expect(mocks.barriers).not.toHaveBeenCalled();
  });
  it('refuses the entire pair when current barrier publication cannot be verified',async()=>{
    const f=await pairFixture();mocks.barriers.mockRejectedValue(Object.assign(Error('Changed barrier publication'),{code:'BARRIER_CALCULATION_SCOPE_CHANGED'}));
    await expect(f.savePair()).rejects.toMatchObject({code:'BARRIER_CALCULATION_SCOPE_CHANGED'});
    expect(f.state.bindings.size).toBe(0);expect(f.state.locations.size).toBe(0);expect(f.state.commands.size).toBe(0);expect(mocks.append).not.toHaveBeenCalled();
  });
  it('commits both heads before either impact/mandate and stores the original pair and child receipts atomically', async () => {
    const f = await pairFixture(); f.queries.length = 0;
    mocks.append.mockImplementation(async (_client, input) => { expect(f.state.heads.size).toBe(2); return { id: input.idempotencyKey, status: 'pending', eligibleCables: 2, excludedMvCables: 0, blockedCategoryCables: 0 }; });
    const result = await f.savePair(); expect(result.receipts.map(receipt => receipt.end)).toEqual(['from', 'to']); expect(result.finalRegistryRevision).toBe('6');
    expect(result.commandSha256).toBe(endpointBindingHash(f.pair)); expect(result.expectedContexts).toEqual(f.pair.expectedContexts);
    expect(f.queries.filter(sql => sql === 'BEGIN')).toHaveLength(1); expect(f.queries.filter(sql => sql === 'COMMIT')).toHaveLength(1);
    expect(f.state.bindings.size).toBe(2); expect(f.state.commands.size).toBe(3); expect(mocks.append).toHaveBeenCalledTimes(2); expect(mocks.mandate).toHaveBeenCalledTimes(2);
    expect(f.queries.join('\n')).not.toMatch(/UPDATE cables|INSERT INTO pf_jobs/);
  });
  it('freezes the untouched opposite endpoint even when saving only From', async () => {
    const f = await pairFixture(['from']); f.state.cables[0].to_location = 'Changed outside the editor';
    await expect(f.savePair()).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_CONTEXT_CHANGED' }); expect(f.state.bindings.size).toBe(0); expect(mocks.append).not.toHaveBeenCalled();
  });
  it('checks second endpoint evidence before writing the first head', async () => {
    const f = await pairFixture(); f.pair.endpoints[1].command.selection = { mode: 'object-derived', sdkObjectId: 345, object: f.ref };
    mocks.selection.mockResolvedValue({ status: 'unavailable', object: null });
    await expect(f.savePair()).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_SELECTION_CHANGED' }); expect(f.state.locations.size).toBe(0); expect(f.state.registry).toBe('4');
  });
  it('rolls the first head back when the second binding fails; the same body remains safe to retry', async () => {
    const f = await pairFixture(), original = f.query.getMockImplementation()!; let writes = 0;
    f.query.mockImplementation(async (sql, args = []) => { if (sql.startsWith('INSERT INTO pf_endpoint_binding_revisions') && ++writes === 2) throw Error('synthetic second head failure'); return original(sql, args); });
    await expect(f.savePair()).rejects.toThrow('synthetic second head failure'); expect(f.state.locations.size).toBe(0); expect(f.state.bindings.size).toBe(0); expect(f.state.commands.size).toBe(0); expect(f.state.registry).toBe('4');
    expect(mocks.append).not.toHaveBeenCalled(); expect((await f.savePair()).duplicate).toBe(false);
  });
  it('rolls both heads and child receipts back when the second mandate fails', async () => {
    const f = await pairFixture(); mocks.mandate.mockResolvedValueOnce({ id: id(990), impactId: id(900), contentSha256: 'a'.repeat(64), mode: 'when-both-empty' }).mockRejectedValueOnce(Error('synthetic second mandate failure'));
    await expect(f.savePair()).rejects.toThrow('synthetic second mandate failure'); expect(f.state.bindings.size).toBe(0); expect(f.state.locations.size).toBe(0); expect(f.state.commands.size).toBe(0); expect(f.state.registry).toBe('4');
  });
  it('replays the whole immutable pair before model/cable/current context checks without new impacts', async () => {
    const f = await pairFixture(), result = await f.savePair(); f.state.prepared = false; f.settings.cableRevision = '20'; f.state.cables[0].from_location = 'Moved';
    expect(await f.savePair()).toEqual({ ...result, duplicate: true }); expect((await f.closePair()).status).toBe('saved');
    expect(mocks.append).toHaveBeenCalledTimes(2); expect(f.state.bindings.size).toBe(2);
    const changed = structuredClone(f.pair); changed.endpoints[1].command.reason = 'A different body'; await expect(f.savePair(changed)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_IDEMPOTENCY_CONFLICT' });
  });
  it('reserves child keys so independent later legacy retries can only recover already committed pair results', async () => {
    const f = await pairFixture(), result = await f.savePair(), child = f.pair.endpoints[0];
    expect(await f.save(child.command, f.cableId, child.end)).toEqual({ ...result.receipts[0], duplicate: true }); expect(f.state.bindings.size).toBe(2); expect(mocks.append).toHaveBeenCalledTimes(2);
  });
  it('refuses to adopt a child already saved independently as an atomic pair', async () => {
    const f = await pairFixture(), child = f.pair.endpoints[0]; await f.save(child.command, f.cableId, child.end);
    await expect(f.savePair()).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_PAIR_CHILD_ALREADY_USED' }); expect(f.state.bindings.size).toBe(1); expect(f.state.commands.size).toBe(1);
  });
  it('closes pair and child keys together after stale context, and all delayed PUTs remain refused', async () => {
    const f = await pairFixture(); f.state.prepared = false; f.state.cables[0].from_location = 'Changed';
    const closed = await f.closePair(); expect(closed.status).toBe('closed'); expect(await f.closePair()).toEqual(closed);
    await expect(f.savePair()).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_COMMAND_CLOSED' });
    for (const child of f.pair.endpoints) await expect(f.save(child.command, f.cableId, child.end)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_COMMAND_CLOSED' });
    expect(f.state.commands.size).toBe(3); expect(f.state.bindings.size).toBe(0); expect(mocks.append).not.toHaveBeenCalled();
  });
  it.each(['admin', 'login', 'expiry', 'abort'] as const)('does not save either head when current %s authority is lost', async kind => {
    const f = await pairFixture(), abort = new AbortController(); if (kind === 'admin') f.state.admin = false; if (kind === 'login') f.state.revoked = true;
    if (kind === 'expiry') f.who.loginExpiresAt = Date.now() - 1; if (kind === 'abort') abort.abort();
    await expect(f.savePair(f.pair, abort.signal)).rejects.toBeDefined(); expect(f.state.bindings.size).toBe(0); expect(f.state.commands.size).toBe(0);
  });
  it('deduplicates identical drafts for the same shared logical location while binding each exact child mandate', async () => {
    const f = await pairFixture(); f.state.cables[0].to_location = 'equipment';
    const to = await f.read(f.cableId, 'to'); f.pair.expectedContexts.to = to.contextSha256;
    f.pair.endpoints[1].command = { ...f.pair.endpoints[1].command, expectedLogicalName: to.logicalName!, expectedContextSha256: to.contextSha256 };
    const result = await f.savePair(); expect(f.state.bindings.size).toBe(1); expect(f.state.registry).toBe('5');
    expect(result.receipts[0].binding.binding.id).toBe(result.receipts[1].binding.binding.id); expect(mocks.mandate).toHaveBeenCalledTimes(2);
    expect(mocks.mandate.mock.calls.map(call => call[1].commandSha256)).toEqual(f.pair.endpoints.map(child => endpointBindingHash(child.command)));
  });
  it('refuses different drafts for the same shared location instead of silently choosing one side', async () => {
    const f = await pairFixture(); f.state.cables[0].to_location = 'equipment'; const to = await f.read(f.cableId, 'to');
    f.pair.expectedContexts.to = to.contextSha256; f.pair.endpoints[1].command = { ...f.pair.endpoints[1].command, expectedLogicalName: to.logicalName!, expectedContextSha256: to.contextSha256,
      selection: { mode: 'fixed-world', pointProjectMetres: [9, 8, 7], derivation: 'manual-world-point', displaySdkObjectId: null } };
    await expect(f.savePair()).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_PAIR_LOCATION_CONFLICT' }); expect(f.state.bindings.size).toBe(0);
  });
  it('keeps a UUID-shaped new logical name distinct from an existing location id and handles a historical no-op first binding', async () => {
    const f = await pairFixture(), numericLocationId = '10000000-0000-4000-8000-000000000001';
    await endpointBindingTransaction(f.pool, f.projectId, f.who, client => confirmEndpointBindingChangeInTransaction(client, f.projectId, f.who, numericLocationId, f.legacyCommand()));
    f.state.cables[0].to_location = numericLocationId;
    const from = await f.read(), to = await f.read(f.cableId, 'to');
    f.pair.expectedContexts = { from: from.contextSha256, to: to.contextSha256 };
    f.pair.endpoints = ([['from', from], ['to', to]] as const).map(([end, c]) => ({ end, command: { ...f.command(c), schemaVersion: 'wfc.pf.cable-endpoint-command.v3',
      calculation: f.pair.endpoints[0].command.calculation, initialFill: f.pair.endpoints[0].command.initialFill,
      selection: { mode: 'fixed-world', pointProjectMetres: end === 'from' ? [2, 3, 4] : [9, 8, 7], derivation: 'manual-world-point', displaySdkObjectId: null } } }));
    const receipt = await f.savePair(); expect(receipt.receipts[0].locationId).toBe(numericLocationId); expect(receipt.receipts[1].locationId).not.toBe(numericLocationId);
    expect(receipt.receipts[0].binding.duplicate).toBe(true); expect(receipt.finalRegistryRevision).toBe('6'); expect(f.state.locations.size).toBe(2); expect(f.state.bindings.size).toBe(2);
  });
  it('deduplicates different From/To aliases of one existing location without renaming or rewriting its historical no-op head', async () => {
    const f = await pairFixture();
    await endpointBindingTransaction(f.pool, f.projectId, f.who, client => confirmEndpointBindingChangeInTransaction(client, f.projectId, f.who, f.locationId, f.legacyCommand()));
    const from = await f.read(), to = await f.read(f.cableId, 'to'); f.pair.expectedContexts = { from: from.contextSha256, to: to.contextSha256 };
    f.pair.endpoints = ([['from', from], ['to', to]] as const).map(([end, c]) => ({ end, command: { ...f.command(c), schemaVersion: 'wfc.pf.cable-endpoint-command.v3',
      calculation: f.pair.endpoints[0].command.calculation, initialFill: f.pair.endpoints[0].command.initialFill } }));
    const receipt = await f.savePair(); expect(receipt.receipts.map(item => item.logicalName)).toEqual(['EQUIPMENT', 'Alias']);
    expect(receipt.receipts.every(item => item.locationId === f.locationId && item.binding.duplicate)).toBe(true);
    expect(f.state.locations.get(f.locationId)?.name).toBe('Equipment'); expect(f.state.registry).toBe('5'); expect(f.state.bindings.size).toBe(1);
  });
  it('retains conclusive committed pair evidence through a lost acknowledgement', async () => {
    const f = await pairFixture(), original = f.query.getMockImplementation()!; let once = true;
    f.query.mockImplementation(async (sql, args = []) => { const result = await original(sql, args); if (sql === 'COMMIT' && once) { once = false; throw Error('synthetic lost commit reply'); } return result; });
    await expect(f.savePair()).rejects.toMatchObject({ code: 'ENDPOINT_COMMIT_OUTCOME_UNKNOWN' }); expect(f.state.bindings.size).toBe(2);
    expect((await f.savePair()).duplicate).toBe(true); expect(mocks.append).toHaveBeenCalledTimes(2);
  });
});

describe('automatic endpoint context is a verified unconfirmed suggestion', () => {
  it('recovers an explicitly assigned fixed-world parent across a different cable/end without a new Save or source object', async () => {
    const f = fixture(), input = f.command(await f.read());
    input.selection = { mode: 'fixed-world', pointProjectMetres: [2, 3, 4], derivation: 'manual-world-point', displaySdkObjectId: 900, displayObjectName: '/Selected parent' };
    await f.save(input); const before = f.state.commands.size, c = await f.read(id(11), 'to');
    expect(c.head?.sourceObject).toBe(null); expect(c.confirmedSelection).toBe(null);
    expect(c.confirmedDisplaySelection).toMatchObject({ sdkObjectId: 900, name: '/Selected parent', bindingId: c.head?.id, pointProjectMetres: [2, 3, 4] });
    expect(c.contextSha256).toBe(endpointBindingHash(cableEndpointContextHashInput(c))); expect(f.state.commands.size).toBe(before);
    f.state.selectedRevision = '2'; expect((await f.read(id(11), 'to')).confirmedDisplaySelection).toBe(null);
  });
  it('a later explicit fixed point without an object clears a previous display hint', async () => {
    const f = fixture(), input = f.command(await f.read());
    input.selection = { mode: 'fixed-world', pointProjectMetres: [2, 3, 4], derivation: 'manual-world-point', displaySdkObjectId: 900 };
    const saved = await f.save(input); expect((await f.read()).confirmedDisplaySelection?.sdkObjectId).toBe(900);
    await f.save(f.command(await f.read())); const c = await f.read();
    expect(c.head?.id).toBe(saved.binding.binding.id); expect(c.confirmedDisplaySelection).toBe(null);
  });
  it('offers only a unique v3-visible retained object without creating a location/head or write authority', async () => {
    const f = fixture(), objectId = f.object.identity.objectId;
    mocks.automatic.mockResolvedValue({ status: 'automatic-ready', candidateObjectIds: [objectId], objectId, point: f.object.geometry.equipmentAnchor!.pointMetres });
    const c = await f.read(); expect(c.automaticSelection).toEqual({ source: 'automatic-unconfirmed', sdkObjectId: Number(objectId.slice(5)), name: f.object.historicalModel.name,
      object: f.ref, pointProjectMetres: f.object.geometry.equipmentAnchor!.pointMetres, approximate: true, confirmed: false });
    expect(c.contextSha256).toBe(endpointBindingHash(cableEndpointContextHashInput(c))); expect(f.state.bindings.size).toBe(0); expect(f.state.locations.size).toBe(0);
  });
  it.each(['missing', 'ambiguous', 'object-unverified', 'preparation-required'])('does not manufacture an automatic draft for %s', async status => {
    const f = fixture(); mocks.automatic.mockResolvedValue({ status, candidateObjectIds: [], objectId: null, point: null }); expect((await f.read()).automaticSelection).toBe(null);
  });
  it('keeps a confirmed shared head instead of replacing it with an automatic candidate', async () => {
    const f = fixture(); await f.save(f.command(await f.read())); mocks.automatic.mockClear();
    expect((await f.read()).head?.status).toBe('confirmed'); expect((await f.read()).automaticSelection).toBe(null); expect(mocks.automatic).not.toHaveBeenCalled();
  });
  it('retains the verified model name and exact source after a confirmed object-derived save and reload', async () => {
    const f = fixture(), input = f.command(await f.read()); input.selection = { mode: 'object-derived', sdkObjectId: 345, object: f.ref };
    await f.save(input); const c = await f.read();
    expect(c.automaticSelection).toBe(null); expect(c.confirmedSelection).toEqual({ source: 'confirmed', confirmed: true, approximate: true,
      sdkObjectId: f.object.identity.dbId, name: f.object.historicalModel.name, object: f.ref, pointProjectMetres: f.object.geometry.equipmentAnchor!.pointMetres });
    expect(f.state.bindings.size).toBe(1); expect(c.contextSha256).toBe(endpointBindingHash(cableEndpointContextHashInput(c)));
    f.state.prepared = false; expect((await f.read()).confirmedSelection).toBe(null);
  });
});
