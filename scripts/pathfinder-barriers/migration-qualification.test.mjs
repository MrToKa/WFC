// Synthetic comparator/control fixtures; no SQL, containers or real business rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {currentInventoryCanonicalHash as hash,currentInventorySchemaMetadata,currentInventoryFrame,losslessTopLevelFields} from '../pathfinder-copied-recovery/current-inventory-lib.mjs';
import {B9_MIGRATION_POLICY,B9_RUNTIME_POLICY,qualifyMigrationFacts,qualifyRuntimeFacts,qualifyMigrationInventories,qualifyRuntimeInventories,assertQualificationReceipt} from './migration-qualification.mjs';

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
 const facts={table:name,columns,primaryKey,keyMode:'primary-key',definitions:{constraints:options.constraints??[],indexes:[],triggers:options.triggers??[],rls:{enabled:false,forced:false,policies:[]}},
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
 const next=table(tableName,rawRows,{columns:clone(old.columns),primaryKey:clone(old.primaryKey),constraints:clone(old.definitions.constraints),triggers:clone(old.definitions.triggers)});
 next.facts.file.path=old.file.path;capture.manifest.tables[index]=next.facts;capture.files[old.file.path]=next.content;capture.rows[tableName]=next.values;reseal(capture.manifest);}

test('migration-only conserves raw precision/keys/old sequence and qualifies only canonical new DDL',()=>{
 const result=migration(fixture());assert.equal(result.status,'PASS');assert.equal(result.newTables.length,7);assert.equal(result.legacyRowsChecked,'1');
 assert.equal(result.schemaVersion,'wfc.pf.b9.migration-facts.v1');
});
test('synthetic raw keys mirror producer text-cast arrays without bigint rounding',()=>{const value=fixture();assert.equal(value.before.rows.legacy_items[0].key,'["9007199254740993"]');
 const setup=runtimeFixture();assert.equal(setup.value.after.rows.pf_recalculation_events[0].key,'["'+PROJECT+'", "11"]');});
for(const[name,mutate,code]of[
 ['legacy row precision',v=>{v.after.manifest.tables.find(row=>row.table==='legacy_items').rowSha256='a'.repeat(64);reseal(v.after.manifest);},'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['legacy key set',v=>{v.after.manifest.tables.find(row=>row.table==='legacy_items').keySetSha256='a'.repeat(64);reseal(v.after.manifest);},'LEGACY_ROWS_OR_KEYS_CHANGED'],
 ['old sequence consumed',v=>{v.after.globals.sequences.find(row=>row.definition.name==='legacy_seq').state.lastValue='9007199254740994';},'LEGACY_SEQUENCE_CHANGED'],
 ['old sequence identity detached',v=>{v.after.globals.sequences.find(row=>row.definition.name==='legacy_seq').ownership=[];},'LEGACY_SEQUENCE_CHANGED'],
 ['new auto ordinal called',v=>{v.after.globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence).state.isCalled=true;},'NEW_AUTO_ORDINAL_NOT_PRISTINE'],
 ['new auto sequence ownership',v=>{v.after.globals.sequences.find(row=>row.definition.name===B9_MIGRATION_POLICY.newSequence).ownership[0].identity='d';},'NEW_AUTO_ORDINAL_NOT_PRISTINE'],
 ['new table backfill',v=>{v.after.manifest.tables.find(row=>row.table==='pf_auto_lengths').rows='1';reseal(v.after.manifest);},'NEW_MANAGED_TABLE_NOT_EMPTY'],
 ['new table default tampered',v=>{v.after.manifest.tables.find(row=>row.table==='pf_barrier_heads').columns[0].defaultSql='gen_random_uuid()';reseal(v.after.manifest);},'MANAGED_TABLE_DIFFERS_FROM_PRISTINE'],
 ['legacy RLS changed',v=>{v.after.manifest.tables.find(row=>row.table==='legacy_items').definitions.rls.enabled=true;reseal(v.after.manifest);},'UNDECLARED_LEGACY_DDL_CHANGE'],
 ['new routine tampered',v=>{v.after.globals.routines.find(row=>row.name==='pf_barrier_immutable').definition+=' changed';},'MANAGED_ROUTINE_NOT_EXACT'],
 ['relation owner changed',v=>{v.after.globals.relations.find(row=>row.name==='legacy_items').owner='another_owner';},'LEGACY_RELATION_METADATA_CHANGED'],
 ['existing view definition changed',v=>{v.after.globals.views[0].definition='SELECT 0::bigint AS id;';},'LEGACY_VIEW_CHANGED'],
 ['existing view column changed',v=>{v.after.globals.views[0].columns[0].type='numeric';},'LEGACY_VIEW_CHANGED'],
 ['existing view owner changed',v=>{v.after.globals.relations.find(row=>row.name==='standard_material_catalog').owner='another_owner';},'LEGACY_RELATION_METADATA_CHANGED'],
 ['existing view security changed',v=>{v.after.globals.relations.find(row=>row.name==='standard_material_catalog').acl=[{grantor:'pf_local',grantee:'PUBLIC',privilege:'SELECT',isGrantable:false}];},'LEGACY_RELATION_METADATA_CHANGED'],
 ['undeclared routine',v=>{v.after.globals.routines.push(routine('zz_foreign_added','final'));},'UNDECLARED_ROUTINE_ADDITION'],
 ['canonical check dropped',v=>{v.after.manifest.tables.find(row=>row.table==='pf_recalculation_events').definitions.constraints=[];reseal(v.after.manifest);},'UNDECLARED_LEGACY_DDL_CHANGE'],
])test('migration rejects '+name,()=>{const value=fixture();mutate(value);const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code===code),JSON.stringify(result));});
test('migration idempotent second pass allows no row/key/sequence drift',()=>{const value=fixture();value.before=clone(value.after);assert.equal(migration(value).status,'PASS');});
test('unsupported global definitions are refused rather than omitted',()=>{const value=fixture();value.before.globals.unsupportedObjects=[{kind:'type:e',name:'foreign_enum'}];assert.throws(()=>migration(value),{code:'B9_UNSUPPORTED_GLOBAL_OBJECT'});});
test('view definitions cannot be omitted from a still-present view relation',()=>{const value=fixture();value.after.globals.views=[];assert.throws(()=>migration(value),{code:'B9_GLOBAL_VIEW_COVERAGE'});});
test('index relations cannot be omitted while per-table definitions retain the index',()=>{const value=fixture();value.after.manifest.tables.find(row=>row.table==='legacy_items').definitions.indexes=[{name:'legacy_items_pkey',definition:'CREATE UNIQUE INDEX legacy_items_pkey ON public.legacy_items USING btree (id)',valid:true,ready:true}];
 reseal(value.after.manifest);assert.throws(()=>migration(value),{code:'B9_GLOBAL_INDEX_COVERAGE'});});
test('global index relations cannot be invented without per-table index definitions',()=>{const value=fixture();value.after.globals.relations.push(relation('zz_invented_index','i'));
 assert.throws(()=>migration(value),{code:'B9_GLOBAL_INDEX_COVERAGE'});});
test('undeclared view additions are refused even with complete metadata',()=>{const value=fixture();value.after.globals.views.push({name:'zz_added_view',definition:'SELECT 1 AS id;',columns:[{name:'id',type:'integer',collation:null}]});
 value.after.globals.relations.push(relation('zz_added_view','v'));const result=migration(value);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='LEGACY_VIEW_CHANGED'));assert.ok(result.failures.some(row=>row.code==='UNDECLARED_RELATION_ADDITION'));});
test('exported source policies cannot be widened by a caller',()=>{assert.throws(()=>B9_RUNTIME_POLICY.controls.push('cables'),TypeError);assert.throws(()=>B9_MIGRATION_POLICY.changedConstraints.push({table:'cables',name:'anything'}),TypeError);});

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
test('source-runtime allows exact engine-observer event/reset plus canonical DDL',()=>assert.equal(qualifyRuntimeFacts(runtimeFixture().input).status,'PASS'));
test('source-runtime preserves expired authority without renewing it',()=>assert.equal(qualifyRuntimeFacts(runtimeFixture({expired:true}).input).status,'PASS'));
test('target-runtime refuses a migration hidden inside runtime start',()=>{const{input}=runtimeFixture();input.policy.phase='target-runtime';const result=qualifyRuntimeFacts(input);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='TARGET_RUNTIME_DDL_CHANGED'));});
test('runtime control rows cannot be omitted behind an unchanged metadata digest',()=>{const{input}=runtimeFixture();input.rows.after.states=[];assert.throws(()=>qualifyRuntimeFacts(input),{code:'B9_CONTROL_COVERAGE'});});
test('runtime control row rewording cannot bypass its retained raw hash',()=>{const{input}=runtimeFixture();input.rows.after.states[0].rowText=input.rows.after.states[0].rowText.replace('OLD_REASON','OTHER_REASON');assert.throws(()=>qualifyRuntimeFacts(input),{code:'B9_CONTROL_DIGEST'});});
function rewriteState(setup,side,mutate){const row=JSON.parse(setup.input.rows[side].states[0].rowText);mutate(row);replaceRows(setup.value[side],'pf_recalculation_state',[JSON.stringify(row)]);
 setup.input.rows[side].states=setup.value[side].rows.pf_recalculation_state;}
for(const[name,mutate,code]of[
 ['authority renewal',row=>{row.authority_epoch++;row.authority_expires_at='2026-10-22T19:00:00.000Z';},'RUNTIME_PROTECTED_STATE_CHANGED'],
 ['generation skip',row=>{row.desired_generation=12;},'RUNTIME_ENGINE_STATE_DELTA'],
 ['arbitrary reason',row=>{row.reason_codes=['INVENTED_REASON'];},'RUNTIME_STATUS_OR_REASONS_DELTA'],
 ['wrong engine identity',row=>{row.engine_identity_sha256='f'.repeat(64);},'RUNTIME_ENGINE_NOT_OBSERVED'],
 ['outside control timestamp',row=>{row.updated_at='2026-10-22T19:00:00.000Z';},'RUNTIME_ENGINE_STATE_DELTA'],
])test('runtime rejects self-consistently rehashed '+name,()=>{const value=runtimeFixture();rewriteState(value,'after',mutate);const result=qualifyRuntimeFacts(value.input);
 assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code===code),JSON.stringify(result));});
test('runtime rejects a self-consistently rehashed unrelated cable/business mutation',()=>{const setup=runtimeFixture();replaceRows(setup.value.after,'legacy_items',['{"id":9007199254740993,"amount":12345678901234567890.123456788}']);
 const result=qualifyRuntimeFacts(setup.input);assert.equal(result.status,'FAIL');assert.ok(result.failures.some(row=>row.code==='LEGACY_ROWS_OR_KEYS_CHANGED'));});
test('runtime permits a proven revoked-login reset without granting fresh authority',()=>{const value=runtimeFixture({expired:true});
 for(const side of ['before','after']){
  rewriteState(value,side,row=>{row.authority_expires_at='2026-10-21T20:00:00.000Z';row.login_expires_at='2026-10-21T20:00:00.000Z';
   if(side==='after'){row.status='awaiting_authority';row.reason_codes=['ADMINISTRATOR_ENROLLMENT_REQUIRED'];row.updated_at='2026-10-21T19:00:00.200Z';}});
  const login=JSON.parse(value.input.rows[side].logins[0].rowText);login.expires_at='2026-10-21T20:00:00.000Z';replaceRows(value.value[side],'viewer_login_bindings',[JSON.stringify(login)]);
  value.input.rows[side].logins=value.value[side].rows.viewer_login_bindings;
 }
 assert.equal(qualifyRuntimeFacts(value.input).status,'PASS');
});

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
test('target-runtime positive control starts from an already migrated exact schema',()=>assert.equal(qualifyRuntimeFacts(migratedBefore(runtimeFixture()).input).status,'PASS'));

async function materialize(root,name,value){
 const directory=path.join(root,name);await fs.mkdir(directory,{mode:0o700});
 await fs.writeFile(path.join(directory,'.owner.json'),canonical({schemaVersion:'wfc.operations.lossless-owner.v1',ownerId:OWNER,inventoryId:value.manifest.inventoryId})+'\n',{mode:0o600});
 for(const[file,content]of Object.entries(value.files))await fs.writeFile(path.join(directory,file),content,{mode:0o600});
 const manifestPath=path.join(directory,'manifest.json'),globalsPath=path.join(root,name+'.global.private.json');
 const manifestBytes=Buffer.from(canonical(value.manifest)+'\n'),globalBytes=Buffer.from(canonical(value.globals)+'\n');await fs.writeFile(manifestPath,manifestBytes,{mode:0o600});await fs.writeFile(globalsPath,globalBytes,{mode:0o600});
 return{directory,ownerId:OWNER,manifest:{path:manifestPath,bytes:manifestBytes.length,sha256:bytesHash(manifestBytes)},globals:{path:globalsPath,bytes:globalBytes.length,sha256:bytesHash(globalBytes)},contentSha256:value.manifest.contentSha256};
}
test('actual private-file gate verifies every raw file and binds receipt to exact images/phase/pins',async()=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'wfc-b9-qualification-')),value=fixture();
 const source=fileURLToPath(new URL('./migration-qualification.mjs',import.meta.url));
 const input={context:{operationId:'40000000-0000-4000-8000-000000000001',phase:'target-migration',runtime:path.join(root,'restore-5192'),owner:OWNER,project:'wfc-pathfinder-local-synthetic',port:5192,
  backupId:'40000000-0000-4000-8000-000000000002',candidate:{api:'sha256:'+'a'.repeat(64),web:'sha256:'+'b'.repeat(64)},engineIdentitySha256:ENGINE},
  qualifierSha256:bytesHash(await fs.readFile(source)),operationDirectory:root,before:await materialize(root,'before',value.before),after:await materialize(root,'after',value.after),pristine:await materialize(root,'pristine',value.pristine)};
 const receipt=await qualifyMigrationInventories(input);assert.equal(receipt.status,'PASS');assert.equal(assertQualificationReceipt(receipt,input),receipt);
 for(const mutate of [v=>{v.context.candidate.api='sha256:'+'c'.repeat(64);},v=>{v.context.owner='40000000-0000-4000-8000-000000000003';},v=>{v.captures.before.contentSha256='c'.repeat(64);},
  v=>{v.integrity.before.rawFilesVerified=0;},v=>{v.status='FAIL';},v=>{v.comparison.schemaVersion='fabricated';}]){
  const tampered=clone(receipt);mutate(tampered);const{receiptSha256,...body}=tampered;tampered.receiptSha256=hash(body);assert.throws(()=>assertQualificationReceipt(tampered,input));}
 assert.throws(()=>assertQualificationReceipt(migration(value),input));
 const raw=path.join(input.before.directory,value.before.manifest.tables[0].file.path);await fs.appendFile(raw,'tamper\n');await assert.rejects(()=>qualifyMigrationInventories(input));
});
test('actual private runtime reader binds all control/security rows and explicit window',async()=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'wfc-b9-runtime-qualification-')),setup=migratedBefore(runtimeFixture());
 const source=fileURLToPath(new URL('./migration-qualification.mjs',import.meta.url));
 const input={context:{operationId:'50000000-0000-4000-8000-000000000001',phase:'target-runtime',runtime:path.join(root,'restore-5192'),owner:OWNER,project:'wfc-pathfinder-local-synthetic',port:5192,
  backupId:'50000000-0000-4000-8000-000000000002',candidate:{api:'sha256:'+'a'.repeat(64),web:'sha256:'+'b'.repeat(64)},engineIdentitySha256:ENGINE},
  qualifierSha256:bytesHash(await fs.readFile(source)),operationDirectory:root,policy:setup.input.policy,before:await materialize(root,'before',setup.value.before),
  after:await materialize(root,'after',setup.value.after),pristine:await materialize(root,'pristine',setup.value.pristine)};
 const receipt=await qualifyRuntimeInventories(input);assert.equal(receipt.status,'PASS');assert.equal(receipt.comparison.engineChangedProjects,1);assert.equal(assertQualificationReceipt(receipt,input),receipt);
 const changed=clone(input);changed.policy.engineIdentitySha256='a'.repeat(64);await assert.rejects(()=>qualifyRuntimeInventories(changed),{code:'B9_RUNTIME_BINDING'});
});
