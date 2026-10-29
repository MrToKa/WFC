import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePublicGlobals,validatePublicGlobals,GLOBAL_SQL_V2} from './global-sql-v2.mjs';
const grant={grantor:'owner',grantee:'PUBLIC',privilege:'EXECUTE',isGrantable:false};
const value=()=>({schemaVersion:'wfc.pf.public-global-sql.v2',namespace:{owner:'pg_database_owner',acl:[{...grant}]},relations:[],views:[{name:'catalog',definition:' SELECT 1 AS value;',columns:[{name:'value',type:'integer',collation:null}]}],routines:[],
  sequences:[{definition:{name:'very"large',dataType:'bigint',start:'1',min:'1',max:'9223372036854775807',increment:'1',cycle:false,cache:'1'},
    owner:'owner',acl:[],ownership:[{dependencyKind:'i',tableSchema:'public',table:'t',column:'ordinal',identity:'a'}],state:{lastValue:'9007199254740993',isCalled:true}}],extensions:[],unsupportedObjects:[]});
function mock({failure,unsupported=[]}={}) {
  const calls=[],f=value(),client={release(){calls.push('release');},async query(q){const sql=typeof q==='string'?q:q.text;calls.push(sql);
    if(failure&&sql===GLOBAL_SQL_V2.routines)throw Error('injected');
    if(sql===GLOBAL_SQL_V2.namespace)return{rows:[{value:f.namespace}]};
    if(sql===GLOBAL_SQL_V2.relations||sql===GLOBAL_SQL_V2.routines||sql===GLOBAL_SQL_V2.extensions)return{rows:[]};
    if(sql===GLOBAL_SQL_V2.views)return{rows:f.views.map(value=>({value}))};
    if(sql===GLOBAL_SQL_V2.sequences){const {state,...seq}=f.sequences[0];return{rows:[{value:seq}]};}
    if(sql.startsWith('SELECT last_value'))return{rows:[f.sequences[0].state]};
    if(sql===GLOBAL_SQL_V2.unsupported)return{rows:unsupported};return{rows:[]};}};
  return{calls,pool:{async connect(){return client;}}};
}
test('read-only collection preserves large decimal strings, quotes identifiers and releases transaction',async()=>{
  const m=mock(),r=await capturePublicGlobals(m.pool);assert.deepEqual(r,value());
  assert.ok(m.calls.includes('SELECT last_value::text AS "lastValue",is_called AS "isCalled" FROM public."very""large"'));
  assert.equal(m.calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.deepEqual(m.calls.slice(-2),['COMMIT','release']);
});
test('collector retains unsupported facts for explicit qualifier refusal',async()=>{
  const unsupported=[{kind:'type:e',name:'foreign_enum'}];const r=await capturePublicGlobals(mock({unsupported}).pool);assert.deepEqual(r.unsupportedObjects,unsupported);
});
test('collector rolls back on SQL failure and cannot return success',async()=>{
  const m=mock({failure:true});await assert.rejects(()=>capturePublicGlobals(m.pool),/injected/);assert.deepEqual(m.calls.slice(-2),['ROLLBACK','release']);
});
test('already cancelled capture does not acquire a client',async()=>{
  const m=mock(),c=new AbortController();c.abort();await assert.rejects(()=>capturePublicGlobals(m.pool,{signal:c.signal}),{code:'B9_GLOBAL_INTERRUPTED'});assert.deepEqual(m.calls,[]);
});
test('precision loss, malformed ownership and duplicate ACLs refuse',()=>{
  for(const mutation of [v=>v.sequences[0].state.lastValue=9007199254740992,v=>v.sequences[0].ownership[0].column=null,
    v=>v.sequences[0].ownership[0].dependencyKind='n',v=>v.namespace.acl.push(grant),v=>v.namespace.acl[0].grantor=null]){
    const v=value();mutation(v);assert.throws(()=>validatePublicGlobals(v));
  }
});
test('ACL queries use effective defaults and role names; sequence ownership contains normalized pg_depend facts',()=>{
  for(const key of ['namespace','relations','routines','sequences'])assert.match(GLOBAL_SQL_V2[key],/aclexplode\(COALESCE/);
  assert.match(GLOBAL_SQL_V2.sequences,/pg_depend/);assert.match(GLOBAL_SQL_V2.sequences,/'identity',a.attidentity/);
  assert.match(GLOBAL_SQL_V2.unsupported,/pg_default_acl/);assert.match(GLOBAL_SQL_V2.unsupported,/column-acl/);
  assert.match(GLOBAL_SQL_V2.unsupported,/pg_inherits/);assert.match(GLOBAL_SQL_V2.unsupported,/pg_event_trigger/);assert.match(GLOBAL_SQL_V2.unsupported,/table-access-method/);
});
