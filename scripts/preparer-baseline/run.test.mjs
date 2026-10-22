import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalPass,terminalTotals,childEdgesJoined,workerEntriesJoined,baselineArguments,baselineSummaryStatus,guardDiagnosticsValid,diagnosticObservationValid} from './run.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const complete={exitCode:0,signal:null,killed:false,spawnFailure:null,joined:true,tests:2,pass:2,fail:0,cancelled:0,skipped:0,todo:0};
test('positive terminal TAP and a joined zero exit are both mandatory',()=>{
 assert.equal(terminalPass(complete),true);
 for(const delta of [{tests:0,pass:0},{fail:1},{cancelled:1},{skipped:1},{todo:1},{tests:3},{pass:1},{tests:1,pass:2},{joined:false},{killed:true},{exitCode:1},{signal:'SIGKILL'},{spawnFailure:'ENOENT'},{todo:null}])assert.equal(terminalPass({...complete,...delta}),false);
 assert.equal(terminalPass({...complete,...terminalTotals('ok 1 - partial\n')}),false);
 assert.deepEqual(terminalTotals('# tests 2\r\n# pass 2\r\n# fail 0\r\n# cancelled 0\r\n# skipped 0\r\n# todo 0\r\n'),{tests:2,pass:2,fail:0,cancelled:0,skipped:0,todo:0});
});
test('every exact test-worker entrypoint must report one normal successful exit',()=>{
 const first=path.resolve('first.test.mjs'),second=path.resolve('second.test.mjs'),reports=[{pid:11,entrypoint:first,exitCode:0},{pid:12,entrypoint:second,exitCode:0}];
 assert.equal(workerEntriesJoined(reports,[first,second]),true);
 assert.equal(workerEntriesJoined(reports.slice(0,1),[first,second]),false);
 assert.equal(workerEntriesJoined([...reports,reports[0]],[first,second]),false);
 assert.equal(workerEntriesJoined([reports[0],{...reports[1],exitCode:1}],[first,second]),false);
 assert.equal(workerEntriesJoined([{pid:99,entrypoint:path.resolve('controller.mjs'),exitCode:0}],[first,second]),false);
 assert.equal(workerEntriesJoined(reports,[]),false);
});
const edge=(parentPid,childPid,ordinal)=>({schemaVersion:'wfc.preparer.baseline-edge.v2',phase:'guard',parentPid,childPid,ordinal,kind:'node',grantId:'ce89170c-419c-4d8b-aa12-73547b35d264'});
test('durable child edges require exact close and a guard report for normal Node exit',()=>{
 const start=edge(10,11,1),end={...start,code:0,signal:null,retiredPorts:[]};
 assert.equal(childEdgesJoined([start],[end],[{pid:11}],'guard'),true);
 assert.equal(childEdgesJoined([start],[],[{pid:11}],'guard'),false);
 assert.equal(childEdgesJoined([start],[end],[],'guard'),false);
 assert.equal(childEdgesJoined([start],[{...end,childPid:12}],[{pid:11}],'guard'),false);
 assert.equal(childEdgesJoined([start,start],[end,end],[{pid:11}],'guard'),false);
});
test('killed fixture leaf still requires parent-observed close and every descendant edge',()=>{
 const leaf=edge(10,11,1),closed={...leaf,code:null,signal:'SIGKILL',retiredPorts:[]};
 assert.equal(childEdgesJoined([leaf],[closed],[],'guard'),true);
 const descendant=edge(11,12,1);
 assert.equal(childEdgesJoined([leaf,descendant],[closed],[],'guard'),false);
 assert.equal(childEdgesJoined([leaf],[{...closed,signal:null}],[],'guard'),false);
});
test('diagnostic file selection admits only literal known suite-relative test files',()=>{
 const base=['--work',path.resolve('owned'),'--suite','preparer'];assert.deepEqual(baselineArguments(base),{work:base[1],suite:'preparer',testFile:null});
 assert.equal(baselineArguments([...base,'--test-file','app-test/workspace-service.test.mjs']).testFile,'app-test/workspace-service.test.mjs');
 assert.equal(baselineArguments([...base,'--test-file','test/ops.test.mjs']).testFile,'test/ops.test.mjs');
 for(const file of ['../app-test/workspace-service.test.mjs','app-test\\workspace-service.test.mjs','./app-test/workspace-service.test.mjs','app-test/unknown.test.mjs','test/../test/ops.test.mjs','test\\ops.test.mjs','--eval','file:///private.mjs',path.resolve('app-test/workspace-service.test.mjs')])assert.throws(()=>baselineArguments([...base,'--test-file',file]),{code:'BASELINE_TEST_FILE'});
 for(const suite of ['all','guard','package'])assert.throws(()=>baselineArguments(['--work',base[1],'--suite',suite,'--test-file','app-test/workspace-service.test.mjs']),{code:'BASELINE_TEST_FILE'});
 assert.throws(()=>baselineArguments([...base,'--test-file','app-test/workspace-service.test.mjs','--test-name-pattern','Generate']),{code:'BASELINE_ARGUMENTS'});
});
test('a passing diagnostic subset can never claim the full requested baseline passed',()=>{
 const passing=[{status:'PASS'},{status:'PASS'}];assert.equal(baselineSummaryStatus(passing,2,true,true),'PASS');assert.equal(baselineSummaryStatus(passing,2,true,true,'app-test/workspace-service.test.mjs'),'SUBSET_PASS');
 for(const args of [[passing.slice(0,1),2,true,true],[passing,2,false,true],[passing,2,true,false],[[{status:'FAIL'}],1,true,true]])assert.equal(baselineSummaryStatus(...args,'app-test/workspace-service.test.mjs'),'FAIL');
});
test('safe denial diagnostics reject unbounded, absolute, unknown or secret-bearing metadata',()=>{
 const row={operation:'FETCH_DESTINATION',atMs:1,file:'model-preparer/app/workspace-service.mjs',line:10},record={counts:{denied:1},denials:[row],denialsDropped:0,stages:[{code:'INNER_ACTION',count:1,completed:1,pending:0,firstAtMs:0,lastAtMs:10,totalMs:10,maxMs:10,lastOutcome:'HTTP_OK'}]};assert.equal(guardDiagnosticsValid(record),true);
 for(const denials of [[{...row,file:'C:/secret.mjs'}],[{...row,file:'model-preparer/../secret.mjs'}],[{...row,line:0}],[{...row,operation:'https://secret.invalid'}],[{...row,url:'private'}],Array(33).fill(row)])assert.equal(guardDiagnosticsValid({...record,denials}),false);
 assert.equal(guardDiagnosticsValid({...record,denialsDropped:1}),false);assert.equal(guardDiagnosticsValid({...record,stages:[{...record.stages[0],code:'UNKNOWN'}]}),false);
 assert.equal(guardDiagnosticsValid({...record,stages:[record.stages[0],record.stages[0]]}),false);
});
test('retired port evidence stays bound to exact child, launch grant and observed kill',()=>{
 const start=edge(10,11,1),grant={schemaVersion:'wfc.preparer.baseline-port.v2',nonce:'5676078a-6445-4d89-854a-59376b765ebd',pid:11,port:55001,host:'127.0.0.1',parentPid:10,grantId:start.grantId},retired={name:'port-55001.json',sha256:createHash('sha256').update(JSON.stringify(grant)).digest('hex'),grant},closed={...start,code:null,signal:'SIGKILL',retiredPorts:[retired]};
 assert.equal(childEdgesJoined([start],[closed],[],'guard'),true);
 for(const change of [{signal:null,code:0},{retiredPorts:[{...retired,sha256:'0'.repeat(64)}]},{retiredPorts:[{...retired,grant:{...grant,pid:12}}]},{retiredPorts:[{...retired,grant:{...grant,grantId:'00000000-0000-4000-8000-000000000000'}}]},{retiredPorts:[retired,retired]}])assert.equal(childEdgesJoined([start],[{...closed,...change}],[],'guard'),false);
});

test('partial diagnostic checkpoints accept only capped safe observations and cannot replace terminal proof',()=>{
 const nonce='5676078a-6445-4d89-854a-59376b765ebd',record={schemaVersion:'wfc.preparer.baseline-diagnostics.v1',observationOnly:true,phase:'preparer',nonce,pid:11,
  entrypoint:'model-preparer/app-test/workspace-service.test.mjs',sequence:2,atMs:10,checkpoint:'NEW_STAGE',writeFailures:0,
  counts:{fetch:1,connect:0,listen:0,children:0,denied:0},denials:[],denialsDropped:0,
  stages:[{code:'GENERATION_READ',count:1,completed:0,pending:1,firstAtMs:1,lastAtMs:1,totalMs:0,maxMs:0,lastOutcome:'PENDING'}]};
 assert.equal(diagnosticObservationValid(record,{phase:'preparer',nonce}),true);
 for(const delta of [{exitCode:0},{joined:true},{portsClosed:true},{rawStack:'private'},{url:'https://private.invalid'},
  {checkpoint:'private-stage'},{entrypoint:'C:/private.mjs'},{entrypoint:'model-preparer/../private.mjs'},
  {sequence:0},{atMs:0},{writeFailures:-1},{observationOnly:false},{counts:{...record.counts,secret:'private'}},
  {denials:Array(33).fill({operation:'FETCH_DESTINATION',atMs:1,file:null,line:null})}])
  assert.equal(diagnosticObservationValid({...record,...delta},{phase:'preparer',nonce}),false);
 assert.equal(diagnosticObservationValid(record,{phase:'guard',nonce}),false);
 assert.equal(diagnosticObservationValid(record,{phase:'preparer',nonce:'00000000-0000-4000-8000-000000000000'}),false);
 assert.equal(workerEntriesJoined([record],[path.resolve(record.entrypoint)]),false);
 assert.equal(terminalPass({...complete,joined:false,diagnostics:{observationOnly:true,status:'AVAILABLE',records:[record]}}),false);
 assert.equal(terminalPass({...complete,pass:1,diagnostics:{observationOnly:true,status:'AVAILABLE',records:[record]}}),false);
});
