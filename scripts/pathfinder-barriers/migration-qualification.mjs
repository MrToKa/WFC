// Source-pinned B9 qualification. Importing this module performs no SQL, Docker,
// application startup or mutation. Business rows stay in private raw inventories.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {compareCurrentInventories,currentInventoryCanonicalHash,currentInventoryFrame,currentInventorySchemaMetadata,losslessTopLevelFields} from '../pathfinder-copied-recovery/current-inventory-lib.mjs';

const HASH=/^[a-f0-9]{64}$(?![\s\S])/,IMAGE=/^sha256:[a-f0-9]{64}$(?![\s\S])/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$(?![\s\S])/;
const NEW_TABLES=Object.freeze(['pf_auto_length_admissions','pf_auto_length_targets','pf_auto_lengths','pf_barrier_capture_intents','pf_barrier_heads','pf_barrier_receipts','pf_barrier_snapshots']);
const NEW_ROUTINES=Object.freeze(['pf_auto_length_admission_immutable','pf_barrier_immutable','pf_barrier_intent_immutable']);
const CHANGED_ROUTINES=Object.freeze(['pf_recalculation_dirty','pf_recalculation_row_event']);
const AUTO_SEQUENCE='pf_auto_length_admissions_ordinal_seq';
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export const B9_MIGRATION_POLICY=freeze({schemaVersion:'wfc.pf.b9.migration-policy.v1',newTables:NEW_TABLES,newRoutines:NEW_ROUTINES,
 changedRoutines:CHANGED_ROUTINES,changedConstraints:[{table:'pf_recalculation_events',name:'pf_recalculation_events_domain_check'}],
 addedTriggers:[{table:'pf_barrier_heads',name:'pf_recalculation_row_event'}],newSequence:AUTO_SEQUENCE,
 data:'all-legacy-raw-row-and-key-hashes-exact;new-seven-tables-empty;existing-sequence-state-exact;new-ordinal-uncalled',
 sourceAnchors:['server/pathfinder/barrierRegistrySchema.ts','server/pathfinder/recalculationSchema.ts','server/pathfinder/autoLengthSchema.ts']});
export const B9_RUNTIME_POLICY=freeze({schemaVersion:'wfc.pf.b9.runtime-policy.v1',mode:'engine-observer-and-proven-expired-authority-only',
 controls:['pf_recalculation_state','pf_recalculation_events'],otherRows:'exact',sequences:'exact',
 sourceAnchors:['server/pathfinder/calculationEngineObserver.ts','server/pathfinder/recalculationSchema.ts','server/pathfinder/recalculationRepository.ts']});
export const B9_QUALIFICATION_LIMITS=Object.freeze({manifestBytes:16*1024**2,globalBytes:16*1024**2,receiptBytes:1024**2,
 tables:500,globals:20000,failures:128,milliseconds:300000,controlRows:100000});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const order=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
const fail=code=>{throw Object.assign(Error(code),{code});};
const need=(value,code='B9_QUALIFICATION_INVALID')=>{if(!value)fail(code);};
const text=(value,max=65536)=>typeof value==='string'&&Buffer.byteLength(value)<=max&&!value.includes('\0');
const name=value=>text(value,63)&&value.length>0;
const decimal=value=>typeof value==='string'&&/^(?:0|[1-9][0-9]{0,19})$(?![\s\S])/.test(value);
const sorted=values=>values.every((value,index)=>index===0||order(values[index-1],value)<0);
const signature=row=>row.name+'\0'+row.arguments+'\0'+row.kind;
const mapBy=(values,key)=>new Map(values.map(value=>[key(value),value]));
function collector(){const failures=[];return{failures,add(code,object){if(failures.length<B9_QUALIFICATION_LIMITS.failures)failures.push({code,object});else fail('B9_QUALIFICATION_FAILURE_LIMIT');}};}

function manifestFacts(value){
 need(exact(value,['schemaVersion','status','scope','projection','ownerId','inventoryId','database','tables','catalogSha256','contentSha256'])
  &&value.schemaVersion==='wfc.operations.lossless-inventory.v1'&&value.status==='PASS'&&value.scope==='public'&&value.projection==='postgresql-jsonb-text.v1'
  &&UUID.test(value.ownerId??'')&&UUID.test(value.inventoryId??'')&&exact(value.database,['name','encoding','serverVersionNum'])&&name(value.database.name)
  &&value.database.encoding==='UTF8'&&typeof value.database.serverVersionNum==='string'&&/^[1-9][0-9]{4,7}$/.test(value.database.serverVersionNum)
  &&Array.isArray(value.tables)&&value.tables.length<=B9_QUALIFICATION_LIMITS.tables&&sorted(value.tables.map(table=>table.table)),'B9_MANIFEST_INVALID');
 let total=0n;
 for(const table of value.tables){
  need(exact(table,['table','columns','primaryKey','keyMode','definitions','rows','rawBytes','schemaSha256','rowSha256','keySetSha256','file','fencing'])
   &&name(table.table)&&Array.isArray(table.columns)&&table.columns.length>0&&Array.isArray(table.primaryKey)
   &&exact(table.definitions,['constraints','indexes','triggers','rls'])&&decimal(table.rows)&&BigInt(table.rows)<=1000000n
   &&decimal(table.rawBytes)&&HASH.test(table.schemaSha256??'')&&HASH.test(table.rowSha256??'')
   &&(table.keyMode==='primary-key'?HASH.test(table.keySetSha256??''):table.keyMode==='row-multiset'&&table.keySetSha256===null),'B9_TABLE_FACTS_INVALID');
  need(table.schemaSha256===currentInventoryCanonicalHash(currentInventorySchemaMetadata(table)),'B9_TABLE_SCHEMA_HASH');
  total+=BigInt(table.rows);need(total<=2000000n,'B9_ROW_LIMIT');
 }
 need(value.catalogSha256===hash(value.tables.map(currentInventorySchemaMetadata)),'B9_CATALOG_HASH');
 const {contentSha256,...body}=value;need(HASH.test(contentSha256??'')&&contentSha256===hash(body),'B9_CONTENT_HASH');
 return value;
}
function acl(value){need(Array.isArray(value)&&value.length<=10000&&value.every(item=>exact(item,['grantor','grantee','privilege','isGrantable'])
 &&name(item.grantor)&&name(item.grantee)&&text(item.privilege,128)&&typeof item.isGrantable==='boolean'),'B9_GLOBAL_ACL');
 need(sorted(value.map(row=>[row.grantor,row.grantee,row.privilege,row.isGrantable?'1':'0'].join('\0'))),'B9_GLOBAL_ACL_ORDER');}
function globalFacts(value){
 need(exact(value,['schemaVersion','namespace','relations','views','routines','sequences','extensions','unsupportedObjects'])
  &&value.schemaVersion==='wfc.pf.public-global-sql.v2'&&exact(value.namespace,['owner','acl'])&&name(value.namespace.owner),'B9_GLOBAL_INVALID');acl(value.namespace.acl);
 for(const group of ['relations','views','routines','sequences','extensions','unsupportedObjects'])need(Array.isArray(value[group])&&value[group].length<=B9_QUALIFICATION_LIMITS.globals,'B9_GLOBAL_LIMIT');
 for(const row of value.relations){need(exact(row,['name','kind','owner','persistence','replicaIdentity','acl'])&&name(row.name)&&['r','i','S','v'].includes(row.kind)
  &&name(row.owner)&&['p','u','t'].includes(row.persistence)&&['d','n','f','i'].includes(row.replicaIdentity),'B9_RELATION_INVALID');acl(row.acl);}
 need(sorted(value.relations.map(row=>row.name)),'B9_RELATION_ORDER');
 for(const row of value.views){need(exact(row,['name','definition','columns'])&&name(row.name)&&text(row.definition,1024**2)&&row.definition.length>0
  &&Array.isArray(row.columns)&&row.columns.length>0&&row.columns.length<=1600,'B9_VIEW_INVALID');
  const columns=new Set();for(const column of row.columns){need(exact(column,['name','type','collation'])&&name(column.name)&&!columns.has(column.name)
   &&text(column.type,65536)&&column.type.length>0&&(column.collation===null||text(column.collation,65536)&&column.collation.length>0),'B9_VIEW_COLUMN_INVALID');columns.add(column.name);}}
 need(sorted(value.views.map(row=>row.name)),'B9_VIEW_ORDER');
 for(const row of value.routines){need(exact(row,['name','arguments','kind','definition','owner','acl'])&&name(row.name)&&text(row.arguments)
  &&['f','p'].includes(row.kind)&&text(row.definition,1024**2)&&row.definition.length>0&&name(row.owner),'B9_ROUTINE_INVALID');acl(row.acl);}
 need(sorted(value.routines.map(signature)),'B9_ROUTINE_ORDER');
 for(const row of value.sequences){need(exact(row,['definition','state','owner','acl','ownership'])&&exact(row.definition,['name','dataType','start','min','max','increment','cycle','cache'])
  &&name(row.definition.name)&&text(row.definition.dataType,128)&&['start','min','max','increment','cache'].every(key=>typeof row.definition[key]==='string'&&/^-?(?:0|[1-9][0-9]{0,19})$/.test(row.definition[key]))
  &&typeof row.definition.cycle==='boolean'&&exact(row.state,['lastValue','isCalled'])&&typeof row.state.lastValue==='string'&&/^-?(?:0|[1-9][0-9]{0,19})$/.test(row.state.lastValue)
  &&typeof row.state.isCalled==='boolean'&&name(row.owner)&&Array.isArray(row.ownership)&&row.ownership.length<=1,'B9_SEQUENCE_INVALID');acl(row.acl);
  for(const link of row.ownership)need(exact(link,['dependencyKind','tableSchema','table','column','identity'])&&['a','i'].includes(link.dependencyKind)
   &&name(link.tableSchema)&&name(link.table)&&name(link.column)&&['','a','d'].includes(link.identity),'B9_SEQUENCE_OWNERSHIP');}
 need(sorted(value.sequences.map(row=>row.definition.name)),'B9_SEQUENCE_ORDER');
 for(const row of value.extensions)need(exact(row,['name','version','schema','owner'])&&name(row.name)&&text(row.version,256)&&name(row.schema)&&name(row.owner),'B9_EXTENSION_INVALID');
 need(sorted(value.extensions.map(row=>row.name)),'B9_EXTENSION_ORDER');
 need(value.unsupportedObjects.length===0,'B9_UNSUPPORTED_GLOBAL_OBJECT');
 return value;
}
function facts(value){need(exact(value,['manifest','globals']),'B9_CAPTURE_FACTS');const result={manifest:manifestFacts(value.manifest),globals:globalFacts(value.globals)};
 need(same(result.manifest.tables.map(table=>table.table),result.globals.relations.filter(row=>row.kind==='r').map(row=>row.name)),'B9_GLOBAL_TABLE_COVERAGE');
 const indexes=result.manifest.tables.flatMap(table=>table.definitions.indexes.map(index=>index.name)).sort(order);
 need(sorted(indexes)&&same(indexes,result.globals.relations.filter(row=>row.kind==='i').map(row=>row.name)),'B9_GLOBAL_INDEX_COVERAGE');
 need(same(result.globals.sequences.map(row=>row.definition.name),result.globals.relations.filter(row=>row.kind==='S').map(row=>row.name)),'B9_GLOBAL_SEQUENCE_COVERAGE');
 need(same(result.globals.views.map(row=>row.name),result.globals.relations.filter(row=>row.kind==='v').map(row=>row.name)),'B9_GLOBAL_VIEW_COVERAGE');return result;}
function rowEqual(before,after,issues){if(before.rows!==after.rows||before.rowSha256!==after.rowSha256||before.keySetSha256!==after.keySetSha256)
 issues.add('LEGACY_ROWS_OR_KEYS_CHANGED',before.table);}
function withoutConstraint(table,constraint){const value=currentInventorySchemaMetadata(table);return{...value,definitions:{...value.definitions,constraints:value.definitions.constraints.filter(row=>row.name!==constraint)}};}
function schemaComparison(before,after,pristine,issues){
 const old=mapBy(before.manifest.tables,row=>row.table),next=mapBy(after.manifest.tables,row=>row.table),expected=mapBy(pristine.manifest.tables,row=>row.table);
 const changed=[];
 for(const [table,initial]of old){const current=next.get(table);if(!current){issues.add('LEGACY_TABLE_MISSING',table);continue;}
  if(NEW_TABLES.includes(table))continue;
  if(table==='pf_recalculation_events'){
   const constraint='pf_recalculation_events_domain_check',canonicalExpected=expected.get(table);
   if(!canonicalExpected||!same(withoutConstraint(initial,constraint),withoutConstraint(current,constraint))
    ||initial.definitions.constraints.filter(row=>row.name===constraint).length!==1||canonicalExpected.definitions.constraints.filter(row=>row.name===constraint).length!==1
    ||current.definitions.constraints.filter(row=>row.name===constraint).length!==1
    ||!same(current.definitions.constraints.filter(row=>row.name===constraint),canonicalExpected.definitions.constraints.filter(row=>row.name===constraint)))issues.add('UNDECLARED_LEGACY_DDL_CHANGE',table);
   if(initial.schemaSha256!==current.schemaSha256)changed.push('constraint:'+table+'.'+constraint);
  }else if(initial.schemaSha256!==current.schemaSha256)issues.add('UNDECLARED_LEGACY_DDL_CHANGE',table);
 }
 for(const table of NEW_TABLES){const current=next.get(table),canonicalExpected=expected.get(table);
  if(!current||!canonicalExpected||!same(currentInventorySchemaMetadata(current),currentInventorySchemaMetadata(canonicalExpected)))issues.add('MANAGED_TABLE_DIFFERS_FROM_PRISTINE',table);
  if(current&&current.rows!=='0')issues.add('NEW_MANAGED_TABLE_NOT_EMPTY',table);
  if(current&&!old.has(table))changed.push('table:'+table);
 }
 for(const table of next.keys())if(!old.has(table)&&!NEW_TABLES.includes(table))issues.add('UNDECLARED_TABLE_ADDITION',table);
 if(!same(before.globals.namespace,after.globals.namespace))issues.add('PUBLIC_NAMESPACE_CHANGED','public');
 if(!same(before.globals.extensions,after.globals.extensions))issues.add('EXTENSION_CHANGED','public');
 if(!same(before.globals.views,after.globals.views))issues.add('LEGACY_VIEW_CHANGED','public');
 const oldR=mapBy(before.globals.routines,signature),newR=mapBy(after.globals.routines,signature),pristineR=mapBy(pristine.globals.routines,signature);
 for(const [key,initial]of oldR){const current=newR.get(key);if(!current)issues.add('LEGACY_ROUTINE_MISSING',initial.name);
  else if(CHANGED_ROUTINES.includes(initial.name)||NEW_ROUTINES.includes(initial.name)){
   if(!same(current,pristineR.get(key)))issues.add('MANAGED_ROUTINE_DIFFERS_FROM_PRISTINE',initial.name);
   if(!same(initial,current))changed.push('routine:'+initial.name);
  }else if(!same(initial,current))issues.add('UNDECLARED_ROUTINE_CHANGE',initial.name);}
 for(const [key,current]of newR)if(!oldR.has(key)){
  if(!NEW_ROUTINES.includes(current.name)||!same(current,pristineR.get(key)))issues.add('UNDECLARED_ROUTINE_ADDITION',current.name);
  else changed.push('routine:'+current.name);}
 for(const routine of [...NEW_ROUTINES,...CHANGED_ROUTINES]){
  const actual=after.globals.routines.filter(row=>row.name===routine),expectedRoutine=pristine.globals.routines.filter(row=>row.name===routine);
  if(actual.length!==1||expectedRoutine.length!==1||!same(actual,expectedRoutine))issues.add('MANAGED_ROUTINE_NOT_EXACT',routine);}
 const oldS=mapBy(before.globals.sequences,row=>row.definition.name),newS=mapBy(after.globals.sequences,row=>row.definition.name),pristineS=mapBy(pristine.globals.sequences,row=>row.definition.name);
 for(const [key,initial]of oldS)if(!same(initial,newS.get(key)))issues.add('LEGACY_SEQUENCE_CHANGED',key);
 for(const [key,current]of newS)if(!oldS.has(key)&&key!==AUTO_SEQUENCE)issues.add('UNDECLARED_SEQUENCE_ADDITION',key);
 const auto=newS.get(AUTO_SEQUENCE),canonicalAuto=pristineS.get(AUTO_SEQUENCE);
 if(!auto||!canonicalAuto||!same(auto,canonicalAuto)||auto.state.lastValue!==auto.definition.start||auto.state.isCalled
  ||!same(auto.ownership,[{dependencyKind:'i',tableSchema:'public',table:'pf_auto_length_admissions',column:'ordinal',identity:'a'}]))issues.add('NEW_AUTO_ORDINAL_NOT_PRISTINE',AUTO_SEQUENCE);
 if(auto&&!oldS.has(AUTO_SEQUENCE))changed.push('sequence:'+AUTO_SEQUENCE);
 const oldC=mapBy(before.globals.relations,row=>row.name),newC=mapBy(after.globals.relations,row=>row.name),pristineC=mapBy(pristine.globals.relations,row=>row.name);
 const managedRelations=new Set([...NEW_TABLES,AUTO_SEQUENCE,...NEW_TABLES.flatMap(table=>(expected.get(table)?.definitions.indexes??[]).map(index=>index.name))]);
 for(const [key,initial]of oldC)if(!same(initial,newC.get(key)))issues.add('LEGACY_RELATION_METADATA_CHANGED',key);
 for(const [key,current]of newC)if(!oldC.has(key)){
  if(!managedRelations.has(key)||!same(current,pristineC.get(key)))issues.add('UNDECLARED_RELATION_ADDITION',key);
 }
 for(const key of managedRelations)if(!same(newC.get(key),pristineC.get(key)))issues.add('MANAGED_RELATION_METADATA_NOT_PRISTINE',key);
 return changed.sort(order);
}
export function qualifyMigrationFacts(input){
 need(exact(input,['before','after','pristine']),'B9_MIGRATION_FACTS_INPUT');
 const before=facts(input.before),after=facts(input.after),pristine=facts(input.pristine),issues=collector();
 if(!same(before.manifest.database,after.manifest.database)||before.manifest.database.encoding!==pristine.manifest.database.encoding
  ||before.manifest.database.serverVersionNum!==pristine.manifest.database.serverVersionNum)issues.add('DATABASE_IDENTITY_CHANGED','database');
 const changes=schemaComparison(before,after,pristine,issues),next=mapBy(after.manifest.tables,row=>row.table);
 for(const old of before.manifest.tables)if(next.has(old.table))rowEqual(old,next.get(old.table),issues);
 return{schemaVersion:'wfc.pf.b9.migration-facts.v1',status:issues.failures.length?'FAIL':'PASS',policySha256:hash(B9_MIGRATION_POLICY),
  legacyTablesChecked:before.manifest.tables.length,legacyRowsChecked:before.manifest.tables.reduce((sum,row)=>sum+BigInt(row.rows),0n).toString(),
  newTables:NEW_TABLES.filter(table=>!before.manifest.tables.some(row=>row.table===table)),managedChanges:changes,failures:issues.failures};
}

function stringToken(value,nullable=false){if(nullable&&value==='null')return null;need(typeof value==='string'&&value.startsWith('"'),'B9_CONTROL_TOKEN');
 const parsed=JSON.parse(value);need(typeof parsed==='string','B9_CONTROL_TOKEN');return parsed;}
function boolToken(value){need(value==='true'||value==='false','B9_CONTROL_TOKEN');return value==='true';}
function revisionToken(value){need(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,18})$(?![\s\S])/.test(value)&&BigInt(value)<=9223372036854775807n,'B9_CONTROL_REVISION');return BigInt(value);}
function stampToken(value,nullable=false){const parsed=stringToken(value,nullable);if(parsed===null)return null;
 need(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/.test(parsed)&&Number.isFinite(Date.parse(parsed)),'B9_CONTROL_TIMESTAMP');return Date.parse(parsed);}
function reasonsToken(value){need(typeof value==='string'&&Buffer.byteLength(value)<=65536,'B9_CONTROL_REASONS');const result=JSON.parse(value);
 need(Array.isArray(result)&&result.length<=64&&result.every(reason=>typeof reason==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(reason)),'B9_CONTROL_REASONS');return result;}
function fields(row){need(exact(row,['key','rowText'])&&typeof row.key==='string'&&text(row.rowText,32*1024**2),'B9_CONTROL_ROW');return losslessTopLevelFields(row.rowText);}
function records(rows,key){need(Array.isArray(rows)&&rows.length<=B9_QUALIFICATION_LIMITS.controlRows,'B9_CONTROL_LIMIT');const values=new Map();
 for(const row of rows){const value=fields(row),identity=key(value);need(!values.has(identity),'B9_DUPLICATE_CONTROL_ROW');values.set(identity,value);}return values;}
function sameFields(before,after,ignored=new Set()){
 if(!same([...before.keys()].sort(order),[...after.keys()].sort(order)))return false;
 return [...before.keys()].every(key=>ignored.has(key)||before.get(key)===after.get(key));
}
function runtimePolicy(value){need(exact(value,['schemaVersion','mode','phase','engineIdentitySha256','startedAt','stoppedAt'])
 &&value.schemaVersion==='wfc.pf.b9.runtime-window.v1'&&value.mode===B9_RUNTIME_POLICY.mode&&['target-runtime','source-runtime'].includes(value.phase)
 &&HASH.test(value.engineIdentitySha256??'')&&typeof value.startedAt==='string'&&typeof value.stoppedAt==='string'
 &&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.startedAt)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.stoppedAt),'B9_RUNTIME_POLICY_INVALID');
 const start=Date.parse(value.startedAt),stop=Date.parse(value.stoppedAt);
 need(Number.isFinite(start)&&Number.isFinite(stop)&&stop>=start&&stop-start<=300000,'B9_RUNTIME_WINDOW_INVALID');return{start,stop};}
function runtimeRows(value){need(exact(value,['states','events','users','logins']),'B9_RUNTIME_ROWS');return{
 states:records(value.states,row=>stringToken(row.get('project_id'))),
 events:records(value.events,row=>stringToken(row.get('project_id'))+'\0'+revisionToken(row.get('generation'))),
 users:records(value.users,row=>stringToken(row.get('id'))),logins:records(value.logins,row=>stringToken(row.get('login_id')))};}
function bindControlRows(rows,manifest){
 const tables=new Map(manifest.tables.map(table=>[table.table,table]));
 for(const [field,tableName]of Object.entries({states:'pf_recalculation_state',events:'pf_recalculation_events',users:'users',logins:'viewer_login_bindings'})){
  const table=tables.get(tableName),values=rows[field];need(table&&Array.isArray(values)&&String(values.length)===table.rows,'B9_CONTROL_COVERAGE');
  const digest=createHash('sha256').update('wfc.lossless.table-rows.v1\n'),keys=createHash('sha256').update('wfc.lossless.table-keys.v1\n');let previous;
  for(const row of values){fields(row);need(previous===undefined||order(previous,row.key)<0,'B9_CONTROL_ORDER');previous=row.key;
   currentInventoryFrame(digest,row.key);currentInventoryFrame(digest,row.rowText);currentInventoryFrame(keys,row.key);}
  need(digest.digest('hex')===table.rowSha256&&keys.digest('hex')===table.keySetSha256,'B9_CONTROL_DIGEST');
 }
}
function authorityLost(row,security,at){
 const expiry=stampToken(row.get('authority_expires_at'),true);if(expiry!==null&&expiry<=at)return true;
 const actor=stringToken(row.get('actor_id'),true),login=stringToken(row.get('login_id'),true),user=security.users.get(actor),binding=security.logins.get(login);
 return !user||!boolToken(user.get('is_admin'))||!binding||stringToken(binding.get('user_id'))!==actor||binding.get('revoked_at')!=='null'
  ||binding.get('expires_at')!==row.get('login_expires_at')||stampToken(binding.get('expires_at'))<=at;
}
function runtimeControlComparison(before,after,policy,issues){
 const window=runtimePolicy(policy),old=runtimeRows(before),next=runtimeRows(after),changedProjects=new Map();
 for(const [project,initial]of old.states){const current=next.states.get(project);if(!current){issues.add('RUNTIME_STATE_MISSING','pf_recalculation_state');continue;}
  const engineChanged=stringToken(initial.get('engine_identity_sha256'),true)!==policy.engineIdentitySha256||initial.get('engine_unavailable_code')!=='null';
  const fieldsAllowed=new Set(['engine_identity_sha256','engine_unavailable_code','desired_generation','first_dirty_at','due_at','attempts','attempt_generation','reason_codes','status','updated_at']);
  if(!sameFields(initial,current,fieldsAllowed)){issues.add('RUNTIME_PROTECTED_STATE_CHANGED',project);continue;}
  const oldGeneration=revisionToken(initial.get('desired_generation')),generation=revisionToken(current.get('desired_generation'));
  const enabled=boolToken(initial.get('enabled')),paused=boolToken(initial.get('paused')),updated=stampToken(current.get('updated_at'));
  const within=updated>=window.start-1&&updated<=window.stop+1;
  const isExpiredOverride=stringToken(current.get('status'))==='awaiting_authority'
   &&same(reasonsToken(current.get('reason_codes')),['ADMINISTRATOR_ENROLLMENT_REQUIRED'])&&enabled&&!paused&&authorityLost(initial,old,updated);
  if(stringToken(current.get('engine_identity_sha256'),true)!==policy.engineIdentitySha256||current.get('engine_unavailable_code')!=='null')issues.add('RUNTIME_ENGINE_NOT_OBSERVED',project);
  if(engineChanged){
   if(generation!==oldGeneration+1n||current.get('attempts')!=='0'||current.get('attempt_generation')!=='null'||!within)issues.add('RUNTIME_ENGINE_STATE_DELTA',project);
   const firstBefore=stampToken(initial.get('first_dirty_at'),true),firstAfter=stampToken(current.get('first_dirty_at'),true),due=stampToken(current.get('due_at'),true);
   const cap=firstBefore===null?Infinity:firstBefore+5000;
   if(firstAfter===null||due===null||(firstBefore===null?(firstAfter<window.start-1||firstAfter>window.stop+1):initial.get('first_dirty_at')!==current.get('first_dirty_at'))
    ||due<Math.min(cap,window.start+500)-1||due>Math.min(cap,window.stop+500)+1)issues.add('RUNTIME_DIRTY_TIME_DELTA',project);
   const expectedReasons=[...new Set([...reasonsToken(initial.get('reason_codes')),'ENGINE_IDENTITY_CHANGED'])].sort(order).slice(0,64);
   const expiry=stampToken(initial.get('authority_expires_at'),true);
   const allowedStatus=!enabled?['disabled']:paused?['paused']:expiry===null||expiry>window.stop?['debouncing']
    :expiry<=window.start?['awaiting_authority']:['awaiting_authority','debouncing'];
   if(!isExpiredOverride&&(!same(reasonsToken(current.get('reason_codes')),expectedReasons)||!allowedStatus.includes(stringToken(current.get('status')))))issues.add('RUNTIME_STATUS_OR_REASONS_DELTA',project);
   // The expiry-loss UPDATE is possible only after an intermediate status other
   // than awaiting_authority; reject an invented second reset when already expired.
   if(isExpiredOverride&&enabled&&!paused&&expiry!==null&&expiry<=window.start)issues.add('RUNTIME_UNPROVEN_AUTHORITY_RESET',project);
   changedProjects.set(project,generation);
  }else{
   const unchanged=new Set(['status','reason_codes','updated_at']);
   if(!sameFields(initial,current,unchanged)||generation!==oldGeneration)issues.add('RUNTIME_UNDECLARED_STATE_DELTA',project);
   if(!sameFields(initial,current)&&(!isExpiredOverride||initial.get('status')==='"awaiting_authority"'||!within))issues.add('RUNTIME_UNPROVEN_STATE_RESET',project);
  }
 }
 for(const project of next.states.keys())if(!old.states.has(project))issues.add('RUNTIME_UNDECLARED_STATE_ADDITION',project);
 for(const [key,initial]of old.events){const current=next.events.get(key);if(current){if(!sameFields(initial,current))issues.add('RUNTIME_OLD_EVENT_CHANGED',key);}
  else{const project=stringToken(initial.get('project_id')),generation=revisionToken(initial.get('generation')),newGeneration=changedProjects.get(project);
   if(newGeneration===undefined||generation>newGeneration-1024n)issues.add('RUNTIME_OLD_EVENT_MISSING',key);}}
 const added=new Set();
 for(const [key,current]of next.events)if(!old.events.has(key)){
  const project=stringToken(current.get('project_id')),generation=revisionToken(current.get('generation')),occurred=stampToken(current.get('occurred_at'));
  if(!same([...current.keys()].sort(order),['domain','generation','occurred_at','project_id','reason','source_revision'])||changedProjects.get(project)!==generation
   ||current.get('domain')!=='"engine"'||current.get('reason')!=='"ENGINE_IDENTITY_CHANGED"'||stringToken(current.get('source_revision'))!==policy.engineIdentitySha256
   ||occurred<window.start-1||occurred>window.stop+1||added.has(project))issues.add('RUNTIME_UNDECLARED_EVENT_ADDITION',key);
  added.add(project);
 }
 for(const project of changedProjects.keys())if(!added.has(project))issues.add('RUNTIME_ENGINE_EVENT_MISSING',project);
 return{engineChangedProjects:changedProjects.size,eventsAdded:added.size};
}
export function qualifyRuntimeFacts(input){
 need(exact(input,['before','after','pristine','policy','rows']),'B9_RUNTIME_FACTS_INPUT');const before=facts(input.before),after=facts(input.after),pristine=facts(input.pristine);
 runtimePolicy(input.policy);need(exact(input.rows,['before','after']),'B9_RUNTIME_ROWS');const issues=collector();
 bindControlRows(input.rows.before,before.manifest);bindControlRows(input.rows.after,after.manifest);
 if(!same(before.manifest.database,after.manifest.database)||before.manifest.database.encoding!==pristine.manifest.database.encoding
  ||before.manifest.database.serverVersionNum!==pristine.manifest.database.serverVersionNum)issues.add('DATABASE_IDENTITY_CHANGED','database');
 const changes=schemaComparison(before,after,pristine,issues);
 if(input.policy.phase==='target-runtime'){
  if(before.manifest.catalogSha256!==after.manifest.catalogSha256||!same(before.globals,after.globals))issues.add('TARGET_RUNTIME_DDL_CHANGED','public');
 }
 const next=mapBy(after.manifest.tables,row=>row.table);
 for(const table of before.manifest.tables)if(next.has(table.table)&&!B9_RUNTIME_POLICY.controls.includes(table.table))rowEqual(table,next.get(table.table),issues);
 const controls=runtimeControlComparison(input.rows.before,input.rows.after,input.policy,issues);
 return{schemaVersion:'wfc.pf.b9.runtime-facts.v1',status:issues.failures.length?'FAIL':'PASS',policySha256:hash(B9_RUNTIME_POLICY),
  legacyTablesChecked:before.manifest.tables.length,managedChanges:changes,...controls,failures:issues.failures};
}

function context(value){
 need(exact(value,['operationId','phase','runtime','owner','project','port','backupId','candidate','engineIdentitySha256'])
  &&UUID.test(value.operationId??'')&&['target-migration','target-runtime','source-runtime'].includes(value.phase)
  &&typeof value.runtime==='string'&&path.isAbsolute(value.runtime)&&path.resolve(value.runtime)===value.runtime
  &&UUID.test(value.owner??'')&&text(value.project,128)&&value.project.length>0&&value.port===(value.phase==='source-runtime'?5191:5192)
  &&UUID.test(value.backupId??'')&&exact(value.candidate,['api','web'])&&IMAGE.test(value.candidate.api??'')&&IMAGE.test(value.candidate.web??'')
  &&HASH.test(value.engineIdentitySha256??''),'B9_CONTEXT_INVALID');return value;
}
function pin(value){need(exact(value,['path','bytes','sha256'])&&typeof value.path==='string'&&path.isAbsolute(value.path)&&path.resolve(value.path)===value.path
 &&Number.isSafeInteger(value.bytes)&&value.bytes>0&&HASH.test(value.sha256??''),'B9_PIN_INVALID');return value;}
function captureRef(value,root){
 need(exact(value,['directory','ownerId','manifest','globals','contentSha256'])&&typeof value.directory==='string'&&path.isAbsolute(value.directory)
  &&path.resolve(value.directory)===value.directory&&value.directory.startsWith(root+path.sep)&&UUID.test(value.ownerId??'')&&HASH.test(value.contentSha256??''),'B9_CAPTURE_REF_INVALID');
 pin(value.manifest);pin(value.globals);need(value.manifest.path===path.join(value.directory,'manifest.json')&&value.globals.path.startsWith(root+path.sep),'B9_CAPTURE_PIN_BOUNDARY');return value;
}
async function canonicalPath(filename,directory){
 const full=path.resolve(filename);need(full===filename&&path.isAbsolute(full),'B9_CAPTURE_PATH');let current=path.parse(full).root;
 for(const part of full.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const stat=await fs.lstat(current);
  need(!stat.isSymbolicLink()&&(current===full&&!directory?stat.isFile()&&stat.nlink===1:stat.isDirectory()),'B9_CAPTURE_PATH');
 }
 need(path.resolve(await fs.realpath(full))===full,'B9_CAPTURE_PATH');
}
const fileIdentity=stat=>[stat.dev,stat.ino,stat.nlink,stat.size,stat.mtimeNs,stat.ctimeNs,stat.mode].map(String).join(':');
async function pinnedJson(value,maximum){
 pin(value);need(value.bytes<=maximum,'B9_FILE_LIMIT');await canonicalPath(value.path,false);
 const before=await fs.lstat(value.path,{bigint:true});need(before.size===BigInt(value.bytes),'B9_PIN_BYTES');
 const handle=await fs.open(value.path,'r');let bytes;
 try{need(fileIdentity(await handle.stat({bigint:true}))===fileIdentity(before),'B9_FILE_CHANGED');bytes=Buffer.allocUnsafe(value.bytes);
  let offset=0;while(offset<bytes.length){const read=await handle.read(bytes,offset,Math.min(65536,bytes.length-offset),offset);need(read.bytesRead>0,'B9_FILE_CHANGED');offset+=read.bytesRead;}
  need((await handle.read(Buffer.alloc(1),0,1,bytes.length)).bytesRead===0,'B9_FILE_CHANGED');
  need(bytes.length===value.bytes&&createHash('sha256').update(bytes).digest('hex')===value.sha256,'B9_PIN_HASH');
  need(fileIdentity(await handle.stat({bigint:true}))===fileIdentity(before),'B9_FILE_CHANGED');}
 finally{await handle.close();}
 need(fileIdentity(await fs.lstat(value.path,{bigint:true}))===fileIdentity(before),'B9_FILE_CHANGED');
 const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);losslessTopLevelFields(source,{maximumBytes:maximum});
 return JSON.parse(source);
}
async function loadCapture(ref,root,check,signal){
 captureRef(ref,root);await canonicalPath(ref.directory,true);check();
 const manifest=manifestFacts(await pinnedJson(ref.manifest,B9_QUALIFICATION_LIMITS.manifestBytes));
 need(manifest.ownerId===ref.ownerId&&manifest.contentSha256===ref.contentSha256,'B9_CAPTURE_IDENTITY');
 const bookends=[];
 for(const filename of ['.owner.json',...manifest.tables.map(table=>table.file.path)]){
  need(filename==='.owner.json'||/^table-[0-9]{4}\.ndjson$/.test(filename),'B9_RAW_PATH');
  const full=path.join(ref.directory,filename);await canonicalPath(full,false);bookends.push({path:full,identity:fileIdentity(await fs.lstat(full,{bigint:true}))});
 }
 const integrity=await compareCurrentInventories(ref.directory,ref.directory,{comparison:'exact',beforeOwnerId:ref.ownerId,afterOwnerId:ref.ownerId,signal});
 need(integrity.status==='PASS'&&integrity.beforeContentSha256===ref.contentSha256,'B9_RAW_INTEGRITY');check();
 const globals=globalFacts(await pinnedJson(ref.globals,B9_QUALIFICATION_LIMITS.globalBytes));
 return{ref,manifest,globals,bookends,integrity:{inventoryId:manifest.inventoryId,contentSha256:manifest.contentSha256,catalogSha256:manifest.catalogSha256,
  tablesChecked:manifest.tables.length,rawFilesVerified:manifest.tables.length,globalSha256:ref.globals.sha256}};
}
async function readControlRows(capture,check){
 const result={states:[],events:[],users:[],logins:[]};let total=0;
 for(const [field,tableName]of Object.entries({states:'pf_recalculation_state',events:'pf_recalculation_events',users:'users',logins:'viewer_login_bindings'})){
  const table=capture.manifest.tables.find(value=>value.table===tableName);need(table,'B9_RUNTIME_TABLE_REQUIRED');
  const handle=await fs.open(path.join(capture.ref.directory,table.file.path),'r'),stream=handle.createReadStream({highWaterMark:65536,autoClose:true});
  let pending=[];let size=0;
  try{for await(const chunk of stream){check();let start=0;for(;;){const end=chunk.indexOf(10,start);if(end<0)break;
    const bytes=size+end-start;need(bytes>0&&bytes<=132*1024**2,'B9_CONTROL_LINE_LIMIT');
    const line=pending.length?Buffer.concat([...pending,chunk.subarray(start,end)],bytes):chunk.subarray(start,end);pending=[];size=0;
    total+=line.length;need(total<=128*1024**2&&result[field].length<B9_QUALIFICATION_LIMITS.controlRows,'B9_CONTROL_BYTES_LIMIT');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));
    need(typeof value.key==='string'&&typeof value.rowText==='string','B9_CONTROL_ROW');result[field].push({key:value.key,rowText:value.rowText});start=end+1;
   }
   if(start<chunk.length){pending.push(chunk.subarray(start));size+=chunk.length-start;}need(size<=132*1024**2,'B9_CONTROL_LINE_LIMIT');
  }need(size===0,'B9_CONTROL_EOF');}finally{stream.destroy();await handle.close().catch(()=>{});}
 }
 return result;
}
async function finishCapture(capture,check){
 check();await pinnedJson(capture.ref.manifest,B9_QUALIFICATION_LIMITS.manifestBytes);await pinnedJson(capture.ref.globals,B9_QUALIFICATION_LIMITS.globalBytes);
 for(const item of capture.bookends){await canonicalPath(item.path,false);need(fileIdentity(await fs.lstat(item.path,{bigint:true}))===item.identity,'B9_RAW_BOOKEND_CHANGED');}check();
}
function invocation(input,runtime){
 const keys=['context','qualifierSha256','operationDirectory','before','after','pristine',...(runtime?['policy']:[])];need(exact(input,keys),'B9_QUALIFIER_INPUT');context(input.context);
 need(runtime?input.context.phase!=='target-migration':input.context.phase==='target-migration','B9_PHASE_MISMATCH');
 need(typeof input.operationDirectory==='string'&&path.isAbsolute(input.operationDirectory)&&path.resolve(input.operationDirectory)===input.operationDirectory
  &&HASH.test(input.qualifierSha256??''),'B9_QUALIFIER_SOURCE_PIN');
 for(const ref of [input.before,input.after,input.pristine])captureRef(ref,input.operationDirectory);
 need(input.before.ownerId===input.context.owner&&input.after.ownerId===input.context.owner,'B9_CAPTURE_OWNER_MISMATCH');
 if(runtime){runtimePolicy(input.policy);need(input.policy.phase===input.context.phase&&input.policy.engineIdentitySha256===input.context.engineIdentitySha256,'B9_RUNTIME_BINDING');}
}
async function qualifyInventories(input,runtime){
 invocation(input,runtime);await canonicalPath(input.operationDirectory,true);const started=Date.now(),signal=AbortSignal.timeout(B9_QUALIFICATION_LIMITS.milliseconds),check=()=>{
  signal.throwIfAborted();need(Date.now()-started<=B9_QUALIFICATION_LIMITS.milliseconds,'B9_QUALIFICATION_DEADLINE');};
 const source=fileURLToPath(import.meta.url),sourceBytes=(await fs.stat(source)).size;need(sourceBytes>0&&sourceBytes<=1024**2,'B9_QUALIFIER_SOURCE_LIMIT');
 const sourcePin={path:source,bytes:sourceBytes,sha256:createHash('sha256').update(await fs.readFile(source)).digest('hex')};
 need(sourcePin.sha256===input.qualifierSha256,'B9_QUALIFIER_SOURCE_CHANGED');
 const before=await loadCapture(input.before,input.operationDirectory,check,signal),after=await loadCapture(input.after,input.operationDirectory,check,signal),pristine=await loadCapture(input.pristine,input.operationDirectory,check,signal);
 const pair=value=>({manifest:value.manifest,globals:value.globals});
 const comparison=runtime?qualifyRuntimeFacts({before:pair(before),after:pair(after),pristine:pair(pristine),policy:input.policy,
  rows:{before:await readControlRows(before,check),after:await readControlRows(after,check)}}):qualifyMigrationFacts({before:pair(before),after:pair(after),pristine:pair(pristine)});
 for(const capture of [before,after,pristine])await finishCapture(capture,check);
 need((await fs.stat(source)).size===sourcePin.bytes&&createHash('sha256').update(await fs.readFile(source)).digest('hex')===sourcePin.sha256,'B9_QUALIFIER_SOURCE_CHANGED');
 const receipt={schemaVersion:`wfc.pf.b9.${runtime?'runtime':'migration'}-qualification.v1`,status:comparison.status,context:input.context,
  qualifierSha256:input.qualifierSha256,policySha256:comparison.policySha256,captures:{before:input.before,after:input.after,pristine:input.pristine},
  ...(runtime?{policy:input.policy}:{}),integrity:{before:before.integrity,after:after.integrity,pristine:pristine.integrity},comparison};
 need(Buffer.byteLength(canonical(receipt))<=B9_QUALIFICATION_LIMITS.receiptBytes,'B9_RECEIPT_LIMIT');return{...receipt,receiptSha256:hash(receipt)};
}
export const qualifyMigrationInventories=input=>qualifyInventories(input,false);
export const qualifyRuntimeInventories=input=>qualifyInventories(input,true);
export function assertQualificationReceipt(receipt,expected){
 const runtime=expected?.context?.phase!=='target-migration';invocation(expected,runtime);
 need(exact(receipt,['schemaVersion','status','context','qualifierSha256','policySha256','captures',...(runtime?['policy']:[]),'integrity','comparison','receiptSha256'])
  &&receipt.schemaVersion===`wfc.pf.b9.${runtime?'runtime':'migration'}-qualification.v1`&&receipt.status==='PASS'
  &&same(receipt.context,expected.context)&&receipt.qualifierSha256===expected.qualifierSha256
  &&receipt.policySha256===hash(runtime?B9_RUNTIME_POLICY:B9_MIGRATION_POLICY)&&same(receipt.captures,{before:expected.before,after:expected.after,pristine:expected.pristine})
  &&(!runtime||same(receipt.policy,expected.policy))&&exact(receipt.integrity,['before','after','pristine'])
  &&receipt.comparison?.schemaVersion===`wfc.pf.b9.${runtime?'runtime':'migration'}-facts.v1`&&receipt.comparison.status==='PASS'
  &&receipt.comparison.policySha256===receipt.policySha256&&Array.isArray(receipt.comparison.failures)&&receipt.comparison.failures.length===0,'B9_QUALIFICATION_RECEIPT_INVALID');
 for(const which of ['before','after','pristine']){const value=receipt.integrity[which],ref=expected[which];
  need(exact(value,['inventoryId','contentSha256','catalogSha256','tablesChecked','rawFilesVerified','globalSha256'])&&UUID.test(value.inventoryId??'')
   &&value.contentSha256===ref.contentSha256&&HASH.test(value.catalogSha256??'')&&Number.isSafeInteger(value.tablesChecked)&&value.tablesChecked>=0
   &&value.tablesChecked<=B9_QUALIFICATION_LIMITS.tables&&value.rawFilesVerified===value.tablesChecked&&value.globalSha256===ref.globals.sha256,'B9_QUALIFICATION_INTEGRITY_BINDING');}
 const{receiptSha256,...body}=receipt;need(HASH.test(receiptSha256??'')&&receiptSha256===hash(body),'B9_QUALIFICATION_RECEIPT_HASH');return receipt;
}
