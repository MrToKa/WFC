// Additive current all-public-table qualifier. Historical audit-lib/27-table
// receipts deliberately retain their old contract. No SQL or writes occur here.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

export const CURRENT_INVENTORY_LIMITS = Object.freeze({ manifestBytes: 16 * 1024 ** 2, tables: 500, columns: 2048, definitions: 10000, definitionBytes: 1024 ** 2, rowsPerTable: 1000000, totalRows: 2000000, rowLineBytes: 132 * 1024 ** 2, rowBytes: 32 * 1024 ** 2, fileBytes: 1024 ** 3, totalBytes: 1024 ** 3, milliseconds: 300000, jsonDepth: 128 });
const HASH=/^[a-f0-9]{64}$(?![\s\S])/, UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$(?![\s\S])/;
const FENCES=Object.freeze({pf_installation_state:['installation_epoch','updated_at'],viewer_login_bindings:['revoked_at'],viewer_resource_sessions:['revoked_at','revoke_reason']});
const PRIMARY=Object.freeze({pf_installation_state:['singleton'],viewer_login_bindings:['login_id'],viewer_resource_sessions:['id']});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const order=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(value,code='CURRENT_INVENTORY_INVALID')=>{if(!value)fail(code);};
const text=(value,max=65536)=>typeof value==='string'&&Buffer.byteLength(value)<=max&&!/[\u0000]/u.test(value);
const count=(value,max)=>typeof value==='string'&&/^(?:0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=BigInt(max);
const sorted=values=>values.every((value,index)=>!index||order(values[index-1],value)<0);
const stamp=value=>typeof value==='string'&&value.length<=64&&/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
export function currentInventorySchemaMetadata(table){return{table:table.table,columns:table.columns,primaryKey:table.primaryKey,keyMode:table.keyMode,definitions:table.definitions};}
export function currentInventoryCanonicalHash(value){return hash(value);}
export function currentInventoryFrame(digest,value){const bytes=Buffer.from(value),prefix=Buffer.alloc(4);prefix.writeUInt32BE(bytes.length);digest.update(prefix).update(bytes);return digest;}

/** Parse structure/strings only; numeric tokens remain untouched lexical spans.
 * This also refuses duplicate keys instead of letting JSON.parse hide them. */
export function losslessTopLevelFields(source,{maximumBytes=CURRENT_INVENTORY_LIMITS.rowBytes,maximumDepth=CURRENT_INVENTORY_LIMITS.jsonDepth}={}){
 need(typeof source==='string'&&Buffer.byteLength(source)<=maximumBytes,'CURRENT_INVENTORY_ROW_JSON');let cursor=0,tokens=0;
 const whitespace=()=>{while(/[ \r\n\t]/.test(source[cursor]??'')&&cursor<source.length)cursor++;};
 function string(){const start=cursor;need(source[cursor++]==='"','CURRENT_INVENTORY_ROW_JSON');while(cursor<source.length){const char=source[cursor++];if(char==='"'){try{return JSON.parse(source.slice(start,cursor));}catch{fail('CURRENT_INVENTORY_ROW_JSON');}}if(char==='\\'){need(cursor<source.length,'CURRENT_INVENTORY_ROW_JSON');cursor++;}}fail('CURRENT_INVENTORY_ROW_JSON');}
 const number=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
 function value(depth,top=false){need(++tokens<=4000000&&depth<=maximumDepth,'CURRENT_INVENTORY_ROW_JSON');whitespace();const char=source[cursor];
  if(char==='"'){string();return;}
  if(char==='{'){cursor++;whitespace();const fields=new Map();if(source[cursor]==='}'){cursor++;return fields;}for(;;){whitespace();need(source[cursor]==='"','CURRENT_INVENTORY_ROW_JSON');const key=string();need(!fields.has(key),'CURRENT_INVENTORY_DUPLICATE_JSON_KEY');whitespace();need(source[cursor++]===':','CURRENT_INVENTORY_ROW_JSON');whitespace();const start=cursor;value(depth+1);fields.set(key,top?source.slice(start,cursor):true);whitespace();const separator=source[cursor++];if(separator==='}')return fields;need(separator===',','CURRENT_INVENTORY_ROW_JSON');}}
  if(char==='['){cursor++;whitespace();if(source[cursor]===']'){cursor++;return;}for(;;){value(depth+1);whitespace();const separator=source[cursor++];if(separator===']')return;need(separator===',','CURRENT_INVENTORY_ROW_JSON');}}
  for(const literal of ['true','false','null'])if(source.startsWith(literal,cursor)){cursor+=literal.length;return;}
  number.lastIndex=cursor;const match=number.exec(source);need(match,'CURRENT_INVENTORY_ROW_JSON');cursor=number.lastIndex;
 }
 whitespace();need(source[cursor]==='{','CURRENT_INVENTORY_ROW_JSON');const fields=value(0,true);whitespace();need(cursor===source.length,'CURRENT_INVENTORY_ROW_JSON');return fields;
}
function jsonString(token,nullable=false){if(nullable&&token==='null')return null;need(typeof token==='string'&&token.startsWith('"'),'CURRENT_INVENTORY_FENCE_PROJECTION');let value;try{value=JSON.parse(token);}catch{fail('CURRENT_INVENTORY_FENCE_PROJECTION');}need(typeof value==='string','CURRENT_INVENTORY_FENCE_PROJECTION');return value;}
function validateDefinitions(value,limits){
 need(exact(value,['constraints','indexes','triggers','rls']));
 for(const [group,keys] of [['constraints',['name','definition','validated']],['indexes',['name','definition','valid','ready']],['triggers',['name','definition','enabled']]]){
  need(Array.isArray(value[group])&&value[group].length<=limits.definitions&&sorted(value[group].map(row=>row?.name)));
  for(const row of value[group]){need(exact(row,keys)&&text(row.name,256)&&row.name.length&&text(row.definition,limits.definitionBytes));for(const key of keys.filter(key=>!['name','definition'].includes(key)))need(key==='enabled'?typeof row[key]==='string'&&['O','D','R','A'].includes(row[key]):typeof row[key]==='boolean');}
 }
 need(exact(value.rls,['enabled','forced','policies'])&&typeof value.rls.enabled==='boolean'&&typeof value.rls.forced==='boolean'&&Array.isArray(value.rls.policies)&&value.rls.policies.length<=limits.definitions&&sorted(value.rls.policies.map(row=>row?.name)));
 for(const policy of value.rls.policies)need(exact(policy,['name','command','roles','permissive','usingSql','withCheckSql'])&&text(policy.name,256)&&policy.name.length&&text(policy.command,64)&&Array.isArray(policy.roles)&&policy.roles.every(role=>text(role,256)&&role.length)&&sorted(policy.roles)&&typeof policy.permissive==='boolean'&&(policy.usingSql===null||text(policy.usingSql,limits.definitionBytes))&&(policy.withCheckSql===null||text(policy.withCheckSql,limits.definitionBytes)));
}
function validateManifest(value,ownerId,limits){
 need(exact(value,['schemaVersion','status','scope','projection','ownerId','inventoryId','database','tables','catalogSha256','contentSha256'])&&value.schemaVersion==='wfc.operations.lossless-inventory.v1'&&value.status==='PASS'&&value.scope==='public'&&value.projection==='postgresql-jsonb-text.v1'&&UUID.test(value.ownerId??'')&&value.ownerId===ownerId&&UUID.test(value.inventoryId??'')&&exact(value.database,['name','encoding','serverVersionNum'])&&text(value.database.name,256)&&value.database.name.length&&value.database.encoding==='UTF8'&&typeof value.database.serverVersionNum==='string'&&/^[1-9][0-9]{4,7}$/.test(value.database.serverVersionNum)&&Array.isArray(value.tables)&&value.tables.length<=limits.tables&&sorted(value.tables.map(row=>row?.table)),'CURRENT_INVENTORY_MANIFEST');
 let totalRows=0n,totalBytes=0n;
 for(let index=0;index<value.tables.length;index++){
  const table=value.tables[index];need(exact(table,['table','columns','primaryKey','keyMode','definitions','rows','rawBytes','schemaSha256','rowSha256','keySetSha256','file','fencing'])&&text(table.table,256)&&table.table.length&&Array.isArray(table.columns)&&table.columns.length<=limits.columns&&table.columns.length>0&&new Set(table.columns.map(column=>column?.name)).size===table.columns.length&&Array.isArray(table.primaryKey)&&table.primaryKey.every(name=>typeof name==='string'&&table.columns.some(column=>column.name===name))&&new Set(table.primaryKey).size===table.primaryKey.length&&table.keyMode===(table.primaryKey.length?'primary-key':'row-multiset'));
  for(const column of table.columns)need(exact(column,['name','type','notNull','identity','generated','defaultSql','collation'])&&text(column.name,256)&&column.name.length&&text(column.type,2048)&&column.type.length&&typeof column.notNull==='boolean'&&['','a','d'].includes(column.identity)&&['','s','v'].includes(column.generated)&&(column.defaultSql===null||text(column.defaultSql,limits.definitionBytes))&&(column.collation===null||text(column.collation,2048)));
  validateDefinitions(table.definitions,limits);need(count(table.rows,limits.rowsPerTable)&&count(table.rawBytes,limits.fileBytes)&&HASH.test(table.schemaSha256??'')&&HASH.test(table.rowSha256??'')&&(table.keyMode==='primary-key'?HASH.test(table.keySetSha256??''):table.keySetSha256===null)&&exact(table.file,['path','bytes','sha256'])&&table.file.path===`table-${String(index).padStart(4,'0')}.ndjson`&&count(table.file.bytes,limits.fileBytes)&&HASH.test(table.file.sha256??''));
  totalRows+=BigInt(table.rows);totalBytes+=BigInt(table.file.bytes);need(totalRows<=BigInt(limits.totalRows)&&totalBytes<=BigInt(limits.totalBytes),'CURRENT_INVENTORY_LIMIT');
  const expected=Object.hasOwn(FENCES,table.table)?FENCES[table.table]:null;need(expected?exact(table.fencing,['columns','protectedSha256'])&&same(table.fencing.columns,expected)&&HASH.test(table.fencing.protectedSha256??'')&&same(table.primaryKey,PRIMARY[table.table]):table.fencing===null,'CURRENT_INVENTORY_FENCE_SCHEMA');
  need(table.schemaSha256===hash(currentInventorySchemaMetadata(table)),'CURRENT_INVENTORY_SCHEMA_DIGEST');
 }
 need(value.catalogSha256===hash(value.tables.map(currentInventorySchemaMetadata)),'CURRENT_INVENTORY_CATALOG_DIGEST');const{contentSha256,...body}=value;need(HASH.test(contentSha256??'')&&contentSha256===hash(body),'CURRENT_INVENTORY_MANIFEST_DIGEST');return value;
}
async function canonicalPath(filename,directory){need(path.isAbsolute(filename),'CURRENT_INVENTORY_PATH');const absolute=path.resolve(filename);for(let current=absolute;;current=path.dirname(current)){const stat=await fs.lstat(current);need(!stat.isSymbolicLink()&&(current!==absolute||directory?stat.isDirectory():stat.isFile()&&stat.nlink===1),'CURRENT_INVENTORY_PATH');if(path.dirname(current)===current)break;}need(path.resolve(await fs.realpath(absolute))===absolute,'CURRENT_INVENTORY_PATH');return absolute;}
async function openCapture(directory,ownerId,limits){
 const root=await canonicalPath(directory,true),filename=await canonicalPath(path.join(root,'manifest.json'),false),stat=await fs.stat(filename,{bigint:true});need(stat.size>0n&&stat.size<=BigInt(limits.manifestBytes),'CURRENT_INVENTORY_LIMIT');const bytes=await fs.readFile(filename);let value;
 try{const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);losslessTopLevelFields(decoded,{maximumBytes:limits.manifestBytes,maximumDepth:limits.jsonDepth});value=JSON.parse(decoded);}catch{fail('CURRENT_INVENTORY_MANIFEST');}
 const manifest=validateManifest(value,ownerId,limits),ownerFilename=await canonicalPath(path.join(root,'.owner.json'),false),ownerStat=await fs.stat(ownerFilename,{bigint:true});need(ownerStat.size>0n&&ownerStat.size<=4096n,'CURRENT_INVENTORY_OWNER');let owner;
 try{const decoded=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(ownerFilename));losslessTopLevelFields(decoded,{maximumBytes:4096});owner=JSON.parse(decoded);}catch{fail('CURRENT_INVENTORY_OWNER');}
 need(exact(owner,['schemaVersion','ownerId','inventoryId'])&&owner.schemaVersion==='wfc.operations.lossless-owner.v1'&&owner.ownerId===ownerId&&owner.inventoryId===manifest.inventoryId,'CURRENT_INVENTORY_OWNER');
 return{root,filename,signature:[stat.size,stat.mtimeNs,stat.ctimeNs].join(':'),ownerFilename,ownerSignature:[ownerStat.size,ownerStat.mtimeNs,ownerStat.ctimeNs].join(':'),manifest};
}
function validateRow(row,table,limits){
 need(exact(row,table.fencing?['key','rowText','protectedText','mutable']:['key','rowText'])&&typeof row.rowText==='string'&&Buffer.byteLength(row.rowText)<=limits.rowBytes,'CURRENT_INVENTORY_ROW');
 if(table.keyMode==='primary-key'){need(typeof row.key==='string'&&Buffer.byteLength(row.key)<=65536,'CURRENT_INVENTORY_KEY');let key;try{key=JSON.parse(row.key);}catch{fail('CURRENT_INVENTORY_KEY');}need(Array.isArray(key)&&key.length===table.primaryKey.length&&key.every(part=>typeof part==='string'),'CURRENT_INVENTORY_KEY');}else need(row.key===null,'CURRENT_INVENTORY_KEY');
 const fields=losslessTopLevelFields(row.rowText,{maximumBytes:limits.rowBytes,maximumDepth:limits.jsonDepth});
 need(fields.size===table.columns.length&&table.columns.every(column=>fields.has(column.name)),'CURRENT_INVENTORY_ROW_SCHEMA');
 if(table.fencing){
  need(typeof row.protectedText==='string'&&Buffer.byteLength(row.protectedText)<=limits.rowBytes,'CURRENT_INVENTORY_FENCE_PROJECTION');const protectedFields=losslessTopLevelFields(row.protectedText,{maximumBytes:limits.rowBytes,maximumDepth:limits.jsonDepth});const remaining=[...fields.keys()].filter(key=>!table.fencing.columns.includes(key));need(protectedFields.size===remaining.length&&remaining.every(key=>protectedFields.get(key)===fields.get(key)),'CURRENT_INVENTORY_FENCE_PROJECTION');
  if(table.table==='pf_installation_state'){need(exact(row.mutable,['installationEpoch','updatedAt'])&&UUID.test(row.mutable.installationEpoch??'')&&stamp(row.mutable.updatedAt)&&fields.get('singleton')==='true'&&jsonString(fields.get('installation_epoch'))===row.mutable.installationEpoch&&jsonString(fields.get('updated_at'))===row.mutable.updatedAt,'CURRENT_INVENTORY_FENCE_PROJECTION');}
  else{const resource=table.table==='viewer_resource_sessions';need(exact(row.mutable,resource?['revokedAt','revokeReason']:['revokedAt'])&&(row.mutable.revokedAt===null||stamp(row.mutable.revokedAt))&&jsonString(fields.get('revoked_at'),true)===row.mutable.revokedAt,'CURRENT_INVENTORY_FENCE_PROJECTION');if(resource)need((row.mutable.revokeReason===null||text(row.mutable.revokeReason,4096))&&jsonString(fields.get('revoke_reason'),true)===row.mutable.revokeReason,'CURRENT_INVENTORY_FENCE_PROJECTION');}
 }
 return row;
}
async function* rows(capture,table,limits,check){
 const filename=await canonicalPath(path.join(capture.root,table.file.path),false),before=await fs.stat(filename,{bigint:true});need(before.size===BigInt(table.file.bytes)&&before.size<=BigInt(limits.fileBytes),'CURRENT_INVENTORY_FILE');const stream=(await fs.open(filename,'r')).createReadStream({highWaterMark:65536,autoClose:true});
 const fileHash=createHash('sha256'),rowHash=createHash('sha256').update('wfc.lossless.table-rows.v1\n'),keyHash=createHash('sha256').update('wfc.lossless.table-keys.v1\n'),protectedHash=createHash('sha256').update('wfc.lossless.table-protected.v1\n');let pending=[],pendingBytes=0,previous=null,counted=0n,rawBytes=0n,fileBytes=0n;
 try{for await(const chunk of stream){check();fileBytes+=BigInt(chunk.length);need(fileBytes<=BigInt(table.file.bytes),'CURRENT_INVENTORY_FILE');fileHash.update(chunk);let cursor=0;for(;;){const end=chunk.indexOf(10,cursor);if(end<0)break;const lineBytes=pendingBytes+end-cursor;need(lineBytes>0&&lineBytes<=limits.rowLineBytes,'CURRENT_INVENTORY_ROW_LIMIT');const line=pending.length?Buffer.concat([...pending,chunk.subarray(cursor,end)],lineBytes):chunk.subarray(cursor,end);pending=[];pendingBytes=0;let textLine,row;try{textLine=new TextDecoder('utf-8',{fatal:true}).decode(line);losslessTopLevelFields(textLine,{maximumBytes:limits.rowLineBytes,maximumDepth:limits.jsonDepth});row=JSON.parse(textLine);}catch(error){if(error?.code)throw error;fail('CURRENT_INVENTORY_ROW');}validateRow(row,table,limits);const identity=table.keyMode==='primary-key'?row.key:row.rowText;need(previous===null||(table.keyMode==='primary-key'?order(previous,identity)<0:order(previous,identity)<=0),'CURRENT_INVENTORY_ROW_ORDER');previous=identity;
 counted++;rawBytes+=BigInt(Buffer.byteLength(row.rowText));need(counted<=BigInt(table.rows)&&rawBytes<=BigInt(table.rawBytes),'CURRENT_INVENTORY_COUNT');currentInventoryFrame(rowHash,row.key??'');currentInventoryFrame(rowHash,row.rowText);if(table.keyMode==='primary-key')currentInventoryFrame(keyHash,row.key);if(table.fencing){currentInventoryFrame(protectedHash,row.key??'');currentInventoryFrame(protectedHash,row.protectedText);}check();yield row;cursor=end+1;}
 const tail=chunk.subarray(cursor);if(tail.length){pending.push(tail);pendingBytes+=tail.length;}need(pendingBytes<=limits.rowLineBytes,'CURRENT_INVENTORY_ROW_LIMIT');}
 need(pendingBytes===0&&fileBytes===BigInt(table.file.bytes)&&counted===BigInt(table.rows)&&rawBytes===BigInt(table.rawBytes),'CURRENT_INVENTORY_EOF');need(fileHash.digest('hex')===table.file.sha256&&rowHash.digest('hex')===table.rowSha256&&(table.keyMode!=='primary-key'||keyHash.digest('hex')===table.keySetSha256)&&(!table.fencing||protectedHash.digest('hex')===table.fencing.protectedSha256),'CURRENT_INVENTORY_FILE_DIGEST');const after=await fs.stat(filename,{bigint:true});need([before.size,before.mtimeNs,before.ctimeNs].join(':')===[after.size,after.mtimeNs,after.ctimeNs].join(':'),'CURRENT_INVENTORY_CHANGED');
 }finally{stream.destroy();}
}
function fenceEqual(table,before,after,targetId){
 if(before.key!==after.key||before.protectedText!==after.protectedText)return false;
 if(table==='pf_installation_state')return before.mutable.installationEpoch!==targetId&&after.mutable.installationEpoch===targetId&&before.mutable.installationEpoch!==after.mutable.installationEpoch&&before.mutable.updatedAt!==after.mutable.updatedAt;
 if(before.mutable.revokedAt!==null)return before.rowText===after.rowText;
 if(after.mutable.revokedAt===null)return false;
 return table!=='viewer_resource_sessions'||after.mutable.revokeReason===(before.mutable.revokeReason??'logout');
}

/** Metadata-only comparison. Raw business rows never appear in the result.
 * exact: source cold -> restored BEFORE fence. restore-fence: intentional3-table
 * mutation only, including exact old tombstones and all other rows/leases. */
export async function compareCurrentInventories(beforeDirectory,afterDirectory,{comparison='exact',beforeOwnerId,afterOwnerId,targetId,signal,limits:overrides={}}={}){
 need(['exact','restore-fence'].includes(comparison)&&UUID.test(beforeOwnerId??'')&&UUID.test(afterOwnerId??'')&&(comparison!=='restore-fence'||UUID.test(targetId??'')),'CURRENT_INVENTORY_COMPARISON');const limits={...CURRENT_INVENTORY_LIMITS,...overrides};need(Object.keys(overrides).every(key=>Object.hasOwn(CURRENT_INVENTORY_LIMITS,key))&&Object.values(limits).every(value=>Number.isSafeInteger(value)&&value>0),'CURRENT_INVENTORY_LIMIT');const started=Date.now(),check=()=>{if(signal?.aborted)throw new DOMException('Inventory comparison cancelled.','AbortError');if(Date.now()-started>limits.milliseconds)fail('CURRENT_INVENTORY_DEADLINE');};check();const before=await openCapture(beforeDirectory,beforeOwnerId,limits),after=await openCapture(afterDirectory,afterOwnerId,limits);check();const failures=[],tables=[];const problem=(table,code)=>{if(!failures.some(value=>value.table===table&&value.code===code))failures.push({table,code});};
 if(before.manifest.database.encoding!==after.manifest.database.encoding||before.manifest.database.serverVersionNum!==after.manifest.database.serverVersionNum)problem(null,'DATABASE_SCHEMA_CONTEXT');
 const prior=new Map(before.manifest.tables.map(table=>[table.table,table])),current=new Map(after.manifest.tables.map(table=>[table.table,table])),names=[...new Set([...prior.keys(),...current.keys()])].sort(order);
 if(comparison==='restore-fence')for(const table of Object.keys(FENCES))if(!prior.has(table)||!current.has(table))problem(table,'FENCE_SCHEMA_REQUIRED');
 for(const name of names){check();const a=prior.get(name),b=current.get(name);if(!a||!b)problem(name,'TABLE_SET_CHANGED');else if(a.schemaSha256!==b.schemaSha256)problem(name,'TABLE_SCHEMA_CHANGED');if(comparison==='restore-fence'&&name==='pf_installation_state'&&(a?.rows!=='1'||b?.rows!=='1'))problem(name,'INSTALLATION_SINGLETON');
  const left=a?rows(before,a,limits,check):null,right=b?rows(after,b,limits,check):null;let changed=0n,compared=0n;
  try{for(;;){const[first,next]=await Promise.all([left?.next()??Promise.resolve({done:true}),right?.next()??Promise.resolve({done:true})]);if(first.done&&next.done)break;if(first.done||next.done){problem(name,'ROW_SET_CHANGED');continue;}compared++;const allowed=comparison==='restore-fence'&&Object.hasOwn(FENCES,name);const equal=allowed?fenceEqual(name,first.value,next.value,targetId):first.value.key===next.value.key&&first.value.rowText===next.value.rowText;if(first.value.rowText!==next.value.rowText)changed++;if(!equal)problem(name,allowed?'FENCE_MUTATION_INVALID':'ROW_CONTENT_CHANGED');}}finally{await Promise.all([left?.return(),right?.return()]);}
  tables.push({table:name,beforeRows:a?.rows??null,afterRows:b?.rows??null,comparedRows:String(compared),changedRows:String(changed),qualifiedFence:comparison==='restore-fence'&&Object.hasOwn(FENCES,name)});
 }
 for(const capture of [before,after])for(const[filename,signature]of[[capture.filename,capture.signature],[capture.ownerFilename,capture.ownerSignature]]){const stat=await fs.stat(filename,{bigint:true});need(signature===[stat.size,stat.mtimeNs,stat.ctimeNs].join(':'),'CURRENT_INVENTORY_CHANGED');}check();return{schemaVersion:'wfc.operations.current-inventory-comparison.v1',status:failures.length?'FAIL':'PASS',comparison,scope:'all-public-table-data-and-table-level-schema;global-DDL-separate',beforeDatabase:before.manifest.database,afterDatabase:after.manifest.database,beforeInventoryId:before.manifest.inventoryId,afterInventoryId:after.manifest.inventoryId,beforeContentSha256:before.manifest.contentSha256,afterContentSha256:after.manifest.contentSha256,...(comparison==='restore-fence'?{targetId}:{}),tablesChecked:names.length,tables,failures};
}
export async function qualifyCurrentRestore(beforeDirectory,afterDirectory,options){const receipt=await compareCurrentInventories(beforeDirectory,afterDirectory,options);if(receipt.status!=='PASS')throw Object.assign(new Error('CURRENT_RESTORE_INVENTORY_MISMATCH'),{code:'CURRENT_RESTORE_INVENTORY_MISMATCH',receipt});return Object.freeze(receipt);}
