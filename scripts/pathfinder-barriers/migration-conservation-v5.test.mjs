// Synthetic comparator/control fixtures; no SQL, containers or real business rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {currentInventoryCanonicalHash as hash,currentInventorySchemaMetadata,currentInventoryFrame,losslessTopLevelFields} from '../pathfinder-copied-recovery/current-inventory-lib.mjs';
import {B9_MIGRATION_POLICY} from './migration-qualification.mjs';
import {V5_MIGRATION_POLICY,V5_RUNTIME_POLICY as B9_RUNTIME_POLICY,qualifyMigrationFacts,qualifyRuntimeFacts,qualifyMigrationInventories,qualifyRuntimeInventories,assertQualificationReceipt} from './migration-conservation-v5.mjs';
import {SOURCE} from './owned-update-v3.mjs';

const OWNER='10000000-0000-4000-8000-000000000001',PROJECT='10000000-0000-4000-8000-000000000002';
const ENGINE='e'.repeat(64),clone=value=>structuredClone(value),bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const cmp=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
function column(name,{identity='',type='text'}={}){return{name,type,notNull:false,defaultSql:null,collation:null,identity,generated:''};}
function table(name,rawRows=[],options={}){
 const columns=options.columns??[column('id')],primaryKey=options.primaryKey??['id'];
 // The real producer uses jsonb_build_array(t.pk::text,...)::text: every
 // component is a string, including bigint; keep numeric lexical precision.
 const values=rawRows.map(rowText=>{const fields=losslessTopLevelFields(rowText),key='['+primaryKey.map(key=>{const token=fields.get(key);return JSON.stringify(token.startsWith('"')?JSON.parse(token):token);}).join(', ')+']';return{key,rowText};}).sort((a,b)=>cmp(a.key,b.key));
 const rows=createHash('sha256').update('wfc.lossless.table-rows.v1\n'),keys=createHash('sha256').update('wfc.lossless.table-keys.v1\n'),protectedHash=createHash('sha256').update('wfc.lossless.table-protected.v1\n');
 let rawBytes=0;const fencing=name==='viewer_login_bindings'?{columns:['revoked_at'],protectedSha256:''}:null;
 const lines=values.map(value=>{currentInventoryFrame(rows,value.key);currentInventoryFrame(rows,value.rowText);currentInventoryFrame(keys,value.key);rawBytes+=Buffer.byteLength(value.rowText);
  if(fencing){const fields=losslessTopLevelFields(value.rowText),protectedText='{'+[...fields.keys()].filter(key=>key!=='revoked_at').sort().map(key=>JSON.stringify(key)+':'+fields.get(key)).join(',')+'}';
   currentInventoryFrame(protectedHash,value.key);currentInventoryFrame(protectedHash,protectedText);return canonical({...value,protectedText,mutable:{revokedAt:JSON.parse(fields.get('revoked_at'))}});}
  return canonical(value);});
 const content=lines.length?lines.join('\n')+'\n':'';
 if(fencing)fencing.protectedSha256=protectedHash.digest('hex');
 const byName=(a,b)=>cmp(a.name,b.name);
 const facts={table:name,columns,primaryKey,keyMode:'primary-key',definitions:{constraints:[...(options.constraints??[])].sort(byName),indexes:[...(options.indexes??[])].sort(byName),triggers:[...(options.triggers??[])].sort(byName),rls:{enabled:false,forced:false,policies:[]}},
  rows:String(values.length),rawBytes:String(rawBytes),schemaSha256:'',rowSha256:rows.digest('hex'),keySetSha256:keys.digest('hex'),file:{path:'',bytes:String(Buffer.byteLength(content)),sha256:bytesHash(content)},fencing};
 facts.schemaSha256=hash(currentInventorySchemaMetadata(facts));return{facts,content,values};
}
function finish(tables,globals,{database='wfc_pathfinder_local',inventory='20000000-0000-4000-8000-000000000001'}={}){
 const ordered=tables.sort((a,b)=>cmp(a.facts.table,b.facts.table));for(const[value,index]of ordered.map((value,index)=>[value,index]))value.facts.file.path=`table-${String(index).padStart(4,'0')}.ndjson`;
 const manifest={schemaVersion:'wfc.operations.lossless-inventory.v1',status:'PASS',scope:'public',projection:'postgresql-jsonb-text.v1',ownerId:OWNER,inventoryId:inventory,
  database:{name:database,encoding:'UTF8',serverVersionNum:'180000'},tables:ordered.map(row=>row.facts),catalogSha256:hash(ordered.map(row=>currentInventorySchemaMetadata(row.facts)))};
 manifest.contentSha256=hash(manifest);return{manifest,globals,files:Object.fromEntries(ordered.map(row=>[row.facts.file.path,row.content])),rows:Object.fromEntries(ordered.map(row=>[row.facts.table,row.values]))};
}
function relation(name,kind='r'){return{name,kind,owner:'pf_local',persistence:'p',replicaIdentity:'d',acl:[]};}
function routine(name,version){return{name,arguments:name==='pf_recalculation_dirty'?'pid uuid, kind text, why text, source_value text':'',kind:'f',definition:'synthetic comparator '+version+' '+name,owner:'pf_local',acl:[]};}
function sequence(name,{auto=false}={}){return{definition:{name,dataType:'bigint',start:'1',min:'1',max:'9223372036854775807',increment:'1',cycle:false,cache:'1'},
 state:{lastValue:auto?'1':'9007199254740993',isCalled:!auto},owner:'pf_local',acl:[],ownership:[{dependencyKind:auto?'i':'a',tableSchema:'public',table:auto?'pf_auto_length_admissions':'legacy_items',column:auto?'ordinal':'id',identity:auto?'a':''}]};}
function fixture({runtimeBefore,runtimeAfter}={}){
 const oldConstraint={name:'pf_recalculation_events_domain_check',definition:"CHECK (domain IN ('engine','manual'))",validated:true};
 const newConstraint={...oldConstraint,definition:"CHECK (domain IN ('engine','manual','barriers'))"};
 const legacy=()=>table('legacy_items',['{"id":9007199254740993,"amount":12345678901234567890.123456789}'],{columns:[column('id',{type:'bigint'}),column('amount',{type:'numeric'})]});
 const eventColumns=['project_id','generation','domain','reason','source_revision','occurred_at'].map(name=>column(name));
 const events=(rows,after)=>table('pf_recalculation_events',rows??[],{columns:eventColumns,primaryKey:['project_id','generation'],constraints:[after?newConstraint:oldConstraint]});
 const controls=data=>data?[table('pf_recalculation_state',data.states,{columns:Object.keys(JSON.parse(data.states[0]??runtimeBefore.states[0])).map(name=>column(name)),primaryKey:['project_id']}),
  table('users',data.users,{columns:['id','is_admin'].map(name=>column(name))}),table('viewer_login_bindings',data.logins,{columns:['login_id','user_id','expires_at','revoked_at'].map(name=>column(name)),primaryKey:['login_id']})]:[];
 const managed=()=>B9_MIGRATION_POLICY.newTables.map(name=>table(name,[],{columns:[column(name==='pf_auto_length_admissions'?'ordinal':'id',{identity:name==='pf_auto_length_admissions'?'a':''})],primaryKey:[name==='pf_auto_length_admissions'?'ordinal':'id'],
  triggers:name==='pf_barrier_heads'?[{name:'pf_recalculation_row_event',definition:'synthetic canonical barrier-head event',enabled:'O'}]:[]}));
 const oldTables=[legacy(),events(runtimeBefore?.events,false),...controls(runtimeBefore)],newTables=[legacy(),events(runtimeAfter?.events,true),...controls(runtimeAfter),...managed()];
 const base={schemaVersion:'wfc.pf.public-global-sql.v2',namespace:{owner:'pg_database_owner',acl:[]},relations:[],
  views:[{name:'standard_material_catalog',definition:'SELECT id FROM legacy_items;',columns:[{name:'id',type:'bigint',collation:null}]}],
  routines:B9_MIGRATION_POLICY.changedRoutines.map(name=>routine(name,'old')),sequences:[sequence('legacy_seq')],
  extensions:[{name:'plpgsql',version:'1.0',schema:'pg_catalog',owner:'postgres'}],unsupportedObjects:[]};
 const oldGlobals=clone(base);oldGlobals.relations=[...oldTables.map(row=>relation(row.facts.table)),relation('legacy_seq','S'),relation('standard_material_catalog','v')].sort((a,b)=>cmp(a.name,b.name));oldGlobals.routines.sort((a,b)=>cmp(a.name,b.name));
 const newGlobals=clone(base);newGlobals.relations=[...newTables.map(row=>relation(row.facts.table)),relation('legacy_seq','S'),relation(B9_MIGRATION_POLICY.newSequence,'S'),relation('standard_material_catalog','v')].sort((a,b)=>cmp(a.name,b.name));
 newGlobals.routines=[...B9_MIGRATION_POLICY.changedRoutines,...B9_MIGRATION_POLICY.newRoutines].map(name=>routine(name,'final')).sort((a,b)=>cmp(a.name,b.name));
 newGlobals.sequences.push(sequence(B9_MIGRATION_POLICY.newSequence,{auto:true}));newGlobals.sequences.sort((a,b)=>cmp(a.definition.name,b.definition.name));
 const before=finish(oldTables,oldGlobals),after=finish(newTables,newGlobals,{inventory:'20000000-0000-4000-8000-000000000002'});
 const pristine=finish([legacy(),events([],true),...controls(runtimeBefore?{states:[],users:[],logins:[]}:undefined),...managed()],clone(newGlobals),{database:'wfc_pfb9_pristine_test',inventory:'20000000-0000-4000-8000-000000000003'});
 return{before,after,pristine};
}
const facts=value=>({manifest:value.manifest,globals:value.globals});
const migration=value=>qualifyMigrationFacts({before:facts(value.before),after:facts(value.after),pristine:facts(value.pristine)});
function reseal(manifest){for(const row of manifest.tables)row.schemaSha256=hash(currentInventorySchemaMetadata(row));manifest.catalogSha256=hash(manifest.tables.map(currentInventorySchemaMetadata));const{contentSha256,...body}=manifest;manifest.contentSha256=hash(body);}
function replaceRows(capture,tableName,rawRows){const index=capture.manifest.tables.findIndex(row=>row.table===tableName),old=capture.manifest.tables[index];
 const next=table(tableName,rawRows,{columns:clone(old.columns),primaryKey:clone(old.primaryKey),constraints:clone(old.definitions.constraints),indexes:clone(old.definitions.indexes),triggers:clone(old.definitions.triggers)});
 next.facts.file.path=old.file.path;capture.manifest.tables[index]=next.facts;capture.files[old.file.path]=next.content;capture.rows[tableName]=next.values;reseal(capture.manifest);}

function runtimeFixture({expired=false}={}){
 const login='30000000-0000-4000-8000-000000000001',actor='30000000-0000-4000-8000-000000000002';
 const row={project_id:PROJECT,control_revision:7,desired_generation:10,enrolled_generation:null,authority_epoch:4,enabled:expired,paused:false,
  actor_id:actor,login_id:login,login_expires_at:'2026-10-21T18:00:00.000Z',authority_expires_at:'2026-10-21T18:00:00.000Z',preferences:{decimalString:'123456789.123456789'},
  timeout_ms:60000,status:'complete',reason_codes:['OLD_REASON'],first_dirty_at:null,due_at:null,attempt_generation:10,attempts:2,engine_identity_sha256:'d'.repeat(64),engine_unavailable_code:null,
  current_job_id:null,completed:0,total:0,ready_cables:0,blocked_cables:0,updated_at:'2026-10-21T17:00:00.000Z'};
 const updated={...row,desired_generation:11,status:expired?'awaiting_authority':'disabled',reason_codes:['ENGINE_IDENTITY_CHANGED','OLD_REASON'],first_dirty_at:'2026-10-21T19:00:00.100Z',
  due_at:'2026-10-21T19:00:00.600Z',attempt_generation:null,attempts:0,engine_identity_sha256:ENGINE,updated_at:'2026-10-21T19:00:00.100Z'};
 const event={project_id:PROJECT,generation:11,domain:'engine',reason:'ENGINE_IDENTITY_CHANGED',source_revision:ENGINE,occurred_at:'2026-10-21T19:00:00.100Z'};
 const security={users:[JSON.stringify({id:actor,is_admin:true})],logins:[JSON.stringify({login_id:login,user_id:actor,expires_at:'2026-10-21T18:00:00.000Z',revoked_at:'2026-10-21T18:01:00.000Z'})]};
 const value=fixture({runtimeBefore:{states:[JSON.stringify(row)],events:[],...security},runtimeAfter:{states:[JSON.stringify(updated)],events:[JSON.stringify(event)],...security}});
 const rows=capture=>({states:capture.rows.pf_recalculation_state,events:capture.rows.pf_recalculation_events,users:capture.rows.users,logins:capture.rows.viewer_login_bindings});
 const input={before:facts(value.before),after:facts(value.after),pristine:facts(value.pristine),policy:{schemaVersion:'wfc.pf.b9.runtime-window.v1',mode:B9_RUNTIME_POLICY.mode,
  phase:'source-runtime',engineIdentitySha256:ENGINE,startedAt:'2026-10-21T19:00:00.000Z',stoppedAt:'2026-10-21T19:00:02.000Z'},rows:{before:rows(value.before),after:rows(value.after)}};
 return{value,input};
}
function rewriteState(setup,side,mutate){const row=JSON.parse(setup.input.rows[side].states[0].rowText);mutate(row);replaceRows(setup.value[side],'pf_recalculation_state',[JSON.stringify(row)]);
 setup.input.rows[side].states=setup.value[side].rows.pf_recalculation_state;}
function migratedBefore(setup){
 const old=setup.value.before,final=setup.value.after;
 const tables=final.manifest.tables.map(expected=>{
  const initial=old.manifest.tables.find(row=>row.table===expected.table),facts=clone(expected);
  if(initial){for(const key of ['rows','rawBytes','rowSha256','keySetSha256','fencing'])facts[key]=clone(initial[key]);facts.file=clone(initial.file);}
  const from=initial?old:final,source=initial??expected;return{facts,content:from.files[source.file.path],values:clone(from.rows[source.table])};
 });
 setup.value.before=finish(tables,clone(final.globals));setup.input.before=facts(setup.value.before);
 setup.input.rows.before={states:setup.value.before.rows.pf_recalculation_state,events:setup.value.before.rows.pf_recalculation_events,users:setup.value.before.rows.users,logins:setup.value.before.rows.viewer_login_bindings};
 setup.input.policy.phase='target-runtime';return setup;
}

function populatedLegacyRuntimeFixture(options={}){
 const setup=migratedBefore(runtimeFixture(options));
 for(const side of ['before','after']){
  for(const name of B9_MIGRATION_POLICY.newTables){
   const key=name==='pf_auto_length_admissions'?'ordinal':'id';
   replaceRows(setup.value[side],name,['{"'+key+'":9007199254740993}']);
  }
  const auto=setup.value[side].globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence);
  auto.state={lastValue:'9007199254740993',isCalled:true};
  setup.input[side]=facts(setup.value[side]);
 }
 return setup;
}
const TERMINAL='pf_barrier_command_closures',LOOKUPS=[['pf_barrier_capture_intents','pf_barrier_capture_intents_command_sha256_lookup'],['pf_barrier_receipts','pf_barrier_receipts_command_sha256_lookup']];
const closureHistory='{"project_id":"'+PROJECT+'","command_sha256":"'+'a'.repeat(64)+'","id":"'+OWNER+'","record_sha256":"'+'b'.repeat(64)+'","record":{"protectedClosure":"original","precise":12345678901234567890.123456789},"closed_by":"'+OWNER+'","login_id":"'+OWNER+'","closed_at":"2026-10-22T12:00:00.000Z"}';
function terminalTable(rows=[]){
 const types={project_id:'uuid',command_sha256:'text',id:'uuid',record_sha256:'text',record:'jsonb',closed_by:'uuid',login_id:'uuid',closed_at:'timestamp with time zone'};
 return table(TERMINAL,rows,{columns:Object.entries(types).map(([name,type])=>({...column(name,{type}),notNull:true})),primaryKey:['project_id','command_sha256'],
 constraints:[['pf_barrier_command_closures_pkey','PRIMARY KEY (project_id, command_sha256)'],['pf_barrier_closure_tenant_id','UNIQUE (project_id, id)'],
  ['pf_barrier_closure_project_fk','FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE'],
  ['pf_barrier_closure_command_hash',"CHECK (command_sha256 ~ '^[a-f0-9]{64}$')"],['pf_barrier_closure_record_hash',"CHECK (record_sha256 ~ '^[a-f0-9]{64}$')"],
  ['pf_barrier_closure_record_bytes','CHECK (octet_length(record::text) <= 16384)']].map(([name,definition])=>({name,definition,validated:true})),
 indexes:[{name:'pf_barrier_command_closures_pkey',definition:'CREATE UNIQUE INDEX pf_barrier_command_closures_pkey ON public.pf_barrier_command_closures USING btree (project_id, command_sha256)',valid:true,ready:true},
  {name:'pf_barrier_closure_tenant_id',definition:'CREATE UNIQUE INDEX pf_barrier_closure_tenant_id ON public.pf_barrier_command_closures USING btree (project_id, id)',valid:true,ready:true}],
 triggers:[{name:'pf_barrier_command_closure_immutable',definition:'CREATE TRIGGER pf_barrier_command_closure_immutable BEFORE DELETE OR UPDATE ON public.pf_barrier_command_closures FOR EACH ROW EXECUTE FUNCTION pf_barrier_immutable()',enabled:'O'}]});
}
function addV5(capture,rows=[]){
 const tables=capture.manifest.tables.map(facts=>({facts:clone(facts),content:capture.files[facts.file.path],values:clone(capture.rows[facts.table])}));
 for(const[tableName,indexName]of LOOKUPS){const facts=tables.find(value=>value.facts.table===tableName).facts;
  facts.definitions.indexes.push({name:indexName,definition:'CREATE INDEX '+indexName+' ON public.'+tableName+' USING btree (project_id, request_sha256)',valid:true,ready:true});
  facts.definitions.indexes.sort((a,b)=>cmp(a.name,b.name));facts.schemaSha256=hash(currentInventorySchemaMetadata(facts));}
 tables.push(terminalTable(rows));const globals=clone(capture.globals);
 globals.relations=[...tables.map(value=>relation(value.facts.table)),...tables.flatMap(value=>value.facts.definitions.indexes.map(index=>relation(index.name,'i'))),
  ...globals.sequences.map(value=>relation(value.definition.name,'S')),...globals.views.map(value=>relation(value.name,'v'))].sort((a,b)=>cmp(a.name,b.name));
 return finish(tables,globals,{database:capture.manifest.database.name,inventory:capture.manifest.inventoryId});
}
function populatedRuntimeFixture(options={}){const setup=populatedLegacyRuntimeFixture(options);
 for(const side of ['before','after']){setup.value[side]=addV5(setup.value[side],[closureHistory]);setup.input[side]=facts(setup.value[side]);}
 setup.value.pristine=addV5(setup.value.pristine);setup.input.pristine=facts(setup.value.pristine);return setup;
}
function postB9Fixture(){const setup=populatedLegacyRuntimeFixture();setup.value.after=addV5(clone(setup.value.before));setup.value.pristine=addV5(setup.value.pristine);return setup.value;}

test('v5 sole additions retain all nonempty Auto/barrier history and called high-precision ordinal',()=>{
 const value=postB9Fixture(),result=migration(value);
 assert.equal(result.status,'PASS');assert.equal(result.schemaVersion,'wfc.pf.conservation-v5.migration-facts.v1');
 assert.deepEqual(result.newTables,[TERMINAL]);assert.deepEqual(result.managedChanges,[...LOOKUPS.map(([,name])=>'index:'+name),'table:'+TERMINAL].sort(cmp));
 assert.equal(value.after.globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence).state.lastValue,'9007199254740993');
 assert.equal(value.pristine.globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence).state.isCalled,false);
});
test('second schema-only initialization is exact with retained history, rather than requiring empty tables',()=>{
 const value=postB9Fixture();value.before=clone(value.after);assert.equal(migration(value).status,'PASS');
});
for(const[name,mutate,code]of[
 ['Auto rows',v=>replaceRows(v.after,'pf_auto_lengths',['{"id":9007199254740994}']),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['barrier receipt rows',v=>replaceRows(v.after,'pf_barrier_receipts',['{"id":9007199254740994}']),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['business numeric precision',v=>replaceRows(v.after,'legacy_items',['{"id":9007199254740993,"amount":12345678901234567890.123456788}']),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['sequence consumption',v=>{v.after.globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence).state.lastValue='9007199254740994';},'PUBLIC_GLOBALS_CHANGED'],
 ['sequence reset to pristine',v=>{v.after.globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence).state={lastValue:'1',isCalled:false};},'PUBLIC_GLOBALS_CHANGED'],
 ['legacy sequence ownership',v=>{v.after.globals.sequences.find(row=>row.definition.name==='legacy_seq').ownership=[];},'PUBLIC_GLOBALS_CHANGED'],
 ['existing routine alteration',v=>{v.after.globals.routines[0].definition+=' changed';},'PUBLIC_GLOBALS_CHANGED'],
 ['view definition alteration',v=>{v.after.globals.views[0].definition='SELECT 0::bigint AS id;';},'PUBLIC_GLOBALS_CHANGED'],
 ['namespace ACL alteration',v=>{v.after.globals.namespace.acl=[{grantor:'pf_local',grantee:'PUBLIC',privilege:'USAGE',isGrantable:false}];},'PUBLIC_GLOBALS_CHANGED'],
 ['legacy default alteration',v=>{v.after.manifest.tables.find(row=>row.table==='legacy_items').columns[0].defaultSql='42';reseal(v.after.manifest);},'UNDECLARED_LEGACY_DDL_CHANGE'],
 ['managed default alteration',v=>{v.after.manifest.tables.find(row=>row.table==='pf_barrier_heads').columns[0].defaultSql='42';reseal(v.after.manifest);},'MANAGED_TABLE_DIFFERS_FROM_PRISTINE'],
 ['pristine managed definition tampering',v=>{v.pristine.manifest.tables.find(row=>row.table==='pf_barrier_heads').columns[0].defaultSql='42';reseal(v.pristine.manifest);},'MANAGED_TABLE_DIFFERS_FROM_PRISTINE'],
 ['pristine routine tampering',v=>{v.pristine.globals.routines.find(row=>row.name==='pf_barrier_immutable').definition+=' changed';},'MANAGED_ROUTINE_NOT_EXACT'],
 ['pristine sequence definition tampering',v=>{v.pristine.globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence).definition.increment='2';},'MANAGED_SEQUENCE_DEFINITION_NOT_EXACT'],
 ['pristine relation ACL tampering',v=>{v.pristine.globals.relations.find(row=>row.name==='pf_barrier_heads').acl=[{grantor:'pf_local',grantee:'PUBLIC',privilege:'SELECT',isGrantable:false}];},'MANAGED_RELATION_METADATA_NOT_PRISTINE'],
])test('v5 rejects '+name,()=>{const value=postB9Fixture();mutate(value);const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code===code),JSON.stringify(result));});

function removeTable(capture,name){const indexes=capture.manifest.tables.find(row=>row.table===name)?.definitions.indexes.map(row=>row.name)??[];capture.manifest.tables=capture.manifest.tables.filter(row=>row.table!==name);capture.globals.relations=capture.globals.relations.filter(row=>row.name!==name&&!indexes.includes(row.name));reseal(capture.manifest);}
test('an unknown table added after the baseline fails closed',()=>{
 const value=postB9Fixture(),extra=table('zz_unknown_new',[]);extra.facts.file.path='table-0499.ndjson';
 value.after.manifest.tables.push(extra.facts);value.after.globals.relations.push(relation('zz_unknown_new'));reseal(value.after.manifest);
 const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='TABLE_SET_CHANGED'));
});
test('a required managed table omitted consistently from every capture still fails',()=>{
 const value=postB9Fixture();for(const capture of [value.before,value.after,value.pristine])removeTable(capture,'pf_barrier_receipts');
 const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='REQUIRED_TABLE_MISSING'));
});
test('preexisting unrelated tables remain protected rather than being dropped from comparison',()=>{
 const value=postB9Fixture();assert.equal(migration(value).status,'PASS');
 removeTable(value.after,'legacy_items');const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='LEGACY_TABLE_MISSING'));
});
test('unsupported global kinds and missing coverage are refused, never ignored',()=>{
 const value=postB9Fixture();value.before.globals.unsupportedObjects=[{kind:'type:e',name:'foreign_enum'}];assert.throws(()=>migration(value),{code:'B9_UNSUPPORTED_GLOBAL_OBJECT'});
 const missing=postB9Fixture();missing.after.globals.views=[];assert.throws(()=>migration(missing),{code:'B9_GLOBAL_VIEW_COVERAGE'});
});
test('extra, hidden, symbol or getter top-level options are refused before evaluation',()=>{
 for(const decorate of [v=>{v.extra=true;},v=>Object.defineProperty(v,'hidden',{value:true}),v=>{v[Symbol('extra')]=true;},v=>Object.defineProperty(v,'before',{enumerable:true,get(){throw Error('GETTER_MUST_NOT_RUN');}})]){
  const value=postB9Fixture(),input={before:facts(value.before),after:facts(value.after),pristine:facts(value.pristine)};decorate(input);
  assert.throws(()=>qualifyMigrationFacts(input),{code:'B9_MIGRATION_FACTS_INPUT'});
 }
});
test('versioned policies cannot be widened, and never describe old empty-table exceptions',()=>{
 assert.equal(V5_MIGRATION_POLICY.mode,'post-b20-terminal-closure-additive');assert.throws(()=>V5_MIGRATION_POLICY.managedTables.push('cables'),TypeError);
 assert.equal(V5_MIGRATION_POLICY.newTable,TERMINAL);assert.deepEqual(V5_MIGRATION_POLICY.addedIndexes.map(row=>row.name),LOOKUPS.map(([,name])=>name));assert.throws(()=>B9_RUNTIME_POLICY.controls.push(TERMINAL),TypeError);
});

test('typed target runtime engine observation preserves all populated Auto/barrier rows and sequence state',()=>assert.equal(qualifyRuntimeFacts(populatedRuntimeFixture().input).status,'PASS'));
test('typed source runtime engine observation is also no-DDL',()=>{const setup=populatedRuntimeFixture();setup.input.policy.phase='source-runtime';assert.equal(qualifyRuntimeFacts(setup.input).status,'PASS');});
test('proven expired administrator authority reset remains allowed without renewal',()=>assert.equal(qualifyRuntimeFacts(populatedRuntimeFixture({expired:true}).input).status,'PASS'));
for(const[name,mutate,code]of[
 ['renewed authority',setup=>rewriteState(setup,'after',row=>{row.authority_epoch++;row.authority_expires_at='2026-10-22T19:00:00.000Z';}),'RUNTIME_PROTECTED_STATE_CHANGED'],
 ['generation skip',setup=>rewriteState(setup,'after',row=>{row.desired_generation=12;}),'RUNTIME_ENGINE_STATE_DELTA'],
 ['foreign engine',setup=>rewriteState(setup,'after',row=>{row.engine_identity_sha256='f'.repeat(64);}),'RUNTIME_ENGINE_NOT_OBSERVED'],
 ['Auto write',setup=>replaceRows(setup.value.after,'pf_auto_lengths',['{"id":9007199254740994}']),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['barrier write',setup=>replaceRows(setup.value.after,'pf_barrier_receipts',['{"id":9007199254740994}']),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['cable/business write',setup=>replaceRows(setup.value.after,'legacy_items',['{"id":9007199254740993,"amount":0}']),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['Auto sequence reset',setup=>{setup.value.after.globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence).state={lastValue:'1',isCalled:false};},'PUBLIC_GLOBALS_CHANGED'],
 ['runtime DDL',setup=>{setup.value.after.manifest.tables.find(row=>row.table==='legacy_items').columns[0].defaultSql='42';reseal(setup.value.after.manifest);},'UNDECLARED_LEGACY_DDL_CHANGE'],
])test('v5 runtime rejects '+name,()=>{const setup=populatedRuntimeFixture();mutate(setup);const result=qualifyRuntimeFacts(setup.input);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code===code),JSON.stringify(result));});
test('typed runtime control coverage and raw hash binding cannot be omitted',()=>{
 const missing=populatedRuntimeFixture();missing.input.rows.after.states=[];assert.throws(()=>qualifyRuntimeFacts(missing.input),{code:'B9_CONTROL_COVERAGE'});
 const changed=populatedRuntimeFixture();changed.input.rows.after.states[0].rowText=changed.input.rows.after.states[0].rowText.replace('OLD_REASON','INVENTED_REASON');assert.throws(()=>qualifyRuntimeFacts(changed.input),{code:'B9_CONTROL_DIGEST'});
});

function invocation({source=false}={}){
 const operationId='40000000-0000-4000-8000-000000000001',operationDirectory=path.join(path.dirname(SOURCE.runtime),'barrier-delivery-'+operationId);
 const context={operationId,phase:source?'source-runtime':'target-migration',runtime:source?SOURCE.runtime:path.join(operationDirectory,'restore-5192'),owner:source?SOURCE.owner:OWNER,
  project:source?SOURCE.project:'wfc-pathfinder-local-100000000000',port:source?5191:5192,backupId:'50000000-0000-4000-8000-000000000001',candidate:{api:'sha256:'+'a'.repeat(64),web:'sha256:'+'b'.repeat(64)},engineIdentitySha256:ENGINE};
 const ref=(name,ownerId=context.owner)=>({directory:path.join(operationDirectory,'captures',name),ownerId,manifest:{path:path.join(operationDirectory,'captures',name,'manifest.json'),bytes:1,sha256:'a'.repeat(64)},
  globals:{path:path.join(operationDirectory,'captures',name+'.globals.private.json'),bytes:1,sha256:'b'.repeat(64)},contentSha256:'c'.repeat(64)});
 return{operationDirectory,qualifierSha256:'d'.repeat(64),context,before:ref('before'),after:ref('after'),pristine:ref('pristine',OWNER),
  ...(source?{policy:{schemaVersion:'wfc.pf.b9.runtime-window.v1',mode:B9_RUNTIME_POLICY.mode,phase:'source-runtime',engineIdentitySha256:ENGINE,startedAt:'2026-10-21T19:00:00.000Z',stoppedAt:'2026-10-21T19:00:02.000Z'}}:{})};
}
test('original/foreign source identities are refused before any file read',async()=>{
 for(const mutate of [v=>{v.context.owner=OWNER;v.before.ownerId=v.after.ownerId=OWNER;},v=>{v.context.project='wfc-app';},v=>{v.context.runtime=path.join(path.dirname(SOURCE.runtime),'original-5180');}]){
  const value=invocation({source:true});mutate(value);await assert.rejects(qualifyRuntimeInventories(value),{code:'V5_EXACT_SOURCE_REQUIRED'});
 }
 for(const port of [5180,5190]){const value=invocation({source:true});value.context.port=port;await assert.rejects(qualifyRuntimeInventories(value),{code:'B9_CONTEXT_INVALID'});}
});
test('target cannot impersonate source, reuse an unrelated directory, or pass extra policy options',async()=>{
 const source=invocation();source.context.owner=SOURCE.owner;source.before.ownerId=source.after.ownerId=SOURCE.owner;await assert.rejects(qualifyMigrationInventories(source),{code:'V5_FRESH_TARGET_REQUIRED'});
 const directory=invocation();directory.operationDirectory=path.dirname(directory.operationDirectory);await assert.rejects(qualifyMigrationInventories(directory),{code:'V5_EXACT_OPERATION_REQUIRED'});
 const extra=invocation();extra.relax=true;await assert.rejects(qualifyMigrationInventories(extra),{code:'B9_QUALIFIER_INPUT'});
 const runtime=invocation({source:true});runtime.policy.relax=true;await assert.rejects(qualifyRuntimeInventories(runtime),{code:'V5_RUNTIME_POLICY_INVALID'});
});

function qualificationReceipt({runtime=false}={}){
 const expected=invocation({source:runtime}),setup=runtime?populatedRuntimeFixture():null,value=runtime?setup.value:postB9Fixture();
 if(runtime)setup.input.policy=expected.policy;
 const comparison=runtime?qualifyRuntimeFacts(setup.input):migration(value);
 assert.equal(comparison.status,'PASS');
 const integrity=Object.fromEntries(['before','after','pristine'].map(which=>[which,{inventoryId:value[which].manifest.inventoryId,contentSha256:expected[which].contentSha256,
  catalogSha256:value[which].manifest.catalogSha256,tablesChecked:value[which].manifest.tables.length,rawFilesVerified:value[which].manifest.tables.length,globalSha256:expected[which].globals.sha256}]));
 const receipt={schemaVersion:'wfc.pf.conservation-v5.'+(runtime?'runtime':'migration')+'-qualification.v1',status:'PASS',context:expected.context,
  qualifierSha256:expected.qualifierSha256,policySha256:comparison.policySha256,captures:{before:expected.before,after:expected.after,pristine:expected.pristine},
  ...(runtime?{policy:expected.policy}:{}),integrity,comparison};
 receipt.receiptSha256=hash(receipt);return{expected,receipt};
}
function rehashReceipt(receipt){const{receiptSha256,...body}=receipt;receipt.receiptSha256=hash(body);}
test('versioned qualification receipts bind original captures, policy and source/target context',()=>{
 for(const runtime of [false,true]){const{receipt,expected}=qualificationReceipt({runtime});assert.equal(assertQualificationReceipt(receipt,expected),receipt);}
});
test('receipt fields cannot be changed under an unchanged body hash',()=>{
 const{receipt,expected}=qualificationReceipt();receipt.integrity.after.catalogSha256='f'.repeat(64);
 assert.throws(()=>assertQualificationReceipt(receipt,expected),{code:'B9_QUALIFICATION_RECEIPT_HASH'});
});
test('a self-consistently rehashed receipt still refuses wrong version, captures, extra fields and declared DDL',()=>{
 for(const mutate of [r=>{r.schemaVersion='wfc.pf.b9.migration-qualification.v1';},r=>{r.captures.after={...r.captures.after,contentSha256:'f'.repeat(64)};},r=>{r.comparison.extra=true;},r=>{r.comparison.managedChanges=['table:invented'];},r=>{r.comparison.newTables=['invented'];},r=>{r.extra=true;}]){
  const{receipt,expected}=qualificationReceipt();mutate(receipt);rehashReceipt(receipt);assert.throws(()=>assertQualificationReceipt(receipt,expected));
 }
});

test('idempotent v5 migration preserves populated terminal closures as ordinary protected business rows',()=>{
 const setup=populatedRuntimeFixture(),value=setup.value;value.after=clone(value.before);const result=migration(value);
 assert.equal(result.status,'PASS');assert.deepEqual(result.newTables,[]);assert.deepEqual(result.managedChanges,[]);
 assert.equal(value.after.manifest.tables.find(row=>row.table===TERMINAL).rows,'1');
});
test('source runtime permits the sole exact first additions while retaining typed engine-observer rules',()=>{
 const setup=populatedLegacyRuntimeFixture();setup.value.after=addV5(setup.value.after);setup.value.pristine=addV5(setup.value.pristine);
 setup.input.after=facts(setup.value.after);setup.input.pristine=facts(setup.value.pristine);setup.input.policy.phase='source-runtime';
 const result=qualifyRuntimeFacts(setup.input);assert.equal(result.status,'PASS');assert.equal(result.engineChangedProjects,1);
 assert.deepEqual(result.managedChanges,[...LOOKUPS.map(([,name])=>'index:'+name),'table:'+TERMINAL].sort(cmp));
});
test('target runtime cannot introduce even correctly pristine v5 objects',()=>{
 const setup=populatedLegacyRuntimeFixture();setup.value.after=addV5(setup.value.after);setup.value.pristine=addV5(setup.value.pristine);
 setup.input.after=facts(setup.value.after);setup.input.pristine=facts(setup.value.pristine);
 const result=qualifyRuntimeFacts(setup.input);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='V5_ADDITION_NOT_ALLOWED'));
});
for(const[description,mutate,code]of[
 ['nonempty first table',value=>replaceRows(value.after,TERMINAL,[closureHistory]),'V5_FIRST_TERMINAL_TABLE_NOT_EMPTY'],
 ['missing terminal table',value=>removeTable(value.after,TERMINAL),'V5_TERMINAL_TABLE_REQUIRED'],
 ['terminal column default',value=>{value.after.manifest.tables.find(row=>row.table===TERMINAL).columns[0].defaultSql='gen_random_uuid()';reseal(value.after.manifest);},'MANAGED_TABLE_DIFFERS_FROM_PRISTINE'],
 ['terminal trigger disabled',value=>{value.after.manifest.tables.find(row=>row.table===TERMINAL).definitions.triggers[0].enabled='D';reseal(value.after.manifest);},'MANAGED_TABLE_DIFFERS_FROM_PRISTINE'],
 ['terminal constraint changed',value=>{value.after.manifest.tables.find(row=>row.table===TERMINAL).definitions.constraints[0].definition+=' changed';reseal(value.after.manifest);},'MANAGED_TABLE_DIFFERS_FROM_PRISTINE'],
 ['lookup index wrong columns',value=>{value.after.manifest.tables.find(row=>row.table===LOOKUPS[0][0]).definitions.indexes[0].definition+=' WHERE false';reseal(value.after.manifest);},'V5_LOOKUP_INDEX_NOT_PRISTINE'],
 ['lookup index not valid',value=>{value.after.manifest.tables.find(row=>row.table===LOOKUPS[0][0]).definitions.indexes[0].valid=false;reseal(value.after.manifest);},'V5_LOOKUP_INDEX_NOT_PRISTINE'],
 ['lookup relation owner changed',value=>{value.after.globals.relations.find(row=>row.name===LOOKUPS[0][1]).owner='foreign_owner';},'V5_UNDECLARED_GLOBAL_ADDITION'],
 ['terminal relation ACL changed',value=>{value.after.globals.relations.find(row=>row.name===TERMINAL).acl=[{grantor:'pf_local',grantee:'PUBLIC',privilege:'SELECT',isGrantable:false}];},'V5_UNDECLARED_GLOBAL_ADDITION'],
 ['new routine invented',value=>{value.after.globals.routines.push(routine('zz_terminal_extra','new'));},'PUBLIC_GLOBALS_CHANGED'],
])test('v5 rejects '+description,()=>{const value=postB9Fixture();mutate(value);const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code===code),JSON.stringify(result));});
for(const[description,rows]of[
 ['changed record',[closureHistory.replace('"protectedClosure":"original"','"protectedClosure":"changed"')]],
 ['changed record hash',[closureHistory.replace('b'.repeat(64),'c'.repeat(64))]],
 ['deleted record',[]],
 ['additional record',[closureHistory,closureHistory.replace('a'.repeat(64),'c'.repeat(64))]],
])test('v5 runtime refuses '+description+' without any closure exemption',()=>{
 const setup=populatedRuntimeFixture();replaceRows(setup.value.after,TERMINAL,rows);
 const result=qualifyRuntimeFacts(setup.input);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='LEGACY_ROWS_OR_KEYS_CHANGED'&&row.object===TERMINAL));
});
test('an existing lookup index cannot be altered or dropped during an idempotent migration',()=>{
 for(const drop of [true,false]){const setup=populatedRuntimeFixture(),value=setup.value;value.after=clone(value.before);
  const table=value.after.manifest.tables.find(row=>row.table===LOOKUPS[0][0]);
  if(drop){table.definitions.indexes=[];value.after.globals.relations=value.after.globals.relations.filter(row=>row.name!==LOOKUPS[0][1]);}
  else table.definitions.indexes[0].definition+=' WHERE false';reseal(value.after.manifest);
  const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='UNDECLARED_LEGACY_DDL_CHANGE'));
 }
});

async function materializedFixture(){
 const value=postB9Fixture(),request=invocation(),operationId=randomUUID();request.context.operationId=operationId;
 request.operationDirectory=path.join(path.dirname(SOURCE.runtime),'barrier-delivery-'+operationId);request.context.runtime=path.join(request.operationDirectory,'restore-5192');
 await fs.mkdir(request.operationDirectory,{recursive:false,mode:0o700});
 for(const which of ['before','after','pristine']){
  const capture=value[which],directory=path.join(request.operationDirectory,which);await fs.mkdir(directory,{mode:0o700});
  const manifest=Buffer.from(canonical(capture.manifest)),globals=Buffer.from(canonical(capture.globals)),globalFile=path.join(request.operationDirectory,which+'.globals.private.json');
  await fs.writeFile(path.join(directory,'.owner.json'),canonical({schemaVersion:'wfc.operations.lossless-owner.v1',ownerId:OWNER,inventoryId:capture.manifest.inventoryId}),{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(directory,'manifest.json'),manifest,{flag:'wx',mode:0o600});await fs.writeFile(globalFile,globals,{flag:'wx',mode:0o600});
  for(const table of capture.manifest.tables)await fs.writeFile(path.join(directory,table.file.path),capture.files[table.file.path],{flag:'wx',mode:0o600});
  request[which]={directory,ownerId:OWNER,manifest:{path:path.join(directory,'manifest.json'),bytes:manifest.length,sha256:bytesHash(manifest)},globals:{path:globalFile,bytes:globals.length,sha256:bytesHash(globals)},contentSha256:capture.manifest.contentSha256};
 }
 request.qualifierSha256=bytesHash(await fs.readFile(fileURLToPath(new URL('./migration-conservation-v5.mjs',import.meta.url))));
 // These fresh synthetic directories are deliberately retained for root audit.
 return{request,value};
}
test('v5 verifies actual owned lossless raw files and binds its strict qualification receipt',async()=>{
 const{request}=await materializedFixture(),receipt=await qualifyMigrationInventories(request);
 assert.equal(receipt.status,'PASS');assert.equal(assertQualificationReceipt(receipt,request),receipt);
 assert.equal(receipt.integrity.before.rawFilesVerified,receipt.integrity.before.tablesChecked);assert.deepEqual(receipt.comparison.newTables,[TERMINAL]);
});
test('v5 refuses tampered raw business bytes even while supplied manifest pins remain unchanged',async()=>{
 const{request,value}=await materializedFixture(),table=value.after.manifest.tables.find(row=>row.table==='legacy_items');
 await fs.appendFile(path.join(request.after.directory,table.file.path),' ');await assert.rejects(qualifyMigrationInventories(request));
});
test('v5 refuses a changed qualifier source pin before reading inventories',async()=>{
 const fixture=await materializedFixture();fixture.request.qualifierSha256='f'.repeat(64);
 await assert.rejects(qualifyMigrationInventories(fixture.request),{code:'B9_QUALIFIER_SOURCE_CHANGED'});
});
