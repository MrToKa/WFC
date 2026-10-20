// @vitest-environment node
import type { Pool,PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace, geometryTraceHash,geometryTraceBytesHash,geometryTraceFrozenSchema } from './geometryTraceBuilder.js';
import { createGeometryTraceRepository, geometryTraceTransaction } from './geometryTraceRepository.js';
import { GEOMETRY_TRACE_DERIVATION } from '../../shared/pathfinderGeometryTrace.js';
import { initializeGeometryTraceSchema } from './geometryTraceSchema.js';
import {canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import type {GeometryTraceWorkerInput} from './geometryTraceWorker.js';
import type {GeometryTraceManifest} from '../../shared/pathfinderGeometryTrace.js';
import type {OperationPrincipal,GrantOperationPrincipal} from './operationAuthority.js';
const transport=vi.hoisted(()=>({read:vi.fn(),store:vi.fn(),worker:vi.fn(),allowance:vi.fn(),discard:vi.fn(),grant:vi.fn()}));
vi.mock('./preparationStorage.js',()=>({readPreparationBlob:transport.read,storePreparationBlob:transport.store,storePreparationBytes:vi.fn()}));
vi.mock('./geometryTraceWorker.js',()=>({runGeometryTraceWorker:transport.worker,runGeometryEvidenceWorker:vi.fn()}));
vi.mock('./geometryTraceStorage.js',()=>({withFittedExportAllowance:transport.allowance,discardAdoptedFittedExportReference:transport.discard}));
vi.mock('./calculationAuthority.js',async importOriginal=>({...await importOriginal<typeof import('./calculationAuthority.js')>(),grantTransaction:(...args:unknown[])=>transport.grant(...args)}));
const id = (n: number) => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
afterEach(() => {vi.useRealTimers();vi.clearAllMocks();});
function fixture() {
  const f = geometryTraceFixture(), built = buildGeometryTrace(f), who = { userId: f.createdBy, loginId: id(1), loginExpiresAt: Date.now() + 60000 }, command = { schemaVersion: 'wfc.pf.geometry-trace-create.v1', aggregateId: f.aggregate.id, expectedProjectionSha256: f.aggregate.projection.sha256, derivationVersion: GEOMETRY_TRACE_DERIVATION, idempotencyKey: id(2) };
  const state = { exists: true, admin: true, user: true, revoked: false, receipt: true, tamper: false, commitFails: false, rollbackFails: false, completeIntent: false, changedFingerprint: false };
  const queries: string[] = [], parameters: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> => { queries.push(sql); parameters.push(params);
    if (sql === 'COMMIT' && state.commitFails) throw Error('private socket/SQL detail');
    if (sql === 'ROLLBACK' && state.rollbackFails) throw Error('private rollback transport detail');
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SET LOCAL') || sql.startsWith('INSERT INTO viewer_login_bindings')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM projects')) return { rows: state.exists ? [{ id: f.aggregate.projectId }] : [] };
    if (sql.startsWith('SELECT is_admin')) return { rows: state.user ? [{ is_admin: state.admin }] : [] };
    if (sql.startsWith('SELECT user_id,expires_at')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: state.revoked ? new Date() : null }] };
    if (sql.startsWith('SELECT request_sha256')) return { rows: state.receipt ? [{ request_sha256: geometryTraceHash(command), request: command, receipt: { schemaVersion: 'wfc.pf.geometry-trace-receipt.v1', trace: built.manifest, duplicate: false } }] : [] };
    if (sql.includes('/* geometry-trace:aggregate */')) return { rows: [{ manifest: f.aggregate, plan: f.plan, snapshot_sha256: f.aggregate.projection.sha256, snapshot_bytes: String(f.aggregate.projection.bytes), model_version_id: f.aggregate.modelVersionId }] };
    if (sql.startsWith('SELECT id,input_sha256')) return { rows: state.completeIntent ? [{ id: f.traceId, input_sha256: geometryTraceHash({ aggregate: f.aggregate, derivationVersion: command.derivationVersion, fingerprint: f.runtimeFingerprint }), frozen: { traceId: f.traceId, exportId: f.fitted.exportId, fittedBlobId: f.fittedBlob.payloadRef, recordsBlobId: f.recordsBlobId, frozenBlobId: id(5), aggregate: f.aggregate, plan: f.plan, runtimeFingerprint: f.runtimeFingerprint, declaredLengths: f.declaredLengths, evidence: [], createdAt: f.createdAt, createdBy: f.createdBy }, state: 'complete', lease_token: id(4), lease_expires_at: new Date(0) }] : [] };
    if (sql.startsWith('INSERT INTO pf_geometry_trace_receipts')) return { rows: [] };
    if (sql.startsWith('SELECT manifest FROM pf_geometry_trace_sets')) return { rows: [{ manifest: built.manifest }] };
    if (sql.startsWith('SELECT t.manifest')) return { rows: [{ manifest: built.manifest }] };
    if (sql.startsWith('SELECT summary')) return { rows: built.summaries.map(summary => ({ summary })) };
    if (sql.startsWith('SELECT record,summary')) return { rows: [{ record: state.tamper ? { ...built.records[0], aggregateId: id(99) } : built.records[0], summary: built.summaries[0] }] };
    if (sql.startsWith('SELECT message')) return { rows: f.fitted.diagnostics.slice(0, Number(params[2])).map(message => ({ message })) };
    throw Error('Unexpected pure test query: ' + sql.slice(0, 60));
  });
  const release = vi.fn(), client = { query, release }, pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  const adapters = { getRuntimeFingerprint: vi.fn(async () => state.changedFingerprint ? { ...f.runtimeFingerprint, runnerSha256: 'f'.repeat(64) } : f.runtimeFingerprint), exportFittedTrace: vi.fn(async () => { throw Error('Unexpected export in readonly/replay controls'); }) };
  return { f, built, who, command, state, queries, parameters, query, release, client, pool, adapters, repo: createGeometryTraceRepository(pool, adapters) };
}
/** Mocked transaction model only; root separately proves database atomicity. */
function publicationFixture(){
  const f=geometryTraceFixture();f.fitted.diagnostics=['Synthetic publication diagnostic'];f.fitted.counts.diagnostics=1;
  const who={userId:f.createdBy,loginId:id(201),loginExpiresAt:Date.now()+60000},command={schemaVersion:'wfc.pf.geometry-trace-create.v1' as const,aggregateId:f.aggregate.id,expectedProjectionSha256:f.aggregate.projection.sha256,derivationVersion:GEOMETRY_TRACE_DERIVATION,idempotencyKey:id(202)};
  type Intent={id:string;input_sha256:string;frozen:unknown;state:string;lease_token:string;lease_expires_at:Date};
  type Receipt={request_sha256:string;request:unknown;receipt:unknown};
  const empty=()=>({intents:new Map<string,Intent>(),receipts:new Map<string,Receipt>(),traces:new Map<string,GeometryTraceManifest>(),dirty:[] as unknown[][],objects:0,diagnostics:0});
  let durable=empty(),working=empty(),transactionNumber=0;
  const controls={scope:{current_aggregate_id:f.aggregate.id,current_artifact_id:f.aggregate.artifactId,geometry_revision:f.aggregate.geometryRevision,active_model_version_id:f.aggregate.modelVersionId,selection_revision:f.aggregate.selectionRevision,content_fingerprint:f.aggregate.contentFingerprint,state:'ready',health:'healthy'} as Record<string,unknown>|null,scopeError:null as Error|null,dirtyError:null as Error|null,finalAdmin:true,finalRevoked:false,finalCommitUnknown:false,concurrentReceipt:false,leaseChanged:false,onDirty:()=>{},onWorker:()=>{}};
  const bytes=new Map<string,Buffer>(),queries:{sql:string;params:unknown[];transaction:number;client:unknown}[]=[],release=vi.fn((_discard?:boolean)=>undefined);
  let manifest:GeometryTraceManifest|undefined;
  const put=(payloadRef:string,value:unknown)=>{const valueBytes=Buffer.from(canonicalPurposeJson(value));bytes.set(payloadRef,valueBytes);return{payloadRef,sha256:geometryTraceBytesHash(valueBytes),bytes:valueBytes.length};};
  const query=vi.fn(async(sql:string,params:unknown[]=[]):Promise<{rows:Record<string,unknown>[]}>=>{
    queries.push({sql,params,transaction:transactionNumber,client});
    if(sql==='BEGIN'){transactionNumber++;working=structuredClone(durable);return{rows:[]};}
    if(sql==='COMMIT'){durable=structuredClone(working);if(transactionNumber===3&&controls.finalCommitUnknown){controls.finalCommitUnknown=false;throw Error('lost final commit acknowledgement');}return{rows:[]};}
    if(sql==='ROLLBACK'){working=structuredClone(durable);return{rows:[]};}
    if(sql.startsWith('SET LOCAL')||sql.startsWith('INSERT INTO viewer_login_bindings'))return{rows:[]};
    if(sql.startsWith('SELECT id FROM projects'))return{rows:[{id:f.aggregate.projectId}]};
    if(sql.startsWith('SELECT is_admin'))return{rows:[{is_admin:transactionNumber<3||controls.finalAdmin}]};
    if(sql.startsWith('SELECT user_id,expires_at'))return{rows:[{user_id:who.userId,expires_at:new Date(who.loginExpiresAt),revoked_at:transactionNumber>=3&&controls.finalRevoked?new Date():null}]};
    if(sql.startsWith('SELECT request_sha256')){const previous=working.receipts.get(String(params[2]));return{rows:previous?[previous]:[]};}
    if(sql.includes('/* geometry-trace:aggregate */'))return{rows:[{manifest:f.aggregate,plan:f.plan,snapshot_sha256:f.aggregate.projection.sha256,snapshot_bytes:String(f.aggregate.projection.bytes),model_version_id:f.aggregate.modelVersionId}]};
    if(sql.startsWith('SELECT id,input_sha256')){
      const values=sql.includes('aggregate_id=$2')?[...working.intents.values()]:[working.intents.get(String(params[1]))].filter((value):value is Intent=>Boolean(value));
      return{rows:values.map(value=>controls.leaseChanged&&transactionNumber>=3?{...value,lease_token:id(999)}:value)};
    }
    if(sql.startsWith('SELECT id::text,length_mm::text'))return{rows:f.declaredLengths.map(value=>({id:value.projectTrayId,value:value.valueMm,source_revision:value.sourceRevision}))};
    if(sql.startsWith('SELECT part_id,receipt'))return{rows:[]};
    if(sql.startsWith('INSERT INTO pf_geometry_trace_intents')){working.intents.set(String(params[0]),{id:String(params[0]),input_sha256:String(params[4]),frozen:params[5],state:'pending',lease_token:String(params[6]),lease_expires_at:params[7] as Date});return{rows:[]};}
    if(sql.startsWith('INSERT INTO pf_geometry_trace_sets')){working.traces.set(String(params[0]),params[5] as GeometryTraceManifest);return{rows:[]};}
    if(sql.startsWith('INSERT INTO pf_geometry_object_revisions')){working.objects+=(JSON.parse(String(params[2])) as unknown[]).length;return{rows:[]};}
    if(sql.startsWith('INSERT INTO pf_geometry_trace_diagnostics')){working.diagnostics+=(JSON.parse(String(params[2])) as unknown[]).length;return{rows:[]};}
    if(sql.startsWith('UPDATE pf_geometry_trace_intents SET state=')){working.intents.get(String(params[1]))!.state='complete';return{rows:[]};}
    if(sql.startsWith('INSERT INTO pf_geometry_trace_receipts')){working.receipts.set(String(params[2]),{request_sha256:String(params[3]),request:params[4],receipt:params[5]});return{rows:[]};}
    if(sql.includes('/* geometry-trace:ordinary-current */')){if(controls.scopeError)throw controls.scopeError;return{rows:controls.scope?[controls.scope]:[]};}
    if(sql==='SELECT pf_recalculation_dirty($1,$2,$3,$4)'){if(controls.dirtyError)throw controls.dirtyError;working.dirty.push(params);controls.onDirty();return{rows:[]};}
    if(sql.startsWith('SELECT manifest FROM pf_geometry_trace_sets')){const saved=working.traces.get(String(params[1]));return{rows:saved?[{manifest:saved}]:[]};}
    throw Error('Unexpected publication test query: '+sql);
  });
  const client={query,release},pool={connect:vi.fn(async()=>client)} as unknown as Pool;
  transport.store.mockImplementation(async(projectId:string,sessionId:string,payloadRef:string,value:unknown,limit:number)=>{expect([projectId,sessionId]).toEqual([f.aggregate.projectId,f.aggregate.sessionId]);const ref=put(payloadRef,value);expect(ref.bytes).toBeLessThanOrEqual(limit);return ref;});
  transport.read.mockImplementation(async(projectId:string,sessionId:string,ref:{payloadRef:string;sha256:string;bytes:number},limit:number)=>{expect([projectId,sessionId]).toEqual([f.aggregate.projectId,f.aggregate.sessionId]);const value=bytes.get(ref.payloadRef);if(!value||value.length!==ref.bytes||value.length>limit||geometryTraceBytesHash(value)!==ref.sha256)throw Error('test blob integrity');return Buffer.from(value);});
  transport.allowance.mockImplementation(async(_exportId:string,action:(existing:boolean)=>Promise<unknown>)=>action(false));transport.discard.mockResolvedValue(undefined);
  transport.worker.mockImplementation(async(input:GeometryTraceWorkerInput)=>{
    const frozen=geometryTraceFrozenSchema.parse(JSON.parse(bytes.get(input.frozenBlob.payloadRef)!.toString('utf8'))),fitted={...f.fitted,exportId:frozen.exportId},fittedBlob=put(frozen.fittedBlobId,fitted),built=buildGeometryTrace({...f,...frozen,fitted,fittedBlob});manifest=built.manifest;
    const records=put(frozen.recordsBlobId,built.records),index=put(id(280),built.records.map((record,order_index)=>({id:record.id,object_id:record.identity.objectId,order_index,project_tray_id:built.summaries[order_index].projectTrayId,summary:built.summaries[order_index],record}))),diagnostics=put(id(281),fitted.diagnostics.map((message,order_index)=>({order_index,message})));
    controls.onWorker();
    if(controls.concurrentReceipt){durable.traces.set(manifest.id,manifest);durable.receipts.set(command.idempotencyKey,{request_sha256:geometryTraceHash(command),request:command,receipt:{schemaVersion:'wfc.pf.geometry-trace-receipt.v1',trace:manifest,duplicate:false}});durable.intents.get(manifest.id)!.state='complete';}
    return{manifest:put(id(282),manifest),fittedTrace:fittedBlob,objectRecords:records,indexPages:[{...index,firstIndex:0,rowCount:built.records.length}],diagnosticPages:[{...diagnostics,firstIndex:0,rowCount:fitted.diagnostics.length}],objectCount:built.records.length,diagnosticCount:fitted.diagnostics.length,transientExport:{exportId:frozen.exportId}};
  });
  // This test double checks emitter ownership only. Real grant authority is
  // independently exercised by the existing grant suites and root fixture.
  transport.grant.mockImplementation(async(p:Pool,_authority:unknown,_operation:unknown,callback:(c:PoolClient)=>Promise<unknown>,signal?:AbortSignal)=>{const c=await p.connect();try{await c.query('BEGIN');signal?.throwIfAborted();const result=await callback(c);signal?.throwIfAborted();await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}});
  const adapters={getRuntimeFingerprint:vi.fn(async()=>f.runtimeFingerprint),exportFittedTrace:vi.fn(async(input:{exportId:string})=>({schemaVersion:'wfc.pf.fitted-trace-reference.v1' as const,exportId:input.exportId,sha256:'a'.repeat(64),bytes:32,counts:f.fitted.counts,engine:f.fitted.engine,rulesSha256:f.fitted.rulesSha256,snapshotSha256:f.fitted.snapshotSha256,preparedKey:f.fitted.preparedKey}))};
  const repo=createGeometryTraceRepository(pool,adapters),create=(principal:OperationPrincipal=who,raw:unknown=command,signal?:AbortSignal)=>repo.create(f.aggregate.projectId,principal,raw,signal);
  const grant:GrantOperationPrincipal={kind:'calculation-grant',userId:who.userId,authority:{kind:'calculation-grant',projectId:f.aggregate.projectId,grantId:id(290),grantRevision:'1',grantEpoch:'1',installationEpoch:id(291),issuerId:who.userId,issuerAdminRevision:'1',leaseId:id(292),ownerToken:'a'.repeat(64),leaseExpiresAt:new Date(Date.now()+60000).toISOString(),operation:'trace',modelVersionId:f.aggregate.modelVersionId,selectionRevision:f.aggregate.selectionRevision,contentFingerprint:f.aggregate.contentFingerprint}};
  return{f,who,command,controls,queries,query,client,pool,release,adapters,repo,create,grant,get durable(){return durable;},get manifest(){return manifest;}};
}

describe('current authority and immutable geometry trace repository', () => {
  it('holds project/user/login in established order and checks final expiry before COMMIT', async () => { const f = fixture(); await f.repo.authorize(f.f.aggregate.projectId, f.who); expect(f.queries.findIndex(q => q.startsWith('SELECT id FROM projects'))).toBeLessThan(f.queries.findIndex(q => q.startsWith('SELECT is_admin'))); expect(f.queries.some(q => q.includes('users') && q.includes('FOR SHARE'))).toBe(true); expect(f.queries.some(q => q.includes('viewer_login_bindings') && q.includes('FOR SHARE'))).toBe(true); expect(f.queries.at(-1)).toBe('COMMIT'); expect(f.release).toHaveBeenCalledTimes(1); });
  it.each(['nonadmin', 'missing-user', 'revoked-login'] as const)('refuses %s before disclosing nonexistent project', async kind => { const f = fixture(); f.state.exists = false; if (kind === 'nonadmin') f.state.admin = false; if (kind === 'missing-user') f.state.user = false; if (kind === 'revoked-login') f.state.revoked = true; await expect(f.repo.get(f.f.aggregate.projectId, f.who, f.f.traceId)).rejects.toMatchObject({ status: kind === 'nonadmin' ? 403 : 401 }); expect(f.queries).not.toContain('COMMIT'); expect(f.queries.at(-1)).toBe('ROLLBACK'); expect(f.queries.some(q => q.startsWith('SELECT manifest'))).toBe(false); });
  it('current denial precedes malformed command parsing and runtime fingerprint access', async () => { const f = fixture(); f.state.admin = false; await expect(f.repo.create(f.f.aggregate.projectId, f.who, { actor: 'forged' })).rejects.toMatchObject({ status: 403 }); expect(f.adapters.getRuntimeFingerprint).not.toHaveBeenCalled(); });
  it('an expiry during the operation prevents commit', async () => { const f = fixture(); await expect(geometryTraceTransaction(f.pool, f.f.aggregate.projectId, f.who, async () => { f.who.loginExpiresAt = Date.now() - 1; })).rejects.toMatchObject({ code: 'LOGIN_EXPIRED' }); expect(f.queries).not.toContain('COMMIT'); });
  it('unknown COMMIT acknowledgement remains unknown and discards the uncertain connection', async () => { const f = fixture(); f.state.commitFails = true; await expect(f.repo.authorize(f.f.aggregate.projectId, f.who)).rejects.toMatchObject({ code: 'GEOMETRY_TRACE_COMMIT_OUTCOME_UNKNOWN', status: 503 }); expect(f.release).toHaveBeenCalledWith(true); });
  it('discards a connection when rollback acknowledgement fails while preserving the operation failure', async () => { const f = fixture(); f.state.rollbackFails = true; await expect(geometryTraceTransaction(f.pool, f.f.aggregate.projectId, f.who, async () => { throw Error('original operation failure'); })).rejects.toThrow('original operation failure'); expect(f.queries.at(-1)).toBe('ROLLBACK'); expect(f.release).toHaveBeenCalledExactlyOnceWith(true); });
  it('returns a confirmed rollback connection normally to its pool', async () => { const f = fixture(); await expect(geometryTraceTransaction(f.pool, f.f.aggregate.projectId, f.who, async () => { throw Error('operation failure'); })).rejects.toThrow('operation failure'); expect(f.release).toHaveBeenCalledExactlyOnceWith(undefined); });
  it('reconciles exact historical receipt without reading current selection/policy/registry or reexporting', async () => { const f = fixture(); const receipt = await f.repo.create(f.f.aggregate.projectId, f.who, f.command); expect(receipt.duplicate).toBe(true); expect(receipt.trace.id).toBe(f.f.traceId); expect(f.adapters.exportFittedTrace).not.toHaveBeenCalled(); expect(f.queries.join('\n')).not.toMatch(/project_model_selections|pf_project_state|pf_purpose_project_state|UPDATE cables/); });
  it('rejects same-key changed command and changed binary under same derivation version', async () => { const f = fixture(); await expect(f.repo.create(f.f.aggregate.projectId, f.who, { ...f.command, expectedProjectionSha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'GEOMETRY_TRACE_IDEMPOTENCY_CONFLICT' }); f.state.changedFingerprint = true; await expect(f.repo.create(f.f.aggregate.projectId, f.who, f.command)).rejects.toMatchObject({ code: 'GEOMETRY_TRACE_DERIVATION_CHANGED' }); await expect(f.repo.get(f.f.aggregate.projectId, f.who, f.f.traceId)).resolves.toMatchObject({ id: f.f.traceId }); });
  it('a new command reuses complete aggregate/derivation set without another trace/index/export', async () => { const f = fixture(); f.state.receipt = false; f.state.completeIntent = true; const value = await f.repo.create(f.f.aggregate.projectId, f.who, f.command); expect(value.duplicate).toBe(true); expect(f.queries.filter(q => q.startsWith('INSERT INTO pf_geometry_trace_receipts'))).toHaveLength(1); expect(f.queries.join('\n')).not.toMatch(/INSERT INTO pf_geometry_trace_sets|INSERT INTO pf_geometry_object_revisions|UPDATE pf_project/); expect(f.adapters.exportFittedTrace).not.toHaveBeenCalled(); });
  it('projects strict nonempty list summaries and paged detail/diagnostics from the same manifest', async () => { const f = fixture(), list = await f.repo.list(f.f.aggregate.projectId, f.who); expect(list.traces[0]).not.toHaveProperty('diagnostics'); expect(list.traces[0].contentSha256).toBe(f.built.manifest.contentSha256); const page = await f.repo.objects(f.f.aggregate.projectId, f.who, f.f.traceId); expect(page.total).toBe(3); expect(page.contentSha256).toBe(list.traces[0].contentSha256); const warnings = await f.repo.diagnostics(f.f.aggregate.projectId, f.who, f.f.traceId, { limit: 100 }); expect(warnings.total).toBe(2051); expect(warnings.items).toHaveLength(100); expect(warnings.nextOffset).toBe(100); await expect(f.repo.object(f.f.aggregate.projectId, f.who, f.f.traceId, f.built.records[0].id)).resolves.toEqual(f.built.records[0]); });
  it('refuses a tampered record instead of returning a valid-looking object', async () => { const f = fixture(); f.state.tamper = true; await expect(f.repo.object(f.f.aggregate.projectId, f.who, f.f.traceId, f.built.records[0].id)).rejects.toMatchObject({ code: 'GEOMETRY_TRACE_RECORD_INTEGRITY' }); });
  it('bounds connection admission and returns a late client to its pool', async () => { vi.useFakeTimers(); const f = fixture(); let finish!: (value: typeof f.client) => void; const delayed = { connect: () => new Promise(resolve => { finish = resolve; }) } as unknown as Pool; const p = geometryTraceTransaction(delayed, f.f.aggregate.projectId, f.who, async () => undefined), rejected = expect(p).rejects.toMatchObject({ code: 'GEOMETRY_TRACE_DATABASE_BUSY', status: 503 }); await vi.advanceTimersByTimeAsync(5000); await rejected; finish(f.client); await Promise.resolve(); expect(f.release).toHaveBeenCalledTimes(1); expect(f.query).not.toHaveBeenCalled(); });
  it.each(['rollback', 'commit'] as const)('discards schema initializer connections with uncertain %s acknowledgement', async phase => { const release = vi.fn(), query = vi.fn(async (sql: string) => { if (phase === 'rollback' && sql.startsWith('SELECT pg_advisory')) throw Error('migration failure'); if (sql === (phase === 'rollback' ? 'ROLLBACK' : 'COMMIT')) throw Error('transport failure'); return { rows: [] }; }), pool = { connect: async () => ({ query, release }) } as unknown as Pool; await expect(initializeGeometryTraceSchema(pool)).rejects.toThrow(); expect(release).toHaveBeenCalledExactlyOnceWith(true); });
});

describe('ordinary new trace publication recalculation event',()=>{
  const dirtySql='SELECT pf_recalculation_dirty($1,$2,$3,$4)';
  it('marks exactly one current healthy ordinary trace after its receipt on the same client as the last SQL mutation',async()=>{
    const f=publicationFixture(),receipt=await f.create();expect(receipt.duplicate).toBe(false);expect(f.durable.dirty).toEqual([[f.f.aggregate.projectId,'geometry','GEOMETRY_TRACE_PUBLISHED',receipt.trace.id+':'+receipt.trace.contentSha256]]);expect(Buffer.byteLength(String(f.durable.dirty[0][3]))).toBe(101);
    const calls=f.queries,dirty=calls.findIndex(call=>call.sql===dirtySql),receiptIndex=calls.findIndex(call=>call.sql.startsWith('INSERT INTO pf_geometry_trace_receipts')),complete=calls.findIndex(call=>call.sql.startsWith('UPDATE pf_geometry_trace_intents SET state=')),scope=calls.findIndex(call=>call.sql.includes('geometry-trace:ordinary-current'));
    expect(complete).toBeLessThan(receiptIndex);expect(receiptIndex).toBeLessThan(scope);expect(scope).toBeLessThan(dirty);expect(calls[scope].params).toEqual([f.f.aggregate.projectId]);expect(calls[scope].sql).toContain('FOR SHARE OF p,s,v');expect(calls[dirty].client).toBe(f.client);expect(calls[dirty].transaction).toBe(3);expect(calls.slice(dirty+1).map(call=>call.sql)).toEqual(['COMMIT']);expect(f.durable.objects).toBe(3);expect(f.durable.diagnostics).toBe(1);expect(f.durable.receipts.size).toBe(1);
    expect(calls.some(call=>/UPDATE cables|UPDATE pf_recalculation_state|calculation_grant/.test(call.sql))).toBe(false);
  });
  it.each([
    ['current_aggregate_id',id(999)],['current_artifact_id',id(999)],['geometry_revision','2'],['active_model_version_id',id(999)],['selection_revision','2'],['content_fingerprint','0'.repeat(64)],['state','processing'],['health','unhealthy'],['missing',null],
  ])('retains a historical publication but emits nothing for current scope mismatch %s',async(field,value)=>{
    const f=publicationFixture();if(field==='missing')f.controls.scope=null;else f.controls.scope![String(field)]=value;const receipt=await f.create();expect(receipt.duplicate).toBe(false);expect(f.durable.traces.size).toBe(1);expect(f.durable.receipts.size).toBe(1);expect(f.durable.dirty).toEqual([]);expect(f.queries.some(call=>call.sql===dirtySql)).toBe(false);
  });
  it('skips the entire ordinary scope read and event for a new grant publication',async()=>{
    const f=publicationFixture(),receipt=await f.create(f.grant);expect(receipt.duplicate).toBe(false);expect(f.durable.traces.size).toBe(1);expect(f.durable.dirty).toEqual([]);expect(f.queries.some(call=>call.sql.includes('geometry-trace:ordinary-current')||call.sql===dirtySql)).toBe(false);expect(transport.grant).toHaveBeenCalledTimes(3);
  });
  it('never emits again on exact replay or completed derivation reuse under a new command key',async()=>{
    const f=publicationFixture(),first=await f.create(),scopeReads=()=>f.queries.filter(call=>call.sql.includes('geometry-trace:ordinary-current')).length;
    expect((await f.create()).duplicate).toBe(true);expect((await f.create(f.who,{...f.command,idempotencyKey:id(203)})).duplicate).toBe(true);expect(f.durable.dirty).toHaveLength(1);expect(scopeReads()).toBe(1);expect(transport.worker).toHaveBeenCalledTimes(1);expect(f.durable.traces.size).toBe(1);expect(f.durable.receipts.size).toBe(2);expect(f.durable.dirty[0][3]).toBe(first.trace.id+':'+first.trace.contentSha256);
  });
  it('does not emit from final-transaction receipt replay after a concurrent publication',async()=>{
    const f=publicationFixture();f.controls.concurrentReceipt=true;const receipt=await f.create();expect(receipt.duplicate).toBe(true);expect(f.durable.traces.size).toBe(1);expect(f.durable.dirty).toEqual([]);expect(f.queries.some(call=>call.sql.includes('geometry-trace:ordinary-current')||call.sql===dirtySql)).toBe(false);expect(f.queries.some(call=>call.sql.startsWith('INSERT INTO pf_geometry_trace_sets'))).toBe(false);
  });
  it.each(['scope','dirty'] as const)('rolls back new trace, receipt and event on %s failure instead of publishing a partial dirty effect',async phase=>{
    const f=publicationFixture(),failure=new Error('synthetic transaction failure');if(phase==='scope')f.controls.scopeError=failure;else f.controls.dirtyError=failure;
    await expect(f.create()).rejects.toBe(failure);expect(f.durable.traces.size).toBe(0);expect(f.durable.receipts.size).toBe(0);expect(f.durable.dirty).toEqual([]);expect(f.durable.objects).toBe(0);expect(f.durable.diagnostics).toBe(0);expect([...f.durable.intents.values()].map(value=>value.state)).toEqual(['pending']);expect(f.queries.some(call=>call.sql==='ROLLBACK')).toBe(true);
  });
  it.each(['role','login','lease'] as const)('retains final %s fences before any trace mutation or dirty event',async phase=>{
    const f=publicationFixture();if(phase==='role')f.controls.finalAdmin=false;if(phase==='login')f.controls.finalRevoked=true;if(phase==='lease')f.controls.leaseChanged=true;
    await expect(f.create()).rejects.toMatchObject({code:phase==='role'?'ADMIN_REQUIRED':phase==='login'?'LOGIN_REVOKED':'GEOMETRY_TRACE_LEASE_CHANGED'});expect(f.durable.traces.size).toBe(0);expect(f.durable.receipts.size).toBe(0);expect(f.durable.dirty).toEqual([]);expect(f.queries.some(call=>call.sql===dirtySql)).toBe(false);
  });
  it('keeps final expiry after the dirty call atomic by rolling all publication effects back',async()=>{
    const f=publicationFixture();f.controls.onDirty=()=>{f.who.loginExpiresAt=Date.now()-1;};await expect(f.create()).rejects.toMatchObject({code:'LOGIN_EXPIRED'});expect(f.queries.some(call=>call.sql===dirtySql)).toBe(true);expect(f.durable.traces.size).toBe(0);expect(f.durable.receipts.size).toBe(0);expect(f.durable.dirty).toEqual([]);
  });
  it('keeps final cancellation after the dirty call atomic and retains no publication effects',async()=>{
    const f=publicationFixture(),controller=new AbortController();f.controls.onDirty=()=>controller.abort();await expect(f.create(f.who,f.command,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(f.queries.some(call=>call.sql===dirtySql)).toBe(true);expect(f.durable.traces.size).toBe(0);expect(f.durable.receipts.size).toBe(0);expect(f.durable.dirty).toEqual([]);
  });
  it('models a lost final COMMIT acknowledgement and reconciles the exact durable receipt without a second generation',async()=>{
    const f=publicationFixture();f.controls.finalCommitUnknown=true;const result=await f.create();expect(result.duplicate).toBe(true);expect(f.durable.dirty).toHaveLength(1);expect(f.durable.traces.size).toBe(1);expect(f.durable.receipts.size).toBe(1);expect(f.release.mock.calls.some(call=>call[0]===true)).toBe(true);expect(f.queries.filter(call=>call.sql===dirtySql)).toHaveLength(1);
    expect((await f.create()).duplicate).toBe(true);expect(f.durable.dirty).toHaveLength(1);expect(f.queries.filter(call=>call.sql.includes('geometry-trace:ordinary-current'))).toHaveLength(1);
  });
  it('preserves changed-runtime derivation replay refusal without emitting or invalidating historical reads',async()=>{
    const f=publicationFixture(),first=await f.create();f.adapters.getRuntimeFingerprint.mockResolvedValue({...f.f.runtimeFingerprint,derivationSha256:'0'.repeat(64)});
    await expect(f.create()).rejects.toMatchObject({code:'GEOMETRY_TRACE_DERIVATION_CHANGED'});expect(f.durable.dirty).toHaveLength(1);await expect(f.repo.get(f.f.aggregate.projectId,f.who,first.trace.id)).resolves.toMatchObject({id:first.trace.id});expect(f.durable.dirty).toHaveLength(1);
  });
});
