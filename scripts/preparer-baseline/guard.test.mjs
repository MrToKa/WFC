import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn,fork} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isolationCounters} from './isolation.mjs';
const fixture=fileURLToPath(new URL('./child.mjs',import.meta.url)),run=promisify(execFile),refused=error=>error?.code==='BASELINE_EXTERNAL_OPERATION_REFUSED';
test('callback execFile preserves both streams and exit failure',async()=>{
 const success=await new Promise((resolve,reject)=>execFile(process.execPath,[fixture],(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));assert.deepEqual(success,{stdout:'fixture-out',stderr:'fixture-error'});
 await new Promise((resolve,reject)=>execFile(process.execPath,[fixture,'fail'],(error,stdout,stderr)=>{try{assert.equal(error.code,7);assert.equal(stdout,'fixture-out');assert.equal(stderr,'fixture-error');resolve();}catch(e){reject(e);}}));
});
test('custom promisification preserves object result, child and rejection streams',async()=>{
 const promise=run(process.execPath,[fixture],{env:{}});assert.ok(promise.child?.pid);assert.deepEqual(await promise,{stdout:'fixture-out',stderr:'fixture-error'});
 const failed=run(process.execPath,[fixture,'fail']);assert.ok(failed.child?.pid);await assert.rejects(failed,e=>e.code===7&&e.stdout==='fixture-out'&&e.stderr==='fixture-error');
});
test('child guard controls remain pinned after parent environment mutation',async()=>{
 const names=['NODE_OPTIONS','PREPARER_BASELINE_CONTROL','PREPARER_BASELINE_CONTROL_SHA256'],saved=names.map(key=>[key,process.env[key]]);
 try{for(const key of names)delete process.env[key];assert.deepEqual(await run(process.execPath,[fixture,'guard-state']),{stdout:'guard-active',stderr:''});}
 finally{for(const[key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('registered ephemeral loopback HTTP works',async()=>{
 assert.equal((await new Promise((resolve,reject)=>dns.lookup('127.0.0.1',(error,address,family)=>error?reject(error):resolve({address,family})))).address,'127.0.0.1');
 assert.equal((await dns.promises.lookup('::1')).address,'::1');
 const server=http.createServer((_req,res)=>res.end('owned'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{assert.equal(await(await fetch('http://127.0.0.1:'+server.address().port)).text(),'owned');}finally{await new Promise(resolve=>server.close(resolve));}
});
test('eight intentional refusals cover external/fixed targets, subprocess paths, shell/env/cwd/execArgv injection',async()=>{
 const before=isolationCounters().denied;
 await assert.rejects(()=>fetch('https://example.invalid/'),refused);
 assert.throws(()=>net.connect({host:'127.0.0.1',port:5180}),refused);
 assert.throws(()=>execFile('cmd.exe',['/c','echo refused']),refused);
 await assert.rejects(()=>run('cmd.exe',['/c','echo refused']),refused);
 assert.throws(()=>spawn(process.execPath,[fixture],{shell:true}),refused);
 assert.throws(()=>execFile(process.execPath,[fixture],{env:{APS_CLIENT_SECRET:'synthetic-not-forwarded'}}),refused);
 assert.throws(()=>execFile(process.execPath,[fixture],{cwd:path.parse(fixture).root}),refused);
 assert.throws(()=>fork(fixture,[],{execArgv:['--import','outside.mjs']}),refused);
 assert.equal(isolationCounters().denied-before,8);
});
