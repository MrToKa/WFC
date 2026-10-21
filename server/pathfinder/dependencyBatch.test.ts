// @vitest-environment node
import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endpointBindingSchema, type EndpointBinding } from '../../shared/pathfinderEndpointBindings.js';
import { ENGINE_IDENTITY_POLICY_VERSIONS, ENGINE_IDENTITY_VERSION, engineIdentityCanonicalBody, type EngineIdentity } from '../../shared/pathfinderEngineIdentity.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { collectDependencyBatchInTransaction } from './dependencyBatch.js';
import { canonicalJson, collectDependencies, collectDependenciesForVersion, hash } from './dependencies.js';
import { defaultOptions } from './jobContracts.js';
import { BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS, type BarrierEngineIdentity } from '../../shared/pathfinderEngineIdentity.js';
import { BARRIER_RUNTIME_PROFILE, createBarrierRuntimePolicy, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';

const mocked = vi.hoisted(() => ({ active: vi.fn(), artifact: vi.fn(), context: vi.fn(), routing: vi.fn(), comparison: vi.fn(), identity: vi.fn(), barrierIdentity: vi.fn(), barriers: vi.fn(), needed: vi.fn(), automatic: vi.fn() }));
vi.mock('./automaticEndpointCandidates.js', () => ({ readAutomaticEndpointCandidates: mocked.automatic }));
vi.mock('./repository.js', () => ({ activeModel: mocked.active, latestArtifact: mocked.artifact }));
vi.mock('./routingScope.js', () => ({ requirePreparedRoutingScope: mocked.routing }));
vi.mock('./revisionComparisonRepository.js', () => ({ readComparisonDependency: mocked.comparison }));
vi.mock('./calculationEngineIdentity.js', () => ({ calculationEngineIdentity: mocked.identity,barrierCalculationEngineIdentity:mocked.barrierIdentity }));
vi.mock('./barrierCalculationScope.js',()=>({collectBarrierCalculationScope:mocked.barriers}));
vi.mock('./endpointBindingRepository.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./endpointBindingRepository.js')>();
  return { ...actual, readCurrentEndpointBindingContext: mocked.context, readNeededEndpointBindingHeads: mocked.needed };
});

const id = (n: number) => `eb000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const projectId = id(1), modelId = id(2), artifactId = id(3), aggregateId = id(4), frameId = id(5), locationA = id(6), locationB = id(7), actorId = id(8);
const NOW = 1_800_000_000_000;
type Cable = { id: string; from_location: string | null; to_location: string | null; mto: string | null; cable_type_id: string; cable_write_revision: string; input_oversize: boolean };
type Head = { location_id: string; location_revision: string; binding_id: string; binding_revision: string; record_sha256: string; record: EndpointBinding };

function identity(): EngineIdentity {
  const body = { schemaVersion: 'wfc.pf.engine-identity.v1' as const, version: ENGINE_IDENTITY_VERSION, runnerSha256: '1'.repeat(64), modelModuleSha256: '2'.repeat(64), coreModuleSha256: '3'.repeat(64), adapterModuleSha256: '4'.repeat(64), derivationSha256: '5'.repeat(64), policyVersions: { ...ENGINE_IDENTITY_POLICY_VERSIONS } };
  // hash(string) canonicalizes the string, so digest the validated body object directly.
  return { ...body, contentSha256: hash(JSON.parse(engineIdentityCanonicalBody(body))) };
}
function barrierIdentity():BarrierEngineIdentity {
  const {contentSha256:_old,...base}=identity();const body={...base,schemaVersion:'wfc.pf.engine-identity.v2' as const,barriersModuleSha256:'8'.repeat(64),barrierVerifierModuleSha256:'9'.repeat(64),policyVersions:{...BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS}};
  return {...body,contentSha256:hash(body)};
}
function barrierRuntime():BarrierRuntimeContext {
  const policy=createBarrierRuntimePolicy(true);
  return{schemaVersion:'wfc.pf.barrier-runtime.v1',binding:{scope:{projectId,modelVersionId:modelId,selectionRevision:'1',contentFingerprint:'c'.repeat(64),captureFrameId:frameId,captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres'},registryRevision:'0',snapshot:null,policy,policySha256:hash(policy)},profile:structuredClone(BARRIER_RUNTIME_PROFILE),profileSha256:hash(BARRIER_RUNTIME_PROFILE),storage:null};
}
function barrierOptions(){const runtime=barrierRuntime();return{...defaultOptions,barrierRouting:{schemaVersion:'wfc.pf.barrier-admission-intent.v1' as const,scope:runtime.binding.scope,expectedRegistryRevision:'0',expectedSnapshot:null,drillThroughWalls:true}};}
function binding(locationId: string, n: number): EndpointBinding {
  const body = {
    schemaVersion: 'wfc.pf.endpoint-binding.v1' as const, id: id(n), projectId, locationId, locationRevision: '1', bindingRevision: '1', locationRegistryRevision: '9',
    modelVersionId: modelId, aggregateId, artifactId, projectionSha256: 'd'.repeat(64), captureFrameId: frameId, qualifiedProjectFrameId: null,
    status: 'confirmed' as const, mode: 'fixed-world' as const, pointProjectMetres: [1, 2, 3] as [number, number, number], derivation: 'manual-world-point' as const,
    sourceObject: null, attachment: null, sourceDecisionId: null, supersedesBindingId: null, legacyObservationId: null,
    priorPointProjectMetres: null, priorCaptureFrameId: null, displacementBasis: 'none' as const, displacementVectorMetres: null, displacementMetres: null,
    confirmedBy: actorId, confirmedAt: '2026-01-01T00:00:00.000Z', reason: 'Synthetic bulk input fixture.',
  };
  return endpointBindingSchema.parse({ ...body, contentSha256: hash(body) });
}
const context = () => ({ modelVersionId: modelId, selectionRevision: '1', contentFingerprint: 'c'.repeat(64), aggregateId, artifactId, projectionSha256: 'd'.repeat(64), captureFrameId: frameId, geometryRevision: '2', traceId: null });
function fixture(count = 1) {
  const cables: Cable[] = Array.from({ length: count }, (_, n) => ({ id: id(1000 + n), from_location: '  =a-01 ', to_location: '=B.02', mto: 'Instrumentation', cable_type_id: id(20), cable_write_revision: '4', input_oversize: false }));
  const aliasRows = [{ normalized_alias: '=A-01', location_id: locationA }, { normalized_alias: '=B.02', location_id: locationB }];
  const heads: Head[] = [binding(locationA, 16), binding(locationB, 17)].map(b => ({ location_id: b.locationId, location_revision: b.locationRevision, binding_id: b.id, binding_revision: b.bindingRevision, record_sha256: b.contentSha256, record: b }));
  const state = { cables, aliasRows, heads, registry: '9', inputChunk: 0, omitChunk: 0, extraAlias: false, onQuery: (_sql: string) => undefined as void };
  const query = vi.fn(async (sql: string, args: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> => {
    state.onQuery(sql);
    if (sql.startsWith('SELECT id FROM cables')) { const requested = args[1] as string[] | undefined; return { rows: state.cables.filter(c => !requested || requested.includes(c.id)).map(c => ({ id: c.id })).sort((a, b) => a.id.localeCompare(b.id)) }; }
    if (sql.includes('CASE WHEN octet_length(from_location)')) { state.inputChunk++; const selected = args[1] as string[]; const found = state.cables.filter(c => selected.includes(c.id)).sort((a, b) => a.id.localeCompare(b.id)); return { rows: state.omitChunk === state.inputChunk ? found.slice(0, -1) : found }; }
    if (sql.includes('routing,design_length,install_length')) { const cable = state.cables.find(c => c.id === args[1]); return { rows: cable ? [{ ...cable, routing: '/OLD', design_length: 23, install_length: 24 }] : [] }; }
    if (sql.startsWith('SELECT active_model_version_id')) return { rows: [{ active_model_version_id: modelId, selection_revision: '1' }] };
    if (sql.startsWith('SELECT state,health,content_fingerprint')) return { rows: [{ state: 'ready', health: 'healthy', content_fingerprint: 'c'.repeat(64) }] };
    if (sql.startsWith('SELECT id FROM pf_artifacts')) return { rows: [{ id: artifactId }] };
    if (sql.startsWith('SELECT connection_gap::text')) return { rows: [{ connection_gap: '1', secondary_tray_length: '7', end_connection_length: '5', additional_bending_percent: '10', pf_settings_revision: '2' }] };
    if (sql.startsWith('SELECT registry_revision::text')) return { rows: [{ registry_revision: state.registry }] };
    if (sql.startsWith('SELECT a.normalized_alias')) { const selected = args[1] as string[]; return { rows: state.aliasRows.filter(r => selected.includes(r.normalized_alias)).concat(state.extraAlias ? [{ normalized_alias: '=FOREIGN', location_id: id(99) }] : []) }; }
    if (sql.startsWith('SELECT l.id FROM pf_location_aliases')) return { rows: state.aliasRows.filter(r => r.normalized_alias === args[1]).map(r => ({ id: r.location_id })) };
    if (sql.startsWith('SELECT h.location_id')) { const selected = args[1] as string[]; return { rows: state.heads.filter(r => selected.includes(r.location_id)) }; }
    if (sql.startsWith('SELECT h.binding_id')) return { rows: state.heads.filter(r => r.location_id === args[1]) };
    if (sql.startsWith('SELECT revision::text FROM pf_locations')) return { rows: state.heads.filter(r => r.location_id === args[1]).map(r => ({ revision: r.location_revision })) };
    throw Error('Unexpected SQL in synthetic dependency batch fixture: ' + sql.slice(0, 80));
  });
  return { state, query, client: { query } as unknown as PoolClient };
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(NOW);
  // restoreAllMocks resets this forwarding mock after every test. Reinstall the
  // real reader per test, so later cases still exercise its proof and limits.
  const actual = await vi.importActual<typeof import('./endpointBindingRepository.js')>('./endpointBindingRepository.js');
  mocked.needed.mockImplementation(actual.readNeededEndpointBindingHeads);
  mocked.active.mockResolvedValue({ active_model_version_id: modelId, selection_revision: '1', state: 'ready', health: 'healthy', content_fingerprint: 'c'.repeat(64) });
  mocked.artifact.mockResolvedValue({ id: artifactId, content_fingerprint: 'c'.repeat(64), snapshot_sha256: 'd'.repeat(64) }); mocked.context.mockResolvedValue(context());
  mocked.routing.mockResolvedValue({ catalogRevision: '1', routingContentSha256: 'e'.repeat(64), routingPolicyRevision: '1', routingPolicySha256: 'f'.repeat(64) });
  mocked.comparison.mockResolvedValue({ applicability: 'not-required', readiness: 'not-required', scope: null, reasonCodes: [], reviewStatus: 'not-applicable' }); mocked.identity.mockResolvedValue(identity());
  mocked.automatic.mockResolvedValue(new Map());
  mocked.barrierIdentity.mockResolvedValue(barrierIdentity());mocked.barriers.mockResolvedValue(barrierRuntime());
});
afterEach(() => vi.restoreAllMocks());

describe('bulk dependency collection, mocked SQL protocol with real freeze/head/alias logic', () => {
  it('collects v8 runtime once for a whole batch and equals the exact single-cable body',async()=>{
    const db=fixture(20),options=barrierOptions();
    const batch=await collectDependencyBatchInTransaction(db.client,{projectId,options,dependencyVersion:'pathfinder.dependencies.v8'});
    expect(mocked.barriers).toHaveBeenCalledTimes(1);expect(mocked.barrierIdentity).toHaveBeenCalledTimes(1);expect(mocked.identity).not.toHaveBeenCalled();
    const single=await collectDependenciesForVersion(db.client,projectId,db.state.cables[0].id,options,'pathfinder.dependencies.v8',true);
    expect(batch.items[0].dependencies).toEqual(single.dependencies);expect(batch.items.every(item=>item.dependencies?.schemaVersion==='pathfinder.dependencies.v8')).toBe(true);
    expect(batch.registryRevision).toBe('9');expect(batch.items[0].dependencies).not.toHaveProperty('registryRevision');
  });
  it('refuses protected options without explicit v8 and v8 without a strict intent before reading cables',async()=>{
    const db=fixture();
    await expect(collectDependencyBatchInTransaction(db.client,{projectId,options:barrierOptions()})).rejects.toMatchObject({code:'BARRIER_ADMISSION_REQUIRED'});
    await expect(collectDependencyBatchInTransaction(db.client,{projectId,options:defaultOptions,dependencyVersion:'pathfinder.dependencies.v8'})).rejects.toMatchObject({code:'BARRIER_ADMISSION_REQUIRED'});
    expect(db.query).not.toHaveBeenCalled();
  });
  it('does not fall back to runnable legacy items if common v8 storage is corrupt',async()=>{
    const db=fixture(20);mocked.barriers.mockRejectedValueOnce(Object.assign(new Error('Corrupt capture'),{code:'BARRIER_BLOB_INTEGRITY'}));
    await expect(collectDependencyBatchInTransaction(db.client,{projectId,options:barrierOptions(),dependencyVersion:'pathfinder.dependencies.v8'})).rejects.toMatchObject({code:'BARRIER_BLOB_INTEGRITY'});
  });
  it('refuses cross-version implementation injection instead of relabeling legacy identity',async()=>{
    const db=fixture();await expect(collectDependencyBatchInTransaction(db.client,{projectId,options:barrierOptions(),dependencyVersion:'pathfinder.dependencies.v8',engineIdentity:identity()})).rejects.toMatchObject({code:'BARRIER_ENGINE_IDENTITY_REQUIRED'});
    expect(mocked.barriers).not.toHaveBeenCalled();
  });
  it('admits explicit scoped batches with exact single-cable v7 parity while retaining registry as separate audit', async () => {
    const db=fixture(20),input={projectId,options:defaultOptions,dependencyVersion:'pathfinder.dependencies.v7' as const};
    const first=await collectDependencyBatchInTransaction(db.client,input),single=await collectDependenciesForVersion(db.client,projectId,db.state.cables[0].id,defaultOptions,'pathfinder.dependencies.v7',true);
    expect(first.items[0].dependencies).toEqual(single.dependencies);expect(first.items).toHaveLength(20);
    expect(first.items.every(item=>item.dependencies?.schemaVersion==='pathfinder.dependencies.v7'&&!Object.hasOwn(item.dependencies,'registryRevision'))).toBe(true);
    expect(first.registryRevision).toBe('9');db.state.registry='10';
    const after=await collectDependencyBatchInTransaction(db.client,input);
    expect(after.registryRevision).toBe('10');expect(after.items.map(item=>hash(item.dependencies))).toEqual(first.items.map(item=>hash(item.dependencies)));
    expect(after.items[0].dependencies?.cableInputs.mto).toBe('Instrumentation');
  });
  it('changes the v7 body for a relevant shared head while preserving exact aliases across both ends and20cables', async()=>{
    const db=fixture(20);db.state.aliasRows[1].location_id=locationA;
    const input={projectId,options:defaultOptions,dependencyVersion:'pathfinder.dependencies.v7' as const},first=await collectDependencyBatchInTransaction(db.client,input);
    const original=db.state.heads[0].record,{contentSha256:_hash,...body}={...original,id:id(900),bindingRevision:'2',pointProjectMetres:[9,8,7] as [number,number,number]},next={...body,contentSha256:hash(body)};
    db.state.heads[0]={...db.state.heads[0],binding_id:next.id,binding_revision:next.bindingRevision,record_sha256:next.contentSha256,record:next};db.state.registry='10';
    const after=await collectDependencyBatchInTransaction(db.client,input);
    expect(after.items.every((item,at)=>hash(item.dependencies)!==hash(first.items[at].dependencies))).toBe(true);
    expect(after.items[0].dependencies).toHaveProperty('endpointResolution',{schemaVersion:'pathfinder.endpoint-resolution.v1',matchingPolicy:'nfc-trim-uppercase-v1',
      from:{logicalKey:'=A-01',locationId:locationA},to:{logicalKey:'=B.02',locationId:locationA}});
    expect(after.items[0].dependencies?.from).toEqual(after.items[0].dependencies?.to);
  });
  it('matches single-cable v5 collection exactly while retaining Details gap and Instrumentation input', async () => {
    const db = fixture(), batch = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions });
    const single = await collectDependencies(db.client, projectId, db.state.cables[0].id, defaultOptions, true);
    expect(batch.items[0].dependencies).toEqual(single.dependencies); expect(batch.items[0].status).toBe(single.status);
    expect(batch.items[0].dependencies?.schemaVersion).toBe('pathfinder.dependencies.v5'); expect(batch.items[0].dependencies?.cableInputs.mto).toBe('Instrumentation');
    expect(batch.items[0].dependencies?.settings).toMatchObject({ connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' }); expect(batch.options.connectionToleranceMeters).toBe(1);
  });
  it('performs shared authority/input reads once for 501 cables, with exact250 input chunks and no endpoint N+1', async () => {
    const db = fixture(501), batch = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions });
    expect(batch.items).toHaveLength(501); for (const fn of [mocked.active, mocked.artifact, mocked.context, mocked.routing, mocked.comparison, mocked.identity, mocked.needed]) expect(fn).toHaveBeenCalledTimes(1);
    const reads = db.query.mock.calls.filter(call => call[0].includes('CASE WHEN octet_length(from_location)')); expect(reads.map(call => (call[1]![1] as string[]).length)).toEqual([250, 250, 1]);
    expect(db.query.mock.calls.filter(call => call[0].startsWith('SELECT a.normalized_alias'))).toHaveLength(1); expect(db.query.mock.calls.filter(call => call[0].startsWith('SELECT h.location_id'))).toHaveLength(1);
    expect(db.query.mock.calls.some(call => call[0].startsWith('SELECT h.binding_id'))).toBe(false); expect(mocked.identity).toHaveBeenCalledWith({ force: true });
    const aliases = db.state.aliasRows.map(r => ({ normalized_alias: r.normalized_alias, location_id: r.location_id })); expect(mocked.needed.mock.calls[0][1].initialBytes).toBe(aliases.reduce((n, r) => n + Buffer.byteLength(canonicalJson(r)), 0));
  });
  it('uses one supplied coherent implementation identity without reading binaries per cable', async () => {
    const db = fixture(5), implementation = identity();
    const batch = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions, engineIdentity: implementation });
    expect(mocked.identity).not.toHaveBeenCalled(); expect(batch.items.every(item => item.dependencies?.schemaVersion === 'pathfinder.dependencies.v5' && item.dependencies.engineIdentity.contentSha256 === implementation.contentSha256)).toBe(true);
  });
  it('locks complete membership before text/common inputs, preserves exact subset order, and rejects foreign members', async () => {
    const db = fixture(3), ids = [db.state.cables[2].id, db.state.cables[0].id, db.state.cables[2].id];
    const batch = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions, cableIds: ids });
    expect(batch.items.map(item => item.id)).toEqual([db.state.cables[0].id, db.state.cables[2].id]); expect(db.query.mock.calls[0][0]).toContain('LIMIT 10001 FOR UPDATE');
    await expect(collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions, cableIds: [id(999)] })).rejects.toMatchObject({ code: 'CABLE_NOT_FOUND' });
  });
  it.each(['missing', 'ambiguous', 'stale', 'blank', 'category'] as const)('marks %s input blocked without inventing origin points or silently omitting its cable', async kind => {
    const db = fixture();
    if (kind === 'missing') db.state.aliasRows = db.state.aliasRows.filter(r => r.location_id !== locationA);
    if (kind === 'ambiguous') db.state.aliasRows.push({ normalized_alias: '=A-01', location_id: id(99) });
    if (kind === 'stale') db.state.heads[0].location_revision = '9';
    if (kind === 'blank') db.state.cables[0].from_location = '  ';
    if (kind === 'category') db.state.cables[0].mto = 'Unknown';
    const result = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions });
    expect(result.items).toHaveLength(1); expect(result.items[0].dependencies).toBeNull(); expect(result.items[0].status).toBe(kind === 'category' ? 'category_required' : 'locations_required');
  });
  it('shares one confirmed binding across From/To aliases and every cable, and observes a changed head', async () => {
    const db = fixture(2); db.state.aliasRows[1].location_id = locationA;
    const first = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions }); expect(first.items[0].dependencies?.from).toEqual(first.items[0].dependencies?.to);
    const changed = { ...db.state.heads[0].record, id: id(900), bindingRevision: '2', pointProjectMetres: [9, 8, 7] as [number, number, number] }, { contentSha256: _old, ...body } = changed;
    const next = { ...body, contentSha256: hash(body) }; db.state.heads[0] = { ...db.state.heads[0], binding_id: next.id, binding_revision: next.bindingRevision, record_sha256: next.contentSha256, record: next };
    const second = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions }); expect(second.items.every(item => { const d = item.dependencies; return d?.schemaVersion === 'pathfinder.dependencies.v5' && d.from.bindingId === next.id && d.to.bindingId === next.id; })).toBe(true); expect(second.items[0].dependencies?.from).not.toEqual(first.items[0].dependencies?.from);
  });
  it('returns a complete blocked batch when common preparation/comparison is unavailable, with no alias/head reads', async () => {
    const db = fixture(3); mocked.comparison.mockResolvedValue({ applicability: 'required', readiness: 'pending', scope: null, reasonCodes: ['REVISION_COMPARISON_PENDING'], reviewStatus: 'unreviewed' });
    const batch = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions }); expect(batch.items).toHaveLength(3); expect(batch.items.every(item => item.status === 'comparison_required' && item.dependencies === null)).toBe(true); expect(mocked.needed).not.toHaveBeenCalled();
  });
  it('refuses missing chunk rows before any common read or partial return', async () => {
    const db = fixture(251); db.state.omitChunk = 2;
    await expect(collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions })).rejects.toMatchObject({ code: 'RECALCULATION_CABLE_INTEGRITY' }); expect(mocked.active).not.toHaveBeenCalled(); expect(mocked.identity).not.toHaveBeenCalled(); expect(mocked.needed).not.toHaveBeenCalled(); expect(db.query.mock.calls.every(call => call[0].startsWith('SELECT'))).toBe(true);
  });
  it('refuses an over-cap project or explicit scope without taking an arbitrary10k prefix', async () => {
    const db = fixture(10_001); await expect(collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions })).rejects.toMatchObject({ code: 'JOB_CABLE_BUDGET' }); expect(mocked.active).not.toHaveBeenCalled();
    const explicit = fixture(); await expect(collectDependencyBatchInTransaction(explicit.client, { projectId, options: defaultOptions, cableIds: Array.from({ length: 10_001 }, (_, n) => id(1000 + n)) })).rejects.toMatchObject({ code: 'JOB_CABLE_BUDGET' }); expect(explicit.query).not.toHaveBeenCalled();
  });
  it('refuses the SQL oversized-input flag before materializing common facts', async () => {
    const db = fixture(); db.state.cables[0].input_oversize = true;
    await expect(collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions })).rejects.toMatchObject({ code: 'RECALCULATION_INPUT_BYTES' }); expect(mocked.active).not.toHaveBeenCalled(); expect(db.query.mock.calls[1][0]).toContain('CASE WHEN octet_length(from_location)>4096 THEN NULL');
  });
  it('rejects alias rows outside the requested names instead of broadening scope', async () => {
    const db = fixture(); db.state.extraAlias = true;
    await expect(collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions })).rejects.toMatchObject({ code: 'RECALCULATION_ALIAS_INTEGRITY' }); expect(mocked.needed).not.toHaveBeenCalled();
  });
  it('enforces cumulative serialized dependency bytes even when bounded raw cable inputs fit', async () => {
    const db = fixture(6500), longName = '=' + 'A'.repeat(3799); db.state.cables.forEach(c => { c.from_location = longName; }); db.state.aliasRows[0].normalized_alias = longName;
    expect(db.state.cables.reduce((n, c) => n + Buffer.byteLength(canonicalJson(c)), 0)).toBeLessThan(RECALCULATION_LIMITS.dependencyBytes);
    await expect(collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions })).rejects.toMatchObject({ code: 'RECALCULATION_DEPENDENCY_BYTES' });
  }, 20_000);
  it('stops on a deadline/abort during collection without a partial batch or write', async () => {
    const db = fixture(251); db.state.onQuery = sql => { if (sql.includes('CASE WHEN octet_length')) vi.mocked(Date.now).mockReturnValue(NOW + 2); };
    await expect(collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions, deadline: NOW + 1 })).rejects.toMatchObject({ code: 'RECALCULATION_COLLECTION_DEADLINE' }); expect(mocked.active).not.toHaveBeenCalled();
    vi.mocked(Date.now).mockReturnValue(NOW); const controller = new AbortController(), aborted = fixture(251); aborted.state.onQuery = sql => { if (sql.includes('CASE WHEN octet_length')) controller.abort(); };
    await expect(collectDependencyBatchInTransaction(aborted.client, { projectId, options: defaultOptions, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(aborted.query.mock.calls.every(call => call[0].startsWith('SELECT'))).toBe(true);
  });
  it('collects automatic proposal anchors once for the needed unbound locations across the whole cable batch', async () => {
    const db = fixture(3); db.state.heads = []; mocked.context.mockResolvedValue({ ...context(), traceId: id(30) });
    const automatic = (locationId: string) => ({ kind: 'automatic-equipment-anchor', locationId, locationRevision: '1',
      point: [1, 2, 3], approximate: true, engineeringAccepted: false });
    mocked.automatic.mockResolvedValue(new Map([locationA, locationB].map(locationId => [locationId,
      { status: 'automatic-ready', candidateObjectIds: ['dbid:42'], point: automatic(locationId) }])));
    const batch = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions });
    expect(mocked.automatic).toHaveBeenCalledTimes(1);
    expect(mocked.automatic).toHaveBeenCalledWith(db.client, expect.objectContaining({ projectId,
      locationIds: [locationA, locationB], current: expect.objectContaining({ traceId: id(30) }) }));
    expect(batch.items.every(item => item.dependencies?.schemaVersion === 'pathfinder.dependencies.v6' &&
      item.dependencies.from === batch.items[0].dependencies?.from)).toBe(true);
    expect(batch.items[0].dependencies?.settings.connectionGap).toBe('1');
    expect(db.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });
  it('keeps confirmed manual heads first without asking automatic model candidates to replace them', async () => {
    const db = fixture(); mocked.context.mockResolvedValue({ ...context(), traceId: id(30) });
    const batch = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions });
    expect(batch.items[0].dependencies?.schemaVersion).toBe('pathfinder.dependencies.v5');
    expect(mocked.automatic).not.toHaveBeenCalled();
  });
  it('leaves stale saved heads unresolved instead of silently falling back to an equipment match', async () => {
    const db = fixture(); db.state.heads[0].location_revision = '2'; mocked.context.mockResolvedValue({ ...context(), traceId: id(30) });
    const batch = await collectDependencyBatchInTransaction(db.client, { projectId, options: defaultOptions });
    expect(batch.items[0]).toMatchObject({ status: 'locations_required', dependencies: null });
    expect(mocked.automatic).not.toHaveBeenCalled();
  });
});
