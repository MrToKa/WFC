import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalPass,terminalTotals,childEdgesJoined,workerEntriesJoined} from './run.mjs';
import path from 'node:path';

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
const edge=(parentPid,childPid,ordinal)=>({schemaVersion:'wfc.preparer.baseline-edge.v1',phase:'guard',parentPid,childPid,ordinal,kind:'node'});
test('durable child edges require exact close and a guard report for normal Node exit',()=>{
 const start=edge(10,11,1),end={...start,code:0,signal:null};
 assert.equal(childEdgesJoined([start],[end],[{pid:11}],'guard'),true);
 assert.equal(childEdgesJoined([start],[],[{pid:11}],'guard'),false);
 assert.equal(childEdgesJoined([start],[end],[],'guard'),false);
 assert.equal(childEdgesJoined([start],[{...end,childPid:12}],[{pid:11}],'guard'),false);
 assert.equal(childEdgesJoined([start,start],[end,end],[{pid:11}],'guard'),false);
});
test('killed fixture leaf still requires parent-observed close and every descendant edge',()=>{
 const leaf=edge(10,11,1),closed={...leaf,code:null,signal:'SIGKILL'};
 assert.equal(childEdgesJoined([leaf],[closed],[],'guard'),true);
 const descendant=edge(11,12,1);
 assert.equal(childEdgesJoined([leaf,descendant],[closed],[],'guard'),false);
 assert.equal(childEdgesJoined([leaf],[{...closed,signal:null}],[],'guard'),false);
});
