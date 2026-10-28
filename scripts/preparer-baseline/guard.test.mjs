import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn,fork} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isolationCounters,isolationDiagnostics,portGrantMatchesClose,assertTrustedPowerShellPin} from './isolation.mjs';
import {diagnosticObservationValid,workerEntriesJoined} from './run.mjs';
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
test('only the exact root-pinned Windows ACL executable can protect a fresh owned scratch directory',async()=>{
 const control=JSON.parse(await fs.readFile(process.env.PREPARER_BASELINE_CONTROL,'utf8'));
 if(process.platform!=='win32'){assert.equal(control.powershellPin,null);assert.throws(()=>assertTrustedPowerShellPin(),/BASELINE_TRUSTED_EXECUTABLE_CHANGED/);return;}
 assert.equal(assertTrustedPowerShellPin(),true);assert.ok(BigInt(control.powershellPin.nlink)>0n);
 const before=isolationCounters().denied;
 for(const change of [{path:path.join(control.work,'scratch','powershell.exe')},{sha256:'0'.repeat(64)},{ino:'0'},{dev:String(BigInt(control.powershellPin.dev)+1n)},
  {bytes:control.powershellPin.bytes+1},{nlink:String(BigInt(control.powershellPin.nlink)+1n)},{extra:true}])assert.throws(()=>assertTrustedPowerShellPin({...control.powershellPin,...change}),/BASELINE_TRUSTED_EXECUTABLE_CHANGED/);
 assert.equal(isolationCounters().denied,before,'Pin checks are not attempted external operations.');
 const directory=await fs.mkdtemp(path.join(control.work,'scratch','guard-acl-'));
 const {secureDirectory}=await import(pathToFileURL(path.join(control.work,'model-preparer','ops','common.mjs')).href);
 await secureDirectory(directory);assert.equal((await fs.stat(directory)).isDirectory(),true);
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
 const rows=isolationDiagnostics().denials;assert.deepEqual(rows.map(row=>row.operation),['FETCH_DESTINATION','SOCKET_DESTINATION','CHILD_EXECUTABLE','CHILD_EXECUTABLE','CHILD_OPTIONS','CHILD_ENVIRONMENT','CHILD_OPTIONS','CHILD_FORK']);
 assert.ok(rows.every(row=>row.file==='harness/guard.test.mjs'&&Number.isInteger(row.line)&&row.line>0));assert.doesNotMatch(JSON.stringify(rows),/example\.invalid|cmd\.exe|APS_CLIENT_SECRET|synthetic-not-forwarded|C:\\/);
});
test('denial evidence is capped independently and never contains destination secrets',async()=>{
 const result=await run(process.execPath,[fixture,'denial-cap']),value=JSON.parse(result.stdout);assert.equal(result.stderr,'');assert.equal(value.denials.length,32);assert.equal(value.denialsDropped,8);assert.equal(value.stages.length,0);
 assert.ok(value.denials.every(row=>row.operation==='FETCH_DESTINATION'&&row.file==='harness/child.mjs'&&Number.isInteger(row.line)));
 assert.doesNotMatch(result.stdout,/private-user|private-password|example\.invalid|private-path|private-query|https?:|C:\\/);
});
test('only a positively observed exact killed child retires its own port grant',async()=>{
 const control=JSON.parse(await fs.readFile(process.env.PREPARER_BASELINE_CONTROL,'utf8')),child=spawn(process.execPath,[fixture,'listen'],{stdio:['ignore','pipe','pipe']});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 try{const line=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('FIXTURE_LISTEN_TIMEOUT')),5000);child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timer);resolve(text.trim());}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',()=>{clearTimeout(timer);reject(Error('FIXTURE_EARLY_CLOSE'));});});
  const {port}=JSON.parse(line),file=path.join(control.ports,'port-'+port+'.json'),bytes=await fs.readFile(file),grant=JSON.parse(bytes),starts=[];for(const name of await fs.readdir(control.edges))if(name.endsWith('.start.json'))starts.push({name,value:JSON.parse(await fs.readFile(path.join(control.edges,name),'utf8'))});
  const edge=starts.find(row=>row.value.parentPid===process.pid&&row.value.childPid===child.pid);assert.ok(edge);assert.equal(portGrantMatchesClose(grant,edge.value,'SIGKILL'),true);
  for(const change of [{pid:grant.pid+1},{parentPid:grant.parentPid+1},{nonce:'00000000-0000-4000-8000-000000000000'},{grantId:'00000000-0000-4000-8000-000000000000'},{extra:true}])assert.equal(portGrantMatchesClose({...grant,...change},edge.value,'SIGKILL'),false);
  assert.equal(portGrantMatchesClose(grant,edge.value,null),false);assert.equal(portGrantMatchesClose(grant,{...edge.value,kind:'acl'},'SIGKILL'),false);assert.equal(await fs.readFile(file,'utf8'),bytes.toString('utf8'),'Read-only rejection checks do not alter a grant');
  assert.equal(child.kill('SIGKILL'),true);assert.equal((await closed).signal,'SIGKILL');await assert.rejects(fs.stat(file),{code:'ENOENT'});
  const receipt=JSON.parse(await fs.readFile(path.join(control.edges,edge.name.replace('.start.json','.close.json')),'utf8'));assert.deepEqual(receipt.retiredPorts,[{name:path.basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),grant}]);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
});

test('a killed pending worker retains only an observational checkpoint, never a terminal guard proof',async()=>{
 const control=JSON.parse(await fs.readFile(process.env.PREPARER_BASELINE_CONTROL,'utf8')),child=spawn(process.execPath,[fixture,'diagnostic-hang'],{stdio:['ignore','pipe','pipe']});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 try{
  await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('FIXTURE_DIAGNOSTIC_TIMEOUT')),5000);child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('diagnostic-pending\n')){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',()=>{clearTimeout(timer);reject(Error('FIXTURE_EARLY_CLOSE'));});});
  const file=path.join(control.evidence,'diagnostics-'+child.pid+'.json'),before=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(diagnosticObservationValid(before,{phase:control.phase,nonce:control.nonce}),true);
  assert.ok(before.stages.some(row=>row.code==='GENERATION_READ'&&row.count===1&&row.pending===1&&row.completed===0));
  assert.equal(before.observationOnly,true);assert.equal(Object.hasOwn(before,'exitCode'),false);
  assert.equal(child.kill('SIGKILL'),true);assert.equal((await closed).signal,'SIGKILL');
  const bytes=await fs.readFile(file),retained=JSON.parse(bytes);assert.ok(bytes.length<=16384);
  assert.equal(diagnosticObservationValid(retained,{phase:control.phase,nonce:control.nonce}),true);
  assert.ok(retained.stages.some(row=>row.code==='GENERATION_READ'&&row.pending===1));
  await assert.rejects(fs.stat(path.join(control.evidence,'guard-'+child.pid+'.json')),{code:'ENOENT'});
  assert.equal(workerEntriesJoined([retained],[fixture]),false,'Partial sidecars do not supply the required exact worker exit');
  assert.doesNotMatch(bytes.toString('utf8'),/https?:|127\.0\.0\.1|headers|password|rawStack/);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
});
