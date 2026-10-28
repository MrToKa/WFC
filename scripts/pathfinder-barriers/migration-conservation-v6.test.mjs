// Synthetic private raw inventories only; no SQL, Docker, HTTP or application runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {currentInventoryCanonicalHash as hash,currentInventorySchemaMetadata,currentInventoryFrame,losslessTopLevelFields} from '../pathfinder-copied-recovery/current-inventory-lib.mjs';
import {B9_MIGRATION_POLICY} from './migration-qualification.mjs';
import {V6_MIGRATION_POLICY,V6_RUNTIME_POLICY as B9_RUNTIME_POLICY,qualifyMigrationFacts,qualifyRuntimeFacts,qualifyMigrationInventories,qualifyRuntimeInventories,assertQualificationReceipt} from './migration-conservation-v6.mjs';
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

const PAIR_TABLES=['pf_automatic_pair_dispatch','pf_automatic_pair_mandates'],PAIR_ROUTINE='pf_automatic_pair_mandate_immutable';
const pairHistory=tableName=>JSON.stringify(tableName==='pf_automatic_pair_mandates'?{project_id:PROJECT,job_id:OWNER,cable_id:OWNER,id:OWNER,
 actor_id:OWNER,login_id:OWNER,record_sha256:'a'.repeat(64),record:{precise:'9007199254740993',kind:tableName,state:'written'},created_at:'2026-10-23T10:00:00Z'}
 :{project_id:PROJECT,job_id:OWNER,cable_id:OWNER,status:'written',attempts:1,owner_token:null,lease_until:null,not_before:null,reason_code:null,receipt_id:OWNER,updated_at:'2026-10-23T10:00:00Z'});
function pairTable(name,rows=[]){
 const types=name==='pf_automatic_pair_mandates'?{project_id:'uuid',job_id:'uuid',cable_id:'uuid',id:'uuid',actor_id:'uuid',login_id:'uuid',record_sha256:'text',record:'jsonb',created_at:'timestamp with time zone'}
  :{project_id:'uuid',job_id:'uuid',cable_id:'uuid',status:'text',attempts:'integer',owner_token:'uuid',lease_until:'timestamp with time zone',not_before:'timestamp with time zone',reason_code:'text',receipt_id:'uuid',updated_at:'timestamp with time zone'};
 const notNull=name==='pf_automatic_pair_mandates'?Object.keys(types):['project_id','job_id','cable_id','status','attempts','updated_at'];
 return table(name,rows,{columns:Object.entries(types).map(([key,type])=>({...column(key,{type}),notNull:notNull.includes(key)})),primaryKey:['project_id','job_id','cable_id'],
  constraints:V6_MIGRATION_POLICY.addedConstraints[name].map(key=>({name:key,definition:key.endsWith('_not_null')?'NOT NULL '+key:'synthetic pristine constraint '+key,validated:true})),
  indexes:V6_MIGRATION_POLICY.addedIndexes[name].map(key=>({name:key,definition:'synthetic pristine index '+key,valid:true,ready:true})),
  triggers:name==='pf_automatic_pair_mandates'?[{name:PAIR_ROUTINE,definition:'synthetic pristine immutable mandate trigger',enabled:'O'}]:[]});
}
function addPair(capture,{populated=false}={}){
 const tables=capture.manifest.tables.map(facts=>({facts:clone(facts),content:capture.files[facts.file.path],values:clone(capture.rows[facts.table])}));
 tables.push(...PAIR_TABLES.map(name=>pairTable(name,populated?[pairHistory(name)]:[])));
 const globals=clone(capture.globals);globals.routines.push(routine(PAIR_ROUTINE,'v6'));globals.routines.sort((a,b)=>cmp(a.name,b.name));
 globals.relations=[...tables.map(value=>relation(value.facts.table)),...tables.flatMap(value=>value.facts.definitions.indexes.map(index=>relation(index.name,'i'))),
  ...globals.sequences.map(value=>relation(value.definition.name,'S')),...globals.views.map(value=>relation(value.name,'v'))].sort((a,b)=>cmp(a.name,b.name));
 return finish(tables,globals,{database:capture.manifest.database.name,inventory:capture.manifest.inventoryId});
}
function pairFixture({existing=false,populated=false}={}){
 const setup=populatedRuntimeFixture(),before=clone(setup.value.before);
 return{before:existing?addPair(before,{populated}):before,after:addPair(clone(before),{populated}),pristine:addPair(setup.value.pristine)};
}
function pairRuntime({first=false,phase='target-runtime',populated=true}={}){
 const setup=populatedRuntimeFixture();
 for(const which of ['before','after','pristine']){
  if(which==='before'&&first)continue;
  setup.value[which]=addPair(setup.value[which],{populated:which!=='pristine'&&!first&&populated});setup.input[which]=facts(setup.value[which]);
 }
 setup.input.policy.phase=phase;return setup;
}
const changed=value=>value.managedChanges;
const additions=[...PAIR_TABLES.map(name=>'table:'+name),...Object.values(V6_MIGRATION_POLICY.addedIndexes).flat().map(name=>'index:'+name),'routine:'+PAIR_ROUTINE].sort(cmp);

test('v6 adds only the two exact empty tables, four indexes and immutable function while preserving all legacy rows and called sequences',()=>{
 const value=pairFixture(),result=migration(value);assert.equal(result.status,'PASS',JSON.stringify(result));
 assert.equal(result.schemaVersion,'wfc.pf.conservation-v6.migration-facts.v1');assert.deepEqual(result.newTables,PAIR_TABLES);assert.deepEqual(changed(result),additions);
 assert.equal(value.after.globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence).state.lastValue,'9007199254740993');
});
test('v6 idempotent migration retains populated mandate, dispatch and terminal closure history exactly',()=>{
 const value=pairFixture({existing:true,populated:true}),result=migration(value);assert.equal(result.status,'PASS',JSON.stringify(result));assert.deepEqual(result.newTables,[]);assert.deepEqual(changed(result),[]);
 for(const name of PAIR_TABLES)assert.equal(value.after.manifest.tables.find(row=>row.table===name).rows,'1');
});
test('v6 policies are immutable and bind the isolated new DDL source',()=>{
 assert.equal(V6_MIGRATION_POLICY.mode,'post-b27-automatic-pair-additive');assert.ok(V6_MIGRATION_POLICY.sourceAnchors.includes('server/pathfinder/automaticPairSchema.ts'));
 assert.ok(B9_RUNTIME_POLICY.sourceAnchors.includes('server/pathfinder/automaticPairSchema.ts'));assert.throws(()=>V6_MIGRATION_POLICY.newTables.push('cables'),TypeError);
 assert.throws(()=>V6_MIGRATION_POLICY.addedIndexes.pf_automatic_pair_dispatch.push('foreign'),TypeError);
 assert.deepEqual(B9_RUNTIME_POLICY.controls,['pf_recalculation_state','pf_recalculation_events']);
});
test('v6 declared object names match the isolated DDL export without importing server runtime',async()=>{
 const source=await fs.readFile(new URL('../../server/pathfinder/automaticPairSchema.ts',import.meta.url),'utf8');
 assert.deepEqual([...source.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map(match=>match[1]).sort(cmp),PAIR_TABLES);
 assert.deepEqual([...source.matchAll(/CREATE INDEX IF NOT EXISTS ([a-z_]+)/g)].map(match=>match[1]),['pf_automatic_pair_due']);
 assert.deepEqual([...source.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_]+)/g)].map(match=>match[1]),[PAIR_ROUTINE]);
 assert.deepEqual([...source.matchAll(/CREATE TRIGGER ([a-z_]+)/g)].map(match=>match[1]),[PAIR_ROUTINE]);assert.doesNotMatch(source,/CREATE SEQUENCE/);
});
for(const name of PAIR_TABLES){
 test('v6 refuses populated first-created '+name,()=>{const value=pairFixture();replaceRows(value.after,name,[pairHistory(name)]);const result=migration(value);
  assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='V6_FIRST_PAIR_TABLE_NOT_EMPTY'&&row.object===name));});
 test('v6 refuses populated pristine '+name,()=>{const value=pairFixture();replaceRows(value.pristine,name,[pairHistory(name)]);const result=migration(value);
  assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='V6_PRISTINE_PAIR_NOT_EMPTY'&&row.object===name));});
 for(const action of ['change','delete','add'])test('v6 migration conserves existing '+name+' '+action,()=>{
  const value=pairFixture({existing:true,populated:true});replaceRows(value.after,name,action==='delete'?[]:action==='change'?[pairHistory(name).replace('written','pending')]:[pairHistory(name),pairHistory(name).replace('"cable_id":"'+OWNER+'"','"cable_id":"'+PROJECT+'"')]);
  const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='LEGACY_ROWS_OR_KEYS_CHANGED'&&row.object===name));
 });
}
for(const[description,mutate,code]of[
 ['old Auto rows',v=>replaceRows(v.after,'pf_auto_lengths',['{"id":9007199254740994}']),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['old barrier history',v=>replaceRows(v.after,'pf_barrier_receipts',['{"id":9007199254740994}']),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['old terminal history',v=>replaceRows(v.after,TERMINAL,[]),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['numeric lexical precision',v=>replaceRows(v.after,'legacy_items',['{"id":9007199254740993,"amount":12345678901234567890.123456788}']),'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['called sequence reset',v=>{v.after.globals.sequences[0].state={lastValue:'1',isCalled:false};},'PUBLIC_GLOBALS_CHANGED'],
 ['old table default',v=>{v.after.manifest.tables.find(row=>row.table==='legacy_items').columns[0].defaultSql='42';reseal(v.after.manifest);},'UNDECLARED_LEGACY_DDL_CHANGE'],
 ['old lookup removal',v=>{const row=v.after.manifest.tables.find(row=>row.table===LOOKUPS[0][0]);row.definitions.indexes=[];v.after.globals.relations=v.after.globals.relations.filter(row=>row.name!==LOOKUPS[0][1]);reseal(v.after.manifest);},'UNDECLARED_LEGACY_DDL_CHANGE'],
 ['new trigger disabled',v=>{v.after.manifest.tables.find(row=>row.table===PAIR_TABLES[1]).definitions.triggers[0].enabled='D';reseal(v.after.manifest);},'MANAGED_TABLE_DIFFERS_FROM_PRISTINE'],
 ['new constraint changed',v=>{v.after.manifest.tables.find(row=>row.table===PAIR_TABLES[0]).definitions.constraints[0].definition+=' modified';reseal(v.after.manifest);},'MANAGED_TABLE_DIFFERS_FROM_PRISTINE'],
 ['new index invalid',v=>{v.after.manifest.tables.find(row=>row.table===PAIR_TABLES[0]).definitions.indexes[0].valid=false;reseal(v.after.manifest);},'MANAGED_TABLE_DIFFERS_FROM_PRISTINE'],
 ['new function changed',v=>{v.after.globals.routines.find(row=>row.name===PAIR_ROUTINE).definition+=' modified';},'V6_PAIR_ROUTINE_NOT_PRISTINE'],
 ['old function changed',v=>{v.after.globals.routines.find(row=>row.name==='pf_barrier_immutable').definition+=' modified';},'PUBLIC_GLOBALS_CHANGED'],
 ['new relation ACL',v=>{v.after.globals.relations.find(row=>row.name===PAIR_TABLES[0]).acl=[{grantor:'pf_local',grantee:'PUBLIC',privilege:'SELECT',isGrantable:false}];},'V6_UNDECLARED_GLOBAL_ADDITION'],
 ['old view changed',v=>{v.after.globals.views[0].definition+=' modified';},'PUBLIC_GLOBALS_CHANGED'],
])test('v6 refuses '+description,()=>{const value=pairFixture();mutate(value);const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code===code),JSON.stringify(result));});

function removeTable(capture,name){const indexes=capture.manifest.tables.find(row=>row.table===name)?.definitions.indexes.map(row=>row.name)??[];
 capture.manifest.tables=capture.manifest.tables.filter(row=>row.table!==name);capture.globals.relations=capture.globals.relations.filter(row=>row.name!==name&&!indexes.includes(row.name));reseal(capture.manifest);}
test('v6 does not inherit any V5 closure-table addition exception',()=>{
 const value=pairFixture();removeTable(value.before,TERMINAL);const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='REQUIRED_TABLE_MISSING'&&row.object===TERMINAL));
});
test('v6 cannot silently omit the new DDL from all captures',()=>{
 const value=pairFixture();for(const capture of Object.values(value)){for(const name of PAIR_TABLES)removeTable(capture,name);capture.globals.routines=capture.globals.routines.filter(row=>row.name!==PAIR_ROUTINE);}
 const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='V6_PAIR_TABLE_REQUIRED'));
});
for(const kind of ['index','trigger','constraint','rls','column'])test('v6 rejects undeclared '+kind+' even when smuggled into both candidate and pristine',()=>{
 const value=pairFixture();for(const which of ['after','pristine']){const capture=value[which],table=capture.manifest.tables.find(row=>row.table===PAIR_TABLES[0]);
  if(kind==='index'){table.definitions.indexes.push({name:'zz_undeclared_index',definition:'SELECT 1',valid:true,ready:true});capture.globals.relations.push(relation('zz_undeclared_index','i'));capture.globals.relations.sort((a,b)=>cmp(a.name,b.name));}
  else if(kind==='trigger')table.definitions.triggers.push({name:'zz_undeclared_trigger',definition:'SELECT 1',enabled:'O'});
  else if(kind==='constraint')table.definitions.constraints.push({name:'zz_undeclared_check',definition:'CHECK (true)',validated:true});
  else if(kind==='rls')table.definitions.rls.enabled=true;
  else table.columns.push(column('zz_undeclared'));reseal(capture.manifest);
 }
 const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='V6_UNDECLARED_PAIR_DEFINITION'));
});
test('v6 rejects undeclared routine additions even when pristine also contains them',()=>{
 const value=pairFixture();for(const which of ['after','pristine'])value[which].globals.routines.push(routine('zz_undeclared_function','new'));
 const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='V6_UNDECLARED_ROUTINE_ADDITION'));
});
test('v6 runtime retains the typed engine-observer exception with populated pair histories conserved',()=>{
 const setup=pairRuntime(),result=qualifyRuntimeFacts(setup.input);assert.equal(result.status,'PASS',JSON.stringify(result));assert.equal(result.engineChangedProjects,1);assert.deepEqual(changed(result),[]);
});
test('v6 source runtime may add exact empty pair tables without authorizing any pair row',()=>{
 const setup=pairRuntime({first:true,phase:'source-runtime'}),result=qualifyRuntimeFacts(setup.input);assert.equal(result.status,'PASS',JSON.stringify(result));assert.deepEqual(changed(result),additions);
});
test('v6 target runtime forbids even exact empty additions',()=>{
 const setup=pairRuntime({first:true}),result=qualifyRuntimeFacts(setup.input);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='V6_ADDITION_NOT_ALLOWED'));
});
for(const name of PAIR_TABLES)for(const action of ['change','delete','add'])test('v6 runtime refuses '+name+' '+action,()=>{
 const setup=pairRuntime();replaceRows(setup.value.after,name,action==='delete'?[]:action==='change'?[pairHistory(name).replace('written','pending')]:[pairHistory(name),pairHistory(name).replace('"cable_id":"'+OWNER+'"','"cable_id":"'+PROJECT+'"')]);
 const result=qualifyRuntimeFacts(setup.input);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='LEGACY_ROWS_OR_KEYS_CHANGED'&&row.object===name));
});

function invocation(){const operationId='93000000-0000-4000-8000-000000000009',operationDirectory=path.join(path.dirname(SOURCE.runtime),'barrier-delivery-'+operationId);
 const context={operationId,phase:'target-migration',runtime:path.join(operationDirectory,'restore-5192'),owner:OWNER,project:'wfc-pathfinder-local-123456789abc',port:5192,
  backupId:OWNER,candidate:{api:'sha256:'+'a'.repeat(64),web:'sha256:'+'b'.repeat(64)},engineIdentitySha256:ENGINE};
 const ref=which=>({directory:path.join(operationDirectory,which),ownerId:OWNER,manifest:{path:path.join(operationDirectory,which,'manifest.json'),bytes:1,sha256:'a'.repeat(64)},
  globals:{path:path.join(operationDirectory,which+'.globals.private.json'),bytes:1,sha256:'a'.repeat(64)},contentSha256:'a'.repeat(64)});
 return{context,qualifierSha256:'a'.repeat(64),operationDirectory,before:ref('before'),after:ref('after'),pristine:ref('pristine')};
}
async function materializedFixture({runtime=false}={}){
 const setup=runtime?pairRuntime():null,value=setup?.value??pairFixture(),request=invocation(),operationId=randomUUID();request.context.operationId=operationId;
 request.operationDirectory=path.join(path.dirname(SOURCE.runtime),'barrier-delivery-'+operationId);request.context.runtime=path.join(request.operationDirectory,'restore-5192');
 if(runtime){request.context.phase='target-runtime';request.policy=setup.input.policy;}
 await fs.mkdir(request.operationDirectory,{recursive:false,mode:0o700});
 for(const which of ['before','after','pristine']){const capture=value[which],directory=path.join(request.operationDirectory,which);await fs.mkdir(directory,{mode:0o700});
  const manifest=Buffer.from(canonical(capture.manifest)),globals=Buffer.from(canonical(capture.globals)),globalFile=path.join(request.operationDirectory,which+'.globals.private.json');
  await fs.writeFile(path.join(directory,'.owner.json'),canonical({schemaVersion:'wfc.operations.lossless-owner.v1',ownerId:OWNER,inventoryId:capture.manifest.inventoryId}),{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(directory,'manifest.json'),manifest,{flag:'wx',mode:0o600});await fs.writeFile(globalFile,globals,{flag:'wx',mode:0o600});
  for(const table of capture.manifest.tables)await fs.writeFile(path.join(directory,table.file.path),capture.files[table.file.path],{flag:'wx',mode:0o600});
  request[which]={directory,ownerId:OWNER,manifest:{path:path.join(directory,'manifest.json'),bytes:manifest.length,sha256:bytesHash(manifest)},globals:{path:globalFile,bytes:globals.length,sha256:bytesHash(globals)},contentSha256:capture.manifest.contentSha256};
 }
 request.qualifierSha256=bytesHash(await fs.readFile(new URL('./migration-conservation-v6.mjs',import.meta.url)));
 // Fresh private synthetic inventories are retained for the root's audit.
 return{request,value};
}
test('v6 verifies actual private lossless inventories and a strictly bound migration receipt',async()=>{
 const{request}=await materializedFixture(),receipt=await qualifyMigrationInventories(request);assert.equal(receipt.status,'PASS',JSON.stringify(receipt));
 assert.equal(assertQualificationReceipt(receipt,request),receipt);assert.deepEqual(receipt.comparison.newTables,PAIR_TABLES);
 assert.equal(receipt.integrity.before.rawFilesVerified,receipt.integrity.before.tablesChecked);
});
test('v6 verifies private runtime inventories without allowing any automatic-pair business writes',async()=>{
 const{request}=await materializedFixture({runtime:true}),receipt=await qualifyRuntimeInventories(request);assert.equal(receipt.status,'PASS',JSON.stringify(receipt));assert.equal(assertQualificationReceipt(receipt,request),receipt);
});
test('v6 refuses tampered raw bytes even while manifest pins remain unchanged',async()=>{
 const{request,value}=await materializedFixture(),table=value.after.manifest.tables.find(row=>row.table==='legacy_items');await fs.appendFile(path.join(request.after.directory,table.file.path),' ');
 await assert.rejects(qualifyMigrationInventories(request));
});
test('v6 refuses changed qualifier source pins before inventory reads',async()=>{
 const{request}=await materializedFixture();request.qualifierSha256='f'.repeat(64);await assert.rejects(qualifyMigrationInventories(request),{code:'B9_QUALIFIER_SOURCE_CHANGED'});
});
test('v6 receipts cannot be widened through a self-consistent rehash',async()=>{
 const{request}=await materializedFixture(),receipt=await qualifyMigrationInventories(request);
 for(const mutate of [v=>{v.schemaVersion='wfc.pf.conservation-v5.migration-qualification.v1';},v=>{v.comparison.managedChanges.push('table:cables');},
  v=>{v.comparison.managedChanges=['index:pf_automatic_pair_due'];v.comparison.newTables=[];},v=>{v.comparison.newTables=[];},v=>{v.extra=true;}]){
  const changed=clone(receipt);mutate(changed);const{receiptSha256,...body}=changed;changed.receiptSha256=hash(body);assert.throws(()=>assertQualificationReceipt(changed,request));
 }
});
