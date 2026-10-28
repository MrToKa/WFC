// All tests are pure validators or source reads; no fixture file, credential,
// database connection, Docker command or live qualification operator is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deriveSimulatedV6Before, validateAutomaticPairV6CatalogFixture, V6_CATALOG_INVENTORY } from './automatic-pair-v6-catalog-qualification.mjs';
import { V6_MIGRATION_POLICY, qualifyMigrationFacts } from '../pathfinder-barriers/migration-conservation-v6.mjs';
import { currentInventoryCanonicalHash as hash, currentInventorySchemaMetadata } from '../pathfinder-copied-recovery/current-inventory-lib.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const owner = 'ce473847-dd7c-4f58-b70e-ed5e7c3c3d81', suffix = owner.replaceAll('-', '');
const directory = path.join(root, 'pathfinder-engine/.scratch/cable-workflow-u7-' + owner), filename = path.join(directory, 'fixture.private.json');
const fixture = () => ({ schemaVersion: 'wfc.pf.u7-chain-fixture.v1', owner, database: 'wfc_pfu7_' + suffix,
  databaseUrl: 'postgresql://pfu7:synthetic-unused-password@127.0.0.1:65432/wfc_pfu7_' + suffix,
  containerName: 'pfu7-pg-' + suffix.slice(0, 12), compiledRoot: path.join(root, 'server/dist'), storageRoot: path.join(directory, 'storage') });
const bytesHash = value => createHash('sha256').update(value).digest('hex'), order = (a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b));
const relation = (name,kind='r') => ({name,kind,owner:'pfu7',persistence:'p',replicaIdentity:'d',acl:[]});
const column = (name,notNull=false) => ({name,type:'text',notNull,defaultSql:null,collation:null,identity:'',generated:''});
function table(name) {
  const pair=V6_MIGRATION_POLICY.newTables.includes(name), cols=pair?V6_MIGRATION_POLICY.addedColumns[name]:name==='pf_auto_length_admissions'?['ordinal']:['id'];
  const mandatory=name==='pf_automatic_pair_mandates'?cols:['project_id','job_id','cable_id','status','attempts','updated_at'];
  const columns=cols.map(name=>column(name,pair&&mandatory.includes(name)));
  if(name==='pf_auto_length_admissions')columns[0].identity='a';
  const value={table:name,columns,primaryKey:pair?['project_id','job_id','cable_id']:[cols[0]],keyMode:'primary-key',
    definitions:{constraints:pair?V6_MIGRATION_POLICY.addedConstraints[name].map(name=>({name,definition:'synthetic '+name,validated:true})):[],
      indexes:pair?V6_MIGRATION_POLICY.addedIndexes[name].map(name=>({name,definition:'synthetic '+name,valid:true,ready:true})):[],
      triggers:name==='pf_automatic_pair_mandates'?[{name:V6_MIGRATION_POLICY.addedRoutine,definition:'synthetic immutable trigger',enabled:'O'}]:[],rls:{enabled:false,forced:false,policies:[]}},
    rows:'0',rawBytes:'0',schemaSha256:'',rowSha256:bytesHash('wfc.lossless.table-rows.v1\n'),keySetSha256:bytesHash('wfc.lossless.table-keys.v1\n'),
    file:{path:'',bytes:'0',sha256:bytesHash('')},fencing:null};
  value.schemaSha256=hash(currentInventorySchemaMetadata(value));return value;
}
function reseal(facts){for(const row of facts.manifest.tables)row.schemaSha256=hash(currentInventorySchemaMetadata(row));
  facts.manifest.catalogSha256=hash(facts.manifest.tables.map(currentInventorySchemaMetadata));const{contentSha256,...body}=facts.manifest;facts.manifest.contentSha256=hash(body);}
function pristine(){const tables=[...V6_MIGRATION_POLICY.managedTables,'users','viewer_login_bindings','zz_legacy_rows'].sort(order).map(table);
  tables.forEach((table,index)=>{table.file.path=`table-${String(index).padStart(4,'0')}.ndjson`;});
  const facts={manifest:{schemaVersion:'wfc.operations.lossless-inventory.v1',status:'PASS',scope:'public',projection:'postgresql-jsonb-text.v1',ownerId:owner,
    inventoryId:'93000000-0000-4000-8000-000000000009',database:{name:'wfc_pfu7_'+suffix,encoding:'UTF8',serverVersionNum:'180000'},tables,catalogSha256:'',contentSha256:''},
    globals:{schemaVersion:'wfc.pf.public-global-sql.v2',namespace:{owner:'pg_database_owner',acl:[]},
      relations:[...tables.map(row=>relation(row.table)),...tables.flatMap(table=>table.definitions.indexes.map(index=>relation(index.name,'i'))),relation(V6_MIGRATION_POLICY.managedSequence,'S')].sort((a,b)=>order(a.name,b.name)),views:[],
      routines:V6_MIGRATION_POLICY.managedRoutines.map(name=>({name,arguments:'',kind:'f',definition:'synthetic '+name,owner:'pfu7',acl:[]})).sort((a,b)=>order(a.name,b.name)),
      sequences:[{definition:{name:V6_MIGRATION_POLICY.managedSequence,dataType:'bigint',start:'1',min:'1',max:'9223372036854775807',increment:'1',cycle:false,cache:'1'},
        state:{lastValue:'9007199254740993',isCalled:true},owner:'pfu7',acl:[],ownership:[{dependencyKind:'i',tableSchema:'public',table:'pf_auto_length_admissions',column:'ordinal',identity:'a'}]}],extensions:[],unsupportedObjects:[]}};
  const row=tables.find(table=>table.table==='zz_legacy_rows');Object.assign(row,{rows:'1',rawBytes:'27',rowSha256:'a'.repeat(64),keySetSha256:'b'.repeat(64),file:{...row.file,bytes:'73',sha256:'c'.repeat(64)}});
  reseal(facts);return facts;
}

test('V6 catalog pure validation accepts only the maintained isolated U7 identity',()=>{
  assert.equal(validateAutomaticPairV6CatalogFixture(fixture(),filename).directory,directory);
});
for(const kind of ['database','host','owner','container','compiled','storage','options','filename','port','credentials'])
  test('V6 catalog refuses mismatched '+kind+' before IO',()=>{const value=fixture();let target=filename;
    if(kind==='database')value.database='wfc_pathfinder_local';if(kind==='host')value.databaseUrl=value.databaseUrl.replace('127.0.0.1','192.168.0.2');
    if(kind==='owner')value.owner='00000000-0000-4000-8000-000000000001';if(kind==='container')value.containerName='wfc-app-backend-1';
    if(kind==='compiled')value.compiledRoot=path.join(root,'../WFC/server/dist');if(kind==='storage')value.storageRoot=path.join(root,'pathfinder-engine/.scratch/unrelated');
    if(kind==='options')value.databaseUrl+='?options=-csearch_path=public';if(kind==='filename')target=path.join(directory,'other.private.json');
    if(kind==='port')value.databaseUrl=value.databaseUrl.replace(':65432/',':0/');if(kind==='credentials')value.databaseUrl=value.databaseUrl.replace('pfu7:','postgres:');
    assert.throws(()=>validateAutomaticPairV6CatalogFixture(value,target));
  });
test('V6 catalog inventory source is an exact immutable path/hash, without loading that file',()=>{
  assert.equal(V6_CATALOG_INVENTORY.path,path.join(root,'pathfinder-engine/.scratch/b25-20abf31d-22a4-4fcb-a080-713b5c4ade03/qualified-losslessInventory.mjs'));
  assert.equal(V6_CATALOG_INVENTORY.sha256,'c97d4cf5613e7e9f6497027344256536c1078d3c8499a952bab7eaeefc9f1e82');assert.ok(Object.isFrozen(V6_CATALOG_INVENTORY));
});
test('derived simulated before removes only the two pair tables, four exact indexes and one routine',()=>{
  const actual=pristine(),frozen=structuredClone(actual),derived=deriveSimulatedV6Before(actual);
  assert.deepEqual(actual,frozen);assert.deepEqual(derived.removed.tables,V6_MIGRATION_POLICY.newTables);
  assert.equal(derived.removed.indexes.length,4);assert.deepEqual(derived.removed.routines,[V6_MIGRATION_POLICY.addedRoutine]);
  assert.equal(derived.self.status,'PASS');assert.deepEqual(derived.self.newTables,[]);
  const result=qualifyMigrationFacts({before:derived.before,after:actual,pristine:actual});assert.equal(result.status,'PASS');assert.deepEqual(result.newTables,V6_MIGRATION_POLICY.newTables);
  assert.equal(derived.before.manifest.tables.length,actual.manifest.tables.length-2);assert.equal(derived.before.globals.relations.length,actual.globals.relations.length-6);
  assert.equal(derived.before.globals.routines.length,actual.globals.routines.length-1);
});
test('derived facts preserve all old schema definitions, lossless row/key digests and called sequence state',()=>{
  const actual=pristine(),{before}=deriveSimulatedV6Before(actual);
  for(const old of before.manifest.tables){const original=actual.manifest.tables.find(row=>row.table===old.table);
    assert.deepEqual(currentInventorySchemaMetadata(old),currentInventorySchemaMetadata(original));
    for(const key of ['rows','rawBytes','rowSha256','keySetSha256','fencing'])assert.deepEqual(old[key],original[key]);
  }
  for(const key of ['namespace','views','sequences','extensions','unsupportedObjects'])assert.deepEqual(before.globals[key],actual.globals[key]);
  assert.equal(before.globals.sequences[0].state.lastValue,'9007199254740993');assert.equal(before.globals.sequences[0].state.isCalled,true);
  assert.equal(before.manifest.catalogSha256,hash(before.manifest.tables.map(currentInventorySchemaMetadata)));const{contentSha256,...body}=before.manifest;
  assert.equal(contentSha256,hash(body));assert.notEqual(contentSha256,actual.manifest.contentSha256);
});
for(const kind of ['populated-pair','unknown-index','unknown-trigger','unknown-constraint','wrong-PG-version','missing-table','altered-routine'])
  test('derivation refuses '+kind+' instead of stripping or certifying it',()=>{const actual=pristine(),pair=actual.manifest.tables.find(row=>row.table==='pf_automatic_pair_dispatch');
    if(kind==='populated-pair'){pair.rows='1';pair.rawBytes='1';}
    if(kind==='unknown-index'){pair.definitions.indexes.push({name:'zz_undeclared_index',definition:'synthetic',valid:true,ready:true});actual.globals.relations.push(relation('zz_undeclared_index','i'));actual.globals.relations.sort((a,b)=>order(a.name,b.name));}
    if(kind==='unknown-trigger')pair.definitions.triggers.push({name:'zz_undeclared',definition:'synthetic',enabled:'O'});
    if(kind==='unknown-constraint')pair.definitions.constraints.push({name:'zz_undeclared',definition:'synthetic',validated:true});
    if(kind==='wrong-PG-version')actual.manifest.database.serverVersionNum='170000';
    if(kind==='missing-table'){actual.manifest.tables=actual.manifest.tables.filter(row=>row.table!==pair.table);const names=new Set([pair.table,...pair.definitions.indexes.map(row=>row.name)]);actual.globals.relations=actual.globals.relations.filter(row=>!names.has(row.name));}
    if(kind==='altered-routine')actual.globals.routines.find(row=>row.name===V6_MIGRATION_POLICY.addedRoutine).arguments='extra text';reseal(actual);
    assert.throws(()=>deriveSimulatedV6Before(actual));
  });
test('derivation refuses extra, hidden and accessor top-level controls without invoking accessors',()=>{
  for(const decorate of [v=>{v.extra=true;},v=>Object.defineProperty(v,'hidden',{value:true}),v=>Object.defineProperty(v,'manifest',{enumerable:true,get(){throw Error('GETTER_MUST_NOT_RUN');}})]){
    const value=pristine();decorate(value);assert.throws(()=>deriveSimulatedV6Before(value),{code:'U7_V6_CATALOG_FACTS'});
  }
});
test('catalog operator source contains only read-only capture APIs and labels the simulated baseline honestly',async()=>{
  const source=await fs.readFile(new URL('./automatic-pair-v6-catalog-qualification.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('loadOwnedPairSqlFixture(filename)'));assert.ok(source.includes('default_transaction_read_only=on'));
  assert.ok(source.includes('captureLosslessInventory(pool'));assert.ok(source.includes('capturePublicGlobals(pool'));
  assert.ok(source.includes('simulatedBefore: true, realMigration: false, databaseMutations: false'));
  assert.ok(source.includes("fs.open(output, 'wx', 0o600)"));assert.ok(source.includes('same(sourcePins, await pinSources(files))'));
  assert.doesNotMatch(source,/initializeDatabase\(|initializePathFinder\(|initializeAutomaticPairSchema\(|CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE cables|process\.env\s*=/);
});
