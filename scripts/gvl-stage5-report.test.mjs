import test from 'node:test';
import assert from 'node:assert/strict';
import {projectId,buildReport,captureSnapshot} from './gvl-stage5-report.mjs';
import {compactEvidence} from './gvl-stage5-generate.mjs';

const current={modelVersionId:'M1',selectionRevision:'4',aggregateId:'A',artifactId:'V',captureFrameId:'F',traceId:'T'};
function data() {
  const cables=[{id:'C1',tag:'power',from:'Alias 1',to:'End 2'},{id:'C2',tag:'control',from:'End 2',to:'End 3'}];
  const baseline={projectId,current,modelLabel:'test',resultsSha256:'source',cables,
    locations:[{id:'L2',bindingId:'B2'}],
    evidence:[{locationId:'L1',name:'End 1',method:'own-tag',impactId:'I1',bindingId:'B1',objectIds:[13]},
      {locationId:'L3',name:'End 3',reason:'DOCUMENT_PARENT_NOT_IN_MODEL',status:'not-found',candidates:[{tag:'P3',objectIds:[]}]}]};
  const snapshot={projectId,current,capturedAt:'2026-11-21T00:00:00Z',registryRevision:'7',cables:cables.map((c,i)=>({...c,routing:i?null:'/TRAY',manual:!i})),
    locations:[{id:'L1',name:'End 1',bindingId:'B1',ready:true},{id:'L2',name:'End 2',bindingId:'B2',ready:true},{id:'L3',name:'End 3',ready:false}],
    aliases:[{name:'Alias 1',id:'L1'}],receipts:[{receiptId:'R1',impactId:'I1',bindingId:'B1',locationId:'L1',jobId:'J1'}],
    latestJobs:[{id:'C2',jobId:'J2',status:'locations_required'}]};
  return {baseline,snapshot};
}
test('distinct locations and exact receipts reconcile, unchanged sources replay idempotently',()=>{
  const {baseline,snapshot}=data(),report=buildReport(baseline,snapshot);
  assert.deepEqual(report.summary,{locations:3,assigned:1,preserved:1,otherReady:0,unresolved:1,cables:2,routed:1,unrouted:1,manualProtected:1,changedTags:0,blankSides:0});
  assert.deepEqual(buildReport(baseline,structuredClone(snapshot)),report);
  assert.equal(report.assigned[0].receiptId,'R1');assert.equal(report.assigned[0].jobId,'J1');
  assert.equal(report.unresolved[0].cables[0].side,'to');
  assert.equal(report.routingBlocked[0].latestJobId,'J2');
});
test('new scope retains audit while retiring prior bindings and candidate object IDs',()=>{
  const {baseline,snapshot}=data();snapshot.current={...current,traceId:'new'};snapshot.locations[0].ready=false;snapshot.locations[0].bindingStatus='confirmed';
  const report=buildReport(baseline,snapshot);
  assert.equal(report.scopeStatus,'changed');assert.equal(report.assigned.length,0);assert.equal(report.audit[0].status,'changed-scope');
  assert.ok(report.unresolved.some(r=>r.status==='obsolete'));assert.ok(report.unresolved.every(r=>r.candidates.length===0));
});
test('a saved receipt only counts if both the location and live binding match',()=>{
  for(const x of [{bindingId:'wrong'},{locationId:'wrong'}]){
    const {baseline,snapshot}=data();Object.assign(snapshot.receipts[0],x);
    const report=buildReport(baseline,snapshot);assert.equal(report.assigned.length,0);assert.equal(report.audit[0].status,'unverified');assert.equal(report.summary.otherReady,1);
  }
});
test('a ready replacement has separate current ownership and historical lineage',()=>{
  const {baseline,snapshot}=data();snapshot.locations[0].bindingId='B-new';
  const report=buildReport(baseline,snapshot);assert.equal(report.audit[0].status,'superseded');assert.equal(report.summary.otherReady,1);
});
test('unregistered names retain each affected side while blank sides are counted per cable',()=>{
  const {baseline,snapshot}=data();snapshot.cables[0].from='new';snapshot.cables[1].from=' NEW ';snapshot.cables[1].to='';
  const report=buildReport(baseline,snapshot);assert.equal(report.unresolved[0].locationId,null);assert.equal(report.unresolved[0].cables.length,2);
  assert.equal(report.summary.blankSides,1);assert.equal(report.summary.changedTags,2);
});
test('ambiguous registry aliases and duplicates refuse publication',()=>{
  const {baseline,snapshot}=data();
  snapshot.aliases.push({name:'end 2',id:'L3'});
  assert.throws(()=>buildReport(baseline,snapshot),/CONFLICTING_LOCATION/);
  snapshot.receipts.push(snapshot.receipts[0]);
  assert.throws(()=>buildReport(baseline,snapshot),/DUPLICATE_ASSIGNMENT/);
});
test('only sourced compact evidence is shown, repeated references deduplicate',()=>{
  const doc={documentId:'drawing.pdf',page:4};
  const compact=compactEvidence({name:'motor',documentEvidence:[doc],ownTagEvidence:[doc],
    documentParents:[{tag:'15-P0',evidence:[doc]}],parentSearch:[{tag:'15-P0',objectHits:[{dbId:43}]}]});
  assert.deepEqual(compact.documents,[{source:'drawing.pdf',page:4}]);assert.deepEqual(compact.candidates,[{tag:'15-P0',objectIds:[43]}]);
});
test('snapshot rejects cross-project requests before acquiring a database connection',async()=>{
  await assert.rejects(captureSnapshot({},'another',{}),/PROJECT_MISMATCH/);
});
test('a failed readiness check rolls back and releases its read-only transaction',async()=>{
  const events=[];
  const conn={query:async sql=>{events.push(sql);return {rows:[]};},release:()=>events.push('release')};
  const repo={readCurrentEndpointBindingContext:async c=>c.query('UPDATE cables SET tag=$1',[])};
  await assert.rejects(captureSnapshot({connect:async()=>conn},projectId,repo),/READ_ONLY_QUERY/);
  assert.deepEqual(events,['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',"SET LOCAL statement_timeout='15s'",'ROLLBACK','release']);
});
